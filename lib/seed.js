'use strict';

const crypto = require('crypto');
const { load, save, nextId } = require('./db');
const demo = require('./demo-photos');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function makeUser({ phone, password, name, role, company }) {
  const salt = crypto.randomBytes(12).toString('hex');
  const u = {
    id: nextId('user'),
    phone,
    name,
    role,
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };
  if (company) u.company = company;
  return u;
}

function token() {
  return crypto.randomBytes(9).toString('base64url');
}

function step(key, title, instruction, opts = {}) {
  return {
    id: crypto.randomBytes(4).toString('hex'),
    key,
    title,
    instruction,
    type: opts.type || 'photo',
    required: opts.required !== false,
    hint: opts.hint || '',
    options: opts.options || null,
  };
}

const PHOTO_SCENARIO = [
  ['overview', 'Общий вид', 'Сфотографируйте объект целиком так, чтобы он занимал большую часть кадра.', 'Отойдите на 3–5 метров, чтобы объект был виден полностью.'],
  ['plate', 'Заводская табличка', 'Крупным планом снимите табличку с серийным номером и годом выпуска.', 'Номер должен читаться без увеличения.'],
  ['state', 'Состояние объекта', 'Снимите характерные повреждения или их отсутствие.', 'Если повреждений нет — снимите объект с того же ракурса.'],
  ['docs', 'Документ', 'Сфотографируйте первую страницу паспорта или свидетельства.', 'Проверьте, что номер и подпись видно.'],
  ['extra', 'Дополнительный ракурс', 'Снимите объект с другой стороны.', 'Помогает заказчику оценить состояние.'],
];

const TEXT_SCENARIO = [
  ['mileage', 'Показания', 'Укажите пробег или наработку в моточасах.', 'Значение с приборной панели.'],
  ['defects', 'Дефекты', 'Перечислите выявленные дефекты или напишите «не выявлены».', ''],
  ['comment', 'Комментарий', 'Опишите состояние объекта.', ''],
];

function buildSteps() {
  const list = PHOTO_SCENARIO.map(([k, t, i, h]) => step(k, t, i, { hint: h }));
  list.push(step(TEXT_SCENARIO[1][0], TEXT_SCENARIO[1][1], TEXT_SCENARIO[1][2], { type: 'text' }));
  return list;
}

function seed() {
  const db = load();
  if (db.users.length) return;

  const executor = makeUser({
    phone: '79514476815',
    password: 'Invest-74!',
    name: 'Алексей Смирнов',
    role: 'executor',
  });
  const client = makeUser({
    phone: '79000000000',
    password: 'demo1234',
    name: 'ООО «ИНВЕСТ-лизинг»',
    role: 'client',
    company: 'ООО «ИНВЕСТ-лизинг»',
  });
  db.users.push(executor, client);

  const objects = [
    {
      id: nextId('object'),
      title: 'Экскаватор-погрузчик JCB 3CX',
      address: 'Челябинск, пр-кт Победы, 147а',
      kind: 'commercial',
      area: 24,
      lat: 55.1838717,
      lng: 61.408741,
      radius: 120,
    },
    {
      id: nextId('object'),
      title: 'Складской комплекс, корпус Б',
      address: 'Челябинск, Троицкий тракт, 11',
      kind: 'commercial',
      area: 1850,
      lat: 55.1102451,
      lng: 61.3862108,
      radius: 80,
    },
  ];
  db.objects.push(...objects);

  const now = Date.now();
  const mk = (number, objectId, title, purpose, days, status, steps) => ({
    id: nextId('task'),
    number,
    objectId,
    title,
    purpose,
    status,
    token: token(),
    customerName: client.company,
    executorName: executor.name,
    executorPhone: executor.phone,
    executorPhonePretty: '+7 951 447-68-15',
    executorId: executor.id,
    clientId: client.id,
    createdAt: new Date(now - days * 864e5).toISOString(),
    deadline: new Date(now + (days + 3) * 864e5).toISOString(),
    steps,
    inspection: null,
  });

  db.tasks.push(
    mk('ИО-2026-000117', objects[0].id, 'Плановый осмотр техники', 'Ежегодная проверка предмета лизинга', 4, 'open', buildSteps()),
    mk('ИО-2026-000118', objects[1].id, 'Осмотр при передаче', 'Проверка состояния перед передачей лизингополучателю', 2, 'open', buildSteps())
  );

  const photosDir = require('./db').PHOTOS_DIR;
  const submitted = mk(
    'ИО-2026-000116',
    objects[0].id,
    'Осмотр перед продлением договора',
    'Подтверждение состояния предмета лизинга',
    6,
    'submitted',
    buildSteps()
  );
  const steps = {};
  submitted.steps.forEach((s, i) => {
    const at = new Date(now - 3600e3 + i * 120e3).toISOString();
    if (s.type === 'text') {
      steps[s.id] = {
        at,
        lat: null,
        lng: null,
        accuracy: null,
        distance: null,
        text: 'Не выявлены. Наработка 2 480 моточасов, следов подтёков нет.',
      };
      return;
    }
    const name = `demo-116-${i + 1}.png`;
    demo.writePhoto(photosDir, name, i);
    steps[s.id] = {
      at,
      lat: objects[0].lat + (i - 2) * 0.00002,
      lng: objects[0].lng - (i - 2) * 0.00003,
      accuracy: 8 + i * 2,
      distance: 12 + i * 7,
      photo: '/photos/' + name,
      capturedAt: at,
    };
  });
  submitted.inspection = {
    steps,
    submittedAt: new Date(now - 1800e3).toISOString(),
    review: null,
  };
  db.tasks.push(submitted);

  save();
}

module.exports = { seed, hashPassword, token, buildSteps, PHOTO_SCENARIO };
