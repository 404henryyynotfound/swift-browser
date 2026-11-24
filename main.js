'use strict';

/* Swift — main process. Owns tabs, browser sessions, privacy filtering and
   everything that the trusted chrome UI is allowed to ask for. */

const { app, BrowserWindow, BrowserView, ipcMain, session, shell, dialog, Menu, globalShortcut, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('./lib/store');
const { APP_META, APP_IDS, createAppsBackend } = require('./lib/swift-apps');
const { EDITIONS, detectEdition, visibleApps: visibleAppsForEdition } = require('./lib/editions');
const { classify, hostOf, CATEGORY_LABELS } = require('./privacy/blocklist');

const edition = detectEdition();
if (edition.userDataSuffix) {
  app.setPath('userData', path.join(app.getPath('userData'), edition.userDataSuffix));
}
if (edition.remoteDebugging && process.env.SWIFT_DEVTOOLS_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.SWIFT_DEVTOOLS_PORT));
}

const CHROME_HEIGHT = 100;
const NEW_TAB = 'swift://newtab';
const DEFAULTS = {
  trackerBlocking: true,
  fingerprintLevel: 'balanced', // off | balanced | strict
  httpsUpgrade: true,
  dnt: true,
  thirdPartyCookies: false,
  referrerPolicy: 'strict', // none | strict | normal
  turbo: false,
  tabSleeping: true,
  sleepAfterMs: 5 * 60 * 1000,
  searchEngine: 'duckduckgo',
  theme: 'aurora',
  showHomeButton: true,
  showSidebar: true,
  groupTabsByApp: true,
  customBlocked: [],
  allowedSites: []
};

const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
  startpage: 'https://www.startpage.com/sp/search?query=',
  google: 'https://www.google.com/search?q='
};

const NO_UPGRADE_HOSTS = new Set([
  'localhost', 'example.com', 'example.org', 'example.net', 'invalid', 'test'
]);

protocol.registerSchemesAsPrivileged([{
  scheme: 'swift',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: false }
}]);

function readEnterprisePolicy() {
  if (!edition.policies) return { organization: '', supportUrl: '', settings: {} };
  const file = process.env.SWIFT_ENTERPRISE_POLICY || path.join(app.getPath('userData'), 'enterprise-policy.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      organization: String(parsed.organization || ''),
      supportUrl: String(parsed.supportUrl || ''),
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    };
  } catch {
    return { organization: '', supportUrl: '', settings: {} };
  }
}

const enterprisePolicy = readEnterprisePolicy();
const store = new Store(path.join(app.getPath('userData'), 'swift-data.json'));
const settings = Object.assign({}, DEFAULTS, edition.defaults, store.get('settings', {}), enterprisePolicy.settings);
const lockedSettings = new Set([
  ...(edition.lockedSettings || []),
  ...Object.keys(enterprisePolicy.settings || {})
]);
const stats = Object.assign(
  { blocked: 0, saved: 0, byDomain: {}, byCategory: {} },
  store.get('stats', {})
);
const recentBlocks = [];
const upgradeFailures = new Set();
const tabs = new Map();
const visibleApps = visibleAppsForEdition(APP_META, edition);
const appsBackend = createAppsBackend(app.getPath('userData'), {
  meta: visibleApps,
  notify: (channel, payload) => {
    send(channel, payload);
    for (const tab of tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.send(channel, payload);
    }
  }
});
const authState = () => appsBackend.authState();

let mainWindow = null;
let activeTabId = null;
let nextTabId = 1;
let attachedViewId = null;
let sleepTimer = null;
let statsTimer = null;
let fullscreen = false;

const isPrivateTab = (tab) => !!(tab && tab.privateTab);
const activeTab = () => tabs.get(activeTabId) || null;

function appIdFromUrl(target) {
  try {
    const parsed = new URL(target);
    return parsed.protocol === 'swift:' ? parsed.hostname : null;
  } catch { return null; }
}

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'
};

