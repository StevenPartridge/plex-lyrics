((root) => {
  const STATUS_COPY = {
    'lyrics-unavailable': {
      status: 'lyrics-unavailable',
      shortLabel: 'No lyrics',
      pipStatus: 'No lyrics for this song',
      pipEmptyText: 'Plex does not have lyrics for this track. I will keep watching the next song.',
    },
    'lyrics-load-error': {
      status: 'lyrics-load-error',
      shortLabel: 'Plex error',
      pipStatus: 'Plex could not load lyrics',
      pipEmptyText: 'Plex reported an error loading lyrics. This is coming from Plex, not the extension.',
    },
  };

  const LYRICS_SURFACE_SELECTORS = [
    '[class*="AudioVideoLyrics-container"]',
    '[class*="AudioVideoLyrics-content"]',
    '[class*="AudioVideoLyrics-innerContent"]',
    '[class*="AudioVideoLyrics-scroller"]',
    '[class*="AudioVideoLyrics"]',
    '[class*="EmptyPage"]',
    '[data-testid*="lyrics" i]',
  ];

  const LYRICS_LINE_SELECTOR = 'div[class*="AudioVideoLyrics-line-"]';

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function classifyText(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
      return null;
    }

    if (
      /\bthere was an error loading (the )?lyrics\b/.test(normalized)
      || /\berror loading (the )?lyrics\b/.test(normalized)
      || /\bcould not load (the )?lyrics\b/.test(normalized)
      || /\bcouldn't load (the )?lyrics\b/.test(normalized)
      || /\bfailed to load (the )?lyrics\b/.test(normalized)
      || /\blyrics failed to load\b/.test(normalized)
    ) {
      return STATUS_COPY['lyrics-load-error'];
    }

    if (
      /\b(current|this) (song|track) (does not|doesn't) have lyrics\b/.test(normalized)
      || /\bno lyrics (available|found)\b/.test(normalized)
      || /\bno lyrics for (this|the) (song|track)\b/.test(normalized)
      || /\blyrics (are )?not available\b/.test(normalized)
      || /\blyrics unavailable\b/.test(normalized)
    ) {
      return STATUS_COPY['lyrics-unavailable'];
    }

    return null;
  }

  function isVisibleElement(element) {
    if (!element || typeof element.getBoundingClientRect !== 'function') {
      return true;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasVisibleLyricText(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return false;
    }

    return Array.from(root.querySelectorAll(LYRICS_LINE_SELECTOR)).some((row) => {
      if (!isVisibleElement(row)) {
        return false;
      }

      const textElement = row.querySelector && row.querySelector('span');
      const text = textElement ? textElement.textContent : row.textContent;
      return normalizeText(text).length > 0;
    });
  }

  function findLyricsStatus(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return null;
    }

    if (hasVisibleLyricText(root)) {
      return null;
    }

    const candidates = [];
    LYRICS_SURFACE_SELECTORS.forEach((selector) => {
      try {
        candidates.push(...root.querySelectorAll(selector));
      } catch (error) {
        // Selector support can vary slightly across extension targets.
      }
    });

    for (const candidate of candidates) {
      if (!isVisibleElement(candidate)) {
        continue;
      }

      const status = classifyText(candidate.textContent);
      if (status) {
        return status;
      }
    }

    return null;
  }

  function copyForStatus(status) {
    return STATUS_COPY[status] || null;
  }

  const api = Object.freeze({
    classifyText,
    copyForStatus,
    findLyricsStatus,
  });

  root.PlexLyricsStatus = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
