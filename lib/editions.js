'use strict';

/* Swift editions/channels. One codebase, five official products. The edition
   is selected with SWIFT_EDITION or --edition=<id> before Electron starts. */

const EDITIONS = {
  stable: {
    id: 'stable',
    name: 'Swift',
    shortName: 'Swift',
    badge: '',
    channel: 'Stable',
    color: '#22d3ee',
    icon: 'icon.png',
    userDataSuffix: '',
    versionSuffix: '',
    homepage: 'https://swift-browser.surge.sh',
    disabledApps: [],
    lockedSettings: [],
    policies: false,
    defaults: {}
  },
  lite: {
    id: 'lite',
    name: 'Swift Lite',
    shortName: 'Lite',
    badge: 'LITE',
    channel: 'Lite',
    color: '#34d399',
    icon: 'icon-lite.png',
    userDataSuffix: 'swift-lite',
    versionSuffix: 'lite',
    homepage: 'https://swift-tech.surge.sh/#lite',
    disabledApps: ['meet', 'ai', 'drive'],
    lockedSettings: [],
    policies: false,
    defaults: {
      turbo: true,
      tabSleeping: true,
      sleepAfterMs: 60000,
      showSidebar: false,
      groupTabsByApp: false,
      fingerprintLevel: 'balanced'
    }
  },
  enterprise: {
    id: 'enterprise',
    name: 'Swift Enterprise',
    shortName: 'Enterprise',
    badge: 'ENTERPRISE',
    channel: 'Enterprise',
    color: '#818cf8',
    icon: 'icon-enterprise.png',
    userDataSuffix: 'swift-enterprise',
    versionSuffix: 'enterprise',
    homepage: 'https://swift-tech.surge.sh/#enterprise',
    disabledApps: [],
    lockedSettings: [
      'trackerBlocking', 'thirdPartyCookies', 'referrerPolicy', 'fingerprintLevel', 'dnt'
    ],
    policies: true,
    defaults: {
      trackerBlocking: true,
      thirdPartyCookies: false,
      referrerPolicy: 'none',
      fingerprintLevel: 'strict',
      httpsUpgrade: true,
      dnt: true,
      tabSleeping: false
    }
  },
  beta: {
    id: 'beta',
    name: 'Swift Beta',
    shortName: 'Beta',
    badge: 'BETA',
    channel: 'Beta',
    color: '#c084fc',
    icon: 'icon-beta.png',
    userDataSuffix: 'swift-beta',
    versionSuffix: 'beta.1',
    homepage: 'https://swift-tech.surge.sh/#beta',
    disabledApps: [],
    lockedSettings: [],
    policies: false,
    defaults: {
      fingerprintLevel: 'strict',
      groupTabsByApp: true
    }
  },
  nightly: {
    id: 'nightly',
    name: 'Swift Nightly',
    shortName: 'Nightly',
    badge: 'NIGHTLY',
    channel: 'Nightly / Canary',
    color: '#fb923c',
    icon: 'icon-nightly.png',
    userDataSuffix: 'swift-nightly',
    versionSuffix: 'nightly',
    homepage: 'https://swift-tech.surge.sh/#nightly',
    disabledApps: [],
    lockedSettings: [],
    policies: false,
    defaults: {
      turbo: true,
      tabSleeping: true,
      sleepAfterMs: 120000,
      fingerprintLevel: 'strict'
    }
  },
  developer: {
    id: 'developer',
    name: 'Swift Developer',
    shortName: 'Developer',
    badge: 'DEV',
    channel: 'Developer',
    color: '#2dd4bf',
    icon: 'icon-developer.png',
    userDataSuffix: 'swift-developer',
    versionSuffix: 'dev',
    homepage: 'https://swift-tech.surge.sh/#developer',
    disabledApps: [],
    lockedSettings: [],
    policies: false,
    remoteDebugging: true,
    defaults: {
      showSidebar: true,
      groupTabsByApp: true
    }
  }
};

function normalise(value) {
  const id = String(value == null ? '' : value).trim().toLowerCase();
  if (id === 'canary' || id === 'nightlycanary') return 'nightly';
  if (id === 'dev') return 'developer';
  return id;
}

function detectEdition(argv = process.argv, env = process.env) {
  const flagIndex = argv.findIndex((arg) => arg === '--edition');
  const flag = flagIndex >= 0 ? argv[flagIndex + 1] : null;
  const inline = argv.find((arg) => arg.startsWith('--edition='));
  const requested = inline ? inline.slice('--edition='.length) : flag || env.SWIFT_EDITION || 'stable';
  const id = normalise(requested);
  return EDITIONS[id] || EDITIONS.stable;
}

function visibleApps(meta, edition) {
  const disabled = new Set(edition.disabledApps || []);
  return meta.filter((item) => !disabled.has(item.id));
}

module.exports = { EDITIONS, detectEdition, visibleApps };