function unavailableAppHtml(appId) {
  const meta = APP_META.find((item) => item.id === appId) || { name: `Swift ${appId}` };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${meta.name} — ${edition.name}</title><style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b16;color:#e7f0ff;font:15px/1.6 system-ui,-apple-system,sans-serif}
  main{max-width:520px;padding:36px;border:1px solid #1b2942;border-radius:18px;background:#0d1426}
  .badge{display:inline-block;padding:4px 10px;border-radius:999px;font-size:10px;letter-spacing:.14em;color:#070b16;font-weight:800;background:${edition.color}}
  h1{font-size:26px;margin:16px 0 8px}a{color:${edition.color}}
  </style></head><body><main><span class="badge">${edition.badge || edition.name}</span>
  <h1>${meta.name} is not included in ${edition.name}.</h1>
  <p>This edition keeps the browser lighter and focuses on a smaller set of tools. Switch to stable Swift for the full app suite.</p>
  <p><a href="swift://id">Open Swift ID</a> · <a href="${edition.homepage}">Compare editions</a></p>
  </main></body></html>`;
}

function appProtocolHandler(request, callback) {
  try {
    const parsed = new URL(request.url);
    if (parsed.pathname.startsWith('/ui/apps/')) {
      const root = path.resolve(__dirname, 'ui', 'apps');
      const filePath = path.resolve(root, parsed.pathname.slice('/ui/apps/'.length));
      if (!filePath.startsWith(root)) {
        return callback({ statusCode: 403, data: Buffer.from('Forbidden') });
      }
      return fs.readFile(filePath, (error, data) => {
        if (error) return callback({ statusCode: 404, data: Buffer.from('Not found') });
        callback({ mimeType: MIME_TYPES[path.extname(filePath)] || 'application/octet-stream', data });
      });
    }
    const appId = APP_IDS.includes(parsed.hostname) ? parsed.hostname : 'id';
    if ((edition.disabledApps || []).includes(appId)) {
      return callback({ mimeType: MIME_TYPES['.html'], data: Buffer.from(unavailableAppHtml(appId)) });
    }
    const template = fs.readFileSync(path.join(__dirname, 'ui', 'apps', 'app.html'), 'utf8');
    return callback({
      mimeType: MIME_TYPES['.html'],
      data: Buffer.from(template
        .replace('__APP_ID__', appId)
        .replace('__EDITION_LABEL__', edition.badge || edition.channel))
    });
  } catch (error) {
    callback({ statusCode: 400, data: Buffer.from(String(error.message || error)) });
  }
}

function registerAppProtocol() {
  for (const ses of [session.defaultSession, session.fromPartition('persist:swift'), session.fromPartition('swift-private')]) {
    ses.protocol.registerBufferProtocol('swift', appProtocolHandler);
  }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function searchUrl(query) {
  return (SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.duckduckgo) + encodeURIComponent(query);
}

function resolveUrl(input) {
  const value = String(input == null ? '' : input).trim();
  if (!value) return NEW_TAB;
  const appMatch = value.match(/^(?:swift:\/\/|swift:|@)([a-z]+)$/i);
  if (appMatch && APP_IDS.includes(appMatch[1].toLowerCase())) return `swift://${appMatch[1].toLowerCase()}`;
  if (/^(https?|file|ftp|about|data):/i.test(value)) return value;
  if (/^localhost(:\d+)?(\/|$)/i.test(value)) return `http://${value}`;
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/|$)/.test(value)) return `http://${value}`;
  if (/^[^\s]+\.[^\s]+$/.test(value) && !value.startsWith('.')) return `https://${value}`;
  return searchUrl(value);
}

function isCrossOrigin(requestUrl, initiator) {
  const host = hostOf(requestUrl);
  const source = hostOf(initiator);
  if (!host || !source) return !!source; // unknown initiator: treat as third party
  return host !== source && !host.endsWith(`.${source}`) && !source.endsWith(`.${host}`);
}

function recordBlock(domain, category, requestUrl) {
  stats.blocked += 1;
  stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;
  if (category) stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
  recentBlocks.unshift({ domain, category, url: requestUrl, time: Date.now() });
  if (recentBlocks.length > 40) recentBlocks.length = 40;
  store.set('stats', stats);
  if (!statsTimer) {
    statsTimer = setTimeout(() => {
      statsTimer = null;
      send('swift:stats', privacyStats());
    }, 400);
  }
}

