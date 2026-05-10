(() => {
  const STORAGE_KEY = 'netflixLoopRanges';
  const TOLERANCE = 0.5;

  let video = null;
  let panel = null;
  let loopState = { enabled: false, start: 0, end: 0 };
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
    }
    video = v;
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeking', onSeeking);
  }

  function onTimeUpdate() {
    if (!video) return;
    updateNowDisplay();
    if (!loopState.enabled) return;
    if (loopState.end <= loopState.start) return;
    if (video.currentTime >= loopState.end) {
      programmaticSeek = true;
      video.currentTime = loopState.start;
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
      programmaticSeek = true;
      video.currentTime = loopState.start;
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
  }

  function updateNowDisplay() {
    if (!panel || !video) return;
    const now = panel.querySelector('.nfl-now');
    if (!now) return;
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    now.textContent = `${formatTime(video.currentTime)} / ${formatTime(total)}`;
  }

  function applyLoadedRange(range) {
    loopState = { enabled: false, start: 0, end: 0, ...(range || {}) };
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

  async function onUrlChange() {
    const id = getVideoId();
    if (id === lastVideoId) return;
    lastVideoId = id;
    const range = await loadRange(id);
    applyLoadedRange(range);
  }

  function findAndAttach() {
    const v = document.querySelector('video');
    if (v) attachVideo(v);
  }

  function init() {
    ensurePanel();
    findAndAttach();
    onUrlChange();

    const observer = new MutationObserver(() => {
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
