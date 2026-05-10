(() => {
  if (window.__netflixLoopBridge) return;
  window.__netflixLoopBridge = true;

  function getPlayer() {
    try {
      const api = window.netflix?.appContext?.state?.playerApp?.getAPI?.();
      if (!api || !api.videoPlayer) return null;
      const sessionIds = api.videoPlayer.getAllPlayerSessionIds() || [];
      const sessionId = sessionIds.find((id) => String(id).startsWith('watch-')) || sessionIds[0];
      if (!sessionId) return null;
      return api.videoPlayer.getVideoPlayerBySessionId(sessionId);
    } catch (e) {
      return null;
    }
  }

  window.addEventListener('netflix-loop:seek', (e) => {
    const player = getPlayer();
    if (!player) {
      console.warn('[NetflixLoop] player not ready for seek');
      return;
    }
    try {
      player.seek(e.detail.timeMs);
    } catch (err) {
      console.error('[NetflixLoop] seek failed', err);
    }
  });

  window.addEventListener('netflix-loop:pause', () => {
    const player = getPlayer();
    if (player) {
      try { player.pause(); } catch (err) { /* ignore */ }
    }
  });

  window.addEventListener('netflix-loop:play', () => {
    const player = getPlayer();
    if (player) {
      try { player.play(); } catch (err) { /* ignore */ }
    }
  });
})();
