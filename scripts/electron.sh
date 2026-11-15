#!/bin/sh
# Run the app with the system's Electron (Arch: electronNN packages; the newest one installed wins).
ELECTRON="$(command -v electron 2>/dev/null || ls /usr/bin/electron[0-9]* 2>/dev/null | sort -V | tail -1)"
[ -n "$ELECTRON" ] || { echo "No Electron found: install one (e.g. pacman -S electron43)" >&2; exit 1; }
exec "$ELECTRON" --ozone-platform-hint=auto "$@"
