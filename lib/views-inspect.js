'use strict';

const { layout, esc, statusPill } = require('./views');
const { BRAND } = require('./brand');

function inspectPage({ task, object, step, user, publicMode = false, error = '', desktop = false }) {
  const idx = task.steps.findIndex((s) => s.id === step.id);
  const next = task.steps[idx + 1];
  const backHref = publicMode ? `/s/${task.token}` : `/tasks/${task.id}`;
  const prevFix = task.inspection && task.inspection.steps ? task.inspection.steps[step.id] : null;
  const rejected = prevFix && prevFix.review === 'rejected';

  if (desktop) return desktopGate({ task, step, user, backHref, publicMode });

  return layout({
    title: step.title + ' · ' + task.number,
    user,
    active: 'tasks',
    bodyClass: 'inspect',
    body: `
<a class="back" href="${backHref}">← К заданию</a>

<div class="pagehead compact">
  <div>
    <div class="task-num">Шаг ${idx + 1} из ${task.steps.length} · ${esc(task.number)}</div>
    <h1>${esc(step.title)}</h1>
  </div>
  ${statusPill(task.status)}
</div>

${rejected ? `<div class="flash err"><b>Фотография отклонена заказчиком.</b>${
    prevFix.reviewComment ? ' ' + esc(prevFix.reviewComment) : ''
  } Снимите кадр заново.</div>` : ''}
<p class="instruction">${esc(step.instruction)}</p>
${step.hint ? `<p class="hint">${esc(step.hint)}</p>` : ''}
${error ? `<div class="flash err">${esc(error)}</div>` : ''}

<div class="cols inspect-cols" id="inspectArea">
  <section class="card camera-card">
    ${step.type === 'text' ? textForm(task, step, publicMode) : cameraForm(task, step, publicMode)}
  </section>

  <aside class="card geo-card">
    <h2>Геоконтроль</h2>
    <div class="geo-status" id="geostatus">
      <span class="spinner"></span> Определяем местоположение…
    </div>
    <div class="geofacts">
      <div class="kv"><span>Объект</span><b>${esc(object.address)}</b></div>
      <div class="kv"><span>Координаты</span><b>${object.lat.toFixed(6)}, ${object.lng.toFixed(6)}</b></div>
      <div class="kv"><span>Допустимый радиус</span><b>${object.radius} м</b></div>
      <div class="kv"><span>Ваши координаты</span><b id="mycoords">—</b></div>
      <div class="kv"><span>Расстояние до объекта</span><b id="mydist">—</b></div>
      <div class="kv"><span>Точность GPS</span><b id="myacc">—</b></div>
    </div>
    <button class="btn ghost block" type="button" id="refreshGeo">Обновить геопозицию</button>
    <p class="muted small">${step.type === 'text'
      ? 'Для текстового ответа геопозиция фиксируется, если доступна.'
      : 'Кадр засчитывается только при съёмке внутри радиуса и при точности GPS не хуже допустимой. Координаты проверяются на сервере повторно.'}</p>
    ${step.type !== 'text' ? `<div class="hintbox">Съёмка и загрузка доступны только на телефоне и только внутри зоны объекта. С компьютера загрузить готовый файл нельзя, а без подтверждённой геопозиции кнопки съёмки заблокированы.</div>` : ''}
  </aside>
</div>

${next ? `<div class="nextrow"><a class="btn ghost" href="${publicMode ? `/s/${task.token}/step/${next.id}` : `/tasks/${task.id}/inspect/${next.id}`}">Следующий шаг: ${esc(next.title)} →</a></div>` : ''}

<script>
window.__STEP__ = ${JSON.stringify({
    object: {
      lat: object.lat,
      lng: object.lng,
      radius: object.radius,
      maxAccuracy: Math.max(20, Math.min(60, object.radius * 0.6)),
    },
    geoRequired: step.type !== 'text',
    taskId: task.id,
    stepId: step.id,
    publicMode,
  })};
</script>
<script src="/assets/inspect.js"></script>`,
  });
}

function desktopGate({ task, step, user, backHref, publicMode }) {
  return layout({
    title: 'Нужен смартфон · ' + task.number,
    user: publicMode ? null : user,
    active: 'tasks',
    bodyClass: 'inspect',
    body: `
<a class="back" href="${backHref}">← К заданию</a>

<div class="pagehead compact">
  <div>
    <div class="task-num">${publicMode ? '' : esc(task.number) + ' · '}Шаг «${esc(step.title)}»</div>
    <h1>Съёмка доступна только со смартфона</h1>
  </div>
</div>

<section class="card phonegate">
  <div class="phonegate-icon">▤</div>
  <h2>Пожалуйста, воспользуйтесь смартфоном</h2>
  <p>Съёмка объекта выполняется камерой телефона с одновременной фиксацией геопозиции.
     С компьютера камеру и точное местоположение получить нельзя, поэтому этот шаг здесь недоступен.</p>
  <p class="muted small">Откройте эту же ссылку на смартфоне — камера и геоконтроль включатся автоматически.
     Если ссылка пришла в SMS, просто перейдите по ней с телефона.</p>
  <div class="row">
    <a class="btn primary" href="${backHref}">← Вернуться к заданию</a>
    <button class="btn" type="button" disabled>Открыть камеру</button>
    <button class="btn" type="button" disabled>Зафиксировать шаг</button>
  </div>
</section>`,
  });
}

