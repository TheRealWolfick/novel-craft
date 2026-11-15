#!/bin/sh
# Build the local Arch package from this checkout and install it (pacman asks for your password).
# Usage: sh packaging/arch/build.sh [--no-install]
# makepkg runs on a copy of the PKGBUILD in .build/ (it writes the version into it), so the checkout stays clean.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
export WB_REPO="$(cd "$HERE/../.." && pwd)"
rm -rf "$HERE/.build" && mkdir -p "$HERE/.build"
cp "$HERE/PKGBUILD" "$HERE/.build/"
cd "$HERE/.build"
makepkg -f --cleanbuild
PKG="$(ls -t world-builder-*.pkg.tar.* | head -1)"
mv "$PKG" "$HERE/"
cd "$HERE" && rm -rf .build
echo "Built packaging/arch/$PKG"
[ "$1" = "--no-install" ] || sudo pacman -U "$PKG"
