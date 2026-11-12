'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const db = require('./lib/db');
const geo = require('./lib/geo');
const {
  parseAddressParts,
  geocodeVariants,
  scoreMatch,
  cityMatches,
  houseMatches,
  streetMatches,
  streetTypeConflicts,
} = require('./lib/address');
const { seed, hashPassword, token, buildSteps } = require('./lib/seed');
const V = require('./lib/views');
const VI = require('./lib/views-inspect');
const VS = require('./lib/views-site');
const sms = require('./lib/sms');
const { zipStore, safeName } = require('./lib/zip');
const { BRAND } = require('./lib/brand');

try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(envFile);
  }
} catch (e) {
  console.error('[env] не удалось прочитать .env: ' + ((e && e.message) || e));
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const COOKIE = 'io_session';
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

db.ensureDirs();
seed();

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const store = db.load();
  const s = store.sessions.find((x) => x.sid === sid);
  if (!s) return null;
  if (Date.parse(s.expires) < Date.now()) return null;
  return store.users.find((u) => u.id === s.userId) || null;
}

function createSession(user) {
  const store = db.load();
  const sid = crypto.randomBytes(24).toString('base64url');
  store.sessions.push({
    sid,
    userId: user.id,
    createdAt: new Date().toISOString(),
    expires: new Date(Date.now() + 30 * 864e5).toISOString(),
  });
  db.save();
  return sid;
}

function normalizePhone(v) {
  return String(v || '').replace(/[^\d]/g, '');
}

function hashPasswordFor(user, password) {
  return crypto.scryptSync(password, user.salt, 32).toString('hex');
}

