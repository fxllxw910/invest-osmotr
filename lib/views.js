'use strict';

const { BRAND, LOGO_MARK, FAVICON } = require('./brand');

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const brandMark = (cls = '') => `${LOGO_MARK}`.replace('class="brandmark"', `class="brandmark ${cls}"`);

function layout({ title, body, user, active = '', wide = false, bodyClass = '', unread = 0 }) {
  const nav = user
    ? `
    <header class="topbar">
      <a class="brand" href="/app"><span class="logo">${brandMark()}</span><span class="brandtext">${BRAND.product}</span></a>
      <nav class="nav">
        <a href="/app" class="${active === 'tasks' ? 'on' : ''}">Задания</a>
        ${user.role === 'client' ? `<a href="/app?tab=review" class="${active === 'review' ? 'on' : ''}">Проверка</a>` : ''}
        <a href="/notifications" class="${active === 'notifications' ? 'on' : ''}">Уведомления${unread ? ` <span class="badgecount">${unread}</span>` : ''}</a>
      </nav>
      <div class="whoami">
        <span class="whoname">${esc(user.name)}</span>
        <span class="whorole">${user.role === 'client' ? 'Заказчик' : 'Исполнитель'}</span>
        <form method="post" action="/logout"><button class="linkbtn">Выйти</button></form>
      </div>
    </header>`
    : `
    <header class="topbar">
      <a class="brand" href="/"><span class="logo">${brandMark()}</span><span class="brandtext">${BRAND.product}</span></a>
      <nav class="nav">
        <a class="btn ghost" href="/login">Войти</a>
      </nav>
    </header>`;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#c8af64">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="${FAVICON}">
</head>
<body class="${bodyClass}">
${nav}
<main class="${wide ? 'wide' : ''}">
${body}
</main>
<footer class="foot">
  <span>${BRAND.legal} · ОГРН ${BRAND.ogrn} · ИНН ${BRAND.inn} · КПП ${BRAND.kpp}</span>
  <span class="dot">·</span>
  <a href="${BRAND.site}" target="_blank" rel="noopener">investl.ru</a>
</footer>
</body>
</html>`;
}

const flash = (msg, kind = 'ok') =>
  msg ? `<div class="flash ${kind}">${esc(msg)}</div>` : '';

function loginPage({ error, phone }) {
  return layout({
    title: 'Вход · ' + BRAND.product,
    bodyClass: 'auth-body',
    body: `
<div class="auth">
  <div class="auth-hero">
    <div class="auth-brand"><span class="logo big">${brandMark()}</span> ${BRAND.product}</div>
    <h1>Осмотры предметов лизинга</h1>
    <p class="muted">Фотофиксация объектов по заданному сценарию с контролем геолокации
    и проверкой каждого кадра заказчиком.</p>
    <ul class="ticks">
      <li>Задание приходит ссылкой в SMS — приложение не нужно</li>
      <li>Съёмка только с камеры устройства, без галереи</li>
      <li>Координаты и точность GPS проверяются на сервере</li>
    </ul>
  </div>

  <form class="card auth-card" method="post" action="/login">
    <h2>Вход в систему</h2>
    <p class="muted small">Номер телефона и пароль, выданные заказчиком.</p>
    ${error ? `<div class="flash err">${esc(error)}</div>` : ''}
    <label>Телефон
      <input name="phone" inputmode="tel" autocomplete="username" placeholder="+7 951 447-68-15" value="${esc(phone || '')}" required>
    </label>
    <label>Пароль
      <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
    </label>
    <button class="btn primary block" type="submit">Войти</button>
    <div class="hintbox">
      <b>Демо-доступ</b><br>
      Заказчик: <code>79000000000</code> / <code>demo1234</code><br>
      Исполнитель: <code>79514476815</code> / <code>Invest-74!</code>
    </div>
  </form>
</div>`,
  });
}

function statusPill(status) {
  const map = {
    open: ['В работе', 'pill open'],
    submitted: ['На проверке', 'pill wait'],
    accepted: ['Принято', 'pill ok'],
    rejected: ['Отклонено', 'pill bad'],
  };
  const [text, cls] = map[status] || [status, 'pill'];
  return `<span class="${cls}">${esc(text)}</span>`;
}

function photoState(f) {
  if (!f || !f.photo) return '';
  if (f.review === 'accepted') return '<span class="photostate ok">✓ принято</span>';
  if (f.review === 'rejected') return '<span class="photostate bad">✕ отклонено</span>';
  return '<span class="photostate wait">ожидает проверки</span>';
}

function progress(task) {
  const fixed = task.inspection ? task.inspection.steps || {} : {};
  const total = task.steps.length;
  const done = Object.keys(fixed).length;
  const photos = task.steps.filter((s) => s.type !== 'text');
  const accepted = photos.filter((s) => fixed[s.id] && fixed[s.id].review === 'accepted').length;
  const rejected = photos.filter((s) => fixed[s.id] && fixed[s.id].review === 'rejected').length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, photos: photos.length, accepted, rejected };
}

function dashPage({ user, tasks, objects, flashMsg, errorMsg = '', tab = 'tasks', unread = 0 }) {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const isClient = user.role === 'client';

  const visible = isClient && tab === 'review'
    ? tasks.filter((t) => t.status === 'submitted')
    : tasks;

  const pendingReview = isClient ? tasks.filter((t) => t.status === 'submitted').length : 0;

  const cards = visible
    .map((t) => {
      const obj = byId.get(t.objectId);
      const pr = progress(t);
      return `
      <article class="card task-card">
        <div class="task-head">
          <div>
            <div class="task-num">${esc(t.number)}</div>
            <h3>${esc(t.title)}</h3>
          </div>
          ${statusPill(t.status)}
        </div>
        <div class="objline"><span class="pin">◎</span> ${esc(obj ? obj.title || obj.address : '—')}</div>
        <div class="objline small muted">${esc(obj ? obj.address : '—')}</div>
        <div class="meta">
          <span>${esc(t.purpose || '')}</span>
          <span>до ${esc(new Date(t.deadline).toLocaleDateString('ru-RU'))}</span>
        </div>
        <div class="bar"><i style="width:${pr.pct}%"></i></div>
        <div class="task-foot">
          <span class="muted small">${pr.done} из ${pr.total} шагов${
            pr.rejected ? ` · <b class="badtext">${pr.rejected} отклонено</b>` : ''
          }</span>
          <a class="btn small ${t.status === 'open' ? 'primary' : ''}" href="/tasks/${t.id}">
            ${isClient && t.status === 'submitted' ? 'Проверить' : t.status === 'open' ? (pr.done ? 'Продолжить' : 'Открыть') : 'Смотреть'}
          </a>
        </div>
      </article>`;
    })
    .join('');

  const title = isClient
    ? tab === 'review' ? 'Осмотры на проверке' : 'Задания на осмотр'
    : 'Мои задания';

  const sub = isClient
    ? tab === 'review'
      ? 'Проверьте каждую фотографию: примите или отклоните с комментарием.'
      : 'Назначайте осмотры и проверяйте результаты.'
    : 'Проводите осмотры и следите за результатами проверки.';

  return layout({
    title: title + ' · ' + BRAND.product,
    user,
    active: tab === 'review' ? 'review' : 'tasks',
    unread,
    body: `
<div class="pagehead">
  <div>
    <h1>${esc(title)}</h1>
    <p class="muted">${esc(sub)}</p>
  </div>
  ${isClient ? '<button class="btn primary" id="newTask">Назначить осмотр</button>' : ''}
</div>
${flash(flashMsg)}
${errorMsg ? `<div class="flash err">${esc(errorMsg)}</div>` : ''}
${isClient && pendingReview && tab !== 'review'
  ? `<div class="flash wait">Осмотров на проверке: <b>${pendingReview}</b>. <a href="/app?tab=review">Перейти к проверке</a></div>`
  : ''}
<div class="grid">${cards || `<div class="card empty">${tab === 'review' ? 'Нет осмотров на проверке.' : 'Заданий пока нет.'}</div>`}</div>
${isClient ? newTaskDialog(objects) : ''}
<script>
const dlg = document.getElementById('newTaskDialog');
document.getElementById('newTask')?.addEventListener('click', () => dlg.showModal());
const sel = document.getElementById('objectSelect');
const newFields = document.getElementById('newObjFields');
const syncObj = () => {
  const isNew = sel.value === '__new';
  newFields.hidden = !isNew;
  newFields.querySelectorAll('input').forEach((i) => { i.required = isNew && (i.name === 'newTitle' || i.name === 'newAddress'); });
};
sel?.addEventListener('change', syncObj);
syncObj();
document.getElementById('geoLookup')?.addEventListener('click', async () => {
  const addr = document.getElementById('newAddress').value.trim();
  const state = document.getElementById('geoLookupState');
  if (!addr) { state.textContent = 'Введите адрес'; return; }
  state.textContent = 'Ищем координаты…';
  try {
    const r = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: addr }),
    });
    const data = await r.json();
    if (data.ok) {
      document.getElementById('newLat').value = data.lat.toFixed(6);
      document.getElementById('newLng').value = data.lng.toFixed(6);
      state.textContent = '✓ ' + (data.displayName || 'координаты определены');
    } else {
      state.textContent = 'Не найдено — укажите координаты вручную';
    }
  } catch {
    state.textContent = 'Ошибка запроса — укажите координаты вручную';
  }
});
</script>`,
  });
}

function newTaskDialog(objects) {
  const opts = objects
    .map((o) => `<option value="${o.id}">${esc(o.title)} — ${esc(o.address)}</option>`)
    .join('');
  const today = new Date().toISOString().slice(0, 10);
  const week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return `
