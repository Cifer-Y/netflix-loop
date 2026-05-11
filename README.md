# Netflix Loop

A minimal Chrome extension that loops a specified time range on Netflix. Useful for language learning, music practice, dance reference, or rewatching that one scene.

## Features

- Floating panel on any Netflix watch page (top-right, dim until hovered)
- Set a start/end time, click **Loop** — the player jumps back to start whenever it reaches end
- **●** button next to each input grabs the current playback time (no typing)
- Time inputs accept any of: `1:23`, `1:23:45`, or raw seconds (`83`)
- Playback speed: 5 presets (`0.5 / 0.75 / 1× / 1.25 / 1.5`) plus a fine-adjust row — click `−`/`+` for ±0.05 steps, or type a custom value in the input (range `0.25`–`2.00`, e.g. `0.85`). Pitch preserved.
- Loop range and speed are remembered per video (keyed by Netflix video ID)
- Manually dragging the timeline outside the loop range turns the loop off (so you can scrub freely)
- Survives episode changes (re-binds to the new `<video>` element via `MutationObserver`)
- Works in fullscreen (panel re-parents itself into the fullscreen element)

## Install (load unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Open any Netflix video — the panel appears in the top-right corner

To update after editing source: hit the refresh icon on the extension card in `chrome://extensions`, then reload the Netflix tab.

## Usage

1. Play your video, scrub to the moment you want to loop from
2. Click **●** next to *Start* to mark the current time
3. Scrub to the end of the segment, click **●** next to *End*
4. Click **Loop OFF** to toggle it on
5. Click **⤴** to jump back to the start manually any time

Drag the timeline outside the marked range to disable the loop and watch normally.

## Files

| File | What it does |
|---|---|
| `manifest.json` | Manifest V3 declaration; injects scripts on all of `netflix.com` |
| `content.js` | Builds the panel, handles loop logic + persistence (isolated world) |
| `page.js` | Bridges to Netflix's `netflix.appContext` player API for seeks (MAIN world) |
| `content.css` | Panel styling (Netflix-themed dark) |

### Why two scripts

Setting `video.currentTime` directly trips Netflix's DRM compatibility check (error code **M7375**). The fix is to call Netflix's own player API (`netflix.appContext.state.playerApp.getAPI().videoPlayer.getVideoPlayerBySessionId(id).seek(ms)`), which lives on the page's real `window` and isn't reachable from the content script's isolated world. So `content.js` (isolated) dispatches `CustomEvent`s on `window`, and `page.js` (MAIN world, declared via `"world": "MAIN"`) listens and forwards them to the Netflix player.

## Notes

- Loop boundary precision is ~±0.25s because it's driven by `timeupdate` (~4Hz). Plenty for normal use; if you need frame-accurate looping you'd switch to `requestVideoFrameCallback`.
- No icon files are bundled — Chrome shows the default puzzle-piece icon. Add a `128x128` PNG and reference it in `manifest.json` if you want a custom one.
- Permissions: only `storage` (for saved ranges) and `host_permissions` for `netflix.com`. No analytics, no network calls.
