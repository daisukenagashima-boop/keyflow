(function () {
  'use strict';

  // ── Token ──────────────────────────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  let token = params.get('t');
  if (token) {
    try { localStorage.setItem('numpad_token', token); } catch {}
  } else {
    try { token = localStorage.getItem('numpad_token') || ''; } catch {}
  }

  const statusEl = document.getElementById('status');
  const setStatus = (text, kind) => {
    statusEl.textContent = text;
    statusEl.classList.remove('ok', 'bad');
    if (kind) statusEl.classList.add(kind);
  };

  if (!token) {
    setStatus('no token — Mac のターミナルに表示された URL を開いてください', 'bad');
    return;
  }

  // ── Socket ─────────────────────────────────────────────────────────────
  const socket = io({
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });

  socket.on('connect',       () => setStatus('● connected', 'ok'));
  socket.on('disconnect', (r) => setStatus('○ ' + r, 'bad'));
  socket.on('connect_error', (e) => setStatus('× ' + e.message, 'bad'));

  function send(type, value) {
    if (!socket.connected) return;
    socket.emit('input', { type, value }, (ack) => {
      if (ack && !ack.ok) {
        setStatus('× ' + (ack.error || 'error'), 'bad');
        setTimeout(() => {
          if (socket.connected) setStatus('● connected', 'ok');
        }, 3000);
      }
    });
  }

  // ── Haptic + audio feedback ────────────────────────────────────────────
  // Category → [vibrateMs, audioFreq, audioPeak, audioDur]
  // vibrate: Android Chrome; audio click: iOS Safari + all fallbacks
  const HAPTIC = {
    number: { vibe: 5,             freq: 1300, peak: 0.030, dur: 0.022 },
    symbol: { vibe: 8,             freq: 1000, peak: 0.050, dur: 0.032 },
    op:     { vibe: 12,            freq:  800, peak: 0.065, dur: 0.038 },
    enter:  { vibe: 20,            freq:  580, peak: 0.085, dur: 0.048 },
    cursor: { vibe: [8, 50, 8],    freq: 1600, peak: 0.018, dur: 0.016 },
  };

  let audioCtx = null;
  function haptic(cat) {
    const cfg = HAPTIC[cat] || HAPTIC.number;
    try { navigator.vibrate?.(cfg.vibe); } catch {}
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = cfg.freq;
      g.gain.value = 0.0001;
      o.connect(g).connect(audioCtx.destination);
      g.gain.exponentialRampToValueAtTime(cfg.peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.dur);
      o.start(t);
      o.stop(t + cfg.dur + 0.01);
    } catch {}
  }

  function hapticCat(btn) {
    if (!btn) return 'number';
    if (btn.classList.contains('enter')) return 'enter';
    if (btn.classList.contains('act'))   return 'op';
    if (btn.classList.contains('op'))    return 'symbol';
    return 'number';
  }

  // ── Interaction state ──────────────────────────────────────────────────
  const LONG_PRESS_MS  = 300;   // ms before cursor mode activates
  const CLEAR_PRESS_MS = 600;   // ms hold on ⌫ to trigger clear-all
  const STEP_SLOW      = 44;    // px per key at start (slow)
  const STEP_FAST      = 11;    // px per key at full speed
  const ACCEL_MS       = 1800;  // ms to reach full speed (ease-in)
  const CANCEL_DIST_PX = 10;    // px of movement that cancels long-press

  let pressTimer      = null;
  let cursorMode      = false;
  let cursorStartTime = 0;
  let pressedBtn      = null;
  let startX = 0, startY = 0;
  let lastX  = 0, lastY  = 0;
  let accX   = 0, accY   = 0;
  let didMove   = false;
  let clearFired = false;

  // Ease-in: starts slow, accelerates to full speed over ACCEL_MS.
  function cursorStep() {
    const t = Math.min((Date.now() - cursorStartTime) / ACCEL_MS, 1);
    return STEP_SLOW + (STEP_FAST - STEP_SLOW) * (t * t);
  }

  function enterCursorMode() {
    cursorMode = true;
    cursorStartTime = Date.now();
    accX = accY = 0;
    document.body.classList.add('cursor-mode');
    if (pressedBtn) pressedBtn.classList.remove('active');
    haptic('cursor');
  }

  function exitCursorMode() {
    cursorMode = false;
    document.body.classList.remove('cursor-mode');
  }

  // Use capture so we intercept before any other handlers.
  document.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    didMove    = false;
    clearFired = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    accX = accY = 0;

    pressedBtn = e.target.closest('.btn');
    if (pressedBtn) pressedBtn.classList.add('active');

    clearTimeout(pressTimer);

    const isBackspace = pressedBtn?.dataset.value === 'backspace';
    if (isBackspace) {
      // ⌫ 長押し → 全削除（カーソルモードには入らない）
      pressedBtn.classList.add('hold-del');
      pressTimer = setTimeout(() => {
        clearFired = true;
        if (pressedBtn) {
          pressedBtn.classList.remove('hold-del');
          pressedBtn.classList.add('clearing');
          setTimeout(() => pressedBtn?.classList.remove('clearing'), 350);
        }
        haptic('enter');
        send('clear', null);
      }, CLEAR_PRESS_MS);
    } else {
      pressTimer = setTimeout(enterCursorMode, LONG_PRESS_MS);
    }
  }, true);

  document.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (cursorMode) {
      const step = cursorStep();
      accX += dx;
      accY += dy;
      while (Math.abs(accX) >= step) {
        send('key', accX > 0 ? 'right' : 'left');
        accX += accX > 0 ? -step : step;
      }
      while (Math.abs(accY) >= step) {
        send('key', accY > 0 ? 'down' : 'up');
        accY += accY > 0 ? -step : step;
      }
      return;
    }

    // Cancel long-press if finger drifts too far before threshold.
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > CANCEL_DIST_PX) {
      clearTimeout(pressTimer);
      pressTimer = null;
      didMove = true;
      if (pressedBtn) {
        pressedBtn.classList.remove('active', 'hold-del');
        pressedBtn = null;
      }
    }
  }, true);

  document.addEventListener('pointerup', (e) => {
    clearTimeout(pressTimer);
    pressTimer = null;

    if (cursorMode) {
      exitCursorMode();
      if (pressedBtn) { pressedBtn.classList.remove('active'); pressedBtn = null; }
      return;
    }

    // Quick tap → fire the button（全削除が発火済みの場合はスキップ）.
    if (pressedBtn && !didMove && !clearFired) {
      send(pressedBtn.dataset.type, pressedBtn.dataset.value);
      haptic(hapticCat(pressedBtn));
    }
    if (pressedBtn) {
      pressedBtn.classList.remove('active', 'hold-del');
      pressedBtn = null;
    }
    didMove    = false;
    clearFired = false;
  }, true);

  document.addEventListener('pointercancel', () => {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (cursorMode) exitCursorMode();
    if (pressedBtn) {
      pressedBtn.classList.remove('active', 'hold-del');
      pressedBtn = null;
    }
    didMove    = false;
    clearFired = false;
  }, true);

  // Prevent iOS long-press context menu.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Service Worker (HTTPS / localhost only) ────────────────────────────
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
