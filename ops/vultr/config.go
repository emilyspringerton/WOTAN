package main

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Everything comes from the environment. Facts the founder has not confirmed (region, plan, OS, domain, price) have
// NO default: the tool stops and names the missing variable. The only defaults are facts read from GitHub itself
// (WOTAN is public, default branch main).
type config struct {
	Region, Plan string
	OSID         int
	Domain       string
	Label        string
	GitURL       string
	GitRef       string
	SSHKeyIDs    []string

	ConfirmMonthlyUSD string // must equal the plan's monthly_cost before apply spends anything

	VultrKey string
	CFToken  string
	CFZone   string

	OriginCertFile, OriginKeyFile string
	OriginOutDir                  string // where a minted origin cert+key are saved (outside any repo)
	RollbackFile                  string
	IdunaUpstream                 string
	GfdUpstream                   string
	AutopullMinutes               int

	VultrBase, CFBase string // API roots; overridable for tests only
}

var (
	reDomain = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	reSlug   = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	rePlan   = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{0,62}$`)
	reRef    = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,100}$`)
	reGitURL = regexp.MustCompile(`^https://[A-Za-z0-9.-]+/[A-Za-z0-9._/-]+$`)
	reUp     = regexp.MustCompile(`^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$`)
	reID     = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
)

// secret reads NAME_FILE (preferred: a file the founder keeps outside the repo) or NAME. The value is trimmed and
// returned; it is never printed.
func secret(name string) (string, error) {
	if p := os.Getenv(name + "_FILE"); p != "" {
		b, err := os.ReadFile(p)
		if err != nil {
			return "", fmt.Errorf("%s_FILE: %v", name, err)
		}
		return strings.TrimSpace(string(b)), nil
	}
	return strings.TrimSpace(os.Getenv(name)), nil
}

func loadConfig(getenv func(string) string) (config, []string) {
	var c config
	var missing []string
	need := func(k string) string {
		v := strings.TrimSpace(getenv(k))
		if v == "" {
			missing = append(missing, k)
		}
		return v
	}
	c.Region = need("WOTAN_VULTR_REGION")
	c.Plan = need("WOTAN_VULTR_PLAN")
	if s := need("WOTAN_VULTR_OS_ID"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n <= 0 {
			missing = append(missing, "WOTAN_VULTR_OS_ID (must be a number from GET /v2/os)")
		}
		c.OSID = n
	}
	c.Domain = strings.ToLower(need("WOTAN_DOMAIN"))
	c.Label = strings.TrimSpace(getenv("WOTAN_VULTR_LABEL"))
	if c.Label == "" {
		c.Label = "wotan"
	}
	c.GitURL = strings.TrimSpace(getenv("WOTAN_GIT_URL"))
	if c.GitURL == "" {
		c.GitURL = "https://github.com/emilyspringerton/WOTAN.git" // public, verified via the GitHub API
	}
	c.GitRef = strings.TrimSpace(getenv("WOTAN_GIT_REF"))
	if c.GitRef == "" {
		c.GitRef = "main" // the repo's default branch, verified via the GitHub API
	}
	for _, s := range strings.Split(getenv("WOTAN_VULTR_SSH_KEY_IDS"), ",") {
		if s = strings.TrimSpace(s); s != "" {
			c.SSHKeyIDs = append(c.SSHKeyIDs, s)
		}
	}
	c.ConfirmMonthlyUSD = strings.TrimSpace(getenv("WOTAN_CONFIRM_MONTHLY_USD"))
	c.CFZone = strings.ToLower(strings.TrimSpace(getenv("WOTAN_CF_ZONE")))
	c.OriginCertFile = strings.TrimSpace(getenv("WOTAN_ORIGIN_CERT_FILE"))
	c.OriginKeyFile = strings.TrimSpace(getenv("WOTAN_ORIGIN_KEY_FILE"))
	c.OriginOutDir = strings.TrimSpace(getenv("WOTAN_ORIGIN_OUT_DIR"))
	c.RollbackFile = strings.TrimSpace(getenv("WOTAN_ROLLBACK_FILE"))
	c.IdunaUpstream = strings.TrimRight(strings.TrimSpace(getenv("WOTAN_IDUNA_UPSTREAM")), "/")
	c.GfdUpstream = strings.TrimRight(strings.TrimSpace(getenv("WOTAN_GFD_UPSTREAM")), "/")
	if s := strings.TrimSpace(getenv("WOTAN_AUTOPULL_MINUTES")); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 1440 {
			missing = append(missing, "WOTAN_AUTOPULL_MINUTES (1-1440, or unset for no timer)")
		}
		c.AutopullMinutes = n
	}
	c.VultrBase = strings.TrimSpace(getenv("WOTAN_VULTR_API_BASE"))
	if c.VultrBase == "" {
		c.VultrBase = "https://api.vultr.com/v2"
	}
	c.CFBase = strings.TrimSpace(getenv("WOTAN_CF_API_BASE"))
	if c.CFBase == "" {
		c.CFBase = "https://api.cloudflare.com/client/v4"
	}
	return c, missing
}

// validate rejects anything that would be interpolated into the first-boot script unless it matches a strict pattern.
func (c config) validate() error {
	checks := []struct {
		ok   bool
		what string
	}{
		{c.Region == "" || reSlug.MatchString(c.Region), "WOTAN_VULTR_REGION"},
		{c.Plan == "" || rePlan.MatchString(c.Plan), "WOTAN_VULTR_PLAN"},
		{c.Domain == "" || reDomain.MatchString(c.Domain), "WOTAN_DOMAIN"},
		{reSlug.MatchString(c.Label), "WOTAN_VULTR_LABEL"},
		{reGitURL.MatchString(c.GitURL), "WOTAN_GIT_URL (https only)"},
		{reRef.MatchString(c.GitRef) && !strings.Contains(c.GitRef, ".."), "WOTAN_GIT_REF"},
		{c.IdunaUpstream == "" || reUp.MatchString(c.IdunaUpstream), "WOTAN_IDUNA_UPSTREAM (https://host[:port], no path)"},
		{c.GfdUpstream == "" || reUp.MatchString(c.GfdUpstream), "WOTAN_GFD_UPSTREAM (https://host[:port], no path)"},
		{c.CFZone == "" || reDomain.MatchString(c.CFZone), "WOTAN_CF_ZONE"},
		{c.CFZone == "" || c.Domain == "" || c.Domain == c.CFZone || strings.HasSuffix(c.Domain, "."+c.CFZone), "WOTAN_DOMAIN must be inside WOTAN_CF_ZONE"},
	}
	for _, id := range c.SSHKeyIDs {
		checks = append(checks, struct {
			ok   bool
			what string
		}{reID.MatchString(id), "WOTAN_VULTR_SSH_KEY_IDS"})
	}
	for _, ch := range checks {
		if !ch.ok {
			return fmt.Errorf("invalid %s", ch.what)
		}
	}
	return nil
}

func (c config) idunaHost() string {
	if c.IdunaUpstream == "" {
		return ""
	}
	u, err := url.Parse(c.IdunaUpstream)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// priceMatches compares the founder's confirmed figure with Vultr's monthly_cost to the cent.
func priceMatches(confirmed string, cost float64) bool {
	f, err := strconv.ParseFloat(strings.TrimPrefix(confirmed, "$"), 64)
	if err != nil {
		return false
	}
	return int64(f*100+0.5) == int64(cost*100+0.5)
}
