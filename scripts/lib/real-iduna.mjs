// A real IDUNA for tests: the actual binary (IDUNA_BIN, or built from the sibling ../IDUNA checkout with `go build`) on a
// throwaway SQLite database, listening on a random loopback port. Nothing on the IDUNA side is stubbed.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function startIduna(extraEnv = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wotan-iduna-'));
  let bin = process.env.IDUNA_BIN;
  const idunaDir = path.resolve(root, '..', 'IDUNA');
  if (!bin) {
    if (!fs.existsSync(path.join(idunaDir, 'main.go'))) throw new Error('Set IDUNA_BIN, or check out IDUNA next to this repo.');
    bin = path.join(work, 'iduna');
    console.log('building IDUNA ...');
    execFileSync('go', ['build', '-o', bin, '.'], { cwd: idunaDir, env: { ...process.env, GOWORK: 'off' }, stdio: 'inherit' });
  }
  const run = path.join(work, 'run');
  for (const d of ['var', 'nock', 'video']) fs.mkdirSync(path.join(run, d), { recursive: true });
  fs.symlinkSync(path.join(idunaDir, 'migrations'), path.join(run, 'migrations'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const dbPath = path.join(run, 'var', 'iduna.db');
  const proc = spawn(bin, [], {
    cwd: run, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, IDUNA_ROOT: run, SQLITE_PATH: dbPath, KEY_FILE: path.join(run, 'key.json'), IDUNA_ADDR: `127.0.0.1:${port}`,
      BASE_URL: `http://127.0.0.1:${port}`, NOCK_DATA_DIR: path.join(run, 'nock'), NOCK_VIDEO_DIR: path.join(run, 'video'),
      NOCK_ROBOTS_GIT_DIR: 'off', EMILY_BACKLOG_PATH: path.join(run, 'BACKLOG.md'),
      DEADWEIGHT_MODEL_GIT_DISABLED: '1', BRAWLPIT_MODEL_GIT_DISABLED: '1', SHANKPIT_MODEL_GIT_DISABLED: '1', ...extraEnv },
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/health')).ok) break; } catch (e) { /* not up yet */ }
    if (i > 60) { proc.kill(); throw new Error('IDUNA did not start:\n' + log.slice(-800)); }
    await new Promise((r) => setTimeout(r, 500));
  }
  return {
    base, port, dbPath, pid: proc.pid, log: () => log,
    stop: () => proc.kill(),
    // a generic IDUNA account the way WOTAN's SSO page registers one, and the SSO JWT a signed-in visitor holds
    async ssoIdentity(email) {
      const r = await fetch(base + '/api/v1/auth/email/register', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: 'correcthorsebattery' }) });
      if (!r.ok) throw new Error('register ' + email + ': ' + r.status + ' ' + await r.text());
      return r.json();
    },
  };
}

// a static server for this repo with /api/ proxied to IDUNA -- WebSocket upgrades too -- as the Gateway does in production
export async function serveWotan(idunaPort, { dir = root, extra = {} } = {}) {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const p = http.request({ host: '127.0.0.1', port: idunaPort, method: req.method, path: u.pathname + u.search, headers: { ...req.headers, host: `127.0.0.1:${idunaPort}` } },
        (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      p.on('error', () => { res.writeHead(502); res.end('{}'); });
      req.pipe(p); return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    let d = dir;
    for (const [prefix, target] of Object.entries(extra)) if (p.startsWith(prefix)) { d = target; p = p.slice(prefix.length - 1); }
    const f = path.join(d, p);
    if (!f.startsWith(d) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  // WebSocket: tunnel the upgrade straight through to IDUNA
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(idunaPort, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries({ ...req.headers, host: `127.0.0.1:${idunaPort}` }).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head && head.length) up.write(head);
      socket.pipe(up); up.pipe(socket);
    });
    up.on('error', () => socket.destroy()); socket.on('error', () => up.destroy());
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, stop: () => server.close() };
}
