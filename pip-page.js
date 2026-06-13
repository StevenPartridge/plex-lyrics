(() => {
  if (window.__plexLyricsPipPageLoaded) {
    return;
  }
  window.__plexLyricsPipPageLoaded = true;

  const BUTTON_ID = 'plex-lyrics-pip-button';
  const TOAST_ID = 'plex-lyrics-pip-toast';
  const LYRICS_BUTTON_SELECTORS = [
    '[data-testid="lyricsButton"]',
    'button[aria-label="Lyrics" i]',
    '[role="button"][aria-label="Lyrics" i]',
  ];
  const LYRICS_SCROLLER_SELECTOR = '[class*="AudioVideoLyrics-scroller"]';
  const LYRICS_LINE_SELECTOR = 'div[class*="AudioVideoLyrics-line-"]';
  const PIP_DEFAULT_WIDTH = 280;
  const PIP_DEFAULT_HEIGHT = 500;
  const PIP_SIZE_STORAGE_KEY = 'plexLyricsPipSize';
  const PIP_LEGACY_SIZE_STORAGE_KEY = 'plexLyricsCompanionPipSize';
  const PIP_MIN_WIDTH = 240;
  const PIP_MIN_HEIGHT = 320;
  const PIP_MAX_WIDTH = 2000;
  const PIP_MAX_HEIGHT = 2000;
  const LYRICS_AUTO_OPEN_COOLDOWN_MS = 1800;

  let pipWindow = null;
  let updateTimer = null;
  let pipSizeSaveTimer = null;
  let scrollAnimationFrame = null;
  let lastSignature = '';
  let lastLyricsOpenAttemptAt = 0;

  function hasClassPart(element, fragment) {
    return Boolean(element && Array.from(element.classList || []).some((className) => className.includes(fragment)));
  }

  function isLikelyPlexPage() {
    return location.hostname.endsWith('plex.tv')
      || /\bplex\b/i.test(document.title)
      || Boolean(document.querySelector('[data-testid="lyricsButton"], [data-testid="playerControls"]'));
  }

  function getLyricsSurfaceStatus() {
    if (!window.PlexLyricsStatus || typeof window.PlexLyricsStatus.findLyricsStatus !== 'function') {
      return null;
    }

    return window.PlexLyricsStatus.findLyricsStatus(document);
  }

  function supportsDocumentPip() {
    return Boolean(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function');
  }

  function clamp(number, min, max) {
    return Math.min(max, Math.max(min, number));
  }

  function normalizePipSize(size) {
    if (!size) {
      return null;
    }

    const width = Math.round(Number(size.width));
    const height = Math.round(Number(size.height));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }

    return {
      width: clamp(width, PIP_MIN_WIDTH, PIP_MAX_WIDTH),
      height: clamp(height, PIP_MIN_HEIGHT, PIP_MAX_HEIGHT),
    };
  }

  function readSavedPipSize() {
    try {
      const storedSize = window.localStorage.getItem(PIP_SIZE_STORAGE_KEY)
        || window.localStorage.getItem(PIP_LEGACY_SIZE_STORAGE_KEY);
      return normalizePipSize(JSON.parse(storedSize));
    } catch (error) {
      return null;
    }
  }

  function savePipSize(sourceWindow = pipWindow) {
    if (!sourceWindow) {
      return;
    }

    try {
      const size = normalizePipSize({
        width: sourceWindow.innerWidth,
        height: sourceWindow.innerHeight,
      });
      if (size) {
        window.localStorage.setItem(PIP_SIZE_STORAGE_KEY, JSON.stringify(size));
        window.localStorage.removeItem(PIP_LEGACY_SIZE_STORAGE_KEY);
      }
    } catch (error) {
      // UI preferences are nice-to-have; private browsing or teardown can block storage.
    }
  }

  function schedulePipSizeSave(delay = 350) {
    window.clearTimeout(pipSizeSaveTimer);
    pipSizeSaveTimer = window.setTimeout(() => savePipSize(), delay);
  }

  function getPipRequestOptions() {
    const size = readSavedPipSize() || {
      width: PIP_DEFAULT_WIDTH,
      height: PIP_DEFAULT_HEIGHT,
    };

    return {
      width: size.width,
      height: size.height,
      preferInitialWindowPlacement: false,
    };
  }

  function isMainLyricsButton(element) {
    if (!element) {
      return false;
    }

    const testId = element.getAttribute('data-testid') || '';
    const ariaLabel = (element.getAttribute('aria-label') || '').trim().toLowerCase();
    return testId === 'lyricsButton' || ariaLabel === 'lyrics';
  }

  function findLyricsButton() {
    for (const selector of LYRICS_BUTTON_SELECTORS) {
      const button = Array.from(document.querySelectorAll(selector)).find(isMainLyricsButton);
      if (button) {
        return button;
      }
    }
    return null;
  }

  function isLyricsVisible(button = findLyricsButton()) {
    if (!button) {
      return false;
    }

    return button.getAttribute('aria-pressed') === 'true'
      || button.getAttribute('aria-selected') === 'true'
      || button.getAttribute('data-selected') === 'true'
      || button.classList.contains('Link-isSelected-x0P_By')
      || button.closest('[aria-pressed="true"], [aria-selected="true"], [data-selected="true"]');
  }

  function dispatchMouseEvent(target, type, x, y) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
    }));
  }

  function clickButton(button) {
    const rect = button.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    dispatchMouseEvent(button, 'mouseover', x, y);
    dispatchMouseEvent(button, 'mousedown', x, y);
    dispatchMouseEvent(button, 'mouseup', x, y);
    dispatchMouseEvent(button, 'click', x, y);
  }

  function requestLyricsPanelVisible(options = {}) {
    const button = findLyricsButton();
    if (!isVisibleEnabledControl(button) || isLyricsVisible(button)) {
      return false;
    }

    const now = Date.now();
    if (!options.force && now - lastLyricsOpenAttemptAt < LYRICS_AUTO_OPEN_COOLDOWN_MS) {
      return false;
    }

    lastLyricsOpenAttemptAt = now;
    clickButton(button);
    return true;
  }

  function ensureLyricsVisibleForPip() {
    if (!isPipOpen()) {
      return;
    }

    if (requestLyricsPanelVisible()) {
      scheduleUpdate(650);
    }
  }

  const PLAYER_CONTROL_SELECTORS = {
    previous: [
      '[data-testid="previousButton"]',
      '[data-testid="skipPreviousButton"]',
      '[aria-label*="Previous" i]',
    ],
    next: [
      '[data-testid="nextButton"]',
      '[data-testid="skipNextButton"]',
      '[aria-label*="Next" i]',
    ],
    pause: [
      '[data-testid="pauseButton"]',
      '[aria-label*="Pause" i]',
    ],
    play: [
      '[data-testid="resumeButton"]',
      '[data-testid="playButton"]',
      '[aria-label*="Resume" i]',
      '[aria-label*="Play" i]',
    ],
  };

  function isVisibleEnabledControl(element) {
    if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getPlayerControlRoot() {
    return document.querySelector('[data-testid="playerControls"]') || document;
  }

  function findPlayerControl(type) {
    const selectors = PLAYER_CONTROL_SELECTORS[type] || [];
    const playerControlRoot = getPlayerControlRoot();
    const roots = playerControlRoot === document ? [document] : [playerControlRoot, document];

    for (const root of roots) {
      for (const selector of selectors) {
        const control = root.querySelector(selector);
        if (isVisibleEnabledControl(control)) {
          return control;
        }
      }
    }

    return null;
  }

  function isPlaybackPlaying() {
    const mediaElement = getPrimaryMediaElement();
    if (mediaElement) {
      return !mediaElement.paused && !mediaElement.ended;
    }

    return Boolean(findPlayerControl('pause'));
  }

  function getPrimaryMediaElement() {
    return Array.from(document.querySelectorAll('audio, video')).find((element) => {
      const duration = Number(element.duration);
      return Number.isFinite(duration) && duration > 0;
    }) || document.querySelector('audio, video');
  }

  function cleanTrackText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getMediaSessionMetadata() {
    const metadata = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!metadata) {
      return {};
    }

    return {
      title: cleanTrackText(metadata.title),
      artist: cleanTrackText(metadata.artist),
      album: cleanTrackText(metadata.album),
    };
  }

  function getNowPlayingSnapshot() {
    const mediaElement = getPrimaryMediaElement();
    const metadata = getMediaSessionMetadata();
    const duration = mediaElement && Number.isFinite(mediaElement.duration) ? mediaElement.duration : 0;
    const currentTime = mediaElement && Number.isFinite(mediaElement.currentTime) ? mediaElement.currentTime : 0;
    const progress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

    return {
      title: metadata.title || 'Plex Music',
      artist: metadata.artist || metadata.album || '',
      currentTime,
      duration,
      progress,
    };
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '0:00';
    }

    const wholeSeconds = Math.floor(seconds);
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  function clickPlayerControl(action) {
    const type = action === 'playPause'
      ? (isPlaybackPlaying() ? 'pause' : 'play')
      : action;
    const control = findPlayerControl(type);

    if (!control) {
      showToast('Playback control unavailable', 'Plex did not expose that player button in the page right now.');
      return;
    }

    clickButton(control);
    scheduleUpdate(120);
  }

  function findLyricsScroller() {
    const scrollers = Array.from(document.querySelectorAll(LYRICS_SCROLLER_SELECTOR))
      .filter((element) => element.querySelector(LYRICS_LINE_SELECTOR));

    return scrollers.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }) || scrollers[0] || null;
  }

  function isTimedLyricsActive() {
    const toggle = document.querySelector('[data-testid="toggleTimedLyrics"], button[aria-label*="Timed Lyrics" i]');
    if (!toggle) {
      return false;
    }

    return toggle.getAttribute('aria-pressed') === 'true'
      || toggle.getAttribute('aria-selected') === 'true'
      || hasClassPart(toggle, 'AudioVideoLyrics-isTimedLyricsActive');
  }

  function getLyricLineText(row) {
    const textElement = row.querySelector('span');
    if (textElement) {
      return textElement.textContent.trim();
    }

    const clone = row.cloneNode(true);
    clone.querySelectorAll('svg, button').forEach((element) => element.remove());
    return clone.textContent.trim();
  }

  function createSnapshot() {
    const scroller = findLyricsScroller();
    const rows = scroller ? Array.from(scroller.querySelectorAll(LYRICS_LINE_SELECTOR)) : [];
    const lines = rows.map((row) => {
      const text = getLyricLineText(row);
      return {
        text,
        active: hasClassPart(row, 'AudioVideoLyrics-isLineSelected'),
        empty: text.length === 0,
      };
    });
    const activeIndex = lines.findIndex((line) => line.active);
    const textLineCount = lines.filter((line) => !line.empty).length;
    const lyricsSurfaceStatus = textLineCount === 0 ? getLyricsSurfaceStatus() : null;
    const statusCopy = lyricsSurfaceStatus && window.PlexLyricsStatus.copyForStatus(lyricsSurfaceStatus.status);
    const emptyMode = lyricsSurfaceStatus
      ? (lyricsSurfaceStatus.status === 'lyrics-load-error' ? 'load-error' : 'no-lyrics')
      : 'empty';
    const mode = textLineCount === 0
      ? emptyMode
      : (isTimedLyricsActive() || activeIndex >= 0 ? 'timed' : 'plain');

    return {
      mode,
      lines,
      activeIndex,
      hasLyrics: textLineCount > 0,
      emptyState: lyricsSurfaceStatus ? lyricsSurfaceStatus.status : 'waiting',
      emptyText: statusCopy
        ? statusCopy.pipEmptyText
        : 'Open lyrics in Plex, then this window will mirror them here.',
      statusText: statusCopy ? statusCopy.pipStatus : 'Waiting for Plex lyrics',
    };
  }

  function hashText(text) {
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return hash >>> 0;
  }

  function getSnapshotSignature(snapshot) {
    return [
      snapshot.mode,
      snapshot.emptyState || '',
      snapshot.activeIndex,
      snapshot.lines.length,
      snapshot.lines.map((line) => `${line.active ? 1 : 0}:${line.empty ? 1 : 0}:${hashText(line.text)}`).join(','),
    ].join('|');
  }

  function showToast(title, detail = '') {
    let element = document.getElementById(TOAST_ID);
    if (!element) {
      element = document.createElement('div');
      element.id = TOAST_ID;
      element.setAttribute('role', 'status');
      element.setAttribute('aria-live', 'polite');
      (document.body || document.documentElement).appendChild(element);
    }

    element.replaceChildren();
    const titleElement = document.createElement('div');
    titleElement.textContent = title;
    titleElement.style.cssText = 'font-size:14px;font-weight:800;line-height:1.25;';
    const detailElement = document.createElement('div');
    detailElement.textContent = detail;
    detailElement.style.cssText = 'margin-top:3px;color:#9ba5b4;font-size:12px;line-height:1.35;';
    element.append(titleElement, detailElement);
    element.style.cssText = `
      position: fixed;
      left: 50%;
      bottom: 136px;
      z-index: 2147483647;
      max-width: 300px;
      padding: 11px 14px 12px;
      transform: translateX(-50%);
      border: 1px solid rgba(229, 160, 13, 0.35);
      border-radius: 8px;
      background: rgba(15, 19, 25, 0.96);
      box-shadow: 0 16px 46px rgba(0, 0, 0, 0.42);
      color: #f4f6fb;
      font-family: Arial, Helvetica, sans-serif;
      pointer-events: none;
      opacity: 1;
      transition: opacity 180ms ease, transform 180ms ease;
    `;

    window.clearTimeout(showToast.hideTimer);
    showToast.hideTimer = window.setTimeout(() => {
      element.style.opacity = '0';
      element.style.transform = 'translateX(-50%) translateY(6px)';
    }, 3600);
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    const shouldShow = isLikelyPlexPage() && Boolean(findLyricsButton() || findLyricsScroller());

    if (!shouldShow) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    let button = existing;
    if (!button) {
      button = document.createElement('button');
      button.id = BUTTON_ID;
      button.type = 'button';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPip();
      });
      (document.body || document.documentElement).appendChild(button);
    }

    const supported = supportsDocumentPip();
    button.textContent = supported ? 'Lyrics PiP' : 'PiP unavailable';
    button.title = supported
      ? 'Open a portrait lyrics Picture-in-Picture window'
      : 'This browser does not expose Document Picture-in-Picture here';
    button.setAttribute('aria-label', supported ? 'Open lyrics Picture-in-Picture' : 'Lyrics Picture-in-Picture unavailable');
    button.dataset.supported = supported ? 'true' : 'false';
    button.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 92px;
      z-index: 2147483647;
      min-width: 98px;
      height: 34px;
      padding: 0 13px;
      border: 1px solid ${supported ? 'rgba(255, 214, 120, 0.58)' : 'rgba(128, 139, 154, 0.38)'};
      border-radius: 8px;
      background: ${supported ? '#e5a00d' : 'rgba(18, 23, 31, 0.94)'};
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.34);
      color: ${supported ? '#0b0e13' : '#c4ccd8'};
      cursor: pointer;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0;
      line-height: 32px;
    `;
  }

  function getPipDocument() {
    if (!pipWindow) {
      return null;
    }

    try {
      if (pipWindow.closed) {
        pipWindow = null;
        lastSignature = '';
        return null;
      }
      return pipWindow.document;
    } catch (error) {
      pipWindow = null;
      lastSignature = '';
      showToast('Lyrics PiP lost access', error && error.name ? error.name : 'The browser closed the PiP document.');
      return null;
    }
  }

  function isPipOpen() {
    try {
      return Boolean(pipWindow && !pipWindow.closed);
    } catch (error) {
      pipWindow = null;
      lastSignature = '';
      scrollAnimationFrame = null;
      return false;
    }
  }

  function setupPipDocument() {
    const pipDocument = getPipDocument();
    if (!pipDocument) {
      return;
    }

    pipDocument.title = 'Lyrics PiP';
    pipDocument.documentElement.lang = document.documentElement.lang || 'en';

    const style = pipDocument.createElement('style');
    style.textContent = `
      :root {
        color-scheme: dark;
        font-family: Arial, Helvetica, sans-serif;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #07090d;
        color: #f6f2e8;
      }

      button {
        font: inherit;
      }

      .plc-pip-shell {
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0b0f16;
        border: 1px solid rgba(229, 160, 13, 0.38);
        box-sizing: border-box;
      }

      .plc-pip-header {
        position: relative;
        z-index: 2;
        display: grid;
        grid-template-areas:
          "nowplaying nowplaying close"
          "controls progress progress";
        grid-template-columns: 98px minmax(0, 1fr) 17px;
        gap: 6px 7px;
        align-items: center;
        box-sizing: border-box;
        padding: 7px 8px 8px;
        border-bottom: 1px solid rgba(255, 226, 150, 0.16);
        background: #0d121b;
      }

      .plc-pip-status {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        border: 0;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
      }

      .plc-pip-controls {
        grid-area: controls;
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        align-items: center;
        justify-self: start;
        width: 96px;
        height: 24px;
        overflow: hidden;
        border: 1px solid rgba(255, 226, 150, 0.34);
        border-radius: 999px;
        background: rgba(18, 24, 33, 0.92);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      .plc-pip-nowplaying {
        grid-area: nowplaying;
        display: grid;
        grid-template-areas:
          "title"
          "artist";
        grid-template-columns: minmax(0, 1fr);
        gap: 2px;
        align-self: stretch;
        align-items: center;
        min-width: 0;
        color: #f8f0df;
      }

      .plc-pip-progress-cluster {
        grid-area: progress;
        display: grid;
        grid-template-areas:
          "progress"
          "time";
        align-content: center;
        min-width: 0;
        height: 26px;
      }

      .plc-pip-track-title,
      .plc-pip-track-artist {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .plc-pip-track-title {
        grid-area: title;
        font-size: 12.5px;
        font-weight: 900;
        line-height: 1.15;
      }

      .plc-pip-track-artist {
        grid-area: artist;
        color: #a8b2c1;
        font-size: 10px;
        font-weight: 800;
        line-height: 1.15;
      }

      .plc-pip-progress {
        grid-area: progress;
        position: relative;
        height: 5px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(143, 154, 172, 0.28);
      }

      .plc-pip-progress-fill {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: #e5a00d;
        transition: width 280ms linear;
      }

      .plc-pip-time {
        grid-area: time;
        justify-self: end;
        overflow: hidden;
        color: #748094;
        font-size: 9px;
        font-weight: 800;
        line-height: 1;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .plc-pip-control {
        display: grid;
        width: 100%;
        height: 100%;
        place-items: center;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #f8f0df;
        cursor: pointer;
      }

      .plc-pip-control + .plc-pip-control {
        border-left: 1px solid rgba(255, 226, 150, 0.2);
      }

      .plc-pip-control:hover {
        background: rgba(229, 160, 13, 0.2);
      }

      .plc-pip-control:focus-visible {
        outline: 0;
        background: rgba(155, 231, 199, 0.12);
        box-shadow: inset 0 0 0 2px #9be7c7;
      }

      .plc-pip-control:disabled {
        cursor: default;
        opacity: 0.42;
      }

      .plc-icon {
        position: relative;
        display: block;
        width: 13px;
        height: 13px;
      }

      .plc-pip-control[data-action="previous"] .plc-icon::before,
      .plc-pip-control[data-action="next"] .plc-icon::before,
      .plc-pip-control[data-action="playPause"][data-state="paused"] .plc-icon::before {
        position: absolute;
        top: 1px;
        width: 0;
        height: 0;
        content: "";
      }

      .plc-pip-control[data-action="previous"] .plc-icon::before {
        left: 4px;
        border-top: 5px solid transparent;
        border-right: 8px solid currentColor;
        border-bottom: 5px solid transparent;
      }

      .plc-pip-control[data-action="previous"] .plc-icon::after,
      .plc-pip-control[data-action="next"] .plc-icon::after,
      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::before,
      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::after {
        position: absolute;
        content: "";
        background: currentColor;
      }

      .plc-pip-control[data-action="previous"] .plc-icon::after {
        top: 1px;
        left: 1px;
        width: 2px;
        height: 11px;
      }

      .plc-pip-control[data-action="next"] .plc-icon::before {
        left: 2px;
        border-top: 5px solid transparent;
        border-bottom: 5px solid transparent;
        border-left: 8px solid currentColor;
      }

      .plc-pip-control[data-action="next"] .plc-icon::after {
        top: 1px;
        right: 1px;
        width: 2px;
        height: 11px;
      }

      .plc-pip-control[data-action="playPause"][data-state="paused"] .plc-icon::before {
        left: 4px;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 9px solid currentColor;
      }

      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::before,
      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::after {
        top: 1px;
        width: 3px;
        height: 11px;
        border-radius: 1px;
      }

      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::before {
        left: 4px;
      }

      .plc-pip-control[data-action="playPause"][data-state="playing"] .plc-icon::after {
        left: 9px;
      }

      .plc-pip-close {
        grid-area: close;
        align-self: start;
        justify-self: end;
        width: 17px;
        height: 17px;
        padding: 0;
        border: 1px solid rgba(255, 226, 150, 0.34);
        border-radius: 999px;
        background: rgba(229, 160, 13, 0.18);
        color: #f2c45e;
        cursor: pointer;
        font-size: 10px;
        font-weight: 900;
        line-height: 15px;
        text-align: center;
      }

      .plc-pip-close:focus-visible {
        outline: 2px solid #9be7c7;
        outline-offset: 2px;
      }

      .plc-pip-viewport {
        min-height: 0;
        width: 100%;
        overflow-x: hidden;
        overflow-y: auto;
        box-sizing: border-box;
        padding: 18px 22px 36px;
        scrollbar-width: thin;
        scrollbar-color: #e5a00d #151b24;
      }

      .plc-pip-lines {
        display: flex;
        min-height: 100%;
        flex-direction: column;
        gap: 10px;
        justify-content: flex-start;
      }

      .plc-pip-line {
        position: relative;
        margin: 0;
        padding-left: 12px;
        border-left: 3px solid transparent;
        overflow-wrap: anywhere;
        color: #8490a3;
        font-size: 18px;
        font-weight: 750;
        line-height: 1.34;
        opacity: 0.72;
        transition: color 420ms ease, opacity 420ms ease, transform 420ms ease, border-color 420ms ease;
      }

      .plc-pip-line.is-active {
        border-left: 3px solid #e5a00d;
        color: #fffaf0;
        font-size: 18px;
        font-weight: 900;
        opacity: 1;
        transform: translateX(1px);
      }

      .plc-pip-line.is-empty {
        min-height: 18px;
        opacity: 0;
      }

      body[data-mode="plain"] .plc-pip-line {
        color: #d6dde8;
        opacity: 0.92;
      }

      .plc-pip-empty {
        margin: auto 0;
        color: #b4bdca;
        font-size: 17px;
        font-weight: 800;
        line-height: 1.42;
      }

      @media (prefers-reduced-motion: reduce) {
        .plc-pip-line {
          transition: none;
        }
      }

      @media (max-width: 250px) {
        .plc-pip-header {
          grid-template-columns: 98px minmax(0, 1fr) 16px;
          gap: 6px;
        }
      }
    `;

    const shell = pipDocument.createElement('main');
    shell.className = 'plc-pip-shell';

    const header = pipDocument.createElement('header');
    header.className = 'plc-pip-header';
    header.setAttribute('aria-label', 'Lyrics PiP controls and track progress');

    const status = pipDocument.createElement('div');
    status.className = 'plc-pip-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.textContent = 'Waiting for Plex lyrics';

    const controls = pipDocument.createElement('div');
    controls.className = 'plc-pip-controls';
    controls.setAttribute('aria-label', 'Plex playback controls');

    [
      ['previous', 'Previous track'],
      ['playPause', 'Play or pause'],
      ['next', 'Next track'],
    ].forEach(([action, label]) => {
      const button = pipDocument.createElement('button');
      button.className = 'plc-pip-control';
      button.type = 'button';
      button.dataset.action = action;
      button.setAttribute('aria-label', label);
      button.title = label;
      button.addEventListener('click', () => clickPlayerControl(action));

      const icon = pipDocument.createElement('span');
      icon.className = 'plc-icon';
      icon.setAttribute('aria-hidden', 'true');
      button.appendChild(icon);
      controls.appendChild(button);
    });

    const nowPlaying = pipDocument.createElement('div');
    nowPlaying.className = 'plc-pip-nowplaying';

    const title = pipDocument.createElement('div');
    title.className = 'plc-pip-track-title';
    title.textContent = 'Plex Music';

    const artist = pipDocument.createElement('div');
    artist.className = 'plc-pip-track-artist';

    const progressCluster = pipDocument.createElement('div');
    progressCluster.className = 'plc-pip-progress-cluster';

    const progress = pipDocument.createElement('div');
    progress.className = 'plc-pip-progress';
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Track progress');
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');

    const progressFill = pipDocument.createElement('div');
    progressFill.className = 'plc-pip-progress-fill';
    progress.appendChild(progressFill);

    const time = pipDocument.createElement('div');
    time.className = 'plc-pip-time';
    time.textContent = '0:00 / 0:00';

    nowPlaying.append(title, artist);
    progressCluster.append(progress, time);

    const closeButton = pipDocument.createElement('button');
    closeButton.className = 'plc-pip-close';
    closeButton.type = 'button';
    closeButton.textContent = 'X';
    closeButton.setAttribute('aria-label', 'Close Lyrics PiP');
    closeButton.addEventListener('click', () => {
      if (isPipOpen()) {
        pipWindow.close();
      }
    });

    const viewport = pipDocument.createElement('section');
    viewport.className = 'plc-pip-viewport';
    viewport.setAttribute('aria-label', 'Lyrics from Plex');

    const lines = pipDocument.createElement('div');
    lines.className = 'plc-pip-lines';
    viewport.appendChild(lines);

    header.append(controls, nowPlaying, progressCluster, closeButton, status);
    shell.append(header, viewport);
    pipDocument.head.replaceChildren(style);
    pipDocument.body.replaceChildren(shell);
  }

  function updateNowPlaying(pipDocument) {
    const snapshot = getNowPlayingSnapshot();
    const title = pipDocument.querySelector('.plc-pip-track-title');
    const artist = pipDocument.querySelector('.plc-pip-track-artist');
    const progress = pipDocument.querySelector('.plc-pip-progress');
    const progressFill = pipDocument.querySelector('.plc-pip-progress-fill');
    const time = pipDocument.querySelector('.plc-pip-time');

    if (title) {
      title.textContent = snapshot.title;
      title.title = snapshot.title;
    }

    if (artist) {
      artist.textContent = snapshot.artist;
      artist.title = snapshot.artist;
      artist.hidden = !snapshot.artist;
    }

    const progressPercent = snapshot.progress * 100;
    const roundedProgressPercent = Math.round(progressPercent);
    if (progress) {
      progress.setAttribute('aria-valuenow', String(roundedProgressPercent));
      progress.setAttribute(
        'aria-valuetext',
        snapshot.duration > 0
          ? `${formatTime(snapshot.currentTime)} of ${formatTime(snapshot.duration)}`
          : `${formatTime(snapshot.currentTime)} elapsed`,
      );
    }

    if (progressFill) {
      progressFill.style.width = `${progressPercent.toFixed(2)}%`;
    }

    if (time) {
      time.textContent = snapshot.duration > 0
        ? `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration)}`
        : formatTime(snapshot.currentTime);
    }
  }

  function updatePipControls(pipDocument) {
    const playing = isPlaybackPlaying();
    const playPauseButton = pipDocument.querySelector('.plc-pip-control[data-action="playPause"]');
    if (playPauseButton) {
      playPauseButton.dataset.state = playing ? 'playing' : 'paused';
      playPauseButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      playPauseButton.title = playing ? 'Pause' : 'Play';
      playPauseButton.disabled = !findPlayerControl(playing ? 'pause' : 'play');
    }

    const previousButton = pipDocument.querySelector('.plc-pip-control[data-action="previous"]');
    if (previousButton) {
      previousButton.disabled = false;
    }

    const nextButton = pipDocument.querySelector('.plc-pip-control[data-action="next"]');
    if (nextButton) {
      nextButton.disabled = false;
    }
  }

  function easeInOutCubic(progress) {
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function animateViewportScroll(viewport, targetTop) {
    if (!isPipOpen()) {
      return;
    }

    const prefersReducedMotion = Boolean(pipWindow.matchMedia && pipWindow.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (prefersReducedMotion) {
      viewport.scrollTop = targetTop;
      return;
    }

    const startTop = viewport.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) {
      return;
    }

    if (scrollAnimationFrame) {
      pipWindow.cancelAnimationFrame(scrollAnimationFrame);
      scrollAnimationFrame = null;
    }

    const duration = 680;
    const startTime = pipWindow.performance ? pipWindow.performance.now() : Date.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      viewport.scrollTop = startTop + (delta * easeInOutCubic(progress));

      if (progress < 1 && isPipOpen()) {
        scrollAnimationFrame = pipWindow.requestAnimationFrame(tick);
      } else {
        scrollAnimationFrame = null;
      }
    };

    scrollAnimationFrame = pipWindow.requestAnimationFrame(tick);
  }

  function scrollActiveLine() {
    const pipDocument = getPipDocument();
    if (!pipDocument) {
      return;
    }

    const viewport = pipDocument.querySelector('.plc-pip-viewport');
    const activeLine = pipDocument.querySelector('.plc-pip-line.is-active');
    if (!viewport || !activeLine) {
      return;
    }

    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const targetTop = Math.min(
      maxScrollTop,
      Math.max(0, activeLine.offsetTop - (viewport.clientHeight * 0.5) + (activeLine.offsetHeight * 0.55)),
    );
    animateViewportScroll(viewport, targetTop);
  }

  function createLineElement(pipDocument, line, index) {
    const element = pipDocument.createElement(line.empty ? 'div' : 'p');
    element.dataset.index = String(index);
    element.dataset.empty = line.empty ? 'true' : 'false';
    element.dataset.textHash = String(hashText(line.text));
    if (!line.empty) {
      element.textContent = line.text;
    }
    updateLineElement(element, line);
    return element;
  }

  function updateLineElement(element, line) {
    element.className = `plc-pip-line${line.active ? ' is-active' : ''}${line.empty ? ' is-empty' : ''}`;

    if (line.active) {
      element.setAttribute('aria-current', 'true');
    } else {
      element.removeAttribute('aria-current');
    }

    if (line.empty) {
      element.setAttribute('aria-hidden', 'true');
    } else {
      element.removeAttribute('aria-hidden');
    }
  }

  function canPatchLines(linesRoot, snapshot) {
    if (linesRoot.dataset.kind !== 'lyrics' || linesRoot.children.length !== snapshot.lines.length) {
      return false;
    }

    return snapshot.lines.every((line, index) => {
      const element = linesRoot.children[index];
      return element
        && element.dataset.empty === (line.empty ? 'true' : 'false')
        && element.dataset.textHash === String(hashText(line.text));
    });
  }

  function syncLyricsLines(pipDocument, linesRoot, snapshot) {
    if (!snapshot.hasLyrics) {
      if (linesRoot.dataset.kind === 'empty' && linesRoot.dataset.emptyState === snapshot.emptyState) {
        return;
      }

      const empty = pipDocument.createElement('p');
      empty.className = 'plc-pip-empty';
      empty.textContent = snapshot.emptyText;
      linesRoot.dataset.kind = 'empty';
      linesRoot.dataset.emptyState = snapshot.emptyState;
      linesRoot.replaceChildren(empty);
      return;
    }

    if (canPatchLines(linesRoot, snapshot)) {
      snapshot.lines.forEach((line, index) => {
        updateLineElement(linesRoot.children[index], line);
      });
      return;
    }

    linesRoot.dataset.kind = 'lyrics';
    delete linesRoot.dataset.emptyState;
    linesRoot.replaceChildren(...snapshot.lines.map((line, index) => createLineElement(pipDocument, line, index)));
  }

  function renderPip(snapshot = createSnapshot(), options = {}) {
    const pipDocument = getPipDocument();
    if (!pipDocument) {
      return;
    }

    const viewport = pipDocument.querySelector('.plc-pip-viewport');
    const linesRoot = pipDocument.querySelector('.plc-pip-lines');
    const status = pipDocument.querySelector('.plc-pip-status');
    if (!viewport || !linesRoot || !status) {
      return;
    }

    updatePipControls(pipDocument);
    updateNowPlaying(pipDocument);
    ensureLyricsVisibleForPip();

    const signature = getSnapshotSignature(snapshot);
    if (!options.force && signature === lastSignature) {
      return;
    }

    const previousScrollTop = viewport.scrollTop;
    lastSignature = signature;
    pipDocument.body.dataset.mode = snapshot.mode;
    status.textContent = snapshot.statusText || (snapshot.mode === 'timed'
      ? 'Timed lyrics from Plex'
      : (snapshot.mode === 'plain' ? 'Plain lyrics from Plex' : 'Waiting for Plex lyrics'));

    syncLyricsLines(pipDocument, linesRoot, snapshot);

    if (snapshot.activeIndex >= 0) {
      pipWindow.requestAnimationFrame(scrollActiveLine);
    } else {
      viewport.scrollTop = previousScrollTop;
    }
  }

  async function openPip() {
    ensureButton();

    if (!supportsDocumentPip()) {
      showToast('Lyrics PiP unavailable', 'This browser does not expose Document Picture-in-Picture on Plex Web.');
      return;
    }

    requestLyricsPanelVisible({ force: true });

    try {
      if (!isPipOpen()) {
        pipWindow = await window.documentPictureInPicture.requestWindow(getPipRequestOptions());
        const openedPipWindow = pipWindow;
        lastSignature = '';
        setupPipDocument();
        openedPipWindow.addEventListener('resize', () => schedulePipSizeSave());
        openedPipWindow.addEventListener('pagehide', () => {
          savePipSize(openedPipWindow);
          window.clearTimeout(pipSizeSaveTimer);
          pipSizeSaveTimer = null;
          pipWindow = null;
          lastSignature = '';
        }, { once: true });
      } else {
        pipWindow.focus();
      }

      renderPip(createSnapshot(), { force: true });
      scheduleUpdate(450);
    } catch (error) {
      pipWindow = null;
      lastSignature = '';
      showToast('Lyrics PiP did not open', error && error.name ? error.name : 'The browser rejected the PiP request.');
    }
  }

  function scheduleUpdate(delay = 120) {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(() => {
      ensureButton();
      if (isPipOpen()) {
        renderPip();
      }
    }, delay);
  }

  function closePip() {
    const currentPipWindow = pipWindow;
    pipWindow = null;
    lastSignature = '';
    scrollAnimationFrame = null;
    window.clearTimeout(pipSizeSaveTimer);
    pipSizeSaveTimer = null;
    if (!currentPipWindow) {
      return;
    }

    try {
      if (!currentPipWindow.closed) {
        savePipSize(currentPipWindow);
        currentPipWindow.close();
      }
    } catch (error) {
      // The browser may already be tearing down the PiP window during navigation.
    }
  }

  const observer = new MutationObserver(() => scheduleUpdate());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'data-selected'],
  });

  window.setInterval(scheduleUpdate, 1000);
  window.addEventListener('pagehide', closePip);
  window.setTimeout(scheduleUpdate, 500);
})();
