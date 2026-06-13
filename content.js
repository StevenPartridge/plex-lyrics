const TOAST_ID = 'plex-lyrics-companion-toast';
const LYRICS_BUTTON_SELECTORS = [
  '[data-testid="lyricsButton"]',
  'button[aria-label="Lyrics" i]',
  '[role="button"][aria-label="Lyrics" i]',
];
const BUTTON_MISSING_GRACE_MS = 6000;

const SESSION_STATES = {
  IDLE: 'idle',
  ACTIVE: 'active',
  PAUSED_BY_MANUAL_CLOSE: 'pausedByManualClose',
  PAUSED_BY_USER: 'pausedByUser',
  WAITING_FOR_PLEX: 'waitingForPlex',
  LYRICS_UNAVAILABLE: 'lyricsUnavailable',
};

let session = { state: SESSION_STATES.IDLE };
let lastKnownVisible = null;
let lastUserLyricsInteractionAt = 0;
let lastSyntheticClickAt = 0;
let lastSentStatus = null;
let inspectTimer = null;
let sessionBecameActiveAt = 0;
let lastButtonSeenAt = 0;
const scriptStartedAt = Date.now();

function sendRuntimeMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Reading lastError prevents noisy console output when the background is asleep.
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // The extension context may disappear while Firefox reloads the add-on.
  }
}

