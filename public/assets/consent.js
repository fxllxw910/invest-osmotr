(function () {
  var KEY = 'io_cookie_ok';
  var banner = document.getElementById('cookie-banner');
  if (banner) {
    var accepted = false;
    try { accepted = localStorage.getItem(KEY) === '1'; } catch (e) { accepted = false; }
    if (!accepted) banner.hidden = false;

    var check = document.getElementById('cookie-consent');
    var btn = document.getElementById('cookie-accept');

    function sync() {
      if (btn && check) btn.disabled = !check.checked;
    }
    if (check) {
      check.addEventListener('change', sync);
      sync();
    }
    if (btn) btn.addEventListener('click', function () {
      if (check && !check.checked) return;
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
      banner.hidden = true;
    });
  }

  function notify(text) {
    var el = document.createElement('div');
    el.className = 'copyhint';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4500);
  }

  function fallbackCopy(addr) {
    var area = document.createElement('textarea');
    area.value = addr;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  var links = document.querySelectorAll('a[href^="mailto:"]');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function () {
      var addr = String(this.getAttribute('href') || '').replace(/^mailto:/i, '').split('?')[0];
      if (!addr) return;
      var left = false;
      var onBlur = function () { left = true; };
      window.addEventListener('blur', onBlur);
      setTimeout(function () {
        window.removeEventListener('blur', onBlur);
        if (left || document.hidden) return;
        var done = false;
        try { done = fallbackCopy(addr); } catch (e) { done = false; }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(addr).catch(function () {});
          done = true;
        }
        notify(done ? 'Адрес скопирован: ' + addr : 'Наш адрес: ' + addr);
      }, 700);
    });
  }
})();
