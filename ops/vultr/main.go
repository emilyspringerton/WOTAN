// wotan-vultr: provision a Vultr instance that serves WOTAN (static, nginx, HTTPS behind Cloudflare).
//
//	plan                     read-only: checks the env, shows Vultr's own price for the plan, spends nothing
//	apply [--dns]            buys ONE instance (only if WOTAN_CONFIRM_MONTHLY_USD equals the plan's price),
//	                         optionally points WOTAN_DOMAIN at it on Cloudflare (old records saved for rollback)
//	status --instance ID     shows the instance's state
//	destroy --instance ID    deletes it (WOTAN_CONFIRM_DESTROY=ID required); --restore-dns puts DNS back first
//
// See README.md. Run with GOWORK=off from inside the monorepo (its go.work does not list this module).
package main

import (
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "plan":
		err = cmdPlan(os.Args[2:])
	case "apply":
		err = cmdApply(os.Args[2:])
	case "status":
		err = cmdStatus(os.Args[2:])
	case "destroy":
		err = cmdDestroy(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "STOPPED:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: wotan-vultr plan | apply [--dns] | status --instance ID | destroy --instance ID [--restore-dns]")
}

type checked struct {
	cfg   config
	plan  *vPlan
	os    *vOS
	vultr *api
	cf    *api // nil without a Cloudflare token
}

// prepare loads and validates config and looks everything up read-only. It prints hints for missing choices.
func prepare(needKey bool) (*checked, error) {
	c, missing := loadConfig(os.Getenv)
	if err := c.validate(); err != nil {
		return nil, err
	}
	key, err := secret("VULTR_API_KEY")
	if err != nil {
		return nil, err
	}
	if needKey && key == "" {
		missing = append(missing, "VULTR_API_KEY_FILE (or VULTR_API_KEY)")
	}
	c.VultrKey = key
	if c.CFToken, err = secret("CLOUDFLARE_API_TOKEN"); err != nil {
		return nil, err
	}
	pub := newAPI(c.VultrBase, "") // catalogue endpoints are public: plan works without any key
	if len(missing) > 0 {
		hint(pub, c, missing)
		return nil, fmt.Errorf("missing or invalid: %s", strings.Join(missing, ", "))
	}
	ch := &checked{cfg: c, vultr: newAPI(c.VultrBase, key)}
	if c.CFToken != "" {
		ch.cf = newAPI(c.CFBase, c.CFToken)
	}
	if ch.plan, err = findPlan(pub, c.Plan); err != nil {
		return nil, err
	}
	if ch.os, err = findOS(pub, c.OSID); err != nil {
		return nil, err
	}
	if f := strings.ToLower(ch.os.Family); f != "debian" && f != "ubuntu" {
		return nil, fmt.Errorf("os %d (%s) is family %q: the first-boot script needs debian or ubuntu", ch.os.ID, ch.os.Name, ch.os.Family)
	}
	ok, err := planAvailable(pub, c.Region, c.Plan)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, fmt.Errorf("plan %s is not available in region %s right now", c.Plan, c.Region)
	}
	return ch, nil
}

// hint prints the real choices from Vultr's public catalogue for whatever is missing, so the founder picks from facts.
func hint(pub *api, c config, missing []string) {
	has := func(k string) bool {
		for _, m := range missing {
			if strings.HasPrefix(m, k) {
				return true
			}
		}
		return false
	}
	if has("WOTAN_VULTR_PLAN") {
		var r struct {
			Plans []vPlan `json:"plans"`
		}
		if pub.do("GET", "/plans?type=vc2&per_page=500", nil, &r) == nil {
			sort.Slice(r.Plans, func(i, j int) bool { return r.Plans[i].MonthlyCost < r.Plans[j].MonthlyCost })
			fmt.Println("Cheapest Vultr cloud-compute (vc2) plans, from Vultr's own list:")
			for i, p := range r.Plans {
				if i == 6 {
					break
				}
				fmt.Printf("  %-18s %d vCPU  %5d MB RAM  %4d GB disk  $%.2f/month\n", p.ID, p.VCPU, p.RAM, p.Disk, p.MonthlyCost)
			}
		}
	}
	if has("WOTAN_VULTR_REGION") {
		var r struct {
			Regions []struct{ ID, City, Country string } `json:"regions"`
		}
		if pub.do("GET", "/regions?per_page=500", nil, &r) == nil {
			var ids []string
			for _, x := range r.Regions {
				ids = append(ids, x.ID+"="+x.City)
			}
			fmt.Println("Regions:", strings.Join(ids, ", "))
		}
	}
	if has("WOTAN_VULTR_OS_ID") {
		var r struct {
			OS []vOS `json:"os"`
		}
		if pub.do("GET", "/os?per_page=500", nil, &r) == nil {
			fmt.Println("Debian/Ubuntu images:")
			for _, o := range r.OS {
				f := strings.ToLower(o.Family)
				if (f == "debian" || f == "ubuntu") && o.Arch == "x64" {
					fmt.Printf("  %5d  %s\n", o.ID, o.Name)
				}
			}
		}
	}
}

