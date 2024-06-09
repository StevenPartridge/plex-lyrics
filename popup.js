document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['enabled', 'duration', 'endTime'], (data) => {
      if (data.duration) {
        document.querySelector(`input[name="duration"][value="${data.duration}"]`).checked = true;
      }
      if (data.enabled) {
        document.getElementById('start').disabled = true;
        document.getElementById('stop').disabled = false;
      } else {
        document.getElementById('start').disabled = false;
        document.getElementById('stop').disabled = true;
      }
      if (data.endTime) {
        updateTimerDisplay(data.endTime - Date.now());
      }
    });
  
    document.getElementById('start').addEventListener('click', () => {
      const duration = document.querySelector('input[name="duration"]:checked').value;
      chrome.runtime.sendMessage({action: 'start', duration: parseInt(duration)}, () => {
        document.getElementById('start').disabled = true;
        document.getElementById('stop').disabled = false;
      });
    });
  
    document.getElementById('stop').addEventListener('click', () => {
      chrome.runtime.sendMessage({action: 'stop'}, () => {
        document.getElementById('start').disabled = false;
        document.getElementById('stop').disabled = true;
        updateTimerDisplay(0);
      });
    });
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateTimer') {
      updateTimerDisplay(request.remainingTime);
    }
  });
  
  function updateTimerDisplay(remainingTime) {
    const timerElement = document.getElementById('timer');
    if (remainingTime > 0) {
      const minutes = Math.floor(remainingTime / 60000);
      const seconds = Math.floor((remainingTime % 60000) / 1000);
      timerElement.textContent = `Time remaining: ${minutes}m ${seconds}s`;
    } else {
      timerElement.textContent = 'Time remaining: 0s';
    }
  }
  