<dialog id="newTaskDialog" class="card dlg">
  <form method="post" action="/api/tasks" id="newTaskForm">
    <h2>Назначить осмотр</h2>
    <p class="muted small">Исполнитель получит SMS со ссылкой на осмотр и пароль для входа.</p>
    <label>Объект
      <select name="objectId" id="objectSelect" required>
        ${opts}
        <option value="__new">— Новый объект…</option>
      </select>
    </label>

    <fieldset class="newobj" id="newObjFields" hidden>
      <legend>Новый объект</legend>
      <label>Название<input name="newTitle" placeholder="Например: Погрузчик Manitou MLT 625"></label>
      <label>Адрес<input name="newAddress" id="newAddress" placeholder="Челябинск, пр-кт Победы, 147а"></label>
      <div class="row">
        <label class="col">Широта<input name="newLat" id="newLat" inputmode="decimal" placeholder="55.183872"></label>
        <label class="col">Долгота<input name="newLng" id="newLng" inputmode="decimal" placeholder="61.408741"></label>
      </div>
      <div class="row">
        <button type="button" class="btn small ghost" id="geoLookup">Определить по адресу</button>
        <span class="muted small" id="geoLookupState"></span>
      </div>
    </fieldset>

    <label>Название осмотра<input name="title" value="Плановый осмотр" required></label>
    <label>Цель осмотра<input name="purpose" placeholder="Например: проверка предмета лизинга"></label>
    <label>Телефон исполнителя
      <input name="executorPhone" inputmode="tel" placeholder="+7 951 447-68-15" required>
    </label>
    <label>Срок<input name="deadline" type="date" value="${week}" min="${today}" required></label>
    <div class="dlg-actions">
      <button type="button" class="btn ghost" onclick="this.closest('dialog').close()">Отмена</button>
      <button class="btn primary" type="submit">Назначить</button>
    </div>
  </form>
