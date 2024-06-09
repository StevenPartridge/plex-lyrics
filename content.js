function isLyricsVisible() {
    const lyricsButton = document.querySelector('[data-testid="lyricsButton"]');
    return lyricsButton && lyricsButton.classList.contains('Link-isSelected-x0P_By');
  }
  
  function clickLyricsButton() {
    const lyricsButton = document.querySelector('[data-testid="lyricsButton"]');
    if (lyricsButton && !isLyricsVisible()) {
      const rect = lyricsButton.getBoundingClientRect();
      const x = rect.left + (rect.width / 2);
      const y = rect.top + (rect.height / 2);
  
      lyricsButton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
      lyricsButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      lyricsButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      lyricsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  
      console.log('Lyrics button clicked with mouse events');
    } else {
      console.log('Lyrics are already visible or button not found');
    }
  }
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'clickLyricsButton') {
      clickLyricsButton();
      sendResponse({ status: 'clicked' });
    }
  });
  