package main

import (
	"bytes"
	"encoding/base64"
	"strings"
	"text/template"
)

// The first-boot script (Vultr passes user-data to cloud-init, which runs a #! script as root once). Debian/Ubuntu
// only: plan checks the OS family before anything is bought. Every interpolated value is either validated against a
// strict pattern in config.go or base64-encoded, so nothing here can break out of its quoting.
//
// What the box ends up as: nginx serving a shallow clone of WOTAN from /var/www/wotan over HTTPS with the given
// origin certificate (port 80 only redirects), ufw allowing 22/80/443, and /usr/local/bin/wotan-deploy to pull and
// sync again (optionally on a systemd timer).
const userDataTmpl = `#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/wotan-provision.log) 2>&1
echo "wotan-vultr first boot $(date -u +%FT%TZ)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends nginx git rsync ufw ca-certificates

install -d -m 755 /var/www/wotan /etc/wotan
install -d -m 700 /etc/ssl/wotan
echo '{{.CertB64}}' | base64 -d > /etc/ssl/wotan/origin.pem
echo '{{.KeyB64}}'  | base64 -d > /etc/ssl/wotan/origin.key
chmod 600 /etc/ssl/wotan/origin.key
{{- if .GfdUpstream}}
# Cloudflare Origin CA ECC root (public): the game box's wss door uses an origin cert, verified against this.
cat > /etc/ssl/wotan/cf-origin-ecc-root.pem <<'PEM'
-----BEGIN CERTIFICATE-----
MIICiTCCAi6gAwIBAgIUXZP3MWb8MKwBE1Qbawsp1sfA/Y4wCgYIKoZIzj0EAwIw
gY8xCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpDYWxpZm9ybmlhMRYwFAYDVQQHEw1T
YW4gRnJhbmNpc2NvMRkwFwYDVQQKExBDbG91ZEZsYXJlLCBJbmMuMTgwNgYDVQQL
Ey9DbG91ZEZsYXJlIE9yaWdpbiBTU0wgRUNDIENlcnRpZmljYXRlIEF1dGhvcml0
eTAeFw0xOTA4MjMyMTA4MDBaFw0yOTA4MTUxNzAwMDBaMIGPMQswCQYDVQQGEwJV
UzETMBEGA1UECBMKQ2FsaWZvcm5pYTEWMBQGA1UEBxMNU2FuIEZyYW5jaXNjbzEZ
MBcGA1UEChMQQ2xvdWRGbGFyZSwgSW5jLjE4MDYGA1UECxMvQ2xvdWRGbGFyZSBP
cmlnaW4gU1NMIEVDQyBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAASR+sGALuaGshnUbcxKry+0LEXZ4NY6JUAtSeA6g87K3jaA
xpIg9G50PokpfWkhbarLfpcZu0UAoYy2su0EhN7wo2YwZDAOBgNVHQ8BAf8EBAMC
AQYwEgYDVR0TAQH/BAgwBgEB/wIBAjAdBgNVHQ4EFgQUhTBdOypw1O3VkmcH/es5
tBoOOKcwHwYDVR0jBBgwFoAUhTBdOypw1O3VkmcH/es5tBoOOKcwCgYIKoZIzj0E
AwIDSQAwRgIhAKilfntP2ILGZjwajktkBtXE1pB4Y/fjAfLkIRUzrI15AiEA5UCL
XYZZ9m2c3fKwIenMMojL1eqydsgqj/wK4p5kagQ=
-----END CERTIFICATE-----
PEM
{{- end}}

cat > /etc/wotan/env <<'EOF'
WOTAN_GIT_URL={{.GitURL}}
WOTAN_GIT_REF={{.GitRef}}
EOF

cat > /usr/local/bin/wotan-deploy <<'EOF'
#!/bin/bash
# Pull WOTAN at WOTAN_GIT_REF and sync it into /var/www/wotan (same exclusions as the monorepo's wotan-deploy.sh).
set -euo pipefail
. /etc/wotan/env
if [ ! -d /opt/wotan-src/.git ]; then
  git clone --depth 1 --branch "$WOTAN_GIT_REF" "$WOTAN_GIT_URL" /opt/wotan-src
else
  git -C /opt/wotan-src fetch --depth 1 origin "$WOTAN_GIT_REF"
  git -C /opt/wotan-src reset --hard FETCH_HEAD
fi
rsync -a --delete --chmod=D755,F644 --exclude='.git' --exclude='ops' --exclude='scripts' /opt/wotan-src/ /var/www/wotan/
echo "deployed $(git -C /opt/wotan-src rev-parse --short HEAD)"
EOF
chmod 755 /usr/local/bin/wotan-deploy
/usr/local/bin/wotan-deploy

cat > /etc/nginx/sites-available/wotan <<'EOF'
# WebSocket upgrades through /api/ (shankpit-460 and Bedrock Racers matchmaking): pass Upgrade on, plain requests keep-alive.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      '';
}
server {
    listen 80;
    listen [::]:80;
    server_name {{.Domain}};
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {{.Domain}};
    ssl_certificate     /etc/ssl/wotan/origin.pem;
    ssl_certificate_key /etc/ssl/wotan/origin.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    root /var/www/wotan;
    index index.html;
    location / {
        try_files $uri $uri/ =404;
    }
    # Game WebSockets (ops/nginx-wotan.conf proxied them to DEADWEIGHT and GFD). Those servers are not up on Vultr
    # yet -- the WOTAN games are next (founder 2026-11-26) -- so fail plainly instead of serving a 404 page.
    location /DEADWEIGHT/ws { return 503; }
{{- if .GfdUpstream}}
    # GFD's browser WebSocket lives on the game box (ops/games): TLS verified against Cloudflare's origin root, the
    # player's IP (Cloudflare's CF-Connecting-IP) forwarded so the MUD's per-IP caps see players, not this box.
    location /GFD/ws {
        proxy_pass {{.GfdUpstream}};
        proxy_ssl_server_name on;
        proxy_ssl_name {{.GfdHost}};
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/wotan/cf-origin-ecc-root.pem;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host {{.GfdHost}};
        proxy_set_header Origin $http_origin;
        proxy_set_header X-Forwarded-For $http_cf_connecting_ip;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
{{- else}}
    location /GFD/ws { return 503; }
{{- end}}
{{- if .IdunaUpstream}}
    # Same-origin IDUNA API, as on the old box (ops/nginx-wotan.conf), pointed at wherever IDUNA now runs.
    location /api/ {
        proxy_pass {{.IdunaUpstream}};
        proxy_ssl_server_name on;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_set_header Host {{.IdunaHost}};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        # Matchmaking WebSockets live under /api/ (IDUNA /api/v1/shankpit460/play, the racer lobby); without these the
        # upgrade is dropped and the browser gets 400. A match lasts up to 6 minutes, so idle reads get an hour.
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
{{- end}}
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/wotan /etc/nginx/sites-enabled/wotan
nginx -t
systemctl enable --now nginx
systemctl reload nginx

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
{{- if .AutopullMinutes}}

cat > /etc/systemd/system/wotan-deploy.service <<'EOF'
[Unit]
Description=Pull and sync WOTAN
[Service]
Type=oneshot
ExecStart=/usr/local/bin/wotan-deploy
EOF
cat > /etc/systemd/system/wotan-deploy.timer <<'EOF'
[Unit]
Description=Pull WOTAN every {{.AutopullMinutes}} minutes
[Timer]
OnBootSec=2min
OnUnitActiveSec={{.AutopullMinutes}}min
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now wotan-deploy.timer
{{- end}}
echo "wotan-vultr first boot done $(date -u +%FT%TZ)"
`