function privacyStats() {
  return {
    stats,
    recent: recentBlocks.slice(0, 20),
    labels: CATEGORY_LABELS
  };
}

function configureSession(ses) {
  const userAgent = `Mozilla/5.0 (X11; Linux ${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36`;
  ses.setUserAgent(userAgent);

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    let parsed;
    try { parsed = new URL(details.url); } catch { return callback({}); }

    if (parsed.protocol === 'http:' && settings.httpsUpgrade &&
        !NO_UPGRADE_HOSTS.has(parsed.hostname) && !upgradeFailures.has(parsed.hostname) &&
        !/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) {
      return callback({ redirectURL: `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}` });
    }

    const initiator = details.initiator || details.referrer || '';
    const crossOrigin = isCrossOrigin(details.url, initiator);

    if (settings.trackerBlocking && crossOrigin) {
      const hit = classify(details.url, initiator);
      if (hit) {
        recordBlock(hit.domain, hit.category, details.url);
        return callback({ cancel: true });
      }
      const sourceHost = hostOf(initiator);
      const custom = (settings.customBlocked || []).map((h) => String(h).toLowerCase().replace(/^www\./, ''));
      if (sourceHost && custom.includes(parsed.hostname.toLowerCase().replace(/^www\./, ''))) {
        recordBlock(parsed.hostname, 'tracking', details.url);
        return callback({ cancel: true });
      }
    }

    if (settings.allowedSites && settings.allowedSites.includes(hostOf(initiator))) {
      return callback({});
    }

    if (settings.turbo && crossOrigin && ['image', 'media'].includes(details.resourceType)) {
      stats.saved += 1;
      return callback({ cancel: true });
    }

    return callback({});
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = details.requestHeaders || {};
    if (settings.dnt) {
      headers.DNT = '1';
      headers['Sec-GPC'] = '1';
    }
    const crossOrigin = isCrossOrigin(details.url, details.initiator || details.referrer || '');
    if (crossOrigin && !settings.thirdPartyCookies) delete headers.Cookie;
    if (settings.referrerPolicy === 'none') {
      delete headers.Referer;
    } else if (settings.referrerPolicy === 'strict' && crossOrigin) {
      delete headers.Referer;
    }
    callback({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (details, callback) => {
    const headers = details.responseHeaders || {};
    if (!settings.thirdPartyCookies && isCrossOrigin(details.url, details.initiator || '')) {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'set-cookie') delete headers[key];
      }
    }
    callback({ responseHeaders: headers });
  });

  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const blocked = new Set([
      'geolocation', 'notifications', 'camera', 'microphone', 'media',
      'midiSysex', 'background-sync', 'persistent-storage', 'idle-detection'
    ]);
    // Swift Meet needs local camera/mic access; websites do not get it by default.
    const isSwiftApp = String(webContents.getURL() || '').startsWith('swift://');
    if (isSwiftApp && (permission === 'camera' || permission === 'microphone')) {
      return callback(true);
    }
    callback(!blocked.has(permission));
  });

  ses.on('will-download', (event, item) => {
    const name = path.basename(item.getFilename() || 'download');
    const dir = app.getPath('downloads');
    let target = path.join(dir, name);
    if (fs.existsSync(target)) {
      target = path.join(dir, `${Date.now()}-${name}`);
    }
    item.setSavePath(target);
    send('swift:download', { name, state: 'started', path: target });
    item.once('done', (_event, state) => {
      send('swift:download', { name, state, path: target });
    });
  });
}

function contentConfig(href) {
  let allowed = false;
  try {
    const host = hostOf(href);
    allowed = !!(host && (settings.allowedSites || []).includes(host));
  } catch { /* ignore */ }
  return { level: settings.fingerprintLevel || 'off', allowed };
}

