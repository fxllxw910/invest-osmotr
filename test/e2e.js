'use strict';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

let ua = MOBILE_UA;
let cookies = [];

function withoutMobileUa(fn) {
  const prev = ua;
  ua = DESKTOP_UA;
  return fn().finally(() => {
    ua = prev;
  });
}

function cookieHeader() {
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

function storeCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const kv = c.split(';')[0];
    const name = kv.split('=')[0];
    cookies = cookies.filter((x) => x.split('=')[0] !== name);
    if (!kv.endsWith('=')) cookies.push(kv);
  }
}

async function get(pathname) {
  const res = await fetch(BASE + pathname, {
    headers: { cookie: cookieHeader(), 'user-agent': ua },
    redirect: 'manual',
  });
  storeCookies(res);
  return {
    status: res.status,
    text: await res.text(),
    location: res.headers.get('location'),
    headers: res.headers,
  };
}

async function getBinary(pathname) {
  const res = await fetch(BASE + pathname, {
    headers: { cookie: cookieHeader(), 'user-agent': ua },
    redirect: 'manual',
  });
  storeCookies(res);
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

async function post(pathname, data) {
  const res = await fetch(BASE + pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(),
      'user-agent': ua,
    },
    body: new URLSearchParams(data).toString(),
    redirect: 'manual',
  });
  storeCookies(res);
  let text = '';
  try { text = await res.text(); } catch {}
  return { status: res.status, text, location: res.headers.get('location') };
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    failures++;
    return false;
  }
  console.log('ok   ' + msg);
  return true;
}

function fakePhotoDataUrl() {
  const raw = Buffer.alloc(6000);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 37 + 11) & 0xff;
  return 'data:image/jpeg;base64,' + raw.toString('base64');
}