</dialog>`;
}

function taskPage({ task, object, user, flashMsg, error, canToken, smsInfo, unread = 0 }) {
  const insp = task.inspection;
  const fixed = insp ? insp.steps || {} : {};
  const pr = progress(task);
  const isClient = user.role === 'client';
  const canEdit = task.status === 'open' || task.status === 'rejected';
  const canRework = task.status === 'submitted' && !isClient;
  const reviewMode = isClient && task.status === 'submitted';
  const photoCount = task.steps.filter((s) => fixed[s.id] && fixed[s.id].photo).length;

  const rows = task.steps
    .map((s, i) => {
      const f = fixed[s.id];
      const icon = f ? (f.review === 'rejected' ? '✕' : f.review === 'accepted' ? '✓' : String(i + 1)) : String(i + 1);
      const cls = f ? (f.review === 'rejected' ? 'done rejected' : 'done') : '';
      let action = '';
      if (!reviewMode && !isClient) {
        if (!f) {
          if (canEdit) {
            action = `<a class="btn small" href="/tasks/${task.id}/inspect/${s.id}">${s.type === 'text' ? 'Заполнить' : 'Снять'}</a>`;
          }
        } else if (f.review === 'accepted') {
          action = '<span class="step-ok">принято</span>';
        } else if (canEdit || (canRework && f.review === 'rejected')) {
          action = `<a class="btn small ghost" href="/tasks/${task.id}/inspect/${s.id}">${s.type === 'text' ? 'Изменить' : 'Переснять'}</a>`;
        } else {
          action = '<span class="step-ok">готово</span>';
        }
      } else if (f) {
        action = '<span class="step-ok">готово</span>';
      }
      return `
      <li class="step ${cls}">
        <span class="step-mark">${icon}</span>
        <div class="step-body">
          <b>${esc(s.title)}${s.required ? '' : ' <span class="opt">необязательно</span>'}</b>
          <p>${esc(s.instruction)}</p>
          ${s.hint ? `<p class="hint">${esc(s.hint)}</p>` : ''}
          ${f && f.photo ? `<a class="thumb" href="${esc(f.photo)}" target="_blank"><img src="${esc(f.photo)}" alt=""></a>` : ''}
          ${f ? photoState(f) : ''}
          ${f && f.text ? `<div class="answer">${esc(f.text)}</div>` : ''}
          ${f ? `<div class="fixmeta">${esc(new Date(f.at).toLocaleString('ru-RU'))}${f.accuracy != null ? ` · ±${Math.round(f.accuracy)} м · ${Math.round(f.distance)} м от объекта` : ''}</div>` : ''}
          ${f && f.reviewComment ? `<div class="reviewnote">Заказчик: ${esc(f.reviewComment)}</div>` : ''}
          ${reviewMode && f && f.photo ? clientPhotoActions(task, s, f) : ''}
        </div>
        ${action}
      </li>`;
    })
    .join('');

  const mapUrl = `https://yandex.ru/maps/?pt=${object.lng},${object.lat}&z=17&l=map`;
  const osm = `https://www.openstreetmap.org/?mlat=${object.lat}&mlon=${object.lng}#map=17/${object.lat}/${object.lng}`;
  const rejected = task.steps.filter((s) => fixed[s.id] && fixed[s.id].review === 'rejected');

  return layout({
    title: task.number + ' · ' + BRAND.product,
    user,
    active: 'tasks',
    unread,
    body: `
<a class="back" href="/app">← Все задания</a>
<div class="pagehead">
  <div>
    <div class="task-num">${esc(task.number)}</div>
    <h1>${esc(task.title)}</h1>
    <p class="muted">${esc(task.purpose || '')}</p>
  </div>
  ${statusPill(task.status)}
</div>
${flash(flashMsg)}
${error ? `<div class="flash err">${esc(error)}</div>` : ''}
${smsInfo ? `<div class="flash ${smsInfo.status === 'failed' ? 'err' : smsInfo.status === 'sent' ? 'ok' : ''}">SMS исполнителю ${esc(smsInfo.toPretty)}: ${
  smsInfo.status === 'sent'
    ? `доставлена${smsInfo.receiptId ? ' (квитанция ' + esc(smsInfo.receiptId) + ')' : ''}${smsInfo.provider ? ' через ' + esc(smsInfo.provider) : ''}`
    : smsInfo.status === 'failed'
      ? `не отправлена — ${esc(smsInfo.error || 'ошибка шлюза')}`
      : 'отправляется'
}. <a href="/outbox">Исходящие</a></div>` : ''}
${task.status === 'rejected' && rejected.length ? `<div class="flash err">Отклонено фотографий: <b>${rejected.length}</b>. Переснимите отмеченные шаги и отправьте отчёт снова.</div>` : ''}
${task.status === 'submitted' && rejected.length ? `<div class="flash err">Заказчик отклонил фотографий: <b>${rejected.length}</b>. Переснимите отмеченные шаги — остальные фото менять не нужно.</div>` : ''}

<div class="cols">
  <section class="card">
    <h2>Объект осмотра</h2>
    <div class="kv"><span>Название</span><b>${esc(object.title || '—')}</b></div>
    <div class="kv"><span>Адрес</span><b>${esc(object.address)}</b></div>
    ${Number(object.area) > 0 ? `<div class="kv"><span>Площадь</span><b>${esc(object.area)} м²</b></div>` : ''}
    <div class="kv"><span>Координаты</span><b>${object.lat.toFixed(6)}, ${object.lng.toFixed(6)}</b></div>
    <div class="kv"><span>Радиус допуска</span><b>${object.radius} м</b></div>
    <div class="mapbox">
      <div class="mapdot"></div>
      <div>
        <b>Точка объекта</b>
        <div class="muted small">Съёмка разрешена только внутри радиуса ${object.radius} м.</div>
      </div>
    </div>
    <div class="row">
      <a class="btn small ghost" target="_blank" href="${osm}">OpenStreetMap</a>
      <a class="btn small ghost" target="_blank" href="${mapUrl}">Яндекс.Карты</a>
    </div>
  </section>

  <section class="card">
    <h2>Реквизиты задания</h2>
    <div class="kv"><span>Заказчик</span><b>${esc(task.customerName || BRAND.legal)}</b></div>
    <div class="kv"><span>Исполнитель</span><b>${esc(task.executorName || '—')}</b></div>
    <div class="kv"><span>Телефон</span><b>${esc(task.executorPhonePretty || '—')}</b></div>
    <div class="kv"><span>Срок</span><b>${esc(new Date(task.deadline).toLocaleString('ru-RU'))}</b></div>
    <div class="kv"><span>Выдано</span><b>${esc(new Date(task.createdAt).toLocaleString('ru-RU'))}</b></div>
    <div class="kv"><span>Шагов</span><b>${pr.done} / ${pr.total}</b></div>
    ${insp && insp.submittedAt ? `<div class="kv"><span>Отправлено</span><b>${esc(new Date(insp.submittedAt).toLocaleString('ru-RU'))}</b></div>` : ''}
    ${canToken ? `<div class="hintbox">Ссылка для исполнителя: <a href="/s/${esc(task.token)}">/s/${esc(task.token)}</a></div>` : ''}
    ${isClient && photoCount ? `<div class="row">
      <a class="btn small" href="/tasks/${task.id}/download">Скачать фото на ПК (ZIP)</a>
      <span class="muted small">${photoCount} файл(ов) + README с координатами</span>
    </div>` : ''}
  </section>
</div>

<section class="card">
  <div class="sec-head">
    <h2>${isClient ? 'Фотографии и ответы' : 'Алгоритм осмотра'}</h2>
    <span class="muted small">${pr.done} из ${pr.total}${pr.accepted ? ` · принято ${pr.accepted}` : ''}${pr.rejected ? ` · отклонено ${pr.rejected}` : ''}</span>
  </div>
  <ol class="steps">${rows}</ol>
  ${canEdit && !isClient
      ? `<form method="post" action="/api/tasks/${task.id}/submit" class="submit-row">
          <button class="btn primary" ${pr.done < pr.total ? 'disabled' : ''}>Отправить на проверку</button>
          ${pr.done < pr.total ? '<span class="muted small">Заполните все шаги, чтобы отправить отчёт.</span>' : ''}
        </form>`
      : ''}
  ${reviewMode ? reviewBox(task) : ''}
  ${task.inspection && task.inspection.review ? `
    <div class="review ${task.status === 'accepted' ? 'ok' : 'bad'}">
      <b>Решение заказчика:</b> ${task.status === 'accepted' ? 'принято' : 'отклонено'}
      ${task.inspection.review.comment ? `<div>${esc(task.inspection.review.comment)}</div>` : ''}
      <div class="muted small">${esc(new Date(task.inspection.review.at).toLocaleString('ru-RU'))}</div>
    </div>` : ''}
</section>`,
  });
}