function tabList() {
  return Array.from(tabs.values()).map((tab) => ({
    id: tab.id,
    appId: tab.appId || null,
    title: tab.title || 'New tab',
    url: tab.url,
    host: tab.url === NEW_TAB ? '' : hostOf(tab.url),
    favicon: tab.favicon,
    loading: !!tab.loading,
    sleeping: !!tab.sleeping,
    privateTab: isPrivateTab(tab),
    blocked: tab.blocked || 0,
    loadMs: tab.loadMs || 0
  }));
}

function broadcastTabs() {
  send('swift:tabs', { tabs: tabList(), activeId: activeTabId });
}

function broadcastSettings() {
  send('swift:settings', settings);
}

async function fetchFavicon(tab, hrefs) {
  if (!hrefs || !hrefs.length) return;
  const href = hrefs.find((h) => /^https?:/i.test(h)) || hrefs[0];
  if (!href || /^data:/i.test(href)) {
    if (href) { tab.favicon = href; broadcastTabs(); }
    return;
  }
  try {
    const response = await fetch(href, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 512 * 1024) return;
    const image = nativeImageFromBuffer(buffer);
    if (!image) return;
    tab.favicon = image.resize({ width: 32, height: 32 }).toDataURL();
    broadcastTabs();
  } catch { /* favicons are cosmetic; never fail a page over one */ }
}

function nativeImageFromBuffer(buffer) {
  try {
    const { nativeImage } = require('electron');
    return nativeImage.createFromBuffer(buffer).isEmpty() ? null : nativeImage.createFromBuffer(buffer);
  } catch { return null; }
}

function setViewBounds(view) {
  if (!view || !mainWindow || mainWindow.isDestroyed()) return;
  const [width, height] = mainWindow.getContentSize();
  const top = fullscreen ? 0 : CHROME_HEIGHT;
  const rail = settings.showSidebar === false ? 0 : 72;
  view.setBounds({ x: rail, y: top, width: Math.max(1, width - rail), height: Math.max(1, height - top) });
}

function attachView(tab) {
  if (!mainWindow || !tab.view || tab.sleeping) return;
  if (attachedViewId && attachedViewId !== tab.id) {
    const previous = tabs.get(attachedViewId);
    if (previous && previous.view) mainWindow.removeBrowserView(previous.view);
  }
  if (!mainWindow.getBrowserViews().includes(tab.view)) mainWindow.addBrowserView(tab.view);
  attachedViewId = tab.id;
  setViewBounds(tab.view);
}

function detachView(tab) {
  if (mainWindow && tab.view && mainWindow.getBrowserViews().includes(tab.view)) {
    mainWindow.removeBrowserView(tab.view);
  }
  if (attachedViewId === tab.id) attachedViewId = null;
}

function sleepTab(tab) {
  if (!tab.view || tab.url === NEW_TAB) return;
  detachView(tab);
  try { tab.view.webContents.destroy(); } catch { /* already gone */ }
  tab.view = null;
  tab.sleeping = true;
  tab.loading = false;
  broadcastTabs();
}

