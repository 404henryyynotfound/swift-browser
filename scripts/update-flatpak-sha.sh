#!/bin/sh
# Fill the Flatpak manifest with real checksums from dist/ release tarballs.
set -e
cd "$(dirname "$0")/.."

for pair in "x64:SHA256_X64" "arm64:SHA256_ARM64"; do
  arch=${pair%%:*}
  placeholder=${pair##*:}
  archive="dist/swift-browser-linux-${arch}.tar.gz"
  if [ ! -f "$archive" ]; then
    echo "Missing $archive — run npm run dist:linux-${arch} first" >&2
    exit 1
  fi
  sha=$(sha256sum "$archive" | cut -d' ' -f1)
  sed -i "s/${placeholder}/${sha}/" flatpak/com.swiftbrowser.Swift.yml
  echo "$arch -> $sha"
done
