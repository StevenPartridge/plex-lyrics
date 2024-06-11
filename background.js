let timer = null;
let interval = null;
let endTime = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    const duration = request.duration * 60 * 1000;
    clearTimeout(timer);
    clearInterval(interval);
    endTime = Date.now() + duration;

    const clickLyricsButton = () => {
      chrome.tabs.query({url: ["*://*.plex.tv/*", "*://*/web/*"]}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {action: 'clickLyricsButton'}, response => {
            if (!response || response.status !== 'clicked') {
              console.error('Failed to click the lyrics button in tab', tab.id);
            }
          });
        });
      });
    };

    // Interval to repeatedly attempt to click the lyrics button
    interval = setInterval(() => {
      chrome.tabs.query({url: ["*://*.plex.tv/*", "*://*/web/*"]}, (tabs) => {
        tabs.forEach(tab => {
          clickLyricsButton();
        });
      });
    }, 3000);

    // Timer to stop the interval after the specified duration
    timer = setTimeout(() => {
      clearInterval(interval);
      chrome.runtime.sendMessage({action: 'updateTimer', remainingTime: 0});
      chrome.storage.local.set({enabled: false});
    }, duration);

    chrome.storage.local.set({enabled: true, duration: request.duration, endTime});
  } else if (request.action === 'stop') {
    clearTimeout(timer);
    clearInterval(interval);
    endTime = null;
    chrome.storage.local.set({enabled: false});
    chrome.runtime.sendMessage({action: 'updateTimer', remainingTime: 0});
  }
  sendResponse({status: 'ok'});
});
