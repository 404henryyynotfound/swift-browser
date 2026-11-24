# Swift landing page

A single-page, static marketing site for **Swift**, a privacy-first desktop browser with a local-first app suite. No build step, no package manager, no frameworks, no CDN, and no external fonts. Everything works offline from the local files.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Semantic page markup, inline SVG logo sprite, sections and copy |
| `styles.css` | All styling, responsive layout, keyframes and reduced-motion rules |
| `app.js` | Raw WebGL hero field, scroll reveal, counters, nav, copy buttons |
| `favicon.svg` | Original Swift mark used as the site icon |
| `.surgeignore` | Keeps non-site files out of the deploy payload |

## Local preview

Serve this directory with Python's built-in HTTP server:

```sh
cd site
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Press `Ctrl+C` to stop the server.

You can also open `index.html` directly in a browser; the page works offline, though clipboard copying is limited outside a secure context (`localhost` counts as secure).

## Deploy

From the repository root:

```sh
surge ./site swift-browser.surge.sh
```

Surge may ask you to sign in the first time. Do not commit credentials or tokens to this directory.

## Notes

- The GitHub releases links point at `404henryyynotfound/swift-browser`; create the public repository and release before announcing the site. The snap name `swift-browser` is registered and the Flatpak app ID is `com.swiftbrowser.Swift`.
- The Apps section shows the twelve local apps shipped with the browser. Swift Mail is deliberately marked coming soon until a custom domain exists for `@swift.email` addresses.
- The animated numbers and the "live demo" panel are illustrative UI motion, not benchmarks or fabricated performance claims.
- The hero uses hand-written WebGL shaders. If WebGL is unavailable, a CSS gradient takes over. Motion is disabled for `prefers-reduced-motion`, when the tab is hidden, and when the hero is off-screen; device pixel ratio is capped to keep GPU memory bounded.
