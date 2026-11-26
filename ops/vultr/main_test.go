package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func baseEnv() map[string]string {
	return map[string]string{
		"WOTAN_VULTR_REGION": "ewr", "WOTAN_VULTR_PLAN": "vc2-1c-1gb", "WOTAN_VULTR_OS_ID": "2136",
		"WOTAN_DOMAIN": "wotan.example.com", "WOTAN_CF_ZONE": "example.com",
	}
}

func TestUnconfirmedFactsHaveNoDefault(t *testing.T) {
	_, missing := loadConfig(env(map[string]string{}))
	got := strings.Join(missing, ",")
	for _, k := range []string{"WOTAN_VULTR_REGION", "WOTAN_VULTR_PLAN", "WOTAN_VULTR_OS_ID", "WOTAN_DOMAIN"} {
		if !strings.Contains(got, k) {
			t.Errorf("%s should be required, missing=%v", k, missing)
		}
	}
}

func TestValidateRejectsInjection(t *testing.T) {
	bad := map[string]string{
		"WOTAN_DOMAIN":         "wotan.example.com;rm -rf /",
		"WOTAN_GIT_REF":        "main'$(id)'",
		"WOTAN_GIT_URL":        "git@github.com:x/y.git",
		"WOTAN_IDUNA_UPSTREAM": "https://iam.example.com/api/",
		"WOTAN_VULTR_REGION":   "ewr\nx",
	}
	for k, v := range bad {
		e := baseEnv()
		e[k] = v
		c, _ := loadConfig(env(e))
		if c.validate() == nil {
			t.Errorf("%s=%q should be rejected", k, v)
		}
	}
	e := baseEnv()
	e["WOTAN_DOMAIN"] = "wotan.other.org"
	c, _ := loadConfig(env(e))
	if c.validate() == nil {
		t.Error("domain outside the zone should be rejected")
	}
	c, _ = loadConfig(env(baseEnv()))
	if err := c.validate(); err != nil {
		t.Errorf("good config rejected: %v", err)
	}
}

func TestPriceMatches(t *testing.T) {
	cases := []struct {
		in   string
		cost float64
		ok   bool
	}{{"5", 5, true}, {"5.00", 5, true}, {"$6.00", 6, true}, {"5", 6, false}, {"", 5, false}, {"abc", 5, false}, {"5.001", 5, true}, {"4.99", 5, false}}
	for _, c := range cases {
		if priceMatches(c.in, c.cost) != c.ok {
			t.Errorf("priceMatches(%q,%v) want %v", c.in, c.cost, c.ok)
		}
	}
}

