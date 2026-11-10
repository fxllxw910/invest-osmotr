(function () {
  'use strict';

  const cfg = window.__STEP__;
  if (!cfg) return;

  const fileInput = document.getElementById('fileinput');
  const openCam = document.getElementById('opencam');
  const shootBtn = document.getElementById('shoot');
  const preview = document.getElementById('preview');
  const photoData = document.getElementById('photoData');
  const captureSource = document.getElementById('captureSource');
  const latEl = document.getElementById('lat');
  const lngEl = document.getElementById('lng');
  const accEl = document.getElementById('accuracy');
  const atEl = document.getElementById('capturedAt');
  const saveBtn = document.getElementById('savebtn');
  const errBox = document.getElementById('err');
  const geoStatus = document.getElementById('geostatus');
  const myCoords = document.getElementById('mycoords');
  const myDist = document.getElementById('mydist');
  const myAcc = document.getElementById('myacc');
  const refreshGeo = document.getElementById('refreshGeo');
  const isText = !fileInput;

  const ua = navigator.userAgent || '';
  const isMobile =
    /Android|iPhone|iPad|iPod|Windows Phone|IEMobile|Opera Mini|BlackBerry|Mobile|Tablet/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const canLiveCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  let position = null;
  let photoReady = false;
  let stream = null;
  let videoEl = null;

  updateSave();

  function distance(a, b) {
    const R = 6371008.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function setGeo(kind, html) {
    if (!geoStatus) return;
    geoStatus.className = 'geo-status ' + kind;
    geoStatus.innerHTML = html;
  }

  function renderGeo() {
    if (!position) {
      setGeo('', '<span class="spinner"></span> Определяем местоположение… съёмка откроется после подтверждения точки');
      updateSave();
      return;
    }
    const d = distance(cfg.object, position);
    if (myCoords) myCoords.textContent = position.lat.toFixed(6) + ', ' + position.lng.toFixed(6);
    if (myDist) myDist.textContent = Math.round(d) + ' м';
    if (myAcc) myAcc.textContent = '±' + Math.round(position.accuracy) + ' м';

    const inRadius = d <= cfg.object.radius;
    const accurate = position.accuracy <= cfg.object.maxAccuracy;

    if (inRadius && accurate) {
      setGeo('ok', '✓ Вы на объекте · ' + Math.round(d) + ' м до точки');
    } else if (!inRadius) {
      setGeo('bad', '✕ Вы вне зоны осмотра · ' + Math.round(d) + ' м (допустимо ' + cfg.object.radius + ' м). Съёмка заблокирована.');
    } else {
      setGeo('warn', '! Низкая точность GPS: ±' + Math.round(position.accuracy) + ' м (нужно ≤ ' + cfg.object.maxAccuracy + ' м). Съёмка заблокирована.');
    }
    updateSave();
  }

  function geoOk() {
    if (!cfg.geoRequired) return true;
    if (!position) return false;
    const d = distance(cfg.object, position);
    return d <= cfg.object.radius && position.accuracy <= cfg.object.maxAccuracy;
  }

  function updateSave() {
    if (saveBtn) saveBtn.disabled = !(isText ? geoOk() : photoReady && geoOk());
    if (!isText && openCam) openCam.disabled = !geoOk();
    if (!isText && shootBtn) shootBtn.disabled = !geoOk();
    if (latEl && position) {
      latEl.value = position.lat;
      lngEl.value = position.lng;
      accEl.value = position.accuracy;
    }
  }

  function locate(highAccuracy) {
    if (!navigator.geolocation) {
      setGeo('bad', '✕ Браузер не поддерживает геолокацию. Откройте ссылку в Chrome или Safari.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        renderGeo();
      },
      (err) => {
        const msg =
          err.code === 1
            ? 'Доступ к геолокации запрещён. Разрешите его в настройках браузера для этого сайта.'
            : err.code === 2
              ? 'Не удалось определить местоположение. Выйдите на открытое место и повторите.'
              : 'Истекло время ожидания GPS. Повторите попытку.';
        setGeo('bad', '✕ ' + msg);
        updateSave();
      },
      { enableHighAccuracy: highAccuracy, timeout: 25000, maximumAge: 0 }
    );
  }

  if (navigator.geolocation && navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'denied') {
          setGeo('bad', '✕ Доступ к геолокации запрещён. Разрешите его в настройках браузера для этого сайта.');
          updateSave();
          return;
        }
        locate(true);
      })
      .catch(() => locate(true));
  } else {
    locate(true);
  }

  let watchId = null;
  if (navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        renderGeo();
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
  }

  refreshGeo?.addEventListener('click', () => {
    myDist && (myDist.textContent = '—');
    locate(true);
  });

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) {
      videoEl.srcObject = null;
      videoEl = null;
    }
  }

  function acceptFrame(dataUrl) {
    photoData.value = dataUrl;
    photoReady = true;
    preview.classList.add('has-image');
    preview.innerHTML = '<img alt="Сделанный кадр" src="' + dataUrl + '">';
    atEl.value = new Date().toISOString();
    if (captureSource) captureSource.value = 'camera';
    stopStream();
    if (shootBtn) {
      shootBtn.hidden = true;
      shootBtn.disabled = false;
    }
    if (openCam) {
      openCam.hidden = false;
      openCam.textContent = 'Переснять';
    }
    updateSave();
    if (!position) locate(true);
  }

  function startCamera() {
    if (!geoOk()) {
      showErr('Сначала подтвердите местоположение на объекте — без геопозиции съёмка и загрузка недоступны.');
      return;
    }
    if (errBox) errBox.hidden = true;

    if (!canLiveCamera) {
      if (isMobile) {
        fileInput.click();
        return;
      }
      showErr('На компьютере загрузить готовый файл нельзя. Кадр снимается камерой устройства — откройте ссылку на телефоне.');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((s) => {
        stopStream();
        stream = s;
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.muted = true;
        videoEl.setAttribute('playsinline', '');
        videoEl.srcObject = s;
        preview.classList.remove('has-image');
        preview.innerHTML = '';
        preview.appendChild(videoEl);
        if (openCam) openCam.hidden = true;
        if (shootBtn) {
          shootBtn.hidden = false;
          shootBtn.disabled = !geoOk();
        }
      })
      .catch((err) => {
        const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        if (isMobile) {
          showErr(
            (denied ? 'Доступ к камере запрещён. Разрешите его в настройках браузера. ' : '') +
              'Открываем камеру устройства…'
          );
          fileInput.click();
          return;
        }
        showErr(
          denied
            ? 'Доступ к камере запрещён. Разрешите его в настройках браузера.'
            : 'Камера не найдена или недоступна. Загрузить готовый файл с компьютера нельзя — откройте ссылку на телефоне.'
        );
      });
  }

  function takeShot() {
    if (!geoOk()) {
      showErr('Съёмка возможна только на объекте. Подтвердите геопозицию.');
      return;
    }
    if (!videoEl || !videoEl.videoWidth) {
      showErr('Камера ещё запускается. Подождите секунду и повторите.');
      return;
    }
    const maxSide = 1600;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    const scale = Math.min(1, maxSide / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, w, h);
    acceptFrame(canvas.toDataURL('image/jpeg', 0.86));
  }

  if (openCam && fileInput) {
    openCam.addEventListener('click', startCamera);
    shootBtn?.addEventListener('click', takeShot);

    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      if (!isMobile) {
        fileInput.value = '';
        showErr('На компьютере загрузить готовый файл нельзя. Откройте ссылку на телефоне — камера откроется в браузере.');
        return;
      }
      if (!geoOk()) {
        fileInput.value = '';
        showErr('Съёмка возможна только на объекте. Подтвердите геопозицию.');
        return;
      }
      if (!/^image\//.test(file.type)) {
        fileInput.value = '';
        showErr('Это не изображение.');
        return;
      }
      if (errBox) errBox.hidden = true;

      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
        URL.revokeObjectURL(url);
        fileInput.value = '';
        acceptFrame(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        fileInput.value = '';
        showErr('Не удалось прочитать файл изображения.');
      };
      img.src = url;
    });
  }

  function showErr(msg) {
    if (!errBox) {
      alert(msg);
      return;
    }
    errBox.textContent = msg;
    errBox.hidden = false;
  }

  const form = document.getElementById('stepform');
  form?.addEventListener('submit', (e) => {
    if (!geoOk()) {
      e.preventDefault();
      showErr('Геопозиция не подтверждена. Съёмка и загрузка возможны только на объекте.');
      return;
    }
    if (!isText && !photoReady) {
      e.preventDefault();
      showErr('Сначала сделайте кадр.');
      return;
    }
    if (position) {
      latEl.value = position.lat;
      lngEl.value = position.lng;
      accEl.value = position.accuracy;
    }
    if (!isText) {
      atEl.value = atEl.value || new Date().toISOString();
      if (captureSource) captureSource.value = 'camera';
    }
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    stopStream();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Отправка…';
  });
})();
