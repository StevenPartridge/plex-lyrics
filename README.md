# Plex Lyrics PiP

WebExtension helper for Plex Music listeners who want Plex Web lyrics in a local Picture-in-Picture window.

Plex lyrics are useful, but the web player keeps them tied to the Plex tab. This extension adds a small `Lyrics PiP` button inside Plex Web and mirrors the lyrics Plex already shows into a portrait Picture-in-Picture window.

## Features

- Opens a focused lyrics Picture-in-Picture view from Plex Web.
- Keeps Plex's own lyrics panel open only while PiP is open.
- Mirrors Plex-provided timed or plain lyrics without fetching another source.
- Shows compact previous, play/pause, next, now-playing, and progress controls in PiP.
- Distinguishes no lyrics and Plex lyric load errors inside the PiP empty state.
- Stores only the last PiP viewport size as a local UI preference.
- Keeps the toolbar icon passive; there is no popup or background keep-open mode.

## Browser Support

Plex Lyrics PiP depends on the Document Picture-in-Picture API. The marketplace manifest targets:

- Chrome 116 or newer.
- Firefox 151 or newer, including compatible Firefox-based browsers where Document Picture-in-Picture is enabled.

The public marketplace build injects only on `https://app.plex.tv/*`. Self-hosted Plex URLs can be revisited later with an opt-in permission flow, but the default package stays narrow for store review.

## Installation

### Temporary Firefox Load

1. Open Firefox and go to `about:debugging`.
2. Click `This Firefox`.
3. Click `Load Temporary Add-on`.
4. Select this repository's `manifest.json`.

### Temporary Chrome Load

1. Open Chrome and go to `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this repository folder.

## Usage

1. Open Plex Web and start music playback.
2. Click the in-page `Lyrics PiP` button.
3. Leave PiP open while you want lyrics mirrored.
4. Close PiP when you are done.

## Manual Smoke Test

- Open PiP from the injected `Lyrics PiP` button: PiP should open after the trusted page click.
- Timed lyrics: the current Plex line should be highlighted and smoothly scrolled in PiP.
- Plain lyrics: the PiP should show the lyric sheet without implying live sync.
- No lyrics: the PiP should show `No lyrics for this song` and keep watching for the next track.
- Plex lyric load error: the PiP should show `Plex could not load lyrics`.
- Close PiP: Plex lyrics should stop being forced open.

## Privacy

Plex Lyrics PiP does not fetch lyrics, call external APIs, run analytics, or transmit listening data. Lyric text and track metadata stay in the current Plex page and PiP window. The only saved value is the last PiP viewport size, stored locally as a UI preference.

## Packaging

Run:

```sh
scripts/package-extension.sh all
```

The script writes Chrome and Firefox review zips under `build/marketplace/` and includes only the runtime files, icons, README, and license.