function verifyLogin(phone, password) {
  const store = db.load();
  const p = normalizePhone(phone);
  const user = store.users.find((u) => u.phone === p);
  if (!user) return null;
  const a = Buffer.from(hashPasswordFor(user, password), 'hex');
  const b = Buffer.from(user.passwordHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return user;
}

function send(res, status, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.writeHead(status, {
    'Content-Length': buf.length,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(buf);
}

function html(res, status, body, extra = {}) {
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
}

function redirect(res, to, extra = {}) {
  send(res, 303, '', { Location: to, ...extra });
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Слишком большой запрос'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseForm(buf, contentType = '') {
  const text = buf.toString('utf8');
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

function savePhoto(dataUrl, taskId) {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = m[1] === 'jpg' ? 'jpeg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 1024) return null;
  if (buf.length > 8 * 1024 * 1024) return null;
  const name = `${taskId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(db.PHOTOS_DIR, name), buf);
  return '/photos/' + name;
}

function serveStatic(res, rel) {
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, buf, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    });
  });
}

function servePhoto(res, name) {
  const base = path.basename(name);
  if (base !== name || base.startsWith('.')) return send(res, 404, 'Not found');
  const filePath = path.join(db.PHOTOS_DIR, base);
  if (!filePath.startsWith(db.PHOTOS_DIR)) return send(res, 404, 'Not found');
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, buf, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    });
  });
}

function getTask(id) {
  return db.load().tasks.find((t) => String(t.id) === String(id));
}

function canReworkStep(task, step) {
  if (!task || !step) return false;
  const entry = task.inspection && task.inspection.steps ? task.inspection.steps[step.id] : null;
  if (entry && entry.review === 'accepted') return false;
  if (task.status === 'open' || task.status === 'rejected') return true;
  if (task.status === 'submitted') {
    return !!entry && entry.review === 'rejected';
  }
  return false;
}

function getObject(id) {
  return db.load().objects.find((o) => o.id === id);
}

async function buildObjectFromForm(body, store) {
  const title = String(body.newTitle || '').trim();
  const address = String(body.newAddress || '').trim();
  if (!title) return { ok: false, error: 'Укажите название объекта.' };
  if (!address) return { ok: false, error: 'Укажите адрес объекта.' };
  let lat = Number(String(body.newLat || '').replace(',', '.'));
  let lng = Number(String(body.newLng || '').replace(',', '.'));
  if (!geo.validCoord(lat, lng)) {
    const found = await geocodeAddress(address);
    if (!found.ok) {
      return { ok: false, error: 'Не удалось определить координаты по адресу. Укажите широту и долготу вручную.' };
    }
    lat = found.lat;
    lng = found.lng;
  }
  if (!geo.validCoord(lat, lng)) return { ok: false, error: 'Координаты объекта указаны неверно.' };
  const radius = Math.round(Number(body.newRadius) || 80);
  return {
    ok: true,
    object: {
      id: db.nextId('object'),
      title,
      address,
      kind: 'commercial',
      area: 0,
      lat,
      lng,
      radius: Math.max(25, Math.min(2000, radius)),
      createdAt: new Date().toISOString(),
    },
  };
}

async function geocodeAddress(address) {
  const original = String(address || '').trim();
  if (!original) return { ok: false };
  const parsed = parseAddressParts(original);
  const variants = geocodeVariants(original);
  let best = null;
  for (const q of variants) {
    const hit = await geocodeOnce(q);
    if (!hit.ok) continue;
    if (!cityMatches(hit.displayName, parsed.city)) continue;
    if (!streetMatches(hit.displayName, parsed.street)) continue;
    if (streetTypeConflicts(hit.displayName, parsed.street)) continue;
    if (parsed.house && houseMatches(hit.displayName, parsed.house) < 0) continue;
    const score = scoreMatch(hit.displayName, parsed);
    if (!best || score > best.score) best = { ...hit, score };
    if (score >= 5) return { ok: true, lat: best.lat, lng: best.lng, displayName: best.displayName };
  }
  if (!best) return { ok: false };
  if (parsed.house && best.score < 1) return { ok: false };
  return { ok: true, lat: best.lat, lng: best.lng, displayName: best.displayName };
}

async function geocodeOnce(q) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q);
    u.searchParams.set('format', 'jsonv2');
    u.searchParams.set('limit', '1');
    u.searchParams.set('accept-language', 'ru');
    u.searchParams.set('countrycodes', 'ru');
    const r = await fetch(u, {
      headers: { 'user-agent': 'invest-osmotr/1.0 (il@chelinvest.ru)', accept: 'application/json' },
      signal: controller.signal,
    });
    if (!r.ok) return { ok: false };
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) return { ok: false };
    const lat = Number(list[0].lat);
    const lng = Number(list[0].lon);
    if (!geo.validCoord(lat, lng)) return { ok: false };
    return { ok: true, lat, lng, displayName: list[0].display_name || '' };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

function verifyGeo(object, lat, lng, accuracy) {
  const flat = Number(lat);
  const flng = Number(lng);
  const facc = Number(accuracy);
  if (!geo.validCoord(flat, flng)) {
    return { ok: false, error: 'Координаты не получены. Разрешите доступ к геолокации и повторите.' };
  }
  if (!Number.isFinite(facc) || facc <= 0) {
    return { ok: false, error: 'Точность GPS не определена. Повторите попытку на открытом месте.' };
  }
  const distance = geo.distanceMeters({ lat: flat, lng: flng }, object);
  const radius = geo.allowedRadius(object);
  if (distance > radius) {
    return {
      ok: false,
      error: `Вы находитесь в ${Math.round(distance)} м от объекта. Допустимо не более ${radius} м.`,
    };
  }
  const maxAcc = geo.maxAccuracy(object);
  if (facc > maxAcc) {
    return {
      ok: false,
      error: `Точность GPS ±${Math.round(facc)} м хуже допустимой ±${maxAcc} м. Выйдите на открытое место и повторите.`,
    };
  }
  return { ok: true, distance, accuracy: facc, lat: flat, lng: flng };
}

function stepsView(task, object, publicToken) {
  const fixed = task.inspection ? task.inspection.steps || {} : {};
  return task.steps
    .map((s, i) => {
      const f = fixed[s.id];
      const editable = !publicToken || canReworkStep(task, s);
      const act = editable
        ? `<a class="btn small ${f ? 'ghost' : ''}" href="/s/${publicToken}/step/${s.id}">${
            s.type === 'text' ? (f ? 'Изменить' : 'Заполнить') : f ? 'Переснять' : 'Снять'
          }</a>`
        : '';
      return `<li class="step ${f ? (f.review === 'rejected' ? 'done rejected' : 'done') : ''}">
        <span class="step-mark">${f ? (f.review === 'rejected' ? '✕' : '✓') : i + 1}</span>
        <div class="step-body">
          <b>${V.esc(s.title)}</b>
          <p>${V.esc(s.instruction)}</p>
          ${f && f.photo ? `<a class="thumb" href="${f.photo}" target="_blank"><img src="${f.photo}" alt=""></a>` : ''}
          ${f && f.text ? `<div class="answer">${V.esc(f.text)}</div>` : ''}
          ${f ? `<div class="fixmeta">${V.esc(new Date(f.at).toLocaleString('ru-RU'))}${f.accuracy != null ? ` · ±${Math.round(f.accuracy)} м · ${Math.round(f.distance)} м от объекта` : ''}</div>` : ''}
        </div>
        ${act}
      </li>`;
    })
    .join('');
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method.toUpperCase();
  const user = sessionUser(req);

  if (p.startsWith('/assets/')) return serveStatic(res, p.slice(1));
  if (p.startsWith('/photos/')) return servePhoto(res, p.slice('/photos/'.length));

  if (p === '/favicon.ico') return send(res, 204, '');

  if (p === '/') {
    if (method === 'GET') {
      return html(res, 200, VS.homePage({ user }));
    }
  }

  if (p === '/login') {
    if (method === 'GET') {
      if (user) return redirect(res, '/app');
      return html(res, 200, V.loginPage({}));
    }
    if (method === 'POST') {
      const body = parseForm(await readBody(req), req.headers['content-type'] || '');
      const found = verifyLogin(body.phone, body.password || '');
      if (!found) {
        return html(res, 401, V.loginPage({ error: 'Неверный номер телефона или пароль.', phone: body.phone }));
      }
      const sid = createSession(found);
      return redirect(res, '/app', {
        'Set-Cookie': `${COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`,
      });
    }
  }

  if (p === '/logout' && method === 'POST') {
    const sid = parseCookies(req)[COOKIE];
    const store = db.load();
    store.sessions = store.sessions.filter((s) => s.sid !== sid);
    db.save();
    return redirect(res, '/login', { 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
  }

  if (p === '/app' || p === '/dashboard') {
    if (!user) return redirect(res, '/login');
    const store = db.load();
    const tab = url.searchParams.get('tab') === 'review' && user.role === 'client' ? 'review' : 'tasks';
    const tasks = store.tasks
      .filter((t) => (user.role === 'client' ? t.clientId === user.id : t.executorId === user.id))
      .slice()
      .sort((a, b) => {
        const rank = { submitted: 0, open: 1, rejected: 1, accepted: 2 };
        const d = (rank[a.status] ?? 3) - (rank[b.status] ?? 3);
        return d || Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    return html(res, 200, V.dashPage({
      user,
      tasks,
      objects: store.objects,
      flashMsg: url.searchParams.get('ok') || '',
      errorMsg: url.searchParams.get('err') || '',
      tab,
      unread: sms.unreadCount(store, user.id),
    }));
  }

  if (p === '/notifications') {
    if (!user) return redirect(res, '/login');
    const store = db.load();
    const items = store.notifications
      .filter((n) => n.userId === user.id)
      .slice()
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    items.forEach((n) => { n.read = true; });
    db.save();
    return html(res, 200, V.notificationsPage({ user, items }));
  }

  if (p === '/notifications/read' && method === 'POST') {
    if (!user) return redirect(res, '/login');
    const store = db.load();
    store.notifications.forEach((n) => { if (n.userId === user.id) n.read = true; });
    db.save();
    return redirect(res, '/notifications');
  }

  if (p === '/outbox') {
    if (!user) return redirect(res, '/login');
    if (user.role !== 'client') return redirect(res, '/app');
    const store = db.load();
    return html(res, 200, V.outboxPage({
      user,
      messages: store.sms.filter((m) => m.kind !== 'password'),
      provider: sms.providerStatus(),
    }));
  }

  if (p === '/api/tasks' && method === 'POST') {
    if (!user) return redirect(res, '/login');
    if (user.role !== 'client') return redirect(res, '/app');
    const body = parseForm(await readBody(req), req.headers['content-type'] || '');
    const store = db.load();

    const fail = (msg) => redirect(res, '/app?err=' + encodeURIComponent(msg));

    let obj;
    if (String(body.objectId || '') === '__new') {
      const created = await buildObjectFromForm(body, store);
      if (!created.ok) return fail(created.error);
      obj = created.object;
      store.objects.push(obj);
    } else {
      obj = store.objects.find((o) => String(o.id) === String(body.objectId));
    }
    if (!obj) return fail('Выберите объект осмотра или создайте новый.');

    const phone = sms.normalizePhone(body.executorPhone);
    if (phone.length !== 11) {
      return fail('Укажите телефон исполнителя в формате +7 XXX XXX-XX-XX');
    }

    let executor = store.users.find((u) => u.phone === phone && u.role === 'executor');
    let tempPassword = null;
    if (!executor) {
      tempPassword = String(Math.floor(100000 + Math.random() * 900000));
      const salt = crypto.randomBytes(12).toString('hex');
      executor = {
        id: db.nextId('user'),
        phone,
        name: body.executorName || 'Исполнитель ' + phone.slice(-4),
        role: 'executor',
        company: 'Внешний исполнитель',
        salt,
        passwordHash: hashPassword(tempPassword, salt),
        createdAt: new Date().toISOString(),
      };
      store.users.push(executor);
    }

    const maxNum = store.tasks.reduce((mx, t) => {
      const tail = String(t.number || '').split('-').pop();
      const n = Number(String(tail).replace(/\D/g, ''));
      return Number.isFinite(n) && n > mx ? n : mx;
    }, 0);
    const deadline = body.deadline
      ? new Date(body.deadline + 'T18:00:00+05:00').toISOString()
      : new Date(Date.now() + 7 * 864e5).toISOString();

    const task = {
      id: db.nextId('task'),
      number: 'ИО-2026-' + String(maxNum + 1).padStart(6, '0'),
      token: token(),
      title: body.title || 'Плановый осмотр',
      objectId: obj.id,
      clientId: user.id,
      executorId: executor.id,
      executorName: executor.name,
      executorPhone: executor.phone,
      executorPhonePretty: sms.prettyPhone(executor.phone),
      status: 'open',
      purpose: body.purpose || '',
      customerName: BRAND.legal,
      deadline,
      createdAt: new Date().toISOString(),
      steps: buildSteps(),
      inspection: null,
    };
    store.tasks.push(task);

    const link = `${baseUrl(req)}/s/${task.token}`;
    const lines = [
      `${BRAND.product}: вам назначен осмотр ${task.number}.`,
      `Объект: ${obj.address}.`,
      `Срок: ${new Date(deadline).toLocaleDateString('ru-RU')}.`,
      `Ссылка: ${link}`,
    ];
    if (tempPassword) lines.push(`Вход: ${sms.prettyPhone(phone)}, пароль ${tempPassword}`);
    const message = await sms.send({
      to: phone,
      text: lines.join(' '),
      taskId: task.id,
      kind: tempPassword ? 'credentials' : 'link',
    });

    sms.notify(store, executor.id, {
      title: 'Новое задание',
      text: `${task.number} · ${obj.address}. Срок до ${new Date(deadline).toLocaleDateString('ru-RU')}.`,
      kind: 'task',
      taskId: task.id,
    });
    db.save();

    const smsState = message.status === 'sent' ? 'SMS отправлена' : message.status === 'failed' ? 'SMS не отправлена' : 'SMS отправляется';
    const head = 'Осмотр назначен, ' + smsState;
    return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent(head) +
      '&sms=' + encodeURIComponent(message.id));
  }

  let m = /^\/tasks\/(\d+)$/.exec(p);
  if (m) {
    if (!user) return redirect(res, '/login');
    const task = getTask(m[1]);
    if (!task) return html(res, 404, V.layout({ title: 'Не найдено', user, body: '<div class="card"><h1>Задание не найдено</h1><p><a href="/app">Вернуться к списку</a></p></div>' }));
    if (user.role === 'client' && task.clientId !== user.id) return redirect(res, '/app');
    if (user.role !== 'client' && task.executorId !== user.id) return redirect(res, '/app');
    const obj = getObject(task.objectId);
    const smsId = Number(url.searchParams.get('sms') || 0);
    const store = db.load();
    const smsInfo = smsId ? store.sms.find((x) => x.id === smsId) : null;
    return html(res, 200, V.taskPage({
      task,
      object: obj,
      user,
      flashMsg: url.searchParams.get('ok') || '',
      canToken: user.role === 'client',
      smsInfo,
      unread: sms.unreadCount(store, user.id),
    }));
  }

  m = /^\/tasks\/(\d+)\/photo\/([a-f0-9]+)$/.exec(p);
  if (m && method === 'POST') {
    if (!user) return redirect(res, '/login');
    if (user.role !== 'client') return redirect(res, '/app');
    const task = getTask(m[1]);
    if (!task || task.clientId !== user.id) return redirect(res, '/app');
    const body = parseForm(await readBody(req), req.headers['content-type'] || '');
    const entry = task.inspection && task.inspection.steps ? task.inspection.steps[m[2]] : null;
    const step = task.steps.find((s) => s.id === m[2]);
    if (!entry || !step) return redirect(res, '/tasks/' + task.id);

    entry.review = body.decision === 'reject' ? 'rejected' : 'accepted';
    entry.reviewComment = String(body.comment || '').slice(0, 500);
    entry.reviewedAt = new Date().toISOString();

    const store = db.load();
    if (entry.review === 'rejected') {
      sms.notify(store, task.executorId, {
        title: `Фото отклонено: ${step.title}`,
        text: `${task.number}. Шаг «${step.title}» отклонён.${entry.reviewComment ? ' ' + entry.reviewComment : ''} Переснимите кадр в задании.`,
        kind: 'photo-rejected',
        taskId: task.id,
      });
    }

    db.save();
    const msg = entry.review === 'rejected'
      ? `Фото «${step.title}» отклонено. Исполнитель получит уведомление.`
      : `Фото «${step.title}» принято.`;
    return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent(msg));
  }

  m = /^\/tasks\/(\d+)\/download$/.exec(p);
  if (m) {
    if (!user) return redirect(res, '/login');
    if (user.role !== 'client') return redirect(res, '/app');
    const task = getTask(m[1]);
    if (!task || task.clientId !== user.id) return redirect(res, '/app');
    const obj = getObject(task.objectId);
    const fixed = task.inspection ? task.inspection.steps || {} : {};
    const files = [];
    for (let i = 0; i < task.steps.length; i++) {
      const s = task.steps[i];
      const f = fixed[s.id];
      if (!f || !f.photo) continue;
      const name = path.basename(f.photo);
      const abs = path.join(db.PHOTOS_DIR, name);
      if (!fs.existsSync(abs)) continue;
      const state = f.review === 'accepted' ? 'принято' : f.review === 'rejected' ? 'отклонено' : 'без-проверки';
      const ext = (path.extname(name) || '.jpg').toLowerCase();
      files.push({
        name: safeName(`${String(i + 1).padStart(2, '0')} ${s.title} (${state})${ext}`),
        data: fs.readFileSync(abs),
      });
    }
    if (!files.length) {
      return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent('Нет фотографий для выгрузки'));
    }
    const readme = [
      `${BRAND.product} — материалы осмотра`,
      `Задание: ${task.number}`,
      `Объект: ${obj.address}`,
      `Заказчик: ${task.customerName || BRAND.legal}`,
      `Исполнитель: ${task.executorName || ''} ${task.executorPhonePretty || ''}`,
      `Выгружено: ${new Date().toLocaleString('ru-RU')}`,
      '',
      'Файлы:',
      ...task.steps.map((s, i) => {
        const f = fixed[s.id];
        if (!f) return `${String(i + 1).padStart(2, '0')}. ${s.title} — не заполнено`;
        const bits = [`${String(i + 1).padStart(2, '0')}. ${s.title}`];
        if (f.at) bits.push(`время ${new Date(f.at).toLocaleString('ru-RU')}`);
        if (f.lat != null) bits.push(`координаты ${f.lat.toFixed(6)}, ${f.lng.toFixed(6)}`);
        if (f.accuracy != null) bits.push(`точность ±${Math.round(f.accuracy)} м`);
        if (f.distance != null) bits.push(`до объекта ${Math.round(f.distance)} м`);
        if (f.review) bits.push(`проверка: ${f.review === 'accepted' ? 'принято' : 'отклонено'}`);
        if (f.reviewComment) bits.push(`комментарий: ${f.reviewComment}`);
        if (f.text) bits.push(`ответ: ${f.text}`);
        return bits.join(' · ');
      }),
    ].join('\r\n');
    files.push({ name: 'README.txt', data: Buffer.from('\ufeff' + readme, 'utf8') });

    const zip = zipStore(files);
    const asciiName = safeName(task.number).replace(/[^\x20-\x7e]/g, '') || 'inspection';
    return send(res, 200, zip, {
      'Content-Type': 'application/zip',
      'Content-Disposition':
        `attachment; filename="${asciiName}.zip"; filename*=UTF-8''${encodeURIComponent(task.number + '.zip')}`,
      'Cache-Control': 'no-store',
    });
  }

  m = /^\/tasks\/(\d+)\/inspect\/([a-f0-9]+)$/.exec(p);
  if (m) {
    if (!user) return redirect(res, '/login');
    const task = getTask(m[1]);
    if (!task) return redirect(res, '/app');
    if (user.role === 'client' && task.clientId === user.id) {
      return redirect(res, '/tasks/' + task.id + '?ok=' +
        encodeURIComponent('Съёмку выполняет исполнитель. Вы можете отправить ему ссылку из карточки задания.'));
    }
    if (task.executorId !== user.id) return redirect(res, '/app');
    const step = task.steps.find((s) => s.id === m[2]);
    if (!step) return redirect(res, '/tasks/' + task.id);
    if (!canReworkStep(task, step)) {
      return redirect(res, '/tasks/' + task.id + '?ok=' +
        encodeURIComponent('Этот шаг уже принят заказчиком — переснимать его не нужно'));
    }
    const obj = getObject(task.objectId);

    if (method === 'GET') {
      return html(res, 200, VI.inspectPage({
        task, object: obj, step, user,
        desktop: step.type !== 'text' && !isMobileRequest(req),
      }));
    }
    if (method === 'POST') {
      if (step.type !== 'text' && !isMobileRequest(req)) {
        return html(res, 403, VI.inspectPage({ task, object: obj, step, user, desktop: true }));
      }
      const body = parseForm(await readBody(req), req.headers['content-type'] || '');
      const result = applyStep(task, obj, step, body, user);
      if (!result.ok) {
        return html(res, 400, VI.inspectPage({ task, object: obj, step, user, error: result.error }));
      }
      const okMsg = task.status === 'submitted'
        ? `Фото «${step.title}» переснято и отправлено заказчику на повторную проверку`
        : `Шаг «${step.title}» зафиксирован`;
      return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent(okMsg));
    }
  }

  m = /^(?:\/api)?\/tasks\/(\d+)\/submit$/.exec(p);
  if (m && method === 'POST') {
    if (!user) return redirect(res, '/login');
    const task = getTask(m[1]);
    if (!task) return redirect(res, '/app');
    if (user.role !== 'client' && task.executorId !== user.id) return redirect(res, '/app');
    if (task.status !== 'open' && task.status !== 'rejected') return redirect(res, '/tasks/' + task.id);
    const fixed = task.inspection ? task.inspection.steps || {} : {};
    const missing = task.steps.filter((s) => s.required !== false && !fixed[s.id]);
    if (missing.length) {
      return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent('Заполните все обязательные шаги'));
    }
    task.inspection ||= { steps: {} };
    task.inspection.submittedAt = new Date().toISOString();
    task.inspection.review = null;
    task.status = 'submitted';

    const store = db.load();
    sms.notify(store, task.clientId, {
      title: 'Осмотр ждёт проверки',
      text: `${task.number} · ${(getObject(task.objectId) || {}).address || ''}. Фотографий: ${task.steps.filter((s) => s.type !== 'text').length}.`,
      kind: 'submitted',
      taskId: task.id,
    });
    db.save();
    return redirect(res, '/tasks/' + task.id + '?ok=' + encodeURIComponent('Отчёт отправлен на проверку'));
  }

  m = /^(?:\/api)?\/tasks\/(\d+)\/review$/.exec(p);
  if (m && method === 'POST') {
    if (!user) return redirect(res, '/login');
    if (user.role !== 'client') return redirect(res, '/app');
    const task = getTask(m[1]);
    if (!task || task.clientId !== user.id) return redirect(res, '/app');
    const body = parseForm(await readBody(req), req.headers['content-type'] || '');
    const fixed = task.inspection ? task.inspection.steps || {} : {};

    if (body.decision === 'accept') {
      const pending = task.steps.filter((s) => {
        const f = fixed[s.id];
        return s.type !== 'text' && f && f.photo && !f.review;
      });
      const stillRejected = task.steps.filter((s) => {
        const f = fixed[s.id];
        return s.type !== 'text' && f && f.photo && f.review === 'rejected';
      });
      if (stillRejected.length) {
        return redirect(res, '/tasks/' + task.id + '?ok=' +
          encodeURIComponent(`Отклонённых фотографий: ${stillRejected.length}. Переснимите их или отклоните осмотр целиком.`));
      }
      if (pending.length) {
        return redirect(res, '/tasks/' + task.id + '?ok=' +
          encodeURIComponent(`Примите или отклоните все фотографии: осталось ${pending.length}`));
      }
      task.steps.forEach((s) => {
        const f = fixed[s.id];
        if (f && s.type !== 'text' && f.photo && !f.review) f.review = 'accepted';
      });
    } else {
      const unreviewed = task.steps.filter((s) => {
        const f = fixed[s.id];
        return s.type !== 'text' && f && f.photo && !f.review;
      });
      unreviewed.forEach((s) => {
        fixed[s.id].review = 'rejected';
        fixed[s.id].reviewComment = fixed[s.id].reviewComment || body.comment || '';
      });
    }

    task.inspection ||= { steps: {} };
    task.inspection.review = { decision: body.decision, comment: body.comment || '', at: new Date().toISOString() };
    task.status = body.decision === 'accept' ? 'accepted' : 'rejected';

    const store = db.load();
    if (body.decision === 'accept') {
      sms.notify(store, task.executorId, {
        title: 'Осмотр принят',
        text: `${task.number}. Заказчик принял отчёт по объекту «${(getObject(task.objectId) || {}).address || ''}».`,
        kind: 'accepted',
        taskId: task.id,
      });
    } else {
      const rej = task.steps.filter((s) => {
        const f = fixed[s.id];
        return f && f.review === 'rejected';
      });
      sms.notify(store, task.executorId, {
        title: 'Осмотр отклонён',
        text: `${task.number}. Отклонено фотографий: ${rej.length}.${body.comment ? ' ' + body.comment : ''} Переснимите отмеченные шаги.`,
        kind: 'rejected',
        taskId: task.id,
      });
    }
    db.save();
    return redirect(res, '/tasks/' + task.id + '?ok=' +
      encodeURIComponent(body.decision === 'accept' ? 'Осмотр принят' : 'Осмотр отклонён, исполнителю отправлено уведомление'));
  }

  m = /^\/s\/([A-Za-z0-9_-]+)$/.exec(p);
  if (m) {
    const store = db.load();
    const task = store.tasks.find((t) => t.token === m[1]);
    if (!task) return html(res, 404, V.layout({ title: 'Ссылка недействительна', body: '<div class="card"><h1>Ссылка недействительна</h1><p>Задание не найдено или ссылка отозвана.</p></div>' }));
    const obj = getObject(task.objectId);
    const fixed = task.inspection ? task.inspection.steps || {} : {};
    const doneCount = Object.keys(fixed).length;
    return html(res, 200, VI.publicTaskPage({
      task,
      object: obj,
      stepsView: stepsView(task, obj, task.token),
      doneCount,
      total: task.steps.length,
      hasRejected: task.steps.some((s) => fixed[s.id] && fixed[s.id].review === 'rejected'),
      error: url.searchParams.get('err') || '',
    }));
  }

  m = /^\/s\/([A-Za-z0-9_-]+)\/submit$/.exec(p);
  if (m && method === 'POST') {
    const store = db.load();
    const task = store.tasks.find((t) => t.token === m[1]);
    if (!task) return redirect(res, '/');
    if (task.status !== 'open' && task.status !== 'rejected' && task.status !== 'submitted') {
      return redirect(res, '/s/' + task.token);
    }
    const fixed = task.inspection ? task.inspection.steps || {} : {};
    const missing = task.steps.filter((s) => s.required !== false && !fixed[s.id]);
    if (missing.length) {
      return redirect(res, '/s/' + task.token + '?err=' + encodeURIComponent('Заполните все обязательные шаги'));
    }
    task.inspection ||= { steps: {} };
    task.inspection.submittedAt = new Date().toISOString();
    task.inspection.review = null;
    task.status = 'submitted';
    if (task.clientId) {
      sms.notify(store, task.clientId, {
        title: 'Осмотр ждёт проверки',
        text: `${task.number} · ${(getObject(task.objectId) || {}).address || ''}. Отчёт отправлен повторно.`,
        kind: 'submitted',
        taskId: task.id,
      });
    }
    db.save();
    return redirect(res, '/s/' + task.token);
  }

  m = /^\/s\/([A-Za-z0-9_-]+)\/step\/([a-f0-9]+)$/.exec(p);
  if (m) {
    const store = db.load();
    const task = store.tasks.find((t) => t.token === m[1]);
    if (!task) return redirect(res, '/');
    const step = task.steps.find((s) => s.id === m[2]);
    if (!step) return redirect(res, '/s/' + m[1]);
    if (!canReworkStep(task, step)) return redirect(res, '/s/' + m[1]);
    const obj = getObject(task.objectId);
    if (method === 'GET') {
      return html(res, 200, VI.inspectPage({
        task, object: obj, step, user: null, publicMode: true,
        desktop: step.type !== 'text' && !isMobileRequest(req),
      }));
    }
    if (method === 'POST') {
      if (step.type !== 'text' && !isMobileRequest(req)) {
        return html(res, 403, VI.inspectPage({ task, object: obj, step, user: null, publicMode: true, desktop: true }));
      }
      const body = parseForm(await readBody(req), req.headers['content-type'] || '');
      const result = applyStep(task, obj, step, body, null);
      if (!result.ok) {
        return html(res, 400, VI.inspectPage({ task, object: obj, step, user: null, publicMode: true, error: result.error }));
      }
      return redirect(res, '/s/' + task.token);
    }
  }

  if (p === '/api/sms/gateway' && method === 'POST') {
    const token = req.headers['x-sms-token'] || url.searchParams.get('token') || '';
    if (!sms.gatewayTokenMatches(token)) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'Неверный токен шлюза' }), { 'Content-Type': 'application/json' });
    }
    const body = parseForm(await readBody(req), req.headers['content-type'] || '');
    const result = sms.acceptAtGateway({
      to: body.to,
      text: body.text,
      messageId: body.messageId,
      taskId: body.taskId,
      kind: body.kind,
    });
    return send(res, result.ok ? 200 : 400, JSON.stringify(result), { 'Content-Type': 'application/json' });
  }

  if (p === '/api/geocode' && method === 'POST') {
    if (!user) return send(res, 401, JSON.stringify({ ok: false }), { 'Content-Type': 'application/json' });
    const body = parseForm(await readBody(req), req.headers['content-type'] || '');
    const found = await geocodeAddress(body.address);
    return send(res, found.ok ? 200 : 404, JSON.stringify(found), { 'Content-Type': 'application/json' });
  }

  if (p === '/api/health') return send(res, 200, JSON.stringify({ ok: true, tasks: db.load().tasks.length }), { 'Content-Type': 'application/json' });

  if (method === 'GET') {
    return html(res, 404, V.layout({
      title: '404 · ' + BRAND.product,
      user,
      body: `<div class="card empty"><h1>Ошибка 404</h1><p>Страница не найдена.</p><p><a class="btn" href="/">На главную</a></p></div>`,
    }));
  }
  send(res, 405, 'Method not allowed');
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = forwarded === 'https' || forwarded === 'http'
    ? forwarded
    : (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry|Mobile|Tablet/i;

function isMobileRequest(req) {
  if (String(req.headers['sec-ch-ua-mobile'] || '') === '?1') return true;
  return MOBILE_UA.test(String(req.headers['user-agent'] || ''));
}

function applyStep(task, object, step, body, user) {
  const isText = step.type === 'text';
  const geoProvided = body.lat != null && body.lng != null && body.accuracy != null && body.lat !== '';
  let check;

  if (isText) {
    if (geoProvided) {
      const g = verifyGeo(object, body.lat, body.lng, body.accuracy);
      if (g.ok) {
        check = g;
      } else {
        check = { ok: true, lat: null, lng: null, accuracy: null, distance: null };
      }
    } else {
      check = { ok: true, lat: null, lng: null, accuracy: null, distance: null };
    }
  } else {
    check = verifyGeo(object, body.lat, body.lng, body.accuracy);
    if (!check.ok) return { ok: false, error: check.error };
  }

  task.inspection ||= { steps: {} };
  const at = new Date().toISOString();
  const entry = {
    at,
    lat: check.lat,
    lng: check.lng,
    accuracy: check.accuracy,
    distance: check.distance,
  };

  if (isText) {
    const text = String(body.text || '').trim();
    if (!text) return { ok: false, error: 'Введите текст ответа.' };
    entry.text = text.slice(0, 4000);
  } else {
    if (!body.photoData) return { ok: false, error: 'Сначала сделайте кадр с камеры.' };
    if (body.captureSource !== 'camera') {
      return { ok: false, error: 'Кадр должен быть снят камерой на объекте. Загрузка готовых файлов запрещена.' };
    }
    const capturedTs = Date.parse(body.capturedAt || '');
    if (!Number.isFinite(capturedTs)) {
      return { ok: false, error: 'Не удалось определить время съёмки. Сделайте кадр заново.' };
    }
    const ageMs = Date.now() - capturedTs;
    if (ageMs > 30 * 60 * 1000) {
      return { ok: false, error: 'Кадр сделан слишком давно. Снимите объект заново прямо сейчас.' };
    }
    if (ageMs < -2 * 60 * 1000) {
      return { ok: false, error: 'Неверное время съёмки. Проверьте часы на устройстве и повторите.' };
    }
    const photoUrl = savePhoto(body.photoData, task.id);
    if (!photoUrl) return { ok: false, error: 'Не удалось сохранить кадр. Попробуйте снять ещё раз.' };
    entry.photo = photoUrl;
    entry.capturedAt = body.capturedAt;
  }

  task.inspection.steps[step.id] = entry;
  if (user) task.inspection.lastUser = user.id;
  if (task.status === 'rejected') {
    task.status = 'open';
    task.inspection.review = null;
  }
  if (task.status === 'submitted') {
    sms.notify(db.load(), task.clientId, {
      title: `Фото переснято: ${step.title}`,
      text: `${task.number}. Исполнитель переснял шаг «${step.title}». Проверьте новый кадр.`,
      kind: 'photo-reshot',
      taskId: task.id,
    });
  }
  db.save();
  return { ok: true };
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) send(res, 500, 'Внутренняя ошибка сервера');
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`${BRAND.product} running: http://${HOST}:${PORT}`);
  console.log('Исполнитель: 79514476815 / Invest-74!');
  console.log('Заказчик:    79000000000 / demo1234');
});

process.on('SIGINT', () => { try { db.saveSync(); } catch {} process.exit(0); });