function clientPhotoActions(task, step, f) {
  return `
  <form method="post" action="/tasks/${task.id}/photo/${step.id}" class="photoacts">
    <input name="comment" placeholder="Комментарий (для отклонения)">
    <button class="btn small primary" name="decision" value="accept">Принять фото</button>
    <button class="btn small danger" name="decision" value="reject">Отклонить</button>
  </form>`;
}

function reviewBox(task) {
  return `
<form method="post" action="/api/tasks/${task.id}/review" class="reviewbox">
  <h3>Решение по осмотру</h3>
  <p class="muted small">Сначала примите или отклоните отдельные фотографии выше.</p>
  <label>Комментарий<textarea name="comment" rows="2" placeholder="Что не так или что подтверждаете"></textarea></label>
  <div class="row">
    <button class="btn primary" name="decision" value="accept">Принять осмотр</button>
    <button class="btn danger" name="decision" value="reject">Отклонить осмотр</button>
  </div>
</form>`;
}

function notificationsPage({ user, items, markAllHref }) {
  const list = items.length
    ? items.map((n) => `
      <article class="card notif ${n.read ? '' : 'unread'}">
        <div class="notif-head">
          <b>${esc(n.title)}</b>
          <span class="muted small">${esc(new Date(n.at).toLocaleString('ru-RU'))}</span>
        </div>
        <p>${esc(n.text)}</p>
        ${n.taskId ? `<a class="btn small ghost" href="/tasks/${n.taskId}">Открыть задание</a>` : ''}
      </article>`).join('')
    : '<div class="card empty">Уведомлений пока нет.</div>';

  return layout({
    title: 'Уведомления · ' + BRAND.product,
    user,
    active: 'notifications',
    body: `
<div class="pagehead">
  <div>
    <h1>Уведомления</h1>
    <p class="muted">Результаты проверки осмотров и отклонённые фотографии.</p>
  </div>
  ${items.some((n) => !n.read) ? '<form method="post" action="/notifications/read"><button class="btn ghost">Отметить все прочитанными</button></form>' : ''}
</div>
${list}`,
  });
}

