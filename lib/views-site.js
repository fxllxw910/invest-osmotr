'use strict';

const { layout, esc } = require('./views');
const { BRAND, LOGO_MARK } = require('./brand');

const STEPS = [
  ['Заявка', 'Заказчик назначает осмотр: объект, срок и телефон исполнителя.'],
  ['SMS', 'Исполнитель получает ссылку на осмотр и пароль для входа.'],
  ['Съёмка', 'Камера и геолокация: система ведёт по шагам сценария.'],
  ['Проверка', 'Заказчик принимает или отклоняет каждую фотографию.'],
  ['Акт', 'Принятые материалы выгружаются одним архивом.'],
];

function homePage({ user }) {
  return layout({
    title: BRAND.product + ' — осмотры предметов лизинга',
    user,
    body: `
<section class="hero">
  <div class="hero-inner">
    <div class="hero-left">
      <div class="hero-badge">${esc(BRAND.legal)} · ОГРН ${esc(BRAND.ogrn)}</div>
      <h1>Осмотр предметов лизинга без выезда в офис</h1>
      <div class="hero-actions">
        <a class="btn primary" href="mailto:${BRAND.email}">Связаться</a>
      </div>
      <div class="hero-facts">
        <div><b>2</b><span>роли: заказчик и исполнитель</span></div>
        <div><b>1:1</b><span>проверка каждой фотографии</span></div>
        <div><b>0</b><span>установок приложения</span></div>
      </div>
    </div>
    <div class="hero-right">
      <div class="demo-phone">
        <div class="notch"></div>
        <div class="dp-head">
          <span class="dp-num">ИО-2026-000118</span>
          <span class="pill wait">На проверке</span>
        </div>
        <div class="dp-obj">Погрузчик · Челябинск, Победы 147а</div>
        <div class="dp-geo geo-ok">✓ Вы на объекте · 8 м</div>
        <div class="dp-step">
          <span class="dp-mark">1</span>
          <div><b>Общий вид</b><p>Сфотографируйте технику целиком</p></div>
        </div>
        <div class="dp-step ghoststep">
          <span class="dp-mark">2</span>
          <div><b>Заводская табличка</b><p>Серийный номер крупным планом</p></div>
        </div>
        <div class="dp-btn">Открыть камеру</div>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <h2>Как это работает</h2>
  <div class="steps4">
    ${STEPS.map(([t, d], i) => `<div class="s4"><span>${i + 1}</span><b>${esc(t)}</b><p>${esc(d)}</p></div>`).join('')}
  </div>
</section>

<section class="section">
  <h2>Контакты</h2>
  <p class="muted">${esc(BRAND.legal)}</p>
  <p class="muted">${esc(BRAND.address)}</p>
  <p class="muted small">ОГРН ${esc(BRAND.ogrn)} · ИНН ${esc(BRAND.inn)} · КПП ${esc(BRAND.kpp)}</p>
  <div class="contactrow">
    <a class="btn" href="mailto:${BRAND.email}">${esc(BRAND.email)}</a>
    <a class="btn" href="${BRAND.site}" target="_blank" rel="noopener">investl.ru</a>
  </div>
</section>`,
  });
}

module.exports = { homePage };
