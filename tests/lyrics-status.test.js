const assert = require('node:assert/strict');
const test = require('node:test');

const lyricsStatus = require('../lyrics-status.js');

function createFakeElement(textContent = '', childrenBySelector = {}) {
  return {
    textContent,
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return childrenBySelector[selector] || [];
    },
    getBoundingClientRect() {
      return { width: 1, height: 1 };
    },
  };
}

test('classifies Plex lyric load errors separately from missing lyrics', () => {
  assert.equal(
    lyricsStatus.classifyText('There was an error loading the lyrics').status,
    'lyrics-load-error',
  );
});

test('classifies current-song lyric availability messages', () => {
  assert.equal(
    lyricsStatus.classifyText("Current Song doesn't have Lyrics").status,
    'lyrics-unavailable',
  );
});

test('does not treat a plain Lyrics label as a lyric failure', () => {
  assert.equal(lyricsStatus.classifyText('Lyrics'), null);
});

test('finds Plex lyric load errors in EmptyPage surfaces', () => {
  const emptyPageTitle = createFakeElement('There was an error loading the lyrics');
  const root = createFakeElement('', {
    '[class*="EmptyPage"]': [emptyPageTitle],
  });

  assert.equal(lyricsStatus.findLyricsStatus(root).status, 'lyrics-load-error');
});