function outboxPage({ user, messages, provider }) {
  const statusMeta = (m) => {
    if (m.status === 'sent') return ['ok', 'доставлено'];
    if (m.status === 'failed') return ['bad', 'ошибка'];
    if (m.status === 'sending') return ['wait', 'отправляется'];
    return ['wait', m.status || 'в очереди'];
  };
  const rows = messages.length
    ? messages.slice().reverse().map((m) => {
      const [cls, label] = statusMeta(m);
      return `
      <article class="card sms">
        <div class="notif-head">
          <b>${esc(m.toPretty)}</b>
          <span class="pill ${cls}">${esc(label)}</span>
        </div>
        <pre class="smsbody">${esc(m.text)}</pre>
        <div class="muted small">${esc(new Date(m.at).toLocaleString('ru-RU'))}${m.taskId ? ` · задание #${m.taskId}` : ''}${
          m.provider ? ` · шлюз: ${esc(m.provider)}` : ''
        }${m.receiptId ? ` · квитанция ${esc(m.receiptId)}` : ''}${
          m.error ? ` · <b>${esc(m.error)}</b>` : ''
        }</div>
      </article>`;
    }).join('')
    : '<div class="card empty">Сообщений пока нет.</div>';

  return layout({
    title: 'Исходящие SMS · ' + BRAND.product,
    user,
    body: `
<a class="back" href="/app">← Все задания</a>
<div class="pagehead">
  <div>
    <h1>Исходящие SMS</h1>
    <p class="muted">Шлюз: <b>${esc(provider.label || provider.provider)}</b>${
      provider.mode === 'console' ? ' — текст печатается в журнал сервера.' :
      provider.mode === 'local' ? ' — сообщения принимаются встроенным HTTP-эндпоинтом и получают квитанцию.' :
      provider.url ? ` (${esc(provider.url)})` : ''
    }</p>
  </div>
</div>
${provider.configured === false ? `<div class="flash err">Провайдер не настроен: ${esc(provider.reason || 'не хватает ключей')}. SMS не уйдут получателям — заполните переменные окружения и перезапустите сервер.</div>` : ''}
${provider.mode === 'local' ? '<div class="flash">Внимание: режим <b>local</b> — сообщения не покидают сервер. Для реальной отправки укажите <code>SMS_PROVIDER=smsru</code> или <code>SMS_PROVIDER=smsc</code>.</div>' : ''}
${rows}`,
  });
}

module.exports = { layout, esc, flash, loginPage, dashPage, taskPage, statusPill, notificationsPage, outboxPage, progress };
