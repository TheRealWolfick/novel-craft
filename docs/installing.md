---
title: Installing and the desktop app
group: Getting started
kind: guide
order: 1
blurb: Run World Builder as a desktop app, in your browser, or as a background service.
---
World Builder runs on your own computer and works on the notes in your Obsidian vault. Nothing is sent anywhere, except when you ask it to download a dataset from GitHub.

You need [Node.js](https://nodejs.org) 20 or newer and [git](https://git-scm.com).

## Getting the app

```
git clone https://github.com/TheRealWolfick/world-builder.git
cd world-builder
npm install
```

## Ways to run it

| Way | Start it with | Good for |
| --- | --- | --- |
| Desktop app (Arch Linux package) | `sh packaging/arch/build.sh`, then `world-builder` or your app launcher | Daily use: its own window, launcher entry, one copy at a time |
| Desktop app (any system) | `npx electron .` (or `npm run app` with a system Electron) | Trying the desktop app without packaging it |
| Browser | `npm start`, then open `http://127.0.0.1:4321` | Any system with Node, or another browser |
| Background service (Linux) | `sh scripts/install-service.sh --vault <folder>` | Always on, opened in a browser tab |

The desktop app runs the server inside its own window, on a free port only your computer can reach. It remembers its size, opens links to other sites in your normal browser, and asks before closing with unsaved changes.

> [!tip] On Hyprland or another tiling window manager, bind a key to `world-builder` to open it like any other app.

## Updating

```
git pull && npm install
```

Then restart the app. For the Arch package run `sh packaging/arch/build.sh` again: it builds the new version and installs it with `sudo pacman -U`.

## Next

[Choose your vault](docs:choosing-a-vault), then [import the starter data](docs:importing-data).
