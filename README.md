# Plex Lyrics Companion

Firefox/WebExtension helper for Plex Music listeners who keep lyrics open on a side screen.

Plex does not always keep lyrics visible across track changes. This extension watches Plex Music, opens lyrics when they disappear during an active session, and pauses immediately when you close lyrics yourself.

## Features

- Keeps Plex Music lyrics open during an active session.
- Pauses when you manually close lyrics, so they do not reopen in a loop.
- Shows session state in the toolbar badge: `ON`, `PAUSE`, or `WAIT`.
- Uses a small Plex-native toast for important state changes.
- Opens or focuses Plex Web from the popup when Plex is not already ready.
- Replaces timer controls with a compact state-based popup.
- Uses Manifest V3 with cross-browser background registration.

## Installation

1. Clone or download this repository.
2. Open Firefox and go to `about:debugging`.
3. Click `This Firefox`.
4. Click `Load Temporary Add-on`.
5. Select this repository's `manifest.json`.

## Usage

1. Click the extension icon.
2. Click `Open Plex` if Plex Music is not already open.
3. Click `Keep lyrics open`.
4. Close lyrics manually any time to pause the companion.
5. Click `Resume lyrics` from the popup when you want automation back.

## Manual Smoke Test

- Start while Plex Music is open and lyrics are hidden: lyrics should open once and the badge should show `ON`.
- Manually close lyrics while active: lyrics should stay closed, the badge should show `PAUSE`, and the popup should say `Lyrics paused`.
- Resume after manual close: lyrics should open again and the session should return to active.
- Open the popup with no Plex tab: `Open Plex` should open Plex Web, then the session should continue once Plex loads.
