# Swift editions

One codebase ships five official channels. Each edition gets its own Electron
profile, icon, defaults, version label and release artifacts, so you can run a
stable browser beside a nightly build without mixing data.

| Edition | ID | Purpose | Profile directory |
| --- | --- | --- | --- |
| Swift | `stable` | Full browser and app suite | `swift-browser` |
| Swift Lite | `lite` | Low-resource devices, Turbo on by default, Meet/AI/Drive hidden | `swift-lite` |
| Swift Enterprise | `enterprise` | Policy-locked privacy defaults and managed settings | `swift-enterprise` |
| Swift Beta | `beta` | Public preview with stricter fingerprint defaults | `swift-beta` |
| Swift Nightly / Canary | `nightly` | Bleeding-edge builds, separate profile, unstable warning | `swift-nightly` |
| Swift Developer | `developer` | DevTools-first build, optional remote debugging | `swift-developer` |

## Run an edition

```bash
npm start                       # stable
npm run start:lite
npm run start:enterprise
npm run start:beta
npm run start:nightly           # also: npm run start:canary
npm run start:developer
```

The selector also works directly:

```bash
SWIFT_EDITION=beta electron .
electron . --edition=canary
```

Unknown values fall back to stable. `canary` is an alias for `nightly`, and
`dev` is an alias for `developer`.

## Enterprise policy

Swift Enterprise reads `enterprise-policy.json` from its profile directory, or
from `SWIFT_ENTERPRISE_POLICY` if set. Any setting in the file is enforced and
cannot be changed in the UI.

```json
{
  "organization": "Example Org",
  "supportUrl": "https://intranet.example.com/swift-support",
  "settings": {
    "trackerBlocking": true,
    "thirdPartyCookies": false,
    "referrerPolicy": "none",
    "fingerprintLevel": "strict",
    "dnt": true
  }
}
```

## Developer remote debugging

Swift Developer does not open a debugging port by default. Set one explicitly
when you need automation:

```bash
SWIFT_DEVTOOLS_PORT=9333 npm run start:developer
```

Stable, Lite, Enterprise, Beta and Nightly never open a debugging port this way.

## Build release artifacts

Each edition has its own electron-builder config and artifact prefix.

```bash
npm run dist:lite:arm64
npm run dist:enterprise:x64
npm run dist:beta:arm64
npm run dist:nightly:x64
npm run dist:developer:arm64
```

Generic helper:

```bash
sh scripts/dist-edition.sh nightly arm64
```

All edition checks are covered by `npm run check`; edition selection logic has
unit tests in `lib/editions.test.js`.