func tlsSource(c config, cf *api) string {
	switch {
	case c.OriginCertFile != "" && c.OriginKeyFile != "":
		return "origin cert from WOTAN_ORIGIN_CERT_FILE / WOTAN_ORIGIN_KEY_FILE"
	case cf != nil && c.OriginOutDir != "":
		return "mint a free Cloudflare Origin CA cert for " + c.Domain + " (saved to WOTAN_ORIGIN_OUT_DIR)"
	}
	return ""
}

func cmdPlan(args []string) error {
	fs := flag.NewFlagSet("plan", flag.ExitOnError)
	dns := fs.Bool("dns", false, "also check the Cloudflare side of apply --dns")
	_ = fs.Parse(args)
	ch, err := prepare(false)
	if err != nil {
		return err
	}
	c := ch.cfg
	fmt.Printf("WOTAN on Vultr: plan only, nothing bought.\n")
	fmt.Printf("  instance   %s in %s, %s (%d vCPU, %d MB RAM, %d GB disk, %d GB transfer)\n",
		c.Plan, c.Region, ch.os.Name, ch.plan.VCPU, ch.plan.RAM, ch.plan.Disk, ch.plan.Bandwidth)
	fmt.Printf("  price      $%.2f/month (Vultr's list price, backups off)\n", ch.plan.MonthlyCost)
	fmt.Printf("  serves     %s from %s @ %s\n", c.Domain, c.GitURL, c.GitRef)
	if c.IdunaUpstream != "" {
		fmt.Printf("  /api/      proxied to %s\n", c.IdunaUpstream)
	} else {
		fmt.Printf("  /api/      not proxied (WOTAN_IDUNA_UPSTREAM unset): sign-in and the store need IDUNA\n")
	}
	if src := tlsSource(c, ch.cf); src != "" {
		fmt.Printf("  TLS        %s\n", src)
	} else {
		fmt.Printf("  TLS        MISSING: set WOTAN_ORIGIN_CERT_FILE+WOTAN_ORIGIN_KEY_FILE, or CLOUDFLARE_API_TOKEN_FILE+WOTAN_ORIGIN_OUT_DIR\n")
	}
	if *dns {
		if err := checkCF(ch); err != nil {
			return err
		}
	}
	if c.VultrKey == "" {
		fmt.Println("  key        VULTR_API_KEY_FILE not set (apply needs it)")
	}
	fmt.Printf("\nTo buy it, the founder confirms the price by setting it:\n  WOTAN_CONFIRM_MONTHLY_USD=%.2f ... wotan-vultr apply%s\n",
		ch.plan.MonthlyCost, map[bool]string{true: " --dns", false: ""}[*dns])
	return nil
}

