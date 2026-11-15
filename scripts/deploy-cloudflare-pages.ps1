# scripts/deploy-cloudflare-pages.ps1 -- put WOTAN's static site (the games included) on Cloudflare Pages, from Windows.
#
# Founder, 2026-11-15: "the token creates tokens, figure it out ... we are in windows". Run this ON YOUR MACHINE: the
# Cloudflare token never leaves it. What it does:
#   1. reads your Cloudflare token: from -TokenFile (e.g. ..\EMILY\var\cloudflare.md or ..\.DS_FART\._), else the
#      environment variable named by -TokenVar (default CLOUDFLARE_API_TOKEN);
#   2. checks it with Cloudflare and finds your account;
#   3. uses it to MINT a short-lived token that can only deploy Pages (falls back to your token if it cannot mint);
#   4. copies this repo's site files to a temp folder (no .git, scripts, ops, docs) and deploys it with wrangler.
# Games play against bots there: sign-in, matchmaking and stats need IDUNA, which Pages does not have.
#
# Usage (PowerShell, from the WOTAN folder):
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-cloudflare-pages.ps1 -TokenFile ..\EMILY\var\cloudflare.md
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-cloudflare-pages.ps1            # token in $env:CLOUDFLARE_API_TOKEN
#   ... -Project wotan -Domain arcade.okemily.com -Zone okemily.com                           # also attach a domain
# Needs Node.js (for npx wrangler): winget install OpenJS.NodeJS.LTS
# Not run yet: written in a cloud session with no Cloudflare access and no PowerShell. Read it before you run it.
param(
    [string]$TokenFile = "",
    [string]$TokenVar = "CLOUDFLARE_API_TOKEN",
    [string]$Project = "wotan",
    [string]$Domain = "",
    [string]$Zone = "",
    [string]$Wrangler = "wrangler@4",
    [switch]$NoMint
)
$ErrorActionPreference = "Stop"
$Api = "https://api.cloudflare.com/client/v4"

function Fail($msg) { Write-Host "DEPLOY STOPPED: $msg" -ForegroundColor Red; exit 1 }

# ---- 1. the token -------------------------------------------------------------------------------------------------
$token = ""
if ($TokenFile) {
    if (-not (Test-Path $TokenFile)) { Fail "no file at $TokenFile" }
    $text = Get-Content -Raw -Path $TokenFile
    # Cloudflare account tokens start cfat_ (the format IDUNA's terraform reads from cloudflare.md); else any 40-char token
    $m = [regex]::Match($text, 'cfat_[A-Za-z0-9_-]{20,}')
    if (-not $m.Success) { $m = [regex]::Match($text, '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])') }
    if (-not $m.Success) { Fail "found no Cloudflare token in $TokenFile" }
    $token = $m.Value
} else {
    $token = [Environment]::GetEnvironmentVariable($TokenVar)
    if (-not $token) { Fail "no token: pass -TokenFile <path> or set `$env:$TokenVar" }
}
Write-Host "Token found ($($token.Length) characters, not shown)."