function isLikelyPlexPage() {
  return location.hostname.endsWith('plex.tv')
    || /\bplex\b/i.test(document.title)
    || Boolean(document.querySelector('[data-testid="lyricsButton"], [data-testid="playerControls"]'));
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

function isMainLyricsButton(element) {
  if (!element) {
    return false;
  }

  const testId = element.getAttribute('data-testid') || '';
  const ariaLabel = (element.getAttribute('aria-label') || '').trim().toLowerCase();
  return testId === 'lyricsButton' || ariaLabel === 'lyrics';
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

function isInsideLyricsButton(target) {
  const button = findLyricsButton();
  return Boolean(button && target instanceof Node && button.contains(target));
}

function isLikelyLyricsControl(target) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (isInsideLyricsButton(target)) {
    return true;
  }

  const labelledControl = target.closest('[data-testid*="lyrics" i], [aria-label*="lyrics" i]');
  if (labelledControl) {
    return true;
  }

  const closeControl = target.closest('button[aria-label*="close" i], [role="button"][aria-label*="close" i], button[aria-label*="hide" i], [role="button"][aria-label*="hide" i]');
  return Boolean(closeControl && lastKnownVisible === true);
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

function clickLyricsButton(button) {
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  lastSyntheticClickAt = Date.now();

  dispatchMouseEvent(button, 'mouseover', x, y);
  dispatchMouseEvent(button, 'mousedown', x, y);
  dispatchMouseEvent(button, 'mouseup', x, y);
  dispatchMouseEvent(button, 'click', x, y);
}

function sendStatus(status) {
  if (status === lastSentStatus && status !== 'clicked') {
    return;
  }
  lastSentStatus = status;
  sendRuntimeMessage({ type: 'CONTENT_STATUS', status });
}

function showToast(toast) {
  if (!toast || !toast.title) {
    return;
  }

  let element = document.getElementById(TOAST_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = TOAST_ID;
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(element);
  }

  element.innerHTML = `
    <div class="plc-toast-accent"></div>
    <div class="plc-toast-copy">
      <div class="plc-toast-title"></div>
      <div class="plc-toast-detail"></div>
    </div>
  `;
  element.querySelector('.plc-toast-title').textContent = toast.title;
  element.querySelector('.plc-toast-detail').textContent = toast.detail || '';

  element.style.cssText = `
    position: fixed;
    left: 50%;
    bottom: 84px;
    z-index: 2147483647;
    transform: translateX(-50%);
    display: grid;
    grid-template-columns: 5px minmax(180px, 280px);
    gap: 0;
    overflow: hidden;
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
  element.querySelector('.plc-toast-accent').style.cssText = 'background:#e5a00d;';
  element.querySelector('.plc-toast-copy').style.cssText = 'padding:11px 14px 12px;';
  element.querySelector('.plc-toast-title').style.cssText = 'font-size:14px;font-weight:800;line-height:1.25;';
  element.querySelector('.plc-toast-detail').style.cssText = 'margin-top:3px;color:#9ba5b4;font-size:12px;line-height:1.35;';

  window.clearTimeout(showToast.hideTimer);
  showToast.hideTimer = window.setTimeout(() => {
    if (!element) {
      return;
    }
    element.style.opacity = '0';
    element.style.transform = 'translateX(-50%) translateY(6px)';
  }, 3600);
}

function handleManualClose() {
  session = { ...session, state: SESSION_STATES.PAUSED_BY_MANUAL_CLOSE };
  sendRuntimeMessage({ type: 'MANUAL_CLOSE_DETECTED' });
}

function inspectLyrics(options = {}) {
  if (!isLikelyPlexPage()) {
    return 'not-plex';
  }

  const button = findLyricsButton();
  if (!button) {
    const waitingForPlayer = session.state === SESSION_STATES.ACTIVE
      && (Date.now() - Math.max(sessionBecameActiveAt, scriptStartedAt, lastButtonSeenAt)) < BUTTON_MISSING_GRACE_MS;

    if (waitingForPlayer) {
      sendStatus('checking');
      lastKnownVisible = false;
      return 'checking';
    }

    sendStatus('button-missing');
    lastKnownVisible = false;
    return 'button-missing';
  }
  lastButtonSeenAt = Date.now();

  const visible = Boolean(isLyricsVisible(button));
  const now = Date.now();
  const userJustClosed = lastKnownVisible === true
    && visible === false
    && now - lastUserLyricsInteractionAt < 2500
    && now - lastSyntheticClickAt > 1500;

  lastKnownVisible = visible;

  if (session.state !== SESSION_STATES.ACTIVE) {
    sendStatus(visible ? 'already-visible' : 'ready');
    return visible ? 'already-visible' : 'ready';
  }

  if (userJustClosed) {
    handleManualClose();
    return 'manual-close-detected';
  }

  if (visible) {
    sendStatus('already-visible');
    return 'already-visible';
  }

  clickLyricsButton(button);
  sendStatus('clicked');

  if (options.fromRequest) {
    scheduleInspect(650);
  }

  return 'clicked';
}

function scheduleInspect(delay = 120) {
  window.clearTimeout(inspectTimer);
  inspectTimer = window.setTimeout(() => inspectLyrics(), delay);
}

document.addEventListener('pointerdown', (event) => {
  if (event.isTrusted && isLikelyLyricsControl(event.target)) {
    lastUserLyricsInteractionAt = Date.now();
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (!event.isTrusted || (event.key !== 'Enter' && event.key !== ' ')) {
    return;
  }
  if (isLikelyLyricsControl(event.target)) {
    lastUserLyricsInteractionAt = Date.now();
  }
}, true);

const observer = new MutationObserver(() => scheduleInspect());
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'data-selected'],
});

window.setInterval(() => {
  if (session.state === SESSION_STATES.ACTIVE || session.state === SESSION_STATES.WAITING_FOR_PLEX) {
    inspectLyrics();
  }
}, 5000);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'SESSION_UPDATED') {
    return;
  }

  const previousState = session.state;
  session = message.session || session;
  if (session.state === SESSION_STATES.ACTIVE && (previousState !== SESSION_STATES.ACTIVE || message.requestOpen)) {
    sessionBecameActiveAt = Date.now();
  } else if (session.state !== SESSION_STATES.ACTIVE) {
    sessionBecameActiveAt = 0;
  }
  showToast(message.toast);

  const status = message.requestOpen
    ? inspectLyrics({ fromRequest: true })
    : inspectLyrics();
  sendResponse({ ok: true, status });
});

window.setTimeout(() => {
  const status = inspectLyrics();
  sendRuntimeMessage({ type: 'CONTENT_READY', status });
}, 500);