function wireWebContents(tab, webContents) {
  webContents.on('did-start-loading', () => {
    tab.loading = true;
    tab.loadStarted = Date.now();
    tab.lastActive = Date.now();
    broadcastTabs();
  });

  webContents.on('did-stop-loading', () => {
    tab.loading = false;
    tab.loadMs = tab.loadStarted ? Date.now() - tab.loadStarted : 0;
    broadcastTabs();
  });

  webContents.on('page-title-updated', (_event, title) => {
    tab.title = title || hostOf(tab.url) || 'Untitled';
    broadcastTabs();
  });

  webContents.on('page-favicon-updated', (_event, favicons) => fetchFavicon(tab, favicons));

  webContents.on('did-navigate', (_event, navigatedUrl) => {
    tab.url = navigatedUrl;
    tab.appId = appIdFromUrl(navigatedUrl);
    tab.sleeping = false;
    const entry = { url: navigatedUrl, title: tab.title || hostOf(navigatedUrl), time: Date.now() };
    const history = store.get('history', []).filter((h) => h.url !== navigatedUrl);
    history.unshift(entry);
    store.set('history', history.slice(0, 1000));
    broadcastTabs();
  });

  webContents.on('did-navigate-in-page', (_event, navigatedUrl) => {
    if (navigatedUrl && navigatedUrl.startsWith('http')) tab.url = navigatedUrl;
    broadcastTabs();
  });

  webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    try {
      const failedHost = hostOf(failedUrl);
      if (failedHost && /ssl|certificate|tunnel|connection/i.test(errorDescription || '')) {
        upgradeFailures.add(failedHost);
        if (upgradeFailures.size > 100) upgradeFailures.delete(upgradeFailures.values().next().value);
      }
    } catch { /* ignore */ }
    send('swift:find-result', { text: errorDescription || 'Page could not be loaded', matches: 0 });
  });

  webContents.on('found-in-page', (_event, result) => {
    send('swift:find-result', { text: `${result.activeMatchOrdinal || 0}/${result.matches || 0}`, matches: result.matches || 0 });
  });

  webContents.on('will-navigate', (event, navigatedUrl) => {
    if (/^(mailto|tel|irc|magnet):/i.test(navigatedUrl)) {
      event.preventDefault();
      shell.openExternal(navigatedUrl).catch(() => {});
    }
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const child = createTab({ url, privateTab: isPrivateTab(tab) });
    activateTab(child.id);
    return { action: 'deny' };
  });

  webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.linkURL) {
      template.push(
        { label: 'Open link in new tab', click: () => { const t = createTab({ url: params.linkURL, privateTab: isPrivateTab(tab) }); activateTab(t.id); } },
        { label: 'Copy link address', click: () => require('electron').clipboard.writeText(params.linkURL) },
        { type: 'separator' }
      );
    }
    if (params.hasTextSelection) {
      template.push(
        { label: 'Copy', role: 'copy' },
        { label: `Search with ${settings.searchEngine === 'duckduckgo' ? 'DuckDuckGo' : 'Swift Search'}`, click: () => {
          const t = createTab({ url: searchUrl(params.selectionText), privateTab: isPrivateTab(tab) });
          activateTab(t.id);
        } },
        { type: 'separator' }
      );
    }
    template.push(
      { label: 'Back', enabled: webContents.canGoBack(), click: () => webContents.goBack() },
      { label: 'Forward', enabled: webContents.canGoForward(), click: () => webContents.goForward() },
      { label: 'Reload', role: 'reload' },
      { type: 'separator' },
      { label: 'Inspect element', click: () => webContents.openDevTools({ mode: 'detach' }) }
    );
    Menu.buildFromTemplate(template).popup();
  });
}

function attachViewToTab(tab, targetUrl) {
  if (tab.view) {
    tab.view.webContents.loadURL(targetUrl).catch(() => {});
    return;
  }
  const view = new BrowserView({
    webPreferences: {
      preload: targetUrl.startsWith('swift://')
        ? path.join(__dirname, 'apps-preload.js')
        : path.join(__dirname, 'preload.js'),
      partition: tab.privateTab ? 'swift-private' : 'persist:swift',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });
  view.setBackgroundColor('#0a0f1d');
  tab.view = view;
  wireWebContents(tab, view.webContents);
  if (tab.id === activeTabId) attachView(tab);
  view.webContents.loadURL(targetUrl).catch(() => {});
}

function createTab(options = {}) {
  const id = `t${nextTabId++}`;
  const targetUrl = options.url || NEW_TAB;
  const appMeta = APP_META.find((app) => app.id === appIdFromUrl(targetUrl));
  const tab = {
    id,
    url: targetUrl,
    appId: appMeta ? appMeta.id : null,
    title: targetUrl === NEW_TAB ? 'New tab' : (appMeta ? appMeta.name : hostOf(targetUrl)),
    favicon: null,
    loading: false,
    sleepUrl: null,
    sleeping: false,
    privateTab: !!options.privateTab,
    view: null,
    blocked: 0,
    loadStarted: 0,
    loadMs: 0,
    lastActive: Date.now()
  };
  tabs.set(id, tab);
  if (targetUrl !== NEW_TAB) attachViewToTab(tab, targetUrl);
  broadcastTabs();
  return tab;
}

function activateTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  const previous = activeTab();
  if (previous && previous.id !== id) previous.lastActive = Date.now();
  if (activeTabId && activeTabId !== id) {
    const old = tabs.get(activeTabId);
    if (old) detachView(old);
  }
  activeTabId = id;
  tab.lastActive = Date.now();
  if (tab.sleeping && tab.sleepUrl) {
    tab.sleeping = false;
    const target = tab.sleepUrl;
    tab.sleepUrl = null;
    attachViewToTab(tab, target);
  }
  if (tab.view && tab.url !== NEW_TAB) attachView(tab);
  broadcastTabs();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  detachView(tab);
  if (tab.view) {
    try { tab.view.webContents.destroy(); } catch { /* already destroyed */ }
  }
  tabs.delete(id);
  const order = Array.from(tabs.keys());
  if (activeTabId === id) {
    const next = order[0] || null;
    activeTabId = null;
    if (next) activateTab(next);
    else {
      const fresh = createTab();
      activateTab(fresh.id);
    }
  }
  broadcastTabs();
}

