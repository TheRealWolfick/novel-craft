#!/bin/sh
# Build the local Arch package from this checkout and install it (pacman asks for your password).
# Usage: sh packaging/arch/build.sh [--no-install]
set -e
cd "$(dirname "$0")"
rm -rf pkg src
makepkg -f --cleanbuild
PKG="$(ls -t world-builder-*.pkg.tar.* | head -1)"
echo "Built packaging/arch/$PKG"
[ "$1" = "--no-install" ] || sudo pacman -U "$PKG"
