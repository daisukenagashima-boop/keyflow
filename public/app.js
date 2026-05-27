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

  const verEl = document.getElementById('ver');

  // Mac のトラックパッド設定に合わせる
  const TP_SCALE_FACTOR = 1.8; // ポインタ速度チューニング値
  let MOVE_SCALE    = 2.2;     // デフォルト（取得できない場合のフォールバック）
  let SCROLL_DIR    = 1;       // 1=ナチュラル（指と同方向）, -1=従来（逆）

  socket.on('connect', () => {
    setStatus('● connected', 'ok');
    fetch('/healthz')
      .then(r => r.json())
      .then(d => {
        if (verEl && d.version) verEl.textContent = 'v' + d.version;
        if (d.trackpadScaling) MOVE_SCALE = d.trackpadScaling * TP_SCALE_FACTOR;
        if (typeof d.naturalScrolling === 'boolean') SCROLL_DIR = d.naturalScrolling ? 1 : -1;
      })
      .catch(() => {});
  });
  socket.on('disconnect', (r) => setStatus('○ ' + r, 'bad'));
  socket.on('connect_error', (e) => setStatus('× ' + e.message, 'bad'));

  // ── Send ───────────────────────────────────────────────────────────────
  function send(typeOrPayload, value) {
    if (!socket.connected) return;
    const payload = (typeof typeOrPayload === 'object' && typeOrPayload !== null)
      ? typeOrPayload : { type: typeOrPayload, value };
    // mouse move は volatile（詰まっても捨てる）
    if (payload.type === 'mouse' && payload.action === 'move') {
      socket.volatile.emit('input', payload);
      return;
    }
    socket.emit('input', payload, (ack) => {
      if (ack && !ack.ok) {
        setStatus('× ' + (ack.error || 'error'), 'bad');
        setTimeout(() => {
          if (socket.connected) setStatus('● connected', 'ok');
        }, 3000);
      }
    });
  }

  // ── Pages / Tabs ───────────────────────────────────────────────────────
  const pagesEl = document.getElementById('pages');

  function currentPage() {
    if (!pagesEl) return 0;
    return Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
  }

  document.querySelectorAll('.tab').forEach((tab, i) => {
    tab.addEventListener('click', () => {
      pagesEl.scrollTo({ left: i * pagesEl.clientWidth, behavior: 'smooth' });
    });
  });

  pagesEl.addEventListener('scroll', () => {
    const page = currentPage();
    document.querySelectorAll('.tab').forEach((tab, i) => {
      tab.classList.toggle('tab-active', i === page);
    });
  });

  // ── Haptic + audio feedback ────────────────────────────────────────────
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

  // ── Numpad interaction state ───────────────────────────────────────────
  const LONG_PRESS_MS  = 300;
  const CLEAR_PRESS_MS = 600;
  const STEP_SLOW      = 44;
  const STEP_FAST      = 11;
  const ACCEL_MS       = 1800;
  const CANCEL_DIST_PX = 10;

  let pressTimer      = null;
  let cursorMode      = false;
  let cursorStartTime = 0;
  let pressedBtn      = null;
  let startX = 0, startY = 0;
  let lastX  = 0, lastY  = 0;
  let accX   = 0, accY   = 0;
  let didMove   = false;
  let clearFired = false;

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

  document.addEventListener('pointerdown', (e) => {
    if (currentPage() !== 0) return;
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
    if (currentPage() !== 0) return;
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

  function resetPressState() {
    clearTimeout(pressTimer);
    pressTimer = null;
    if (pressedBtn) {
      pressedBtn.classList.remove('active', 'hold-del');
      pressedBtn = null;
    }
    didMove    = false;
    clearFired = false;
  }

  document.addEventListener('pointerup', (e) => {
    if (currentPage() !== 0) { resetPressState(); return; }
    if (cursorMode) {
      exitCursorMode();
      if (pressedBtn) { pressedBtn.classList.remove('active'); pressedBtn = null; }
      clearTimeout(pressTimer);
      pressTimer = null;
      return;
    }

    if (pressedBtn && !didMove && !clearFired) {
      send(pressedBtn.dataset.type, pressedBtn.dataset.value);
      haptic(hapticCat(pressedBtn));
    }
    resetPressState();
  }, true);

  document.addEventListener('pointercancel', () => {
    if (cursorMode) exitCursorMode();
    resetPressState();
  }, true);

  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ── Trackpad ───────────────────────────────────────────────────────────
  const SCROLL_SCALE = 0.6;
  const DRAG_DELAY   = 280;  // ms 長押しでドラッグ開始
  const TAP_MAX_MS   = 260;  // ms 以内ならタップ判定

  const trackpadEl = document.getElementById('trackpad');
  if (trackpadEl) {
    let tpTouches   = {};
    let tpMaxFinger = 0;
    let tpStartTime = 0;
    let tpDragging  = false;
    let tpDragTimer = null;

    function tpFingerCount() { return Object.keys(tpTouches).length; }

    trackpadEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        tpTouches[t.identifier] = { x: t.clientX, y: t.clientY };
      }
      const n = tpFingerCount();
      if (n > tpMaxFinger) tpMaxFinger = n;
      if (n === 1 && tpMaxFinger === 1) {
        tpStartTime = Date.now();
        tpDragTimer = setTimeout(() => {
          tpDragging = true;
          send({ type: 'mouse', action: 'down' });
        }, DRAG_DELAY);
      }
    }, { passive: false });

    trackpadEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const fingers = e.touches.length;

      if (fingers === 1) {
        const t = e.touches[0];
        const prev = tpTouches[t.identifier];
        if (prev) {
          const dx = (t.clientX - prev.x) * MOVE_SCALE;
          const dy = (t.clientY - prev.y) * MOVE_SCALE;
          if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            send({ type: 'mouse', action: 'move', dx, dy });
            // 動いたらドラッグ開始タイマーをキャンセル（長押しのみドラッグ）
            if (!tpDragging) { clearTimeout(tpDragTimer); tpDragTimer = null; }
          }
        }
        tpTouches[t.identifier] = { x: t.clientX, y: t.clientY };

      } else if (fingers === 2) {
        let totalDx = 0, totalDy = 0;
        for (const t of e.touches) {
          const prev = tpTouches[t.identifier];
          if (prev) {
            totalDx += t.clientX - prev.x;
            totalDy += t.clientY - prev.y;
          }
          tpTouches[t.identifier] = { x: t.clientX, y: t.clientY };
        }
        send({ type: 'mouse', action: 'scroll', dx: (totalDx / 2) * SCROLL_SCALE * SCROLL_DIR, dy: (totalDy / 2) * SCROLL_SCALE * SCROLL_DIR });

      } else {
        for (const t of e.touches) {
          tpTouches[t.identifier] = { x: t.clientX, y: t.clientY };
        }
      }
    }, { passive: false });

    trackpadEl.addEventListener('touchend', (e) => {
      e.preventDefault();
      const elapsed = Date.now() - tpStartTime;

      if (tpDragging) {
        send({ type: 'mouse', action: 'up' });
        tpDragging = false;
      }
      clearTimeout(tpDragTimer);
      tpDragTimer = null;

      if (e.touches.length === 0) {
        if (elapsed < TAP_MAX_MS) {
          if (tpMaxFinger === 1) {
            // 左クリック + リップル
            send({ type: 'mouse', action: 'click' });
            const last = Object.values(tpTouches)[0];
            if (last) {
              const ripple = document.createElement('div');
              ripple.className = 'tp-ripple';
              ripple.style.left = (last.x - 22) + 'px';
              ripple.style.top  = (last.y - 22) + 'px';
              document.body.appendChild(ripple);
              setTimeout(() => ripple.remove(), 400);
            }
          } else if (tpMaxFinger === 2) {
            // 右クリック
            send({ type: 'mouse', action: 'rclick' });
          }
        }
        tpTouches   = {};
        tpMaxFinger = 0;
      } else {
        for (const t of e.changedTouches) delete tpTouches[t.identifier];
      }
    }, { passive: false });

    trackpadEl.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (tpDragging) {
        send({ type: 'mouse', action: 'up' });
        tpDragging = false;
      }
      clearTimeout(tpDragTimer);
      tpDragTimer = null;
      tpTouches   = {};
      tpMaxFinger = 0;
    }, { passive: false });
  }

  // ── Service Worker ─────────────────────────────────────────────────────
  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
})();