function cameraForm(task, step, publicMode) {
  const action = publicMode
    ? `/s/${task.token}/step/${step.id}`
    : `/tasks/${task.id}/inspect/${step.id}`;
  return `
  <h2>Съёмка с камеры</h2>
  <p class="muted small">Кадр делается камерой прямо сейчас. Готовый файл подставить нельзя — это исключает подмену фотографии. Съёмка разблокируется только после подтверждения геопозиции на объекте.</p>

  <div class="preview" id="preview">
    <div class="preview-empty">
      <div class="camicon">◎</div>
      <p>Нажмите «Открыть камеру», чтобы сделать кадр</p>
    </div>
  </div>

  <input type="file" id="fileinput" accept="image/*" capture="environment" hidden>

  <form method="post" action="${action}" id="stepform">
    <input type="hidden" name="photoData" id="photoData">
    <input type="hidden" name="captureSource" id="captureSource">
    <input type="hidden" name="lat" id="lat">
    <input type="hidden" name="lng" id="lng">
    <input type="hidden" name="accuracy" id="accuracy">
    <input type="hidden" name="capturedAt" id="capturedAt">

    <div class="row">
      <button class="btn primary" type="button" id="opencam" disabled>Открыть камеру</button>
      <button class="btn primary" type="button" id="shoot" hidden>Сделать кадр</button>
      <button class="btn" type="submit" id="savebtn" disabled>Зафиксировать шаг</button>
    </div>
    <div class="flash err" id="err" hidden></div>
  </form>`;
}

function textForm(task, step, publicMode) {
  const action = publicMode
    ? `/s/${task.token}/step/${step.id}`
    : `/tasks/${task.id}/inspect/${step.id}`;
  return `
  <h2>Текстовый ответ</h2>
  <form method="post" action="${action}" id="stepform">
    <input type="hidden" name="lat" id="lat">
    <input type="hidden" name="lng" id="lng">
    <input type="hidden" name="accuracy" id="accuracy">
    <label>Комментарий<textarea name="text" rows="6" required placeholder="Опишите состояние объекта"></textarea></label>
    <div class="flash err" id="err" hidden></div>
    <div class="row">
      <button class="btn primary" type="submit" id="savebtn" disabled>Зафиксировать шаг</button>
    </div>
  </form>`;
}

function publicTaskPage({ task, object, stepsView, doneCount, total, error, hasRejected = false }) {
  const action = `/s/${task.token}/submit`;
  return layout({
    title: task.number + ' · Осмотр',
    body: `
<div class="publichead">
  <div class="task-num">${esc(task.number)}</div>
  <h1>${esc(task.title)}</h1>
  <p class="muted">${esc(object.address)}</p>
  ${statusPill(task.status)}
</div>
${error ? `<div class="flash err">${esc(error)}</div>` : ''}
<div class="card">
  <div class="sec-head">
    <h2>Алгоритм осмотра</h2>
    <span class="muted small">${doneCount} из ${total}</span>
  </div>
  <ol class="steps">${stepsView}</ol>
  ${task.status === 'open' || task.status === 'rejected'
      ? `<form method="post" action="${action}" class="submit-row">
          <button class="btn primary" ${doneCount < total ? 'disabled' : ''}>Отправить на проверку</button>
          ${doneCount < total ? '<span class="muted small">Заполните все шаги, чтобы отправить отчёт.</span>' : ''}
        </form>`
      : task.status === 'submitted' && hasRejected
        ? `<div class="flash err">Заказчик отклонил часть кадров. Переснимите отмеченные шаги — принятые фото остаются в силе.</div>`
      : task.status === 'submitted' ? '<div class="flash wait">Отчёт отправлен заказчику и ожидает проверки.</div>'
      : task.status === 'accepted' ? '<div class="flash ok">Осмотр принят заказчиком.</div>'
      : ''}
</div>
<p class="muted small">Съёмка ведётся камерой устройства. Геопозиция фиксируется вместе с кадром
и проверяется на сервере по координатам объекта.</p>`,
  });
}

module.exports = { inspectPage, publicTaskPage };
