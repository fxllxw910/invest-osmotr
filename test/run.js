'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-osmotr-e2e-'));
const port = 4300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

let server = null;

function stopServer() {
  if (!server) return;
  try { server.kill(); } catch {}
  server = null;
}

function cleanup() {
  stopServer();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function runE2e() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'test', 'e2e.js')], {
      cwd: ROOT,
      env: { ...process.env, BASE: base },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code == null ? 1 : code));
    child.on('error', () => resolve(1));
  });
}

(async () => {
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let boot = '';
  server.stdout.on('data', (b) => { boot += b.toString(); });
  server.stderr.on('data', (b) => { boot += b.toString(); });
  server.on('exit', (code) => {
    if (code) console.error('server exited early (code ' + code + ')\n' + boot);
  });

  const up = await waitForHealth(15000);
  if (!up) {
    console.error('server did not become healthy on ' + base + '\n' + boot);
    cleanup();
    process.exit(1);
  }

  const code = await runE2e();
  cleanup();
  process.exit(code);
})();

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
