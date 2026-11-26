#!/usr/bin/env bash
# The WOTAN game box (founder 2026-11-26: "a slightly beefier box ... all of the game servers and match making and ai
# models for multiplayer"). Buys ONE Vultr instance + a reserved IPv4, points a DNS-only (grey cloud: UDP cannot go
# through Cloudflare's proxy) name at it. Nothing is bought unless GAMES_CONFIRM_MONTHLY_USD equals the plan's live price.
#   GAMES_CONFIRM_MONTHLY_USD=48 ops/games/provision.sh
# Env: GAMES_REGION (ord) GAMES_PLAN (vhp-4c-8gb-amd) GAMES_OS_ID (2284, Ubuntu 24.04) GAMES_SSH_KEY_IDS (comma list)
#      GAMES_DOMAIN (play.okemily.com) GAMES_CF_ZONE (okemily.com); keys from ~/secrets/{vultr-api-key,cloudflare-api-token}
set -euo pipefail
REGION=${GAMES_REGION:-ord}; PLAN=${GAMES_PLAN:-vhp-4c-8gb-amd}; OS_ID=${GAMES_OS_ID:-2284}
DOMAIN=${GAMES_DOMAIN:-play.okemily.com}; ZONE=${GAMES_CF_ZONE:-okemily.com}; LABEL=${GAMES_LABEL:-games}
: "${GAMES_SSH_KEY_IDS:?comma-separated Vultr SSH key ids}"
VK=$(cat ~/secrets/vultr-api-key); CK=$(cat ~/secrets/cloudflare-api-token)
v() { curl -sf -H "Authorization: Bearer $VK" -H 'Content-Type: application/json' "$@"; }
c() { curl -sf -H "Authorization: Bearer $CK" -H 'Content-Type: application/json' "$@"; }
py() { python3 -I -c "$@"; }

price=$(v "https://api.vultr.com/v2/plans?type=all&per_page=500" | py "import json,sys
p=[p for p in json.load(sys.stdin)['plans'] if p['id']=='$PLAN' and '$REGION' in p['locations']]
print(p[0]['monthly_cost'] if p else '')")
[ -n "$price" ] || { echo "plan $PLAN not offered in $REGION"; exit 1; }
echo "plan $PLAN in $REGION: \$$price/month (+ reserved IPv4)"
[ "${GAMES_CONFIRM_MONTHLY_USD:-}" = "$price" ] || { echo "not buying: set GAMES_CONFIRM_MONTHLY_USD=$price to confirm"; exit 2; }

userdata=$(base64 -w0 <<'UD'
#!/bin/bash
set -eux
export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get install -y ufw unattended-upgrades
id games >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/games --shell /usr/sbin/nologin games
ufw allow OpenSSH
ufw allow 6969/udp
ufw --force enable
UD
)
rip=$(v -X POST https://api.vultr.com/v2/reserved-ips -d "{\"region\":\"$REGION\",\"ip_type\":\"v4\",\"label\":\"$LABEL\"}" | py "import json,sys;r=json.load(sys.stdin)['reserved_ip'];print(r['id'],r['subnet'])")
read -r RIP_ID RIP <<<"$rip"; echo "Reserved IPv4 $RIP ($RIP_ID)"
keys=$(py "import json;print(json.dumps('$GAMES_SSH_KEY_IDS'.split(',')))")
inst=$(v -X POST https://api.vultr.com/v2/instances -d "{\"region\":\"$REGION\",\"plan\":\"$PLAN\",\"os_id\":$OS_ID,\"label\":\"$LABEL\",\"hostname\":\"$LABEL\",\"sshkey_id\":$keys,\"backups\":\"disabled\",\"enable_ipv6\":true,\"reserved_ipv4\":\"$RIP_ID\",\"user_data\":\"$userdata\",\"tags\":[\"wotan-games\"]}" | py "import json,sys;print(json.load(sys.stdin)['instance']['id'])")
echo "Bought: Vultr instance $inst ($PLAN, $REGION, \$$price/month). Undo: delete the instance and reserved IP $RIP_ID"
for i in $(seq 60); do
  st=$(v "https://api.vultr.com/v2/instances/$inst" | py "import json,sys;i=json.load(sys.stdin)['instance'];print(i['status'],i['main_ip'])")
  case "$st" in active*) break;; esac; sleep 10
done
echo "Active: $st"
zid=$(c "https://api.cloudflare.com/client/v4/zones?name=$ZONE" | py "import json,sys;print(json.load(sys.stdin)['result'][0]['id'])")
old=$(c "https://api.cloudflare.com/client/v4/zones/$zid/dns_records?name=$DOMAIN" | py "import json,sys;r=json.load(sys.stdin)['result'];print(r[0]['id'] if r else '')")
body="{\"type\":\"A\",\"name\":\"$DOMAIN\",\"content\":\"$RIP\",\"proxied\":false,\"ttl\":300,\"comment\":\"wotan games box $inst (UDP, DNS only)\"}"
if [ -n "$old" ]; then c -X PUT "https://api.cloudflare.com/client/v4/zones/$zid/dns_records/$old" -d "$body" >/dev/null
else c -X POST "https://api.cloudflare.com/client/v4/zones/$zid/dns_records" -d "$body" >/dev/null; fi
echo "DNS: $DOMAIN -> $RIP (DNS only)"