function coordsFrom(html) {
  const m = /(\d{2}\.\d{4,}),\s*(\d{2}\.\d{4,})/.exec(html);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

async function login(phone, password) {
  cookies = [];
  return post('/login', { phone, password });
}

async function fillStep(taskId, sid, obj) {
  const page = await get('/tasks/' + taskId + '/inspect/' + sid);
  const isText = page.text.includes('Текстовый ответ');
  const payload = isText
    ? { text: 'Дефектов не выявлено', lat: String(obj.lat), lng: String(obj.lng), accuracy: '7' }
    : {
        photoData: fakePhotoDataUrl(),
        captureSource: 'camera',
        lat: String(obj.lat),
        lng: String(obj.lng),
        accuracy: '7',
        capturedAt: new Date().toISOString(),
      };
  return post('/tasks/' + taskId + '/inspect/' + sid, payload);
}

function taskIdByNumber(html, number) {
  for (const block of html.split('<article')) {
    if (!block.includes(number)) continue;
    const m = /\/tasks\/(\d+)/.exec(block);
    if (m) return m[1];
  }
  return null;
}

function readZip(buf) {  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const size = buf.readUInt32LE(off + 24);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    entries.push({ name, size, data: buf.slice(start, start + size) });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

(async () => {
  let r = await get('/');
  assert(r.status === 200 && r.text.includes('ИНВЕСТ-осмотр'), 'landing shows new brand');
  assert(r.text.includes('ООО «ИНВЕСТ-лизинг»') && r.text.includes('1107447002541'), 'landing shows legal entity and OGRN');
  assert(r.text.includes('7447167877') && r.text.includes('744701001'), 'landing shows ИНН and КПП');
  assert(!r.text.includes('/services') && !r.text.includes('/store'), 'landing has no removed sections');
  assert(r.text.includes('brandmark'), 'landing uses investl logo mark');

  r = await get('/login');
  assert(r.status === 200 && r.text.includes('Вход в систему'), 'GET /login renders login form');
  assert(r.text.includes('79514476815') && r.text.includes('79000000000'), 'login page shows demo credentials');

  r = await post('/login', { phone: '79514476815', password: 'wrong' });
  assert(r.status === 401 && r.text.includes('Неверный номер'), 'wrong password rejected');

  r = await login('79514476815', 'Invest-74!');
  assert(r.status === 303 && r.location === '/app', 'executor login redirects to /app');

  r = await get('/app');
  assert(r.status === 200 && r.text.includes('ИО-2026-000118'), 'dashboard lists seeded task with new prefix');
  assert(r.text.includes('Мои задания'), 'executor dashboard titled correctly');
  assert(!r.text.includes('Назначить осмотр'), 'executor cannot see assign button');

  let openId = taskIdByNumber(r.text, 'ИО-2026-000118');
  assert(!!openId, 'open seeded task found (id=' + openId + ')');

  r = await get('/tasks/' + openId);
  assert(r.status === 200 && r.text.includes('Алгоритм осмотра'), 'task page renders');
  const obj = coordsFrom(r.text);
  assert(!!obj, 'object coordinates parsed');
  const stepIds = [...new Set([...r.text.matchAll(/\/tasks\/\d+\/inspect\/([a-f0-9]+)/g)].map((m) => m[1]))];
  assert(stepIds.length >= 5, 'task page shows inspect links (' + stepIds.length + ')');

  for (const sid of stepIds) {
    const stepPage = await get('/tasks/' + openId + '/inspect/' + sid);
    assert(stepPage.status === 200, 'inspect link opens the step instead of bouncing to /app (' + sid.slice(0, 4) + ')');
  }

  r = await get('/tasks/' + openId + '/inspect/deadbeef');
  assert(r.status === 303 && r.location === '/tasks/' + openId,
    'unknown step id returns to the task, not the main menu');

  r = await get('/tasks/' + openId + '/inspect/' + stepIds[0]);
  assert(r.status === 200 && r.text.includes('Съёмка с камеры'), 'camera step page renders');
  assert(r.text.includes('capture="environment"'), 'camera input requests device camera');
  assert(r.text.includes('__STEP__'), 'client geo config injected');
  assert(r.text.includes('id="opencam" disabled') && r.text.includes('id="savebtn" disabled'),
    'camera and save buttons start locked until geo is confirmed');
  assert(r.text.includes('С компьютера загрузить готовый файл нельзя'),
    'page states that desktop file upload is impossible');
  assert(!r.text.includes('может предложить выбор файла'), 'misleading desktop file-picker hint removed');
  assert(r.text.includes('name="captureSource"'), 'capture source is submitted with the step');

  const inspectJs = await get('/assets/inspect.js');
  assert(inspectJs.status === 200, 'capture script is served');
  assert(inspectJs.text.includes('getUserMedia'), 'capture script uses the live device camera');
  assert(inspectJs.text.includes('На компьютере загрузить готовый файл нельзя'),
    'capture script refuses desktop file selection');
  assert(/isMobile/.test(inspectJs.text) && /geoOk\(\)/.test(inspectJs.text),
    'capture script gates shooting on mobile and confirmed geolocation');

  const desktopView = await withoutMobileUa(() => get('/tasks/' + openId + '/inspect/' + stepIds[0]));
  assert(desktopView.status === 200, 'desktop still opens the step page');
  assert(desktopView.text.includes('Пожалуйста, воспользуйтесь смартфоном'),
    'desktop sees the use-a-smartphone banner');
  assert(desktopView.text.includes('← Вернуться к заданию'), 'desktop banner offers a back button');
  assert(!desktopView.text.includes('id="stepform"') && !desktopView.text.includes('id="fileinput"'),
    'desktop gets no camera form and no file input');
  assert((desktopView.text.match(/<button[^>]*disabled/g) || []).length >= 2,
    'desktop gate renders its action buttons disabled');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[0], {
    photoData: fakePhotoDataUrl(), lat: '55.75', lng: '37.61', accuracy: '8',
  });
  assert(r.status === 400 && (r.text.includes('вне зоны') || r.text.includes('Вы находитесь')), 'photo outside radius rejected');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[0], {
    photoData: fakePhotoDataUrl(), lat: String(obj.lat), lng: String(obj.lng), accuracy: '500',
  });
  assert(r.status === 400 && r.text.includes('Точность GPS'), 'low GPS accuracy rejected');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[0], {
    photoData: fakePhotoDataUrl(), captureSource: 'camera', lat: String(obj.lat), lng: String(obj.lng),
    accuracy: '9', capturedAt: new Date().toISOString(),
  });
  assert(r.status === 303, 'valid geolocated photo accepted');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[1], {
    photoData: fakePhotoDataUrl(), lat: String(obj.lat), lng: String(obj.lng),
    accuracy: '9', capturedAt: new Date().toISOString(),
  });
  assert(r.status === 400 && r.text.includes('камерой на объекте'),
    'photo without live camera proof rejected');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[1], {
    photoData: fakePhotoDataUrl(), captureSource: 'gallery', lat: String(obj.lat), lng: String(obj.lng),
    accuracy: '9', capturedAt: new Date().toISOString(),
  });
  assert(r.status === 400 && r.text.includes('камерой на объекте'),
    'photo marked as gallery upload rejected');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[1], {
    photoData: fakePhotoDataUrl(), captureSource: 'camera', lat: String(obj.lat), lng: String(obj.lng),
    accuracy: '9', capturedAt: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
  });
  assert(r.status === 400 && r.text.includes('слишком давно'),
    'old photo from gallery rejected by capture time');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[1], {
    photoData: fakePhotoDataUrl(), captureSource: 'camera', lat: String(obj.lat), lng: String(obj.lng),
    accuracy: '9',
  });
  assert(r.status === 400 && r.text.includes('время съёмки'),
    'photo without capture timestamp rejected');

  r = await post('/tasks/' + openId + '/inspect/' + stepIds[1], {
    photoData: fakePhotoDataUrl(), captureSource: 'camera',
    lat: '', lng: '', accuracy: '',
    capturedAt: new Date().toISOString(),
  });
  assert(r.status === 400 && r.text.includes('Координаты не получены'),
    'photo without geolocation rejected');

  const desktopPost = await withoutMobileUa(() =>
    post('/tasks/' + openId + '/inspect/' + stepIds[1], {
      photoData: fakePhotoDataUrl(), captureSource: 'camera', lat: String(obj.lat), lng: String(obj.lng),
      accuracy: '9', capturedAt: new Date().toISOString(),
    })
  );
  assert(desktopPost.status === 403 && desktopPost.text.includes('воспользуйтесь смартфоном'),
    'desktop browsers cannot post a camera step even with valid data');

  r = await get('/tasks/' + openId);
  const photoUrl = (r.text.match(/\/photos\/[A-Za-z0-9._-]+/) || [])[0];
  assert(!!photoUrl, 'photo URL appears on task page');
  const img = await getBinary(photoUrl);
  assert(img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'), 'photo served as image');
  assert(r.text.includes('±9 м'), 'geo metadata rendered with capture');

  for (const sid of stepIds.slice(1)) {
    const res = await fillStep(openId, sid, obj);
    assert(res.status === 303, 'step filled (' + sid.slice(0, 4) + ')');
  }

  r = await get('/tasks/' + openId);
  assert(!r.text.includes('Заполните все шаги'), 'submit enabled after all steps');
  assert(!r.text.includes('Скачать фото'), 'executor does not see download button');

  r = await post('/api/tasks/' + openId + '/submit', {});
  assert(r.status === 303, 'submit accepted');
  r = await get('/tasks/' + openId);
  assert(r.text.includes('На проверке'), 'status becomes submitted');
  assert(!/\/s\/[A-Za-z0-9_-]{6,}/.test(r.text), 'executor page does not expose client-only link');

  // ------------------------------------------------ client
  r = await login('79000000000', 'demo1234');
  assert(r.status === 303, 'client login works');

  r = await get('/app');
  assert(r.status === 200 && r.text.includes('Задания на осмотр'), 'client dashboard renders');
  assert(r.text.includes('Назначить осмотр'), 'client sees assign button');
  assert(r.text.includes('/app?tab=review'), 'client sees review tab');

  const reviewTab = await get('/app?tab=review');
  assert(reviewTab.status === 200 && reviewTab.text.includes('Осмотры на проверке'), 'review tab renders');
  const seededId = taskIdByNumber(reviewTab.text, 'ИО-2026-000116');
  assert(!!seededId, 'client sees seeded submitted inspection (id=' + seededId + ')');

  r = await get('/tasks/' + seededId);
  assert(r.status === 200 && r.text.includes('Решение по осмотру'), 'client sees per-photo and whole review controls');
  assert(r.text.includes('Принять фото') && r.text.includes('Отклонить'), 'client can accept or reject each photo');
  assert(!/\/inspect\/[a-f0-9]+/.test(r.text), 'client page does not offer camera links to the client');

  const seededSteps = [...new Set([...r.text.matchAll(/\/tasks\/\d+\/photo\/([a-f0-9]+)/g)].map((m) => m[1]))];
  assert(seededSteps.length >= 5, 'each photo has its own review form (' + seededSteps.length + ')');

  let rejectedOne = false;
  for (const sid of seededSteps) {
    const decision = rejectedOne ? 'accept' : 'reject';
    const res = await post('/tasks/' + seededId + '/photo/' + sid, {
      decision,
      comment: decision === 'reject' ? 'Не читается серийный номер' : '',
    });
    assert(res.status === 303, 'photo reviewed individually (' + decision + ')');
    if (decision === 'reject') rejectedOne = true;
  }

  r = await get('/tasks/' + seededId);
  assert(r.text.includes('✕ отклонено') && r.text.includes('✓ принято'), 'per-photo states rendered');
  assert(r.text.includes('Не читается серийный номер'), 'rejection comment shown');
  assert(r.text.includes('Переснимите отмеченные шаги'), 'submitted task tells executor to re-shoot rejected photos');

  const zip = await getBinary('/tasks/' + seededId + '/download');
  assert(zip.status === 200, 'ZIP download returns 200');
  assert(zip.headers.get('content-type') === 'application/zip', 'ZIP content type set');
  assert(zip.buf.slice(0, 2).toString() === 'PK', 'ZIP signature present');
  assert(zip.buf.includes('README.txt'), 'ZIP contains README with geo metadata');
  assert(/filename\*=UTF-8''/.test(zip.headers.get('content-disposition') || ''), 'ZIP filename is UTF-8 encoded');

  const entries = readZip(zip.buf);
  assert(entries.length === 6, 'ZIP holds 5 photos + README (' + entries.length + ')');
  assert(entries.every((e) => e.name === 'README.txt' || /^0[1-5] .+ \((принято|отклонено|без-проверки)\)\.(jpg|png)$/.test(e.name)),
    'photo names carry sequence, title and review state');
  const readme = entries.find((e) => e.name === 'README.txt');
  const readmeText = readme.data.toString('utf8');
  assert(readmeText.charCodeAt(0) === 0xfeff, 'README has UTF-8 BOM for Notepad');
  assert(readmeText.includes('координаты') && readmeText.includes('точность'), 'README documents geo metadata');
  assert(readmeText.includes('ИО-2026-000116') && readmeText.includes('ИНВЕСТ-лизинг'), 'README identifies task and client');
  const photoEntry = entries.find((e) => /\.(jpg|png)$/.test(e.name));
  const magic = photoEntry.data.slice(0, 4).toString('hex');
  assert(magic === 'ffd8ff' || magic.startsWith('89504e47'), 'ZIP photos are intact image files');

  r = await post('/api/tasks/' + seededId + '/review', { decision: 'accept', comment: '' });
  assert(r.status === 303 && /%D0%9E%D1%82%D0%BA%D0%BB%D0%BE%D0%BD/.test(r.location),
    'whole accept blocked while a photo stays rejected');

  // per-photo rework while the inspection stays submitted
  const reworkPage = await get('/tasks/' + seededId);
  const seededToken = (reworkPage.text.match(/\/s\/([A-Za-z0-9_-]+)/) || [])[1];
  assert(!!seededToken, 'client page exposes public token');
  const clientCookies = cookies;

  cookies = [];
  const ex = await login('79514476815', 'Invest-74!');
  assert(ex.status === 303, 'executor logs in for rework');
  let exTask = await get('/tasks/' + seededId);
  assert(exTask.text.includes('На проверке'), 'task still marked submitted during rework');
  const exReworkLink = (exTask.text.match(/\/tasks\/\d+\/inspect\/([a-f0-9]+)/) || [])[1];
  assert(exReworkLink === seededSteps[0], 'executor sees rework only for the rejected step');
  let exPage = await get('/tasks/' + seededId + '/inspect/' + seededSteps[1]);
  assert(exPage.status === 303 && exPage.location.startsWith('/tasks/' + seededId),
    'executor cannot re-shoot an already accepted photo');
  exPage = await get('/tasks/' + seededId + '/inspect/' + seededSteps[0]);
  assert(exPage.status === 200 && exPage.text.includes('Фотография отклонена заказчиком'),
    'executor rework page explains the rejection');

  cookies = [];
  let pubView = await get('/s/' + seededToken);
  const pubLinks = [...new Set([...pubView.text.matchAll(/\/s\/[A-Za-z0-9_-]+\/step\/([a-f0-9]+)/g)].map((m) => m[1]))];
  assert(pubLinks.length === 1 && pubLinks[0] === seededSteps[0],
    'public page offers exactly the rejected step for rework (' + pubLinks.join(',') + ')');
  assert(pubView.text.includes('Заказчик отклонил часть кадров'), 'public page explains partial rejection');
  const seededObj = coordsFrom(reworkPage.text);
  let reworkRes = await post('/s/' + seededToken + '/step/' + pubLinks[0], {
    photoData: fakePhotoDataUrl(), captureSource: 'camera',
    lat: String(seededObj.lat), lng: String(seededObj.lng),
    accuracy: '8', capturedAt: new Date().toISOString(),
  });
  assert(reworkRes.status === 303, 'rejected photo re-shot without leaving submitted state');
  pubView = await get('/s/' + seededToken);
  assert(!pubView.text.includes('/step/'), 'no rework links remain after the rejected photo is replaced');
  cookies = clientCookies;
  r = await get('/tasks/' + seededId);
  assert(!r.text.includes('✕ отклонено'), 're-shot photo no longer marked rejected');
  assert(r.text.includes('ожидает проверки'), 're-shot photo awaits a fresh review');

  r = await post('/tasks/' + seededId + '/photo/' + seededSteps[0], { decision: 'accept', comment: '' });
  assert(r.status === 303, 'client can accept the re-shot photo');
  r = await get('/tasks/' + seededId);
  assert(!r.text.includes('ожидает проверки') && !r.text.includes('✕ отклонено'),
    'every photo accepted after rework');

  r = await post('/api/tasks/' + seededId + '/review', { decision: 'reject', comment: 'Переснимите табличку' });
  assert(r.status === 303, 'whole inspection rejected');
  r = await get('/tasks/' + seededId);
  assert(r.text.includes('отклонено'), 'rejected status rendered');

  // accept-all flow on the inspection submitted by the executor
  r = await get('/tasks/' + openId);
  const liveSteps = [...new Set([...r.text.matchAll(/\/tasks\/\d+\/photo\/([a-f0-9]+)/g)].map((m) => m[1]))];
  assert(liveSteps.length >= 5, 'submitted inspection exposes per-photo actions');
  for (const sid of liveSteps) {
    const res = await post('/tasks/' + openId + '/photo/' + sid, { decision: 'accept', comment: '' });
    assert(res.status === 303, 'photo accepted individually');
  }
  r = await post('/api/tasks/' + openId + '/review', { decision: 'accept', comment: 'Замечаний нет' });
  assert(r.status === 303, 'whole inspection accepted when every photo is accepted');
  r = await get('/tasks/' + openId);
  assert(r.text.includes('Принято') && r.text.includes('Замечаний нет'), 'accepted decision rendered');

  // ------------------------------------------------ create object inside assign flow
  const dash = await get('/app');
  assert(dash.text.includes('__new') && dash.text.includes('Новый объект'),
    'assign dialog offers creating a new object');
  assert(dash.text.includes('name="newAddress"') && dash.text.includes('name="newLat"'),
    'new object form collects address and coordinates');

  r = await post('/api/tasks', {
    objectId: '__new',
    newTitle: 'Погрузчик Manitou MLT 625',
    newAddress: 'Челябинск, пр-кт Победы, 147а',
    newLat: '55.1838717',
    newLng: '61.408741',
    title: 'Осмотр нового объекта',
    purpose: 'Проверка предмета лизинга',
    executorPhone: '+7 951 447-68-15',
    deadline: '2026-12-01',
  });
  assert(r.status === 303 && /^\/tasks\/\d+\?/.test(r.location), 'client can assign a task to a brand-new object');
  const createdTask = await get(r.location);
  assert(createdTask.text.includes('Погрузчик Manitou MLT 625'), 'new object title appears on the task');
  assert(createdTask.text.includes('55.183872') && createdTask.text.includes('61.408741'),
    'new object keeps the provided coordinates');
  assert(createdTask.text.includes('80 м'), 'new object gets the default 80 m radius');
  assert(!createdTask.text.includes('Тип') && !createdTask.text.includes('Площадь'),
    'object card no longer shows type and area');

  r = await post('/api/tasks', {
    objectId: '__new', newTitle: '', newAddress: 'Челябинск', title: 'Без названия',
    executorPhone: '+7 951 447-68-15', deadline: '2026-12-01',
  });
  assert(r.status === 303 && /err=/.test(r.location), 'new object without a title is rejected with a message');

  r = await post('/api/tasks', {
    objectId: '__new', newTitle: 'Без адреса', newAddress: '', title: 'Без адреса',
    executorPhone: '+7 951 447-68-15', deadline: '2026-12-01',
  });
  assert(r.status === 303 && /err=/.test(r.location), 'new object without an address is rejected');

  // ------------------------------------------------ new task + SMS
  r = await post('/api/tasks', {
    objectId: '1',
    title: 'Осмотр нового объекта',
    purpose: 'Тест назначения',
    executorPhone: '+7 999 000-11-22',
    deadline: '2026-12-01',
  });
  assert(r.status === 303 && /^\/tasks\/\d+\?/.test(r.location), 'client can create a task');
  const newTask = await get(r.location);
  const num = (newTask.text.match(/ИО-2026-(\d+)/) || [])[1];
  assert(!!num && num.length === 6, 'new task number has 6-digit tail (' + num + ')');
  assert(newTask.text.includes('ООО «ИНВЕСТ-лизинг»'), 'new task carries client company');
  assert(newTask.text.includes('Осмотр нового объекта'), 'new task title applied');
  assert(newTask.text.includes('+7 999 000-11-22'), 'new task shows executor phone');
  assert(newTask.text.includes('SMS'), 'new task reports SMS formation');
  assert(newTask.text.includes('доставлена'), 'task page confirms SMS delivery');

  r = await get('/outbox');
  assert(r.status === 200 && r.text.includes('+7 999 000-11-22'), 'SMS outbox lists message to executor');
  assert(r.text.includes('ИО-2026-' + num), 'SMS body contains task number');
  assert(r.text.includes('доставлено'), 'outbox marks the message as delivered, not simulated');
  assert(!r.text.includes('шлюз не подключён'), 'outbox no longer claims the gateway is disconnected');
  assert(r.text.includes('/s/'), 'SMS body contains public link');
  assert(r.text.includes('пароль'), 'SMS body contains password for a new executor');

  // ------------------------------------------------ SMS gateway endpoint
  const gwToken = process.env.SMS_GATEWAY_TOKEN || 'invest-osmotr-local-gateway';
  const gwPost = async (data, token) => {
    const res = await fetch(BASE + '/api/sms/gateway', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-sms-token': token },
      body: new URLSearchParams(data).toString(),
      redirect: 'manual',
    });
    return { status: res.status, text: await res.text() };
  };
  const gwOk = await gwPost({ to: '+7 999 000-11-22', text: 'Проверка шлюза ИНВЕСТ-осмотр', messageId: 'e2e-1', kind: 'test' }, gwToken);
  assert(gwOk.status === 200 && gwOk.text.includes('"ok":true') && gwOk.text.includes('receiptId'),
    'SMS gateway accepts a message and issues a receipt');
  const gwBad = await gwPost({ to: '123', text: 'x' }, gwToken);
  assert(gwBad.status === 400 && gwBad.text.includes('"ok":false'),
    'SMS gateway rejects an invalid phone number');
  const gwNoAuth = await gwPost({ to: '+7 999 000-11-22', text: 'взлом' }, 'wrong-token');
  assert(gwNoAuth.status === 401, 'SMS gateway rejects a wrong token');

  // ------------------------------------------------ geocoding endpoint
  const geoRes = await post('/api/geocode', { address: 'Челябинск, проспект Победы, 147а' });
  const geoJson = JSON.parse(geoRes.text || '{}');
  assert(geoJson && typeof geoJson.ok === 'boolean', 'geocoder answers with a JSON contract');
  if (geoJson.ok === true) {
    assert(Math.abs(Number(geoJson.lat) - 55.1838717) < 0.0005 &&
      Math.abs(Number(geoJson.lng) - 61.408741) < 0.0005,
      'geocoder returns the coordinates of проспект Победы, 147а');
  } else {
    console.log('note geocoder unavailable offline, coordinate check skipped');
  }
  const geoMiss = await post('/api/geocode', { address: 'несуществующий адрес 000000' });
  assert(geoMiss.status === 404 && geoMiss.text.includes('"ok":false'), 'geocoder reports an unresolvable address');

  const geoCity = await post('/api/geocode', { address: 'г. Челябинск, ул. Кирова, д. 5' });
  const geoCityJson = JSON.parse(geoCity.text || '{}');
  if (geoCityJson.ok === true) {
    const lat = Number(geoCityJson.lat);
    const lng = Number(geoCityJson.lng);
    assert(lat > 55.0 && lat < 55.3 && lng > 61.2 && lng < 61.6,
      'geocoder never resolves a Челябинск address to another city (' + lat + ', ' + lng + ')');
  } else {
    console.log('note geocoder unavailable offline, wrong-city check skipped');
  }

  // ------------------------------------------------ executor result notifications
  r = await login('79514476815', 'Invest-74!');
  assert(r.status === 303, 'executor logs in again');

  r = await get('/app');
  assert(r.status === 200 && r.text.includes('badgecount'), 'executor sees unread notification badge');

  r = await get('/notifications');
  assert(r.status === 200 && r.text.includes('Осмотр отклонён'), 'executor notified about whole rejection');
  assert(r.text.includes('Осмотр принят'), 'executor notified about acceptance');
  assert(r.text.includes('Переснимите') || r.text.includes('отклонён'), 'notification explains what to re-shoot');

  r = await get('/tasks/' + seededId);
  assert(r.status === 200 && r.text.includes('Отправить на проверку'), 'executor can resubmit after rejection');
  const reworkStep = (r.text.match(/\/tasks\/\d+\/inspect\/([a-f0-9]+)/) || [])[1];
  assert(!!reworkStep, 'rejected task allows re-capturing steps');

  r = await post('/api/tasks', { objectId: '1', title: 'Нельзя', deadline: '2026-12-01' });
  assert(r.status === 303 && r.location === '/app', 'executor cannot create tasks');

  r = await get('/outbox');
  assert(r.status === 303 && r.location === '/app', 'executor cannot read SMS outbox');

  const zipDenied = await getBinary('/tasks/' + seededId + '/download');
  assert(zipDenied.status === 303, 'executor cannot download client ZIP');

  r = await post('/tasks/' + seededId + '/photo/abcdef12', { decision: 'accept', comment: '' });
  assert(r.status === 303 && r.location === '/app', 'executor cannot review photos');

  r = await post('/api/tasks/' + seededId + '/review', { decision: 'accept' });
  assert(r.status === 303 && r.location === '/app', 'executor cannot decide on inspection');

  // ------------------------------------------------ public link (no login)
  const cc2 = await login('79000000000', 'demo1234');
  const capp2 = await fetch(BASE + '/app', { headers: { cookie: cookieHeader() } }).then((x) => x.text());
  const pubTaskId = taskIdByNumber(capp2, 'ИО-2026-000117');
  const pubTaskHtml = await get('/tasks/' + pubTaskId);
  const pubToken = (pubTaskHtml.text.match(/\/s\/([A-Za-z0-9_-]+)/) || [])[1];
  assert(!!pubToken, 'client page exposes public link (' + cc2.status + ')');

  const savedCookies = cookies;
  cookies = [];
  r = await get('/s/' + pubToken);
  assert(r.status === 200 && r.text.includes('Алгоритм осмотра'), 'public link opens without login');
  assert(!r.text.includes('Выйти'), 'public page has no account chrome');
  const pubStep = (r.text.match(/\/s\/[A-Za-z0-9_-]+\/step\/([a-f0-9]+)/) || [])[1];
  assert(!!pubStep, 'public page links to each step');

  r = await get('/s/' + pubToken + '/step/' + pubStep);
  assert(r.status === 200 && r.text.includes('capture="environment"'), 'public step uses device camera');
  const pubObj = coordsFrom(r.text);
  r = await post('/s/' + pubToken + '/step/' + pubStep, {
    photoData: fakePhotoDataUrl(), captureSource: 'camera',
    lat: String(pubObj.lat), lng: String(pubObj.lng), accuracy: '6',
    capturedAt: new Date().toISOString(),
  });
  assert(r.status === 303, 'public step accepts geolocated photo');

  r = await get('/s/' + pubToken);
  assert(r.text.includes('1 из 6') || r.text.includes('из 6'), 'public page tracks progress');

  r = await post('/s/' + pubToken + '/submit', {});
  assert(r.status === 303 && /err=/.test(r.location), 'public submit blocked until all steps filled');

  const badToken = 'zzzzzzzzzzzzzzzz';
  r = await get('/s/' + badToken);
  assert(r.status === 404 && r.text.includes('Ссылка недействительна'), 'unknown token shows invalid-link page');
  cookies = savedCookies;

  // ------------------------------------------------ removed pages
  for (const page of ['/store', '/services', '/privacy', '/terms', '/nope-page']) {
    r = await get(page);
    assert(r.status === 404 && r.text.includes('Ошибка 404'), 'removed/unknown route 404: ' + page);
  }

  r = await get('/api/health');
  assert(r.status === 200, 'health endpoint available');

  console.log(failures ? `\n${failures} TEST(S) FAILED` : '\nALL TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
