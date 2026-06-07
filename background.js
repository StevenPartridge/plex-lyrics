const PLEX_URL_PATTERNS = ['*://*.plex.tv/*', '*://*/web/*'];
const PLEX_WEB_URL = 'https://app.plex.tv/desktop/#!/';
const SESSION_KEY = 'lyricsCompanionSession';
const SYNC_ALARM_NAME = 'lyrics-companion-sync';

const SESSION_STATES = {
  IDLE: 'idle',
  ACTIVE: 'active',
  PAUSED_BY_MANUAL_CLOSE: 'pausedByManualClose',
  PAUSED_BY_USER: 'pausedByUser',
  WAITING_FOR_PLEX: 'waitingForPlex',
  LYRICS_UNAVAILABLE: 'lyricsUnavailable',
};

const DEFAULT_SESSION = {
  state: SESSION_STATES.IDLE,
  reason: null,
  lastEvent: 'Ready',
  lastEventAt: null,
  plexTabTitle: '',
  contentStatus: 'unknown',
  updatedAt: 0,
};

function getActionApi() {
  return chrome.action || chrome.browserAction;
}

function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function setInStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

function queryTabs(queryInfo) {
  return new Promise((resolve) => {
    chrome.tabs.query(queryInfo, (tabs) => resolve(tabs || []));
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      resolve({ response, error: error ? error.message : null });
    });
  });
}

function updateTab(tabId, updateProperties) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      resolve({ tab, error: error ? error.message : null });
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      resolve({ tab, error: error ? error.message : null });
    });
  });
}

function focusWindow(windowId) {
  return new Promise((resolve) => {
    if (!chrome.windows || typeof windowId !== 'number') {
      resolve({ ok: false });
      return;
    }

    chrome.windows.update(windowId, { focused: true }, () => {
      const error = chrome.runtime.lastError;
      resolve({ ok: !error, error: error ? error.message : null });
    });
  });
}

function createAlarm() {
  if (!chrome.alarms) {
    return;
  }
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1 });
}

function clearAlarm() {
  if (!chrome.alarms) {
    return;
  }
  chrome.alarms.clear(SYNC_ALARM_NAME);
}

function normalizeSession(session) {
  return {
    ...DEFAULT_SESSION,
    ...(session || {}),
  };
}

async function getSession() {
  const result = await getFromStorage([SESSION_KEY]);
  return normalizeSession(result[SESSION_KEY]);
}

async function saveSession(patch) {
  const current = await getSession();
  const session = normalizeSession({
    ...current,
    ...patch,
    updatedAt: Date.now(),
  });

  await setInStorage({ [SESSION_KEY]: session });
  await updateBadge(session);
  notifyExtensionViews(session);

  if (session.state === SESSION_STATES.ACTIVE || session.state === SESSION_STATES.WAITING_FOR_PLEX) {
    createAlarm();
  } else {
    clearAlarm();
  }

  return session;
}

function badgeForState(state) {
  if (state === SESSION_STATES.ACTIVE) {
    return { text: 'ON', color: '#146b3b', title: 'Plex Lyrics Companion: keeping lyrics open' };
  }
  if (state === SESSION_STATES.PAUSED_BY_MANUAL_CLOSE || state === SESSION_STATES.PAUSED_BY_USER) {
    return { text: 'PAUSE', color: '#936715', title: 'Plex Lyrics Companion: lyrics paused' };
  }
  if (state === SESSION_STATES.WAITING_FOR_PLEX) {
    return { text: 'WAIT', color: '#5c6572', title: 'Plex Lyrics Companion: waiting for Plex Music' };
  }
  if (state === SESSION_STATES.LYRICS_UNAVAILABLE) {
    return { text: 'LYR', color: '#5c6572', title: 'Plex Lyrics Companion: lyrics unavailable' };
  }
  return { text: '', color: '#5c6572', title: 'Plex Lyrics Companion' };
}

async function updateBadge(session) {
  const action = getActionApi();
  if (!action) {
    return;
  }

  const badge = badgeForState(session.state);
  if (action.setBadgeText) {
    action.setBadgeText({ text: badge.text });
  }
  if (action.setBadgeBackgroundColor && badge.text) {
    action.setBadgeBackgroundColor({ color: badge.color });
  }
  if (action.setTitle) {
    action.setTitle({ title: badge.title });
  }
}

function notifyExtensionViews(session) {
  try {
    chrome.runtime.sendMessage({ type: 'STATE_CHANGED', session }, () => {
      void chrome.runtime.lastError;
    });
  } catch (error) {
    // No popup or extension view is open.
  }
}

async function getPlexTabs() {
  const tabs = await queryTabs({ url: PLEX_URL_PATTERNS });
  return tabs.filter((tab) => typeof tab.id === 'number');
}

function chooseTargetTabs(tabs) {
  const audibleTabs = tabs.filter((tab) => tab.audible);
  if (audibleTabs.length > 0) {
    return audibleTabs;
  }

  const activeTabs = tabs.filter((tab) => tab.active);
  if (activeTabs.length > 0) {
    return activeTabs;
  }

  return tabs;
}