func checkCF(ch *checked) error {
	c := ch.cfg
	if ch.cf == nil || c.CFZone == "" || c.RollbackFile == "" {
		return errors.New("--dns needs CLOUDFLARE_API_TOKEN_FILE, WOTAN_CF_ZONE and WOTAN_ROLLBACK_FILE")
	}
	zid, err := cfZoneID(ch.cf, c.CFZone)
	if err != nil {
		return err
	}
	mode, err := cfSSLMode(ch.cf, zid)
	if err != nil {
		return err
	}
	fmt.Printf("  cloudflare zone %s, SSL mode %q\n", c.CFZone, mode)
	if mode != "full" && mode != "strict" {
		return fmt.Errorf("zone SSL mode is %q: this origin needs Full or Full (strict). Not changed here: the founder decides", mode)
	}
	recs, err := cfRecords(ch.cf, zid, c.Domain)
	if err != nil {
		return err
	}
	for _, r := range recs {
		fmt.Printf("  existing   %s %s -> %s (proxied=%v): would be replaced, saved to %s first\n", r.Type, r.Name, r.Content, r.Proxied, c.RollbackFile)
	}
	if _, err := os.Stat(c.RollbackFile); err == nil {
		return fmt.Errorf("WOTAN_ROLLBACK_FILE %s already exists: refusing to overwrite an earlier rollback", c.RollbackFile)
	}
	return nil
}

func cmdApply(args []string) error {
	fs := flag.NewFlagSet("apply", flag.ExitOnError)
	dns := fs.Bool("dns", false, "point WOTAN_DOMAIN at the new instance on Cloudflare (proxied)")
	_ = fs.Parse(args)
	ch, err := prepare(true)
	if err != nil {
		return err
	}
	c := ch.cfg
	if c.ConfirmMonthlyUSD == "" || !priceMatches(c.ConfirmMonthlyUSD, ch.plan.MonthlyCost) {
		return fmt.Errorf("WOTAN_CONFIRM_MONTHLY_USD=%q does not match %s's price $%.2f/month: nothing bought",
			c.ConfirmMonthlyUSD, c.Plan, ch.plan.MonthlyCost)
	}
	if tlsSource(c, ch.cf) == "" {
		return errors.New("no TLS material (see plan): nothing bought")
	}
	if *dns {
		if err := checkCF(ch); err != nil {
			return fmt.Errorf("%v: nothing bought", err)
		}
	}

	// 1. TLS first: it is free, and failing here costs nothing.
	var certPEM, keyPEM []byte
	if c.OriginCertFile != "" {
		if certPEM, err = os.ReadFile(c.OriginCertFile); err != nil {
			return err
		}
		if keyPEM, err = os.ReadFile(c.OriginKeyFile); err != nil {
			return err
		}
	} else {
		if certPEM, keyPEM, err = mintOriginCert(ch.cf, []string{c.Domain}); err != nil {
			return fmt.Errorf("minting the origin cert: %v: nothing bought", err)
		}
		if err := os.MkdirAll(c.OriginOutDir, 0o700); err != nil {
			return err
		}
		stamp := time.Now().UTC().Format("20060102T150405Z")
		for name, b := range map[string][]byte{"origin-" + stamp + ".pem": certPEM, "origin-" + stamp + ".key": keyPEM} {
			if err := os.WriteFile(c.OriginOutDir+string(os.PathSeparator)+name, b, 0o600); err != nil {
				return err
			}
		}
		fmt.Printf("Origin CA cert minted for %s, saved in %s (origin-%s.*).\n", c.Domain, c.OriginOutDir, stamp)
	}
	ud, err := renderUserData(c, certPEM, keyPEM)
	if err != nil {
		return err
	}

	// 2. The one paid call.
	in, err := createInstance(ch.vultr, c, ud)
	if err != nil {
		return err
	}
	fmt.Printf("Bought: Vultr instance %s (%s, %s, $%.2f/month). Undo: wotan-vultr destroy --instance %s\n",
		in.ID, c.Plan, c.Region, ch.plan.MonthlyCost, in.ID)
	in, err = waitActive(ch.vultr, in.ID, 10*time.Minute, 10*time.Second)
	if err != nil {
		return err
	}
	fmt.Printf("Active: %s (IPv4 %s, IPv6 %s). First boot installs nginx and pulls WOTAN (a few minutes).\n", in.ID, in.MainIP, in.V6MainIP)

	// 3. DNS, with the old records saved first.
	if !*dns {
		fmt.Printf("DNS not touched. To serve %s from it: re-run with --dns, or point a proxied A record at %s.\n", c.Domain, in.MainIP)
		return waitHTTP("http://"+in.MainIP+"/", http.StatusMovedPermanently, 10*time.Minute)
	}
	zid, err := cfZoneID(ch.cf, c.CFZone)
	if err != nil {
		return err
	}
	if err := waitHTTP("http://"+in.MainIP+"/", http.StatusMovedPermanently, 10*time.Minute); err != nil {
		return fmt.Errorf("origin never came up, DNS left untouched (instance %s still billed): %v", in.ID, err)
	}
	if err := pointDNS(ch.cf, c.CFZone, zid, c.Domain, in.MainIP, in.ID, c.RollbackFile); err != nil {
		return err
	}
	fmt.Printf("DNS: %s -> %s (proxied). Rollback: wotan-vultr destroy --instance %s --restore-dns (file %s)\n",
		c.Domain, in.MainIP, in.ID, c.RollbackFile)
	if err := waitHTTP("https://"+c.Domain+"/", http.StatusOK, 10*time.Minute); err != nil {
		return err
	}
	fmt.Printf("UP: https://%s/ answers 200 through Cloudflare with TLS verified.\n", c.Domain)
	return nil
}

