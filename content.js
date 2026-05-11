(() => {
  const STORAGE_KEY = 'netflixLoopRanges';
  const TOLERANCE = 0.5;

  let video = null;
  let panel = null;
  let loopState = { enabled: false, start: 0, end: 0, rate: 1 };
  const RATE_PRESETS = [0.5, 0.75, 1, 1.25, 1.5];
  const RATE_MIN = 0.25;
  const RATE_MAX = 2.0;
  const RATE_STEP = 0.05;
  let programmaticSeek = false;
  let lastVideoId = null;

  // ---------- time helpers ----------

  function parseTime(str) {
    const trimmed = String(str ?? '').trim();
    if (!trimmed) return NaN;
    const parts = trimmed.split(':').map((s) => parseFloat(s));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return NaN;
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function getVideoId() {
    const m = location.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  }

  function isWatchPage() {
    return /\/watch\/\d+/.test(location.pathname);
  }

  function seekToSeconds(seconds) {
    programmaticSeek = true;
    window.dispatchEvent(new CustomEvent('netflix-loop:seek', {
      detail: { timeMs: Math.round(seconds * 1000) }
    }));
  }

  // ---------- storage ----------

  async function loadRange(videoId) {
    if (!videoId) return null;
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (data) => {
        const all = data[STORAGE_KEY] || {};
        resolve(all[videoId] || null);
      });
    });
  }

  async function saveRange(videoId, range) {
    if (!videoId) return;
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      const all = data[STORAGE_KEY] || {};
      all[videoId] = range;
      chrome.storage.local.set({ [STORAGE_KEY]: all });
    });
  }

  // ---------- video binding ----------

  function attachVideo(v) {
    if (video === v) return;
    if (video) {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('ratechange', onRateChange);
    }
    video = v;
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('ratechange', onRateChange);
    applyPlaybackRate();
  }

  function applyPlaybackRate() {
    if (!video) return;
    const target = loopState.rate || 1;
    if (Math.abs(video.playbackRate - target) > 0.001) {
      video.playbackRate = target;
    }
  }

  function onRateChange() {
    if (!video) return;
    const target = loopState.rate || 1;
    if (Math.abs(video.playbackRate - target) > 0.001) {
      video.playbackRate = target;
    }
  }

  function setRate(rate) {
    if (!Number.isFinite(rate)) return;
    const clamped = Math.max(RATE_MIN, Math.min(RATE_MAX, rate));
    loopState.rate = Math.round(clamped * 100) / 100;
    applyPlaybackRate();
    persist();
    refreshPanel();
  }

  function bumpRate(delta) {
    setRate((loopState.rate || 1) + delta);
  }

  function parseRate(str) {
    const trimmed = String(str ?? '').trim().replace(/[×x]\s*$/i, '');
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : NaN;
  }

  function formatRate(r) {
    return parseFloat((r || 1).toFixed(2)).toString();
  }

  function onTimeUpdate() {
    if (!video) return;
    updateNowDisplay();
    if (!loopState.enabled) return;
    if (loopState.end <= loopState.start) return;
    if (video.currentTime >= loopState.end) {
      seekToSeconds(loopState.start);
    }
  }

  function onSeeking() {
    if (programmaticSeek) {
      programmaticSeek = false;
      return;
    }
    if (!loopState.enabled || !video) return;
    const t = video.currentTime;
    if (t < loopState.start - TOLERANCE || t > loopState.end + TOLERANCE) {
      setLoopEnabled(false);
    }
  }

  // ---------- panel UI ----------

  function buildPanel() {
    const el = document.createElement('div');
    el.id = 'nfl-panel';
    el.innerHTML = `
      <div class="nfl-header">
        <span class="nfl-title">Loop</span>
        <button class="nfl-collapse" title="Collapse">_</button>
      </div>
      <div class="nfl-body">
        <div class="nfl-row">
          <label>Start</label>
          <input type="text" class="nfl-input" data-field="start" placeholder="mm:ss" spellcheck="false">
          <button class="nfl-mark" data-mark="start" title="Mark current time">●</button>
        </div>
        <div class="nfl-row">
          <label>End</label>
          <input type="text" class="nfl-input" data-field="end" placeholder="mm:ss" spellcheck="false">
          <button class="nfl-mark" data-mark="end" title="Mark current time">●</button>
        </div>
        <div class="nfl-row nfl-controls">
          <button class="nfl-toggle">Loop OFF</button>
          <button class="nfl-jump" title="Jump to start">⤴</button>
        </div>
        <div class="nfl-row nfl-rates">
          ${RATE_PRESETS.map((r) => `<button class="nfl-rate" data-rate="${r}" title="Playback speed ${r}x">${r === 1 ? '1×' : r}</button>`).join('')}
        </div>
        <div class="nfl-row nfl-fine">
          <button class="nfl-step" data-step="-1" title="Slower (−0.05)">−</button>
          <input type="text" class="nfl-rate-input" value="1" spellcheck="false" title="Custom speed (0.25–2.00)">
          <button class="nfl-step" data-step="1" title="Faster (+0.05)">+</button>
        </div>
        <div class="nfl-now">--:-- / --:--</div>
      </div>
    `;
    return el;
  }

  function ensurePanel() {
    if (panel && document.contains(panel)) return panel;
    panel = buildPanel();
    document.body.appendChild(panel);
    bindPanelEvents();
    return panel;
  }

  function bindPanelEvents() {
    const startInput = panel.querySelector('[data-field="start"]');
    const endInput = panel.querySelector('[data-field="end"]');
    const toggleBtn = panel.querySelector('.nfl-toggle');
    const collapseBtn = panel.querySelector('.nfl-collapse');
    const jumpBtn = panel.querySelector('.nfl-jump');

    panel.querySelectorAll('.nfl-mark').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!video) return;
        const field = btn.dataset.mark;
        const t = video.currentTime;
        const input = panel.querySelector(`[data-field="${field}"]`);
        input.value = formatTime(t);
        commitInputs();
      });
    });

    [startInput, endInput].forEach((inp) => {
      inp.addEventListener('change', commitInputs);
      inp.addEventListener('blur', commitInputs);
    });

    toggleBtn.addEventListener('click', () => setLoopEnabled(!loopState.enabled));

    collapseBtn.addEventListener('click', () => {
      panel.classList.toggle('nfl-collapsed');
    });

    jumpBtn.addEventListener('click', () => {
      if (!video || loopState.end <= loopState.start) return;
      seekToSeconds(loopState.start);
    });

    panel.querySelectorAll('.nfl-rate').forEach((btn) => {
      btn.addEventListener('click', () => setRate(parseFloat(btn.dataset.rate)));
    });

    panel.querySelectorAll('.nfl-step').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dir = parseFloat(btn.dataset.step);
        bumpRate(dir * RATE_STEP);
      });
    });

    const rateInput = panel.querySelector('.nfl-rate-input');
    const commitRate = () => {
      const v = parseRate(rateInput.value);
      if (Number.isFinite(v)) setRate(v);
      else refreshPanel();
    };
    rateInput.addEventListener('change', commitRate);
    rateInput.addEventListener('blur', commitRate);
    rateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); rateInput.blur(); }
    });
  }

  function commitInputs() {
    const startStr = panel.querySelector('[data-field="start"]').value;
    const endStr = panel.querySelector('[data-field="end"]').value;
    const start = parseTime(startStr);
    const end = parseTime(endStr);
    const validStart = Number.isFinite(start) ? start : 0;
    const validEnd = Number.isFinite(end) ? end : 0;
    loopState.start = validStart;
    loopState.end = validEnd;
    if (validEnd <= validStart && loopState.enabled) {
      setLoopEnabled(false);
    }
    persist();
    refreshPanel();
  }

  function setLoopEnabled(on) {
    loopState.enabled = !!on && loopState.end > loopState.start;
    persist();
    refreshPanel();
  }

  function persist() {
    const id = getVideoId();
    saveRange(id, { ...loopState });
  }

  function refreshPanel() {
    if (!panel) return;
    const toggleBtn = panel.querySelector('.nfl-toggle');
    toggleBtn.textContent = loopState.enabled ? 'Loop ON' : 'Loop OFF';
    toggleBtn.classList.toggle('nfl-on', loopState.enabled);
    panel.classList.toggle('nfl-active', loopState.enabled);
    const currentRate = loopState.rate || 1;
    panel.querySelectorAll('.nfl-rate').forEach((btn) => {
      const r = parseFloat(btn.dataset.rate);
      btn.classList.toggle('nfl-rate-on', Math.abs(r - currentRate) < 0.001);
    });
    const rateInput = panel.querySelector('.nfl-rate-input');
    if (rateInput && document.activeElement !== rateInput) {
      rateInput.value = formatRate(currentRate);
    }
  }

  function updateNowDisplay() {
    if (!panel || !video) return;
    const now = panel.querySelector('.nfl-now');
    if (!now) return;
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    now.textContent = `${formatTime(video.currentTime)} / ${formatTime(total)}`;
  }

  function applyLoadedRange(range) {
    loopState = { enabled: false, start: 0, end: 0, rate: 1, ...(range || {}) };
    applyPlaybackRate();
    if (!panel) return;
    panel.querySelector('[data-field="start"]').value = loopState.start ? formatTime(loopState.start) : '';
    panel.querySelector('[data-field="end"]').value = loopState.end ? formatTime(loopState.end) : '';
    refreshPanel();
  }

  // ---------- fullscreen reparenting ----------

  function onFullscreenChange() {
    if (!panel) return;
    const fsEl = document.fullscreenElement;
    const target = fsEl || document.body;
    if (panel.parentElement !== target) {
      target.appendChild(panel);
    }
  }

  // ---------- video discovery + SPA nav ----------

  function findAndAttach() {
    const v = document.querySelector('video');
    if (v) attachVideo(v);
  }

  function activate() {
    ensurePanel();
    findAndAttach();
  }

  function deactivate() {
    if (video) {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('ratechange', onRateChange);
      video = null;
    }
    if (panel && panel.parentElement) {
      panel.parentElement.removeChild(panel);
    }
    panel = null;
    loopState = { enabled: false, start: 0, end: 0, rate: 1 };
  }

  async function onUrlChange() {
    const id = getVideoId();
    if (id === lastVideoId) return;
    lastVideoId = id;
    if (!isWatchPage()) {
      deactivate();
      return;
    }
    activate();
    const range = await loadRange(id);
    applyLoadedRange(range);
  }

  function init() {
    onUrlChange();

    const observer = new MutationObserver(() => {
      if (!isWatchPage()) return;
      const v = document.querySelector('video');
      if (v && v !== video) attachVideo(v);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        onUrlChange();
      }
    }, 500);

    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