function navigateTab(id, input) {
  const tab = tabs.get(id || activeTabId);
  if (!tab) return;
  const target = resolveUrl(input);
  if (target === NEW_TAB) {
    detachView(tab);
    if (tab.view) {
      try { tab.view.webContents.destroy(); } catch { /* ignore */ }
      tab.view = null;
    }
    tab.url = NEW_TAB;
    tab.title = 'New tab';
    tab.favicon = null;
    tab.sleeping = false;
    broadcastTabs();
    return;
  }
  const meta = APP_META.find((item) => item.id === appIdFromUrl(target));
  tab.url = target;
  tab.appId = meta ? meta.id : null;
  tab.title = meta ? meta.name : hostOf(target);
  tab.favicon = null;
  tab.sleeping = false;
  tab.sleepUrl = null;
  attachViewToTab(tab, target);
  if (tab.id === activeTabId) attachView(tab);
  broadcastTabs();
}

function withActiveTab(handler) {
  const tab = activeTab();
  if (tab && tab.view && !tab.sleeping) return handler(tab.view.webContents, tab);
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 600,
    frame: false,
    backgroundColor: '#070b16',
    icon: path.join(__dirname, 'assets', edition.icon),
    title: edition.name,
    webPreferences: {
      preload: path.join(__dirname, 'ui-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.on('resize', () => {
    const tab = activeTab();
    if (tab) setViewBounds(tab.view);
  });
  mainWindow.on('maximize', () => { const tab = activeTab(); if (tab) setViewBounds(tab.view); });
  mainWindow.on('unmaximize', () => { const tab = activeTab(); if (tab) setViewBounds(tab.view); });
  mainWindow.on('closed', () => {
    mainWindow = null;
    attachedViewId = null;
  });

  const first = createTab();
  activateTab(first.id);
  broadcastSettings();
  send('swift:stats', privacyStats());
}

function registerShortcuts() {
  const register = (accelerator, handler) => {
    try { globalShortcut.register(accelerator, handler); } catch { /* unsupported on this platform */ }
  };
  register('CommandOrControl+T', () => { const t = createTab(); activateTab(t.id); send('swift:focus-address', {}); });
  register('CommandOrControl+W', () => { if (activeTabId) closeTab(activeTabId); });
  register('CommandOrControl+L', () => send('swift:focus-address', {}));
  register('CommandOrControl+R', () => withActiveTab((wc) => wc.reload()));
  register('CommandOrControl+K', () => send('swift:open-panel', 'palette'));
  register('CommandOrControl+P', () => send('swift:open-panel', 'privacy'));
  register('CommandOrControl+D', () => send('swift:open-panel', 'bookmarks'));
  register('CommandOrControl+Shift+N', () => { const t = createTab({ privateTab: true }); activateTab(t.id); });
  register('F11', () => {
    fullscreen = !fullscreen;
    if (mainWindow) mainWindow.setFullScreen(fullscreen);
    const tab = activeTab();
    if (tab) setTimeout(() => setViewBounds(tab.view), 120);
  });
}

