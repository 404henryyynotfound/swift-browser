#!/bin/sh
# Build one Swift edition for one Linux architecture.
# Usage: sh scripts/dist-edition.sh lite arm64
set -e

edition="$1"
arch="$2"
if [ -z "$edition" ] || [ -z "$arch" ]; then
  echo "Usage: sh scripts/dist-edition.sh <edition> <arch>" >&2
  exit 1
fi

config="electron-builder.${edition}.yml"
if [ ! -f "$config" ]; then
  echo "Missing ${config}" >&2
  exit 1
fi

SWIFT_EDITION="$edition" npx electron-builder --linux "--${arch}" -c "$config"
