# Swift browser — Flathub packaging

This directory contains the Flathub submission for Swift 1.0.0. The manifest
downloads the official x86_64 and aarch64 release archives from the upstream
GitHub release and verifies them with pinned SHA256 checksums.

| File | Purpose |
| --- | --- |
| `com.swiftbrowser.Swift.yml` | flatpak-builder manifest with per-arch release archives |
| `com.swiftbrowser.Swift.desktop` | desktop launcher |
| `com.swiftbrowser.Swift.metainfo.xml` | AppStream metadata for Flathub and software centers |
| `swift-browser-wrapper` | executable installed to `/app/bin/swift-browser` |
| `icon-128.png`, `icon-256.png` | hicolor icons |
| `screenshot-*.png` | screenshots referenced by the metainfo |

Upstream: https://github.com/404henryyynotfound/swift-browser
Website: https://swift-browser.surge.sh
Editions: https://swift-tech.surge.sh
Release: https://github.com/404henryyynotfound/swift-browser/releases/tag/v1.0.0

When cutting a new release, update the URLs and `sha256` values in the manifest.
`scripts/update-flatpak-sha.sh` in the upstream repository can fill them from
`dist/swift-browser-linux-*.tar.gz`.