func TestUserDataEmbedsOnlyEncodedSecrets(t *testing.T) {
	e := baseEnv()
	e["WOTAN_IDUNA_UPSTREAM"] = "https://iam.example.com"
	e["WOTAN_AUTOPULL_MINUTES"] = "10"
	c, _ := loadConfig(env(e))
	ud, err := renderUserData(c, []byte("-----BEGIN CERTIFICATE-----\nCERT\n"), []byte("-----BEGIN EC PRIVATE KEY-----\nKEY'\n"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ud, "BEGIN EC PRIVATE KEY") || strings.Contains(ud, "KEY'") {
		t.Error("key must only appear base64-encoded")
	}
	for _, want := range []string{"server_name wotan.example.com;", "proxy_pass https://iam.example.com;",
		"location /DEADWEIGHT/ws { return 503; }", "location /GFD/ws { return 503; }", "proxy_set_header Host iam.example.com;",
		"proxy_ssl_verify on;", "proxy_set_header Upgrade $http_upgrade;", "proxy_set_header Connection $connection_upgrade;",
		"OnUnitActiveSec=10min", "WOTAN_GIT_REF=main", base64.StdEncoding.EncodeToString([]byte("-----BEGIN CERTIFICATE-----\nCERT\n"))} {
		if !strings.Contains(ud, want) {
			t.Errorf("user-data missing %q", want)
		}
	}
	c2, _ := loadConfig(env(baseEnv()))
	ud2, _ := renderUserData(c2, []byte("c"), []byte("k"))
	if strings.Contains(ud2, "location /api/") || strings.Contains(ud2, "wotan-deploy.timer") {
		t.Error("no IDUNA proxy or timer unless asked")
	}
}

func fakeVultr(t *testing.T, gotCreate *createReq) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/plans":
			io.WriteString(w, `{"plans":[{"id":"vc2-1c-1gb","vcpu_count":1,"ram":1024,"disk":25,"bandwidth":1024,"monthly_cost":5,"type":"vc2"}]}`)
		case r.URL.Path == "/os":
			io.WriteString(w, `{"os":[{"id":2136,"name":"Debian 12 x64 (bookworm)","arch":"x64","family":"debian"},{"id":124,"name":"Windows","arch":"x64","family":"windows"}]}`)
		case r.URL.Path == "/regions/ewr/availability":
			io.WriteString(w, `{"available_plans":["vc2-1c-1gb"]}`)
		case r.URL.Path == "/instances" && r.Method == "POST":
			if r.Header.Get("Authorization") != "Bearer vk" {
				w.WriteHeader(401)
				return
			}
			json.NewDecoder(r.Body).Decode(gotCreate)
			w.WriteHeader(202)
			io.WriteString(w, `{"instance":{"id":"abc-123","main_ip":"0.0.0.0","status":"pending","default_password":"SHOULD-NOT-SURFACE"}}`)
		case r.URL.Path == "/instances/abc-123":
			io.WriteString(w, `{"instance":{"id":"abc-123","main_ip":"203.0.113.7","status":"active"}}`)
		default:
			t.Errorf("unexpected vultr call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
}

func TestVultrLookupsAndCreate(t *testing.T) {
	var got createReq
	srv := fakeVultr(t, &got)
	defer srv.Close()
	pub := newAPI(srv.URL, "")
	p, err := findPlan(pub, "vc2-1c-1gb")
	if err != nil || p.MonthlyCost != 5 {
		t.Fatalf("plan: %v %+v", err, p)
	}
	if _, err := findPlan(pub, "nope"); err == nil {
		t.Error("unknown plan should fail")
	}
	if o, err := findOS(pub, 2136); err != nil || o.Family != "debian" {
		t.Fatalf("os: %v", err)
	}
	if ok, err := planAvailable(pub, "ewr", "vc2-1c-1gb"); !ok || err != nil {
		t.Fatalf("availability: %v %v", ok, err)
	}
	c, _ := loadConfig(env(baseEnv()))
	if _, err := createInstance(pub, c, "x"); err == nil {
		t.Error("create without key must fail")
	}
	in, err := createInstance(newAPI(srv.URL, "vk"), c, "#!/bin/bash\necho hi\n")
	if err != nil || in.ID != "abc-123" {
		t.Fatalf("create: %v", err)
	}
	if got.Backups != "disabled" || got.Region != "ewr" || got.OSID != 2136 {
		t.Errorf("create payload: %+v", got)
	}
	if ud, _ := base64.StdEncoding.DecodeString(got.UserData); string(ud) != "#!/bin/bash\necho hi\n" {
		t.Error("user_data must be base64 of the script")
	}
	if in, err := waitActive(newAPI(srv.URL, "vk"), "abc-123", 1, 1); err != nil || in.MainIP != "203.0.113.7" {
		t.Errorf("waitActive: %v", err)
	}
}

// fakeCF keeps a tiny in-memory DNS table so point+restore can be checked end to end.
type fakeCF struct {
	mu   sync.Mutex
	recs map[string]dnsRecord
	n    int
}

func (f *fakeCF) handler(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	ok := func(v interface{}) {
		b, _ := json.Marshal(v)
		io.WriteString(w, `{"success":true,"errors":[],"result":`+string(b)+`}`)
	}
	p := r.URL.Path
	switch {
	case p == "/zones":
		ok([]map[string]string{{"id": "z1", "name": "example.com"}})
	case p == "/zones/z1/settings/ssl":
		ok(map[string]string{"value": "strict"})
	case p == "/zones/z1/dns_records" && r.Method == "GET":
		var out []dnsRecord
		for _, x := range f.recs {
			if x.Name == r.URL.Query().Get("name") {
				out = append(out, x)
			}
		}
		ok(out)
	case p == "/zones/z1/dns_records" && r.Method == "POST":
		var d dnsRecord
		json.NewDecoder(r.Body).Decode(&d)
		f.n++
		d.ID = "r" + string(rune('0'+f.n))
		f.recs[d.ID] = d
		ok(d)
	case strings.HasPrefix(p, "/zones/z1/dns_records/") && r.Method == "DELETE":
		delete(f.recs, strings.TrimPrefix(p, "/zones/z1/dns_records/"))
		ok(map[string]string{})
	default:
		w.WriteHeader(404)
	}
}

func TestPointAndRestoreDNS(t *testing.T) {
	f := &fakeCF{recs: map[string]dnsRecord{"old": {ID: "old", Type: "A", Name: "wotan.example.com", Content: "136.68.242.3", Proxied: true, TTL: 1},
		"mx": {ID: "mx", Type: "TXT", Name: "wotan.example.com", Content: "keep", TTL: 1}}}
	srv := httptest.NewServer(http.HandlerFunc(f.handler))
	defer srv.Close()
	cf := newAPI(srv.URL, "t")
	zid, err := cfZoneID(cf, "example.com")
	if err != nil {
		t.Fatal(err)
	}
	if m, _ := cfSSLMode(cf, zid); m != "strict" {
		t.Errorf("ssl mode %q", m)
	}
	rbPath := filepath.Join(t.TempDir(), "rb.json")
	if err := pointDNS(cf, "example.com", zid, "wotan.example.com", "203.0.113.7", "abc-123", rbPath); err != nil {
		t.Fatal(err)
	}
	if _, ok := f.recs["old"]; ok {
		t.Error("old A record should be gone")
	}
	if _, ok := f.recs["mx"]; !ok {
		t.Error("non-address records must be left alone")
	}
	rb, err := readRollback(rbPath)
	if err != nil || len(rb.Before) != 1 || rb.Before[0].Content != "136.68.242.3" || rb.CreatedID == "" || rb.InstanceID != "abc-123" {
		t.Fatalf("rollback file: %v %+v", err, rb)
	}
	if fi, _ := os.Stat(rbPath); fi == nil {
		t.Fatal("rollback file missing")
	}
	if err := restoreDNS(cf, rb); err != nil {
		t.Fatal(err)
	}
	var back []dnsRecord
	for _, x := range f.recs {
		if x.Type == "A" {
			back = append(back, x)
		}
	}
	if len(back) != 1 || back[0].Content != "136.68.242.3" || !back[0].Proxied {
		t.Errorf("restore: %+v", back)
	}
}
