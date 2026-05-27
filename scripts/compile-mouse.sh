#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "Compiling mousecontrol (universal)..."
swiftc bin/mousecontrol.swift -target x86_64-apple-macosx10.15 -O -o bin/mousecontrol-x64
swiftc bin/mousecontrol.swift -target arm64-apple-macosx11.0  -O -o bin/mousecontrol-arm64
lipo -create bin/mousecontrol-x64 bin/mousecontrol-arm64 -output bin/mousecontrol
rm  bin/mousecontrol-x64 bin/mousecontrol-arm64
chmod +x bin/mousecontrol
echo "Done: bin/mousecontrol ($(file bin/mousecontrol | grep -o 'Mach-O.*'))"