async function broadcastSession(session, options = {}) {
  const tabs = await getPlexTabs();
  const targetTabs = options.requestOpen ? chooseTargetTabs(tabs) : tabs;

  await Promise.all(
    targetTabs.map((tab) => sendMessageToTab(tab.id, {
      type: 'SESSION_UPDATED',
      session,
      requestOpen: Boolean(options.requestOpen && session.state === SESSION_STATES.ACTIVE),
      toast: options.toast || null,
    })),
  );

  return { tabs, targetTabs };
}

async function setSessionAndBroadcast(patch, options = {}) {
  const session = await saveSession(patch);
  const result = await broadcastSession(session, options);
  return { session, ...result };
}

async function startSession() {
  const tabs = await getPlexTabs();
  const state = tabs.length > 0 ? SESSION_STATES.ACTIVE : SESSION_STATES.WAITING_FOR_PLEX;
  const sessionPatch = {
    state,
    reason: null,
    lastEvent: state === SESSION_STATES.ACTIVE ? 'Watching Plex Music' : 'Waiting for Plex Music',
    lastEventAt: Date.now(),
    plexTabTitle: tabs[0] && tabs[0].title ? tabs[0].title : '',
    contentStatus: tabs.length > 0 ? 'checking' : 'no-plex-tab',
  };

  return setSessionAndBroadcast(sessionPatch, {
    requestOpen: state === SESSION_STATES.ACTIVE,
    toast: state === SESSION_STATES.ACTIVE
      ? { title: 'Keeping lyrics open', detail: 'Following Plex Music.' }
      : null,
  });
}

async function resumeSession() {
  const tabs = await getPlexTabs();
  const state = tabs.length > 0 ? SESSION_STATES.ACTIVE : SESSION_STATES.WAITING_FOR_PLEX;
  const sessionPatch = {
    state,
    reason: null,
    lastEvent: state === SESSION_STATES.ACTIVE ? 'Lyrics resumed' : 'Waiting for Plex Music',
    lastEventAt: Date.now(),
    plexTabTitle: tabs[0] && tabs[0].title ? tabs[0].title : '',
    contentStatus: tabs.length > 0 ? 'checking' : 'no-plex-tab',
  };

  return setSessionAndBroadcast(sessionPatch, {
    requestOpen: state === SESSION_STATES.ACTIVE,
    toast: state === SESSION_STATES.ACTIVE
      ? { title: 'Lyrics resumed', detail: 'Following Plex Music.' }
      : null,
  });
}

async function pauseSession(reason = 'user') {
  const state = reason === 'manual-close'
    ? SESSION_STATES.PAUSED_BY_MANUAL_CLOSE
    : SESSION_STATES.PAUSED_BY_USER;
  const sessionPatch = {
    state,
    reason,
    lastEvent: 'Lyrics paused',
    lastEventAt: Date.now(),
    contentStatus: 'paused',
  };

  return setSessionAndBroadcast(sessionPatch, {
    toast: reason === 'manual-close'
      ? { title: 'Lyrics paused', detail: 'Resume from the extension when ready.' }
      : null,
  });
}

async function stopSession() {
  return setSessionAndBroadcast({
    state: SESSION_STATES.IDLE,
    reason: null,
    lastEvent: 'Lyrics Companion stopped',
    lastEventAt: Date.now(),
    contentStatus: 'stopped',
  });
}

async function checkNow() {
  const session = await getSession();
  if (session.state === SESSION_STATES.IDLE || session.state === SESSION_STATES.PAUSED_BY_USER || session.state === SESSION_STATES.PAUSED_BY_MANUAL_CLOSE) {
    return { session };
  }

  const tabs = await getPlexTabs();
  if (tabs.length === 0) {
    const waiting = await saveSession({
      state: SESSION_STATES.WAITING_FOR_PLEX,
      lastEvent: 'Waiting for Plex Music',
      lastEventAt: Date.now(),
      contentStatus: 'no-plex-tab',
      plexTabTitle: '',
    });
    return { session: waiting, tabs };
  }

  const active = await saveSession({
    state: SESSION_STATES.ACTIVE,
    lastEvent: 'Checking Plex Music',
    lastEventAt: Date.now(),
    contentStatus: 'checking',
    plexTabTitle: tabs[0].title || '',
  });
  await broadcastSession(active, { requestOpen: true });
  return { session: active, tabs };
}