// waitHTTP polls url (TLS always verified, redirects not followed) until it answers want.
func waitHTTP(u string, want int, timeout time.Duration) error {
	hc := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	deadline := time.Now().Add(timeout)
	last := ""
	for time.Now().Before(deadline) {
		resp, err := hc.Get(u)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == want {
				return nil
			}
			last = resp.Status
		} else {
			last = err.Error()
		}
		time.Sleep(10 * time.Second)
	}
	return fmt.Errorf("%s did not answer %d within %s (last: %s)", u, want, timeout, last)
}

func cmdStatus(args []string) error {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	id := fs.String("instance", "", "Vultr instance id")
	_ = fs.Parse(args)
	key, err := secret("VULTR_API_KEY")
	if err != nil || key == "" || *id == "" {
		return errors.New("status needs --instance and VULTR_API_KEY_FILE")
	}
	c, _ := loadConfig(os.Getenv)
	in, err := getInstance(newAPI(c.VultrBase, key), *id)
	if err != nil {
		return err
	}
	fmt.Printf("%s %s %s/%s/%s ip=%s ipv6=%s plan=%s region=%s\n", in.ID, in.Label, in.Status, in.PowerStatus, in.ServerState, in.MainIP, in.V6MainIP, in.Plan, in.Region)
	return nil
}

func cmdDestroy(args []string) error {
	fs := flag.NewFlagSet("destroy", flag.ExitOnError)
	id := fs.String("instance", "", "Vultr instance id")
	restore := fs.Bool("restore-dns", false, "first put DNS back from WOTAN_ROLLBACK_FILE")
	_ = fs.Parse(args)
	if *id == "" || !reID.MatchString(*id) {
		return errors.New("destroy needs --instance ID")
	}
	if os.Getenv("WOTAN_CONFIRM_DESTROY") != *id {
		return fmt.Errorf("set WOTAN_CONFIRM_DESTROY=%s to delete that instance (its disk is gone for good)", *id)
	}
	c, _ := loadConfig(os.Getenv)
	key, err := secret("VULTR_API_KEY")
	if err != nil || key == "" {
		return errors.New("destroy needs VULTR_API_KEY_FILE")
	}
	if *restore {
		tok, err := secret("CLOUDFLARE_API_TOKEN")
		if err != nil || tok == "" || c.RollbackFile == "" {
			return errors.New("--restore-dns needs CLOUDFLARE_API_TOKEN_FILE and WOTAN_ROLLBACK_FILE")
		}
		rb, err := readRollback(c.RollbackFile)
		if err != nil {
			return err
		}
		if rb.InstanceID != "" && rb.InstanceID != *id {
			return fmt.Errorf("rollback file belongs to instance %s, not %s", rb.InstanceID, *id)
		}
		if err := restoreDNS(newAPI(c.CFBase, tok), rb); err != nil {
			return fmt.Errorf("DNS restore failed, instance NOT deleted: %v", err)
		}
		fmt.Printf("DNS for %s restored to its %d earlier record(s).\n", rb.Name, len(rb.Before))
	}
	if err := deleteInstance(newAPI(c.VultrBase, key), *id); err != nil {
		return err
	}
	fmt.Printf("Deleted Vultr instance %s (billing stops).\n", *id)
	return nil
}
