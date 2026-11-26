# wotan-vultr: provision WOTAN on Vultr

One command that turns "WOTAN is down" into a running Vultr box serving the WOTAN static site over HTTPS behind
Cloudflare. It is the first piece of the Vultr provisioning layer (Collection spec step 13, disputes doc D-4).
It is written so that nobody, human or agent, can buy something by accident.

```
plan                     read-only: checks the env, shows Vultr's own price, spends nothing
apply [--dns]            buys ONE instance, only if WOTAN_CONFIRM_MONTHLY_USD equals the plan's price;
                         --dns then points WOTAN_DOMAIN at it (proxied), saving the old records first
status --instance ID     state, IPs
destroy --instance ID    deletes it (needs WOTAN_CONFIRM_DESTROY=ID); --restore-dns puts DNS back first
```

## What the box is

- Debian or Ubuntu (checked before buying), with nginx, git, rsync and ufw (22/80/443).
- WOTAN is shallow-cloned from `WOTAN_GIT_URL` @ `WOTAN_GIT_REF` and synced into `/var/www/wotan`, with the same
  exclusions as the monorepo's `wotan-deploy.sh`. `wotan-deploy` on the box pulls again. Set
  `WOTAN_AUTOPULL_MINUTES` to also run it on a systemd timer.
- HTTPS on 443 uses a **Cloudflare Origin CA** certificate (free, 15 years, so no renewal job). Port 80 only
  redirects. The zone must be on SSL mode **Full** or **Full (strict)**. The tool reads the mode, refuses
  anything else, and never changes it.
- `/api/` is proxied (TLS verified) to `WOTAN_IDUNA_UPSTREAM` when that is set. Without it, sign-in and the hat
  store do not work: they need IDUNA.
- `/DEADWEIGHT/ws` and `/GFD/ws` answer **503** until those game servers are back (2026-11-26: the WOTAN games are
  next). `/api/v1/shankpit-net/` is not carried over: its backend ran on the old host.
- IDUNA itself is provisioned by its sibling tool, `IDUNA/ops/vultr` (`iduna-vultr`). Set
  `WOTAN_IDUNA_UPSTREAM=https://iam.okemily.com` once that box is up.

## Environment

Nothing the founder has not confirmed has a default.

| Variable | |
|---|---|
| `WOTAN_VULTR_REGION`, `WOTAN_VULTR_PLAN`, `WOTAN_VULTR_OS_ID` | required. Leave them unset and run `plan`: it lists the real choices from Vultr's public catalogue (cheapest plans with prices, regions, Debian/Ubuntu image ids) |
| `WOTAN_DOMAIN` | required, e.g. `wotan.okemily.com` |
| `WOTAN_CONFIRM_MONTHLY_USD` | `apply` only: the plan's monthly price, typed by the person approving the spend |
| `VULTR_API_KEY_FILE` | file holding only the Vultr key (or `VULTR_API_KEY`). Never printed |
| `CLOUDFLARE_API_TOKEN_FILE` | file holding only the Cloudflare token (or `CLOUDFLARE_API_TOKEN`). Needed to mint the origin cert and for `--dns`. Permissions: Zone SSL and Certificates Edit, DNS Edit, Zone Settings Read |
| `WOTAN_ORIGIN_OUT_DIR` | where a minted cert and key are saved (mode 600). Keep it outside every repo |
| `WOTAN_ORIGIN_CERT_FILE` + `WOTAN_ORIGIN_KEY_FILE` | use an existing origin cert instead of minting one |
| `WOTAN_CF_ZONE`, `WOTAN_ROLLBACK_FILE` | `--dns` only. The rollback file must not already exist |
| `WOTAN_IDUNA_UPSTREAM` | optional, `https://host[:port]` |
| `WOTAN_GFD_UPSTREAM` | optional, `https://host[:port]`: the game box's wss door (`https://play.okemily.com:8443`, see `../games/README.md`); unset = `/GFD/ws` answers 503 |
| `WOTAN_VULTR_SSH_KEY_IDS` | optional, comma-separated ids from Vultr's SSH keys |
| `WOTAN_VULTR_LABEL` | optional, default `wotan` |
| `WOTAN_GIT_URL` / `WOTAN_GIT_REF` | default `https://github.com/emilyspringerton/WOTAN.git` / `main` (public repo, its default branch) |

## Run

Run from Git Bash on the dev box. The monorepo's `go.work` does not list this module, so set `GOWORK=off`.

```bash
cd WOTAN/ops/vultr
export GOWORK=off
go run . plan                                  # with nothing set: shows the plan/region/OS choices
export WOTAN_VULTR_REGION=... WOTAN_VULTR_PLAN=... WOTAN_VULTR_OS_ID=... WOTAN_DOMAIN=wotan.okemily.com
export VULTR_API_KEY_FILE=... CLOUDFLARE_API_TOKEN_FILE=... WOTAN_ORIGIN_OUT_DIR=... \
       WOTAN_CF_ZONE=okemily.com WOTAN_ROLLBACK_FILE=.../wotan-dns-rollback.json
go run . plan --dns                            # the price, the TLS source, the current records it would replace
WOTAN_CONFIRM_MONTHLY_USD=<price from plan> go run . apply --dns
```

`apply` fails before spending anything if any of these is wrong: the price, the OS family, the plan's
availability in the region, the TLS material, the zone's SSL mode, or the rollback path. Its order:

1. Mint the origin cert (free).
2. Create the instance: the only paid call. It prints the id and the undo command.
3. Wait until the instance is active and nginx answers.
4. Save the old DNS records, then point the name at the new box.
5. Wait for `https://WOTAN_DOMAIN/` to return 200 through Cloudflare, with TLS verified.

Undo everything:

```bash
WOTAN_CONFIRM_DESTROY=<id> go run . destroy --instance <id> --restore-dns
```

## Known trade-off

The origin private key travels in the instance's user-data, which Vultr keeps as instance metadata and which can
be read from inside the instance. The cert only works behind Cloudflare, which makes this acceptable for a
static site. If it is not acceptable for a future service, copy the key in over SSH after boot instead.

## Tests

`go test ./...` runs against fake Vultr and Cloudflare APIs. It covers:
- required env and input validation (shell-injection attempts are rejected)
- the price guard
- the rendered first-boot script
- the create payload
- the DNS point/restore round trip

It never touches the real APIs.