async function openPlex(options = {}) {
  const current = await getSession();
  const tabs = await getPlexTabs();

  if (tabs.length > 0) {
    const target = chooseTargetTabs(tabs)[0];
    await updateTab(target.id, { active: true });
    await focusWindow(target.windowId);

    if (options.startWhenReady || current.state === SESSION_STATES.ACTIVE || current.state === SESSION_STATES.LYRICS_UNAVAILABLE) {
      const active = await saveSession({
        state: SESSION_STATES.ACTIVE,
        reason: null,
        lastEvent: 'Focused Plex Music',
        lastEventAt: Date.now(),
        contentStatus: 'checking',
        plexTabTitle: target.title || current.plexTabTitle || '',
      });
      await broadcastSession(active, { requestOpen: true });
      return { session: active, tab: target };
    }

    const focused = await saveSession({
      lastEvent: 'Focused Plex Music',
      lastEventAt: Date.now(),
      plexTabTitle: target.title || current.plexTabTitle || '',
    });
    return { session: focused, tab: target };
  }

  const created = await createTab({ url: PLEX_WEB_URL, active: true });
  const shouldWait = options.startWhenReady || current.state === SESSION_STATES.WAITING_FOR_PLEX;
  const session = await saveSession({
    state: shouldWait ? SESSION_STATES.WAITING_FOR_PLEX : current.state,
    reason: shouldWait ? null : current.reason,
    lastEvent: 'Opened Plex Web',
    lastEventAt: Date.now(),
    contentStatus: shouldWait ? 'opening' : current.contentStatus,
    plexTabTitle: 'Plex Web',
  });

  return { session, tab: created.tab, error: created.error };
}

async function handleContentReady(sender, status) {
  const current = await getSession();
  if (current.state === SESSION_STATES.WAITING_FOR_PLEX) {
    const resumed = await saveSession({
      state: SESSION_STATES.ACTIVE,
      reason: null,
      lastEvent: 'Plex Music detected',
      lastEventAt: Date.now(),
      plexTabTitle: sender.tab && sender.tab.title ? sender.tab.title : '',
      contentStatus: status || 'ready',
    });
    await broadcastSession(resumed, { requestOpen: true });
    return resumed;
  }

  if (current.state === SESSION_STATES.ACTIVE || current.state === SESSION_STATES.LYRICS_UNAVAILABLE) {
    await sendMessageToTab(sender.tab.id, {
      type: 'SESSION_UPDATED',
      session: current,
      requestOpen: current.state === SESSION_STATES.ACTIVE,
    });
  }

  return current;
}

async function handleContentStatus(sender, status) {
  const current = await getSession();
  if (current.state === SESSION_STATES.IDLE || current.state === SESSION_STATES.PAUSED_BY_USER || current.state === SESSION_STATES.PAUSED_BY_MANUAL_CLOSE) {
    return current;
  }

  const tabTitle = sender.tab && sender.tab.title ? sender.tab.title : current.plexTabTitle;
  let patch = {
    plexTabTitle: tabTitle,
    contentStatus: status,
  };

  if (status === 'clicked') {
    patch = {
      ...patch,
      state: SESSION_STATES.ACTIVE,
      lastEvent: 'Opened lyrics',
      lastEventAt: Date.now(),
    };
  } else if (status === 'already-visible') {
    patch = {
      ...patch,
      state: SESSION_STATES.ACTIVE,
      lastEvent: 'Lyrics visible',
      lastEventAt: Date.now(),
    };
  } else if (status === 'button-missing') {
    patch = {
      ...patch,
      state: SESSION_STATES.LYRICS_UNAVAILABLE,
      lastEvent: 'Lyrics control unavailable',
      lastEventAt: Date.now(),
    };
  }

  return saveSession(patch);
}

async function handleMessage(message, sender) {
  if (!message || !message.type) {
    return { ok: false, error: 'Unknown message' };
  }

  if (message.type === 'GET_STATE') {
    return { ok: true, session: await getSession() };
  }
  if (message.type === 'START_SESSION') {
    const result = await startSession();
    return { ok: true, session: result.session };
  }
  if (message.type === 'RESUME_SESSION') {
    const result = await resumeSession();
    return { ok: true, session: result.session };
  }
  if (message.type === 'PAUSE_SESSION') {
    const result = await pauseSession('user');
    return { ok: true, session: result.session };
  }
  if (message.type === 'STOP_SESSION') {
    const result = await stopSession();
    return { ok: true, session: result.session };
  }
  if (message.type === 'CHECK_NOW') {
    const result = await checkNow();
    return { ok: true, session: result.session };
  }
  if (message.type === 'OPEN_PLEX') {
    const result = await openPlex({ startWhenReady: Boolean(message.startWhenReady) });
    return { ok: true, session: result.session };
  }
  if (message.type === 'CONTENT_READY') {
    const session = await handleContentReady(sender, message.status);
    return { ok: true, session };
  }
  if (message.type === 'CONTENT_STATUS') {
    const session = await handleContentStatus(sender, message.status);
    return { ok: true, session };
  }
  if (message.type === 'MANUAL_CLOSE_DETECTED') {
    const result = await pauseSession('manual-close');
    return { ok: true, session: result.session };
  }

  return { ok: false, error: 'Unhandled message type' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
      checkNow();
    }
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const session = await getSession();
  await updateBadge(session);
});

chrome.runtime.onStartup.addListener(async () => {
  const session = await getSession();
  await updateBadge(session);
  if (session.state === SESSION_STATES.ACTIVE || session.state === SESSION_STATES.WAITING_FOR_PLEX) {
    createAlarm();
  }
});
