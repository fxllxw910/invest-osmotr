'use strict';

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const PORT = process.env.PORT || '4173';
const PINGGY_HOST = '213.109.192.63';
const PINGGY_PORT = '443';

function log(message) {
  const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(ROOT, 'tunnel.log'), line + '\n');
  } catch {}
}

function localHealthy() {
  return new Promise((resolve) => {
    const req = require('http').get(
      { host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 4000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function ensureServer() {
  if (await localHealthy()) return true;
  log('локальный сервер не отвечает — запускаю');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, HOST: '::' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await localHealthy()) return true;
  }
  return false;
}

function startTunnel() {
  return new Promise((resolve, reject) => {
    const args = [
      '-T', '-p', PINGGY_PORT,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=20',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ConnectTimeout=25',
      '-R', `0:localhost:${PORT}`,
      PINGGY_HOST,
    ];
    const child = spawn('ssh', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let settled = false;

    const finish = (url) => {
      if (settled) return;
      settled = true;
      if (url) resolve({ url, child });
      else reject(new Error('ссылка туннеля не получена: ' + buffer.replace(/\s+/g, ' ').slice(0, 300)));
    };

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(/https:\/\/[a-z0-9-]+\.free\.pinggy\.net/);
      if (match) finish(match[0]);
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => finish(null));
    setTimeout(() => finish(null), 60000);
  });
}

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
}

function updatePublishedLink(url) {
  const html = fs.readFileSync(INDEX, 'utf8');
  const current = (html.match(/id="live"[^>]*href="([^"]+)"/) || [])[1];
  if (current === url) {
    log(`ссылка уже актуальна: ${url}`);
    return;
  }

  const block =
    `<!--LIVE_START--><a id="live" class="btn" href="${url}">Открыть демо&nbsp;→</a><!--LIVE_END-->`;
  const updated = html.replace(/<!--LIVE_START-->[\s\S]*?<!--LIVE_END-->/, block);
  if (updated === html) {
    log('блок ссылки не найден в index.html');
    return;
  }

  fs.writeFileSync(INDEX, updated, 'utf8');
  log(`index.html обновлён: ${url}`);

  const add = git(['add', 'index.html']);
  if (add.status !== 0) return log('git add не удался: ' + (add.stderr || '').trim());

  const staged = git(['diff', '--cached', '--name-only']);
  if (!staged.stdout.trim()) return log('нечего коммитить');

  const commit = git([
    '-c', 'user.name=fxllxw910',
    '-c', 'user.email=fxllxw910@users.noreply.github.com',
    'commit', '-m', 'витрина: актуальная ссылка на демо-стенд',
  ]);
  if (commit.status !== 0) return log('git commit не удался: ' + (commit.stderr || '').trim());

  const push = git(['push', 'origin', 'HEAD:main']);
  log('git push ' + (push.status === 0 ? 'ok' : 'ошибка: ' + (push.stderr || '').trim()));
}

async function main() {
  const lockFile = path.join(ROOT, '.tunnel.lock');
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      console.log(`сторож уже работает (pid ${pid}), выходим`);
      return;
    }
  } catch {}
  fs.writeFileSync(lockFile, String(process.pid));
  const release = () => {
    try {
      if (Number(fs.readFileSync(lockFile, 'utf8').trim()) === process.pid) fs.unlinkSync(lockFile);
    } catch {}
  };
  process.on('exit', release);

  log('=== сторож туннеля запущен ===');
  let current = null;

  const shutdown = () => {
    if (current) current.child.kill();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  for (;;) {
    try {
      if (!(await ensureServer())) throw new Error('локальный сервер не поднялся');

      log('запускаю туннель Pinggy');
      const tunnel = await startTunnel();
      current = tunnel;
      log(`туннель поднят: ${tunnel.url}`);

      await new Promise((r) => setTimeout(r, 3000));
      updatePublishedLink(tunnel.url);

      await new Promise((resolve) => tunnel.child.on('exit', resolve));
      log('туннель закрыт — перезапускаю');
    } catch (error) {
      log('ошибка: ' + error.message);
      if (current) {
        try { current.child.kill(); } catch {}
        current = null;
      }
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

main();