function registerIpc() {
  appsBackend.registerIpc(ipcMain);
  ipcMain.on('swift:content-config', (event, href) => {
    event.returnValue = contentConfig(href);
  });

  ipcMain.handle('swift:state', () => ({
    tabs: tabList(),
    activeId: activeTabId,
    settings,
    apps: visibleApps,
    auth: authState(),
    edition: {
      ...edition,
      version: `${app.getVersion()}-${edition.versionSuffix}`.replace(/-$/, ''),
      lockedSettings: Array.from(lockedSettings),
      policy: {
        organization: enterprisePolicy.organization,
        supportUrl: enterprisePolicy.supportUrl
      }
    },
    version: app.getVersion(),
    platform: process.platform
  }));
  ipcMain.handle('swift:edition', () => edition);
  ipcMain.handle('swift:settings', () => settings);
  ipcMain.handle('swift:set-setting', (_event, key, value) => {
    if (!(key in DEFAULTS) || lockedSettings.has(key)) return false;
    settings[key] = value;
    store.set('settings', settings);
    broadcastSettings();
    if (key === 'showSidebar') {
      const tab = activeTab();
      if (tab) setViewBounds(tab.view);
    }
    return true;
  });
  ipcMain.handle('swift:new-tab', (_event, target) => {
    const tab = createTab({ url: target, privateTab: !!(activeTab() && activeTab().privateTab && target) });
    activateTab(tab.id);
    return tab.id;
  });
  ipcMain.handle('swift:close-tab', (_event, id) => closeTab(id));
  ipcMain.handle('swift:activate-tab', (_event, id) => activateTab(id));
  ipcMain.handle('swift:navigate', (_event, id, input) => navigateTab(id, input));
  ipcMain.handle('swift:back', () => withActiveTab((wc) => { if (wc.canGoBack()) wc.goBack(); }));
  ipcMain.handle('swift:forward', () => withActiveTab((wc) => { if (wc.canGoForward()) wc.goForward(); }));
  ipcMain.handle('swift:reload', () => withActiveTab((wc) => wc.reload()));
  ipcMain.handle('swift:stop', () => withActiveTab((wc) => wc.stop()));
  ipcMain.handle('swift:duplicate-tab', () => {
    const current = activeTab();
    if (!current) return null;
    const tab = createTab({ url: current.url, privateTab: isPrivateTab(current) });
    activateTab(tab.id);
    return tab.id;
  });
  ipcMain.handle('swift:privacy-stats', () => privacyStats());
  ipcMain.handle('swift:reset-stats', () => {
    stats.blocked = 0;
    stats.saved = 0;
    stats.byDomain = {};
    stats.byCategory = {};
    recentBlocks.length = 0;
    store.set('stats', stats);
    send('swift:stats', privacyStats());
    return true;
  });
  ipcMain.handle('swift:bookmarks', () => store.get('bookmarks', []));
  ipcMain.handle('swift:add-bookmark', (_event, entry) => {
    const bookmarks = store.get('bookmarks', []).filter((b) => b.url !== entry.url);
    bookmarks.unshift({ title: entry.title || hostOf(entry.url), url: entry.url, time: Date.now() });
    store.set('bookmarks', bookmarks.slice(0, 500));
    return bookmarks;
  });
  ipcMain.handle('swift:remove-bookmark', (_event, targetUrl) => {
    const bookmarks = store.get('bookmarks', []).filter((b) => b.url !== targetUrl);
    store.set('bookmarks', bookmarks);
    return bookmarks;
  });
  ipcMain.handle('swift:history', () => store.get('history', []));
  ipcMain.handle('swift:clear-history', () => { store.set('history', []); return true; });
  ipcMain.handle('swift:clear-site-data', async () => {
    await session.fromPartition('persist:swift').clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cache', 'websql', 'appcache'] });
    await session.fromPartition('swift-private').clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cache'] });
    upgradeFailures.clear();
    return true;
  });
  ipcMain.handle('swift:resolve-url', (_event, input) => resolveUrl(input));
  ipcMain.handle('swift:open-external', (_event, target) => {
    if (/^(https?|mailto):/i.test(String(target))) return shell.openExternal(target).then(() => true).catch(() => false);
    return false;
  });
  ipcMain.handle('swift:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.handle('swift:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.handle('swift:close-window', () => { if (mainWindow) mainWindow.close(); });
  ipcMain.handle('swift:fullscreen', () => {
    fullscreen = !fullscreen;
    if (mainWindow) mainWindow.setFullScreen(fullscreen);
    const tab = activeTab();
    if (tab) setTimeout(() => setViewBounds(tab.view), 120);
    return fullscreen;
  });
  ipcMain.handle('swift:find', (_event, query, forward) => {
    return withActiveTab((wc) => {
      try { wc.findInPage(query || '', { findNext: !!forward, forward: !!forward }); return true; }
      catch { return false; }
    }) || false;
  });
  ipcMain.handle('swift:find-stop', () => withActiveTab((wc) => wc.stopFindInPage('clearSelection')));
  ipcMain.handle('swift:zoom', (_event, direction) => withActiveTab((wc) => {
    const current = wc.getZoomLevel();
    const next = direction === 'reset' ? 0 : Math.max(-3, Math.min(3, current + (direction === 'in' ? 0.5 : -0.5)));
    wc.setZoomLevel(next);
    return next;
  }) || 0);
  ipcMain.handle('swift:devtools', () => withActiveTab((wc) => { wc.openDevTools({ mode: 'detach' }); return true; }));
  ipcMain.handle('swift:new-private-window', () => {
    const tab = createTab({ privateTab: true });
    activateTab(tab.id);
    return tab.id;
  });
  ipcMain.handle('swift:export-data', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Swift data',
      defaultPath: 'swift-data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify({ settings, stats, history: store.get('history', []), bookmarks: store.get('bookmarks', []) }, null, 2));
    return true;
  });
  ipcMain.handle('swift:version', () => app.getVersion());
  ipcMain.handle('swift:focus-address', () => { send('swift:focus-address', {}); return true; });
  ipcMain.handle('swift:frame', () => ({ fullscreen, chromeHeight: CHROME_HEIGHT }));
  ipcMain.handle('swift:panel', (_event, open) => {
    const tab = activeTab();
    if (!tab) return true;
    if (open) detachView(tab);
    else if (tab.view && tab.url !== NEW_TAB) attachView(tab);
    return true;
  });
  ipcMain.handle('swift:sleep-tab', (_event, id) => {
    const tab = tabs.get(id);
    if (!tab) return false;
    if (tab.sleeping && tab.sleepUrl) {
      const target = tab.sleepUrl;
      tab.sleepUrl = null;
      tab.sleeping = false;
      attachViewToTab(tab, target);
      if (tab.id === activeTabId) attachView(tab);
    } else {
      if (tab.id === activeTabId && tabs.size > 1) {
        const other = Array.from(tabs.keys()).find((key) => key !== tab.id);
        if (other) activateTab(other);
      }
      tab.sleepUrl = tab.url;
      sleepTab(tab);
    }
    return true;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('ready', () => {
    Menu.setApplicationMenu(null);
    registerAppProtocol();
    configureSession(session.fromPartition('persist:swift'));
    configureSession(session.fromPartition('swift-private'));
    registerIpc();
    createWindow();
    registerShortcuts();

    sleepTimer = setInterval(() => {
      const now = Date.now();
      for (const tab of tabs.values()) {
        if (!settings.tabSleeping || tab.id === activeTabId || !tab.view || tab.url === NEW_TAB || tab.loading) continue;
        if (now - tab.lastActive >= (settings.sleepAfterMs || 300000)) {
          tab.sleepUrl = tab.url;
          sleepTab(tab);
        }
      }
    }, 30000);
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('before-quit', () => {
    store.save();
    if (sleepTimer) clearInterval(sleepTimer);
    if (statsTimer) clearTimeout(statsTimer);
    globalShortcut.unregisterAll();
  });
}