type udVars struct {
	Domain, GitURL, GitRef   string
	CertB64, KeyB64          string
	IdunaUpstream, IdunaHost string
	GfdUpstream, GfdHost     string
	AutopullMinutes          int
}

func renderUserData(c config, certPEM, keyPEM []byte) (string, error) {
	t, err := template.New("ud").Parse(userDataTmpl)
	if err != nil {
		return "", err
	}
	var b bytes.Buffer
	err = t.Execute(&b, udVars{
		Domain: c.Domain, GitURL: c.GitURL, GitRef: c.GitRef,
		CertB64: base64.StdEncoding.EncodeToString(certPEM), KeyB64: base64.StdEncoding.EncodeToString(keyPEM),
		IdunaUpstream: c.IdunaUpstream, IdunaHost: c.idunaHost(), AutopullMinutes: c.AutopullMinutes,
		GfdUpstream: c.GfdUpstream, GfdHost: hostOf(c.GfdUpstream),
	})
	return b.String(), err
}

// hostOf("https://play.okemily.com:8443") = "play.okemily.com" (the upstream is already validated by reUp).
func hostOf(u string) string {
	h := strings.TrimPrefix(u, "https://")
	if i := strings.IndexByte(h, ':'); i >= 0 {
		h = h[:i]
	}
	return h
}
