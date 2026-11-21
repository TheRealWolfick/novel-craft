---
title: Installing and the desktop app
group: Getting started
kind: guide
order: 1
blurb: Run Novel Craft as a desktop app, in your browser, or as a background service.
---
Novel Craft runs on your own computer and works on the notes in your Obsidian vault. Nothing is sent anywhere, except when you ask it to download a dataset from GitHub.

## Downloading the app

The simplest way: download the file for your system from the [latest release](https://github.com/TheRealWolfick/novel-craft/releases/latest).

- **Linux:** the `.AppImage` runs on any distribution (make it executable, then run it; it needs FUSE 2, e.g. `sudo apt install libfuse2` or `sudo pacman -S fuse2`, or start it with `--appimage-extract-and-run`). On Debian, Ubuntu and their relatives the `.deb` installs it with a launcher entry: `sudo apt install ./Novel-Craft-*.deb`.
- **Windows:** run the `.exe` installer. It isn't signed, so SmartScreen warns "Windows protected your PC": click **More info**, then **Run anyway**.
- **macOS:** open the `.dmg` (`arm64` for Apple silicon, `x64` for Intel) and drag Novel Craft to Applications. It isn't notarized by Apple, so the first start is refused: open **System Settings → Privacy & Security** and click **Open Anyway**.

> [!note] Claude Code needs Linux for now
> The AI assistant's Claude Code mode runs a terminal inside the app, which uses Linux tools. On Windows and macOS the option is greyed out; the Anthropic API, OpenAI and local models work everywhere. See [The AI assistant](docs:ai-assistant#connecting).

## Getting the source

To run it from the source code (any system), you need [Node.js](https://nodejs.org) 20 or newer and [git](https://git-scm.com).

```
git clone https://github.com/TheRealWolfick/novel-craft.git
cd novel-craft
npm install
```

## Ways to run it

| Way | Start it with | Good for |
| --- | --- | --- |
| Desktop app (Arch Linux package) | `sh packaging/arch/build.sh`, then `novel-craft` (or `world-builder`) or your app launcher | Daily use: its own window, launcher entry, one copy at a time |
| Desktop app (any system) | `npx electron .` (or `npm run app` with a system Electron) | Trying the desktop app without packaging it |
| Browser | `npm start`, then open `http://127.0.0.1:4321` | Any system with Node, or another browser |
| Background service (Linux) | `sh scripts/install-service.sh --vault <folder>` | Always on, opened in a browser tab |

The desktop app runs the server inside its own window, on a free port only your computer can reach. It remembers its size, opens links to other sites in your normal browser, and asks before closing with unsaved changes.

> [!tip] On Hyprland or another tiling window manager, bind a key to `novel-craft` to open it like any other app. Its window class is `novel-craft`.

## Updating

A downloaded app: install the new release's file over the old one. From source:

```
git pull && npm install
```

Then restart the app. For the Arch package run `sh packaging/arch/build.sh` again: it builds the new version and installs it with `sudo pacman -U`.

## Next

[Choose your vault](docs:choosing-a-vault), then [import the starter data](docs:importing-data).
