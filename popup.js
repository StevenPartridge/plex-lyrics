const elements = {
  shell: document.querySelector('.popup-shell'),
  statePill: document.getElementById('state-pill'),
  headline: document.getElementById('headline'),
  summary: document.getElementById('summary'),
  plexStatus: document.getElementById('plex-status'),
  lyricsStatus: document.getElementById('lyrics-status'),
  meterFill: document.getElementById('meter-fill'),
  primaryAction: document.getElementById('primary-action'),
  stopAction: document.getElementById('stop-action'),
  checkAction: document.getElementById('check-action'),
  lastEvent: document.getElementById('last-event'),
};

let currentSession = null;
let primaryMessage = { type: 'START_SESSION' };
let secondaryMessage = { type: 'OPEN_PLEX' };

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      resolve(response || { ok: false, error: 'No response' });
    });
  });
}

function contentStatusLabel(status) {
  const labels = {
    'already-visible': 'Visible',
    clicked: 'Opened',
    checking: 'Checking',
    'button-missing': 'Unavailable',
    'no-plex-tab': 'No Plex tab',
    opening: 'Opening',
    paused: 'Paused',
    ready: 'Ready',
    stopped: 'Stopped',
    unknown: 'Idle',
  };
  return labels[status] || 'Idle';
}

function viewModelForSession(session) {
  const model = {
    state: session.state || 'idle',
    pill: 'Off',
    headline: 'Lyrics Companion is off',
    summary: 'Open Plex Music, then keep lyrics ready.',
    primaryLabel: 'Keep lyrics open',
    primaryMessage: { type: 'START_SESSION' },
    secondaryLabel: 'Open Plex',
    secondaryMessage: { type: 'OPEN_PLEX' },
    stopDisabled: true,
    secondaryDisabled: false,
    meterWidth: '0%',
  };

  if (session.state === 'active') {
    return {
      ...model,
      pill: 'On',
      headline: 'Keeping lyrics open',
      summary: 'Plex Music is being watched.',
      primaryLabel: 'Pause',
      primaryMessage: { type: 'PAUSE_SESSION' },
      secondaryLabel: 'Focus Plex',
      secondaryMessage: { type: 'OPEN_PLEX', startWhenReady: true },
      stopDisabled: false,
      meterWidth: '64%',
    };
  }

  if (session.state === 'pausedByManualClose') {
    return {
      ...model,
      pill: 'Pause',
      headline: 'Lyrics paused',
      summary: 'Resume when you want them back.',
      primaryLabel: 'Resume lyrics',
      primaryMessage: { type: 'RESUME_SESSION' },
      secondaryLabel: 'Open Plex',
      secondaryMessage: { type: 'OPEN_PLEX' },
      stopDisabled: false,
      meterWidth: '36%',
    };
  }

  if (session.state === 'pausedByUser') {
    return {
      ...model,
      pill: 'Pause',
      headline: 'Lyrics paused',
      summary: 'Resume when you are ready.',
      primaryLabel: 'Resume lyrics',
      primaryMessage: { type: 'RESUME_SESSION' },
      secondaryLabel: 'Open Plex',
      secondaryMessage: { type: 'OPEN_PLEX' },
      stopDisabled: false,
      meterWidth: '36%',
    };
  }

  if (session.state === 'waitingForPlex') {
    return {
      ...model,
      pill: 'Wait',
      headline: 'Waiting for Plex Music',
      summary: 'Open Plex Music and I will pick up from there.',
      primaryLabel: 'Open Plex',
      primaryMessage: { type: 'OPEN_PLEX', startWhenReady: true },
      secondaryLabel: 'Check again',
      secondaryMessage: { type: 'CHECK_NOW' },
      stopDisabled: false,
      meterWidth: '18%',
    };
  }

  if (session.state === 'lyricsUnavailable') {
    return {
      ...model,
      pill: 'Lyrics',
      headline: 'Lyrics unavailable',
      summary: 'Still watching for the next track.',
      primaryLabel: 'Check again',
      primaryMessage: { type: 'CHECK_NOW' },
      secondaryLabel: 'Focus Plex',
      secondaryMessage: { type: 'OPEN_PLEX', startWhenReady: true },
      stopDisabled: false,
      meterWidth: '28%',
    };
  }

  return model;
}

function render(session) {
  currentSession = session || {};
  const model = viewModelForSession(currentSession);

  elements.shell.dataset.state = model.state;
  elements.statePill.textContent = model.pill;
  elements.headline.textContent = model.headline;
  elements.summary.textContent = model.summary;
  elements.primaryAction.textContent = model.primaryLabel;
  elements.checkAction.textContent = model.secondaryLabel;
  elements.stopAction.disabled = model.stopDisabled;
  elements.checkAction.disabled = model.secondaryDisabled;
  elements.meterFill.style.width = model.meterWidth;
  primaryMessage = model.primaryMessage;
  secondaryMessage = model.secondaryMessage;

  elements.plexStatus.textContent = currentSession.plexTabTitle || (
    currentSession.state === 'waitingForPlex' ? 'Waiting' : 'Not checked'
  );
  elements.lyricsStatus.textContent = contentStatusLabel(currentSession.contentStatus);
  elements.lastEvent.textContent = currentSession.lastEvent || 'Ready';
}

async function refresh() {
  const response = await sendMessage({ type: 'GET_STATE' });
  if (response.ok) {
    render(response.session);
  }
}

async function runAction(message) {
  elements.primaryAction.disabled = true;
  elements.stopAction.disabled = true;
  elements.checkAction.disabled = true;

  const response = await sendMessage(message);
  if (response.ok) {
    render(response.session);
  }

  elements.primaryAction.disabled = false;
  const model = viewModelForSession(currentSession || {});
  elements.checkAction.disabled = model.secondaryDisabled;
  elements.stopAction.disabled = model.stopDisabled;
}

elements.primaryAction.addEventListener('click', () => {
  runAction(primaryMessage);
});

elements.stopAction.addEventListener('click', () => {
  runAction({ type: 'STOP_SESSION' });
});

elements.checkAction.addEventListener('click', () => {
  runAction(secondaryMessage);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'STATE_CHANGED' && message.session) {
    render(message.session);
  }
});

document.addEventListener('DOMContentLoaded', refresh);
refresh();
