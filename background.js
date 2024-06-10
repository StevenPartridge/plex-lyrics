let timer = null;
let interval = null;
let endTime = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'start') {
    const duration = request.duration * 60 * 1000;
    clearTimeout(timer);
    clearInterval(interval);
    endTime = Date.now() + duration;

    interval = setInterval(() => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'clickLyricsButton'});
      });

      const remainingTime = endTime - Date.now();
      chrome.runtime.sendMessage({action: 'updateTimer', remainingTime});
    }, 3000); // Adjusted interval to 3 seconds

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