function Cf($method, $path, $tok, $body = $null) {
    $h = @{ Authorization = "Bearer $tok" }
    if ($body -ne $null) {
        return Invoke-RestMethod -Method $method -Uri "$Api$path" -Headers $h -ContentType "application/json" `
            -Body ($body | ConvertTo-Json -Depth 10)
    }
    return Invoke-RestMethod -Method $method -Uri "$Api$path" -Headers $h
}

# ---- 2. check it, find the account --------------------------------------------------------------------------------
# A user token verifies at /user/tokens/verify, an account token (cfat_) at /accounts/{id}/tokens/verify; /accounts works for both.
try { $accts = Cf GET "/accounts" $token } catch { Fail "Cloudflare refused the token: $($_.Exception.Message)" }
if (-not $accts.success -or $accts.result.Count -lt 1) { Fail "the token sees no Cloudflare account" }
$acct = $accts.result[0]
Write-Host "Account: $($acct.name)"

# ---- 3. mint a deploy-only token (the "token creates tokens" step) ------------------------------------------------
$deployToken = $token
$isAccountToken = $token.StartsWith("cfat_")
$tokensPath = $(if ($isAccountToken) { "/accounts/$($acct.id)/tokens" } else { "/user/tokens" })
if (-not $NoMint) {
    try {
        $groups = (Cf GET "$tokensPath/permission_groups" $token).result
        $pages = $groups | Where-Object { $_.name -eq "Pages Write" } | Select-Object -First 1
        if (-not $pages) { throw "no 'Pages Write' permission group visible to this token" }
        $policies = @(@{ effect = "allow"; resources = @{ "com.cloudflare.api.account.$($acct.id)" = "*" };
                         permission_groups = @(@{ id = $pages.id }) })
        if ($Domain -and $Zone) {
            $zoneObj = (Cf GET "/zones?name=$Zone" $token).result | Select-Object -First 1
            $dns = $groups | Where-Object { $_.name -eq "DNS Write" } | Select-Object -First 1
            if ($zoneObj -and $dns) {
                $policies += @{ effect = "allow"; resources = @{ "com.cloudflare.api.account.zone.$($zoneObj.id)" = "*" };
                                permission_groups = @(@{ id = $dns.id }) }
            }
        }
        $expires = (Get-Date).ToUniversalTime().AddHours(2).ToString("yyyy-MM-ddTHH:mm:ssZ")
        $minted = Cf POST $tokensPath $token @{ name = "wotan-pages-deploy-$(Get-Date -Format yyyyMMdd-HHmm)";
                                                policies = $policies; expires_on = $expires }
        if ($minted.success) { $deployToken = $minted.result.value; Write-Host "Minted a 2-hour Pages-only token." }
    } catch {
        Write-Host "Could not mint a scoped token ($($_.Exception.Message)); deploying with your token instead." -ForegroundColor Yellow
    }
}

# ---- 4. stage the site and deploy -------------------------------------------------------------------------------
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Fail "npx not found: install Node.js (winget install OpenJS.NodeJS.LTS), open a new PowerShell, run again" }
$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP "wotan-pages-$(Get-Date -Format yyyyMMddHHmmss)"
robocopy $repo $stage /E /NFL /NDL /NJH /NJS /XD .git .github ops scripts node_modules /XF *.md *.ps1 *.sh | Out-Null
if ($LASTEXITCODE -ge 8) { Fail "copying the site failed (robocopy $LASTEXITCODE)" }
Write-Host "Staged the site at $stage"

$env:CLOUDFLARE_API_TOKEN = $deployToken
$env:CLOUDFLARE_ACCOUNT_ID = $acct.id
npx --yes $Wrangler pages project create $Project --production-branch main 2>$null | Out-Null   # fine if it exists
npx --yes $Wrangler pages deploy $stage --project-name $Project --branch main --commit-dirty=true
if ($LASTEXITCODE -ne 0) { Fail "wrangler could not deploy (see above)" }

if ($Domain) {
    try {
        Cf POST "/accounts/$($acct.id)/pages/projects/$Project/domains" $deployToken @{ name = $Domain } | Out-Null
        if ($Zone) {
            $zoneObj = (Cf GET "/zones?name=$Zone" $deployToken).result | Select-Object -First 1
            Cf POST "/zones/$($zoneObj.id)/dns_records" $deployToken @{ type = "CNAME"; name = $Domain;
                content = "$Project.pages.dev"; proxied = $true } | Out-Null
        }
        Write-Host "Attached https://$Domain (DNS can take a few minutes)."
    } catch { Write-Host "The site is up, but attaching $Domain failed: $($_.Exception.Message)" -ForegroundColor Yellow }
}
Remove-Item Env:CLOUDFLARE_API_TOKEN
Write-Host "Done: https://$Project.pages.dev" -ForegroundColor Green
