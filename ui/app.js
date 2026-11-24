'use strict';

/* Swift browser chrome renderer. All privileged operations go through the
   narrow window.swift bridge; no page content ever touches this code. */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const call = (name, ...args) => window.swift.invoke(`swift:${name}`, ...args);
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const NEW_TAB = 'swift://newtab';
const QUICK_LINKS = [
  { title: 'DuckDuckGo', url: 'https://duckduckgo.com', glyph: 'D', c1: '#de5833', c2: '#f5a524' },
  { title: 'Wikipedia', url: 'https://wikipedia.org', glyph: 'W', c1: '#9ca3af', c2: '#e5e7eb' },
  { title: 'GitHub', url: 'https://github.com', glyph: 'G', c1: '#6366f1', c2: '#a855f7' },
  { title: 'MDN', url: 'https://developer.mozilla.org', glyph: 'M', c1: '#22d3ee', c2: '#3b82f6' },
  { title: 'Archive', url: 'https://archive.org', glyph: 'A', c1: '#34d399', c2: '#22d3ee' },
  { title: 'Surge', url: 'https://surge.sh', glyph: 'S', c1: '#c084fc', c2: '#f472b6' }
];
const TIPS = [
  'Swift blocks known trackers before they load — no remote lists, no phone-home.',
  'Tabs you leave alone go to sleep after five minutes, freeing memory without losing your place.',
  'Fingerprint defenses hand every site the same boring hardware story.',
  'DuckDuckGo is the default search engine. Change it in Settings without giving up privacy.',
  'Incognito tabs use a throwaway session that disappears when Swift closes.'
];

const state = {
  tabs: [], activeId: null, settings: {}, stats: null, version: '',
  bookmarks: [], history: [], panel: null, findVisible: false,
  suggestionIndex: -1, suggestions: [], tipIndex: 0,
  apps: [], auth: null, edition: null
};

const activeTab = () => state.tabs.find((tab) => tab.id === state.activeId) || null;

function prettyUrl(url) {
  if (!url || url === NEW_TAB) return '';
  return String(url).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function toast(message, icon = 'i-check') {
  const el = $('#toast');
  el.innerHTML = `<svg><use href="#${icon}"/></svg><span>${esc(message)}</span>`;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function renderTabs() {
  const container = $('#tabs');
  const grouped = state.settings.groupTabsByApp !== false;
  let lastGroup = null;
  container.innerHTML = state.tabs.map((tab) => {
    const key = tab.appId || 'web';
    let group = '';
    if (grouped && key !== lastGroup) {
      const meta = state.apps.find((item) => item.id === key);
      group = `<span class="tab-group" title="Tabs grouped by app"><b>${esc(meta ? meta.name : 'Web')}</b></span>`;
      lastGroup = key;
    }
    const icon = state.apps.find((item) => item.id === tab.appId);
    const favicon = tab.favicon
      ? `<span class="tab-favicon"><img src="${esc(tab.favicon)}" alt=""></span>`
      : `<span class="tab-favicon"${icon ? ` style="color:${esc(icon.color)}"` : ''}>${esc(icon ? icon.icon : ((tab.host || 'S').slice(0, 1).toUpperCase()))}</span>`;
    const meta = tab.sleeping ? '💤' : (tab.loadMs ? `${tab.loadMs}ms` : '');
    return `${group}<div class="tab${tab.id === state.activeId ? ' active' : ''}${tab.loading ? ' loading' : ''}${tab.privateTab ? ' private' : ''}"
      data-tab="${esc(tab.id)}" role="tab" aria-selected="${tab.id === state.activeId}" title="${esc(tab.title)} — ${esc(tab.url)}">
      ${favicon}<span class="tab-title">${esc(tab.title)}</span>${meta ? `<span class="tab-meta">${meta}</span>` : ''}
      <button class="tab-close" data-close="${esc(tab.id)}" aria-label="Close tab"><svg><use href="#i-close"/></svg></button>
    </div>`;
  }).join('');
}

function renderRail() {
  const rail = $('#rail-apps');
  if (!rail) return;
  rail.innerHTML = state.apps.map((item) => {
    const active = state.tabs.some((tab) => tab.appId === item.id && tab.id === state.activeId);
    return `<button class="rail-app${active ? ' active' : ''}${item.comingSoon ? ' soon' : ''}"
      data-app="${esc(item.id)}" data-name="${esc(item.name)}" title="${esc(item.name)}"
      style="color:${esc(item.color)}" ${item.comingSoon ? 'disabled' : ''} aria-label="Open ${esc(item.name)}">${esc(item.icon)}</button>`;
  }).join('');
  const chip = $('#rail-account');
  if (chip) {
    const label = state.auth && state.auth.signedIn ? state.auth.name.slice(0, 1).toUpperCase() : '?';
    chip.querySelector('.rail-avatar').textContent = label;
    chip.title = state.auth && state.auth.signedIn ? `Swift ID · ${state.auth.email}` : 'Sign in with Swift ID';
  }
  document.body.classList.toggle('without-rail', state.settings.showSidebar === false);
}

function renderNewTabApps() {
  const box = $('#nt-apps');
  if (!box) return;
  box.innerHTML = state.apps.map((item) => `<button class="nt-app${item.comingSoon ? ' soon' : ''}" data-app="${esc(item.id)}" ${item.comingSoon ? 'disabled' : ''} title="${esc(item.tagline)}">
    <span class="glyph" style="background:${esc(item.color)}">${esc(item.icon)}</span><span>${esc(item.name.replace('Swift ', ''))}</span>
  </button>`).join('');
}

function renderOmnibox() {
  const tab = activeTab();
  const address = $('#address');
  const isNewTab = !tab || tab.url === NEW_TAB;
  address.value = isNewTab ? '' : tab.url;
  address.placeholder = isNewTab ? 'Search privately or enter an address' : prettyUrl(tab.url);
  $('#newtab').classList.toggle('visible', isNewTab);
  $('#bookmark-toggle').classList.toggle('on', !isNewTab && state.bookmarks.some((b) => b.url === tab.url));
  $('#go-back').disabled = !tab || isNewTab;
  $('#go-forward').disabled = !tab || isNewTab;
  $('#reload').disabled = !tab || isNewTab;
  const blocked = state.stats && state.stats.stats ? state.stats.stats.blocked : 0;
  const badge = $('#shield-count');
  badge.hidden = !blocked;
  badge.textContent = blocked > 99 ? '99+' : String(blocked);
  $('#shield').title = `${blocked} trackers blocked this session — open privacy dashboard`;
}

function renderQuickLinks() {
  const items = state.bookmarks.slice(0, 6).map((b, index) => ({
    title: b.title || hostOf(b.url), url: b.url,
    glyph: (b.title || 'S').slice(0, 1).toUpperCase(),
    c1: index % 2 ? '#6366f1' : '#22d3ee', c2: index % 2 ? '#c084fc' : '#3b82f6'
  }));
  const fallback = QUICK_LINKS.slice(0, Math.max(0, 6 - items.length));
  const links = items.concat(fallback).slice(0, 6);
  $('#nt-links').innerHTML = links.map((item, index) => `
    <button class="quick-link" data-url="${esc(item.url)}">
      <span class="quick-glyph" style="--c1:${esc(item.c1)};--c2:${esc(item.c2)}">${esc(item.glyph)}</span>
      <span>${esc(item.title)}</span>
    </button>`).join('');
}

function hostOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return String(value || ''); }
}

function privacyScore() {
  const s = state.settings;
  let score = 0;
  if (s.trackerBlocking) score += 25;
  if (s.fingerprintLevel === 'strict') score += 30;
  else if (s.fingerprintLevel === 'balanced') score += 22;
  if (s.httpsUpgrade) score += 15;
  if (s.dnt) score += 10;
  if (!s.thirdPartyCookies) score += 15;
  if (s.turbo) score += 5;
  return Math.min(100, score);
}

function renderScore() {
  const score = privacyScore();
  $('#score-ring').style.setProperty('--score', score);
  $('#score-value').textContent = score;
  $('#score-note').textContent = score >= 90 ? 'Fortress mode' : score >= 70 ? 'Strong defaults are on' : 'Check your settings';
  $('#tip-text').textContent = TIPS[state.tipIndex % TIPS.length];
}

function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function renderEdition() {
  const edition = state.edition;
  const badge = $('#edition-badge');
  if (!edition || !badge) return;
  document.title = edition.name;
  document.body.dataset.edition = edition.id;
  document.body.classList.toggle('edition-lite', edition.id === 'lite');
  document.body.classList.toggle('edition-nightly', edition.id === 'nightly');
  badge.textContent = edition.badge || edition.shortName;
  badge.hidden = edition.id === 'stable';
  badge.title = `${edition.channel} channel · ${edition.version}`;
  badge.style.setProperty('--edition-color', edition.color || '#22d3ee');
}

function renderAll() {
  renderEdition();
  renderTabs();
  renderRail();
  renderNewTabApps();
  renderOmnibox();
  renderQuickLinks();
  renderScore();
  updateClock();
}

/* ---------- panels ---------- */

function toggleRow(key, title, description, checked) {
  const locked = !!(state.edition && (state.edition.lockedSettings || []).includes(key));
  return `<div class="setting">
    <div class="setting-info"><strong>${esc(title)}</strong><span>${locked ? 'Managed by your organisation · ' : ''}${esc(description)}</span></div>
    <button class="toggle${checked ? ' on' : ''}" data-toggle="${key}" role="switch" aria-checked="${checked}" aria-label="${esc(title)}"${locked ? ' disabled title="Managed by policy"' : ''}></button>
  </div>`;
}

function barRows(groups, total) {
  const entries = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<div class="empty"><strong>Nothing blocked yet</strong>Open a page and watch the counter move.</div>';
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  return `<div class="bar-list">${entries.slice(0, 7).map(([name, count]) => `
    <div class="bar-row"><span class="bar-name">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((count / max) * 100)}%"></span></span>
      <span class="bar-value">${count}</span></div>`).join('')}</div>`;
}

function panelPrivacy() {
  const p = state.stats || { stats: { blocked: 0, saved: 0, byDomain: {}, byCategory: {} }, recent: [], labels: {} };
  const s = state.settings;
  const log = p.recent.slice(0, 10).map((entry) => `<div class="log-item">
    <span class="dot" style="background:${entry.category === 'ads' ? '#fbbf24' : entry.category === 'analytics' ? '#22d3ee' : '#c084fc'}"></span>
    <span class="domain">${esc(entry.domain)}</span><span class="category">${esc(p.labels[entry.category] || 'Tracker')}</span>
    <time>${new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>`).join('');
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-shield"/></svg></div>
      <div><h2>Privacy dashboard</h2><p>Everything Swift stopped, right here on your device.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body">
      <div class="panel-section"><div class="stat-grid">
        <div class="stat cyan"><strong>${p.stats.blocked || 0}</strong><span>trackers blocked</span></div>
        <div class="stat violet"><strong>${Object.keys(p.stats.byDomain || {}).length}</strong><span>unique domains</span></div>
        <div class="stat green"><strong>${p.stats.saved || 0}</strong><span>resources skipped in Turbo</span></div>
      </div></div>
      <div class="panel-section"><h3>Blocked by category</h3>${barRows(p.stats.byCategory || {}, p.stats.blocked)}</div>
      <div class="panel-section"><h3>Top blocked domains</h3>${barRows(p.stats.byDomain || {}, p.stats.blocked)}</div>
      <div class="panel-section"><h3>Recent activity</h3><div class="log-list">${log || '<div class="empty">No blocked requests yet.</div>'}</div></div>
      <div class="panel-section"><h3>Protection</h3><div class="setting-list">
        ${toggleRow('trackerBlocking', 'Tracker & ad blocking', 'Blocks third-party ad, analytics and tracking requests from a bundled list.', s.trackerBlocking)}
        ${toggleRow('dnt', 'Global Privacy Control', 'Sends DNT and Sec-GPC headers asking sites not to sell your data.', s.dnt)}
        ${toggleRow('httpsUpgrade', 'Automatic HTTPS', 'Upgrades plain HTTP addresses to HTTPS whenever possible.', s.httpsUpgrade)}
        ${toggleRow('thirdPartyCookies', 'Allow third-party cookies', 'Off by default. Turning this on lets cross-site cookies through.', !!s.thirdPartyCookies)}
      </div></div>
      <div class="panel-section"><div class="row">
        <button class="btn" data-action="settings">Open all settings</button>
        <button class="btn danger" data-action="reset-stats"><svg><use href="#i-trash"/></svg>Reset counters</button>
      </div></div>
    </div>`;
}

function panelSettings() {
  const s = state.settings;
  const selectRow = (label, description, key, options) => `<div class="setting"><div class="setting-info"><strong>${esc(label)}</strong><span>${esc(description)}</span></div>
    <div class="setting-value"><select class="select-field" data-select="${key}">${options.map(([value, text]) =>
      `<option value="${esc(value)}"${s[key] === value ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></div></div>`;
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-bolt"/></svg></div>
      <div><h2>Settings</h2><p>Your choices stay on this device. No account, no sync, no telemetry.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body">
      <div class="panel-section"><h3>Privacy</h3><div class="setting-list">
        ${toggleRow('trackerBlocking', 'Block trackers and ads', 'Third-party requests from known trackers never reach the network.', s.trackerBlocking)}
        ${selectRow('Fingerprint defense', 'Balanced masks common identifiers. Strict also adds canvas and timer noise.', 'fingerprintLevel', [['off', 'Off'], ['balanced', 'Balanced'], ['strict', 'Strict']])}
        ${toggleRow('httpsUpgrade', 'Upgrade to HTTPS', 'Try the encrypted version of every HTTP page.', s.httpsUpgrade)}
        ${toggleRow('dnt', 'Do Not Track / GPC', 'Ask sites not to track or sell your browsing data.', s.dnt)}
        ${toggleRow('thirdPartyCookies', 'Allow third-party cookies', 'Off keeps cookies scoped to the site you are visiting.', !!s.thirdPartyCookies)}
        ${selectRow('Referrer headers', 'Strict removes the referring address from cross-site requests.', 'referrerPolicy', [['strict', 'Strict (recommended)'], ['none', 'Remove always'], ['normal', 'Normal']])}
      </div></div>
      <div class="panel-section"><h3>Speed</h3><div class="setting-list">
        ${toggleRow('turbo', 'Turbo mode', 'Skip third-party images and media on slow or metered connections.', s.turbo)}
        ${toggleRow('tabSleeping', 'Sleep background tabs', 'Inactive tabs release their memory and reload when you return.', s.tabSleeping)}
        ${selectRow('Sleep after', 'How long a tab stays untouched before it sleeps.', 'sleepAfterMs', [['60000', '1 minute'], ['300000', '5 minutes'], ['900000', '15 minutes']])}
      </div></div>
      <div class="panel-section"><h3>General</h3><div class="setting-list">
        ${selectRow('Search engine', 'Used for anything that is not a web address.', 'searchEngine', [['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search'], ['startpage', 'Startpage'], ['google', 'Google']])}
        ${toggleRow('showHomeButton', 'Show home button', 'The house icon in the toolbar opens a fresh tab.', s.showHomeButton)}
        ${toggleRow('showSidebar', 'Swift apps sidebar', 'Keep all twelve Swift apps one click away while you browse.', s.showSidebar !== false)}
        ${toggleRow('groupTabsByApp', 'Group tabs by app', 'Add a label when neighbouring tabs belong to the same Swift app.', s.groupTabsByApp !== false)}
      </div></div>
      <div class="panel-section"><h3>Your data</h3><div class="row">
        <button class="btn" data-action="export"><svg><use href="#i-download"/></svg>Export data</button>
        <button class="btn danger" data-action="clear-site-data">Clear site data</button>
        <button class="btn danger" data-action="clear-history">Clear history</button>
      </div><p style="color:var(--faint);font-size:11px;line-height:1.5;margin-top:12px">Swift ${esc(state.version)} · Local profile · Nothing is uploaded anywhere.</p></div>
    </div>`;
}

function entryList(entries, kind) {
  if (!entries.length) return '<div class="empty"><strong>Nothing here yet</strong>Items you save or visit will appear here.</div>';
  return `<div class="entry-list">${entries.map((entry) => `<div class="entry" data-url="${esc(entry.url)}">
    <span class="quick-glyph" style="--c1:#22d3ee;--c2:#6366f1;width:26px;height:26px;font-size:10px">${esc((entry.title || 'S').slice(0, 1).toUpperCase())}</span>
    <span class="entry-main"><strong>${esc(entry.title || hostOf(entry.url))}</strong><span>${esc(entry.url)}${entry.time ? ` · ${new Date(entry.time).toLocaleString()}` : ''}</span></span>
    ${kind === 'bookmarks' ? `<button class="icon-btn" data-remove-bookmark="${esc(entry.url)}" aria-label="Remove bookmark"><svg><use href="#i-close"/></svg></button>` : ''}
  </div>`).join('')}</div>`;
}

function panelBookmarks() {
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-bookmark"/></svg></div>
      <div><h2>Bookmarks</h2><p>Saved locally in your Swift profile.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body">
      <div class="row" style="margin-bottom:16px">
        <input class="search-field" id="list-search" placeholder="Filter bookmarks" aria-label="Filter bookmarks">
        <button class="btn primary" data-action="add-bookmark"><svg><use href="#i-star"/></svg>Bookmark this page</button>
      </div>
      <div id="list-body">${entryList(state.bookmarks, 'bookmarks')}</div>
    </div>`;
}

function panelHistory() {
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-history"/></svg></div>
      <div><h2>History</h2><p>The last thousand pages you visited, stored on this device.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body">
      <div class="row" style="margin-bottom:16px">
        <input class="search-field" id="list-search" placeholder="Filter history" aria-label="Filter history">
        <button class="btn danger" data-action="clear-history"><svg><use href="#i-trash"/></svg>Clear history</button>
      </div>
      <div id="list-body">${entryList(state.history.slice(0, 200), 'history')}</div>
    </div>`;
}

const COMMANDS = [
  { id: 'new-tab', label: 'New tab', icon: 'i-plus', key: 'Ctrl+T' },
  { id: 'private-tab', label: 'New private tab', icon: 'i-private', key: 'Ctrl+Shift+N' },
  { id: 'privacy', label: 'Open privacy dashboard', icon: 'i-shield', key: 'Ctrl+P' },
  { id: 'settings', label: 'Open settings', icon: 'i-bolt', key: '' },
  { id: 'bookmarks', label: 'Open bookmarks', icon: 'i-bookmark', key: 'Ctrl+D' },
  { id: 'history', label: 'Open history', icon: 'i-history', key: '' },
  { id: 'add-bookmark', label: 'Bookmark this page', icon: 'i-star', key: '' },
  { id: 'sleep-tab', label: 'Put this tab to sleep', icon: 'i-sleep', key: '' },
  { id: 'turbo', label: 'Toggle Turbo mode', icon: 'i-bolt', key: '' },
  { id: 'find', label: 'Find in page', icon: 'i-find', key: 'Ctrl+F' },
  { id: 'clear-site-data', label: 'Clear site data', icon: 'i-trash', key: '' },
  { id: 'export', label: 'Export Swift data', icon: 'i-download', key: '' },
  { id: 'about', label: 'About Swift', icon: 'i-shield', key: '' }
];

function panelPalette() {
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-bolt"/></svg></div>
      <div><h2>Command palette</h2><p>Type a command and press Enter.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body">
      <input class="palette-search" id="palette-input" placeholder="Search commands…" aria-label="Search commands" autocomplete="off">
      <div id="command-list" style="margin-top:14px"></div>
    </div>`;
}

function panelMenu() {
  const button = (id, label, icon) => `<button class="command" data-command="${id}"><svg><use href="#${icon}"/></svg>${esc(label)}</button>`;
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-menu"/></svg></div>
      <div><h2>Swift menu</h2><p>Everything in one place.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body"><div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
      ${button('new-tab', 'New tab', 'i-plus')}${button('private-tab', 'Private tab', 'i-private')}
      ${button('privacy', 'Privacy dashboard', 'i-shield')}${button('settings', 'Settings', 'i-bolt')}
      ${button('duplicate-tab', 'Duplicate tab', 'i-plus')}${button('sleep-tab', 'Sleep tab', 'i-sleep')}
      ${button('find', 'Find in page', 'i-find')}${button('zoom-in', 'Zoom in', 'i-search')}
      ${button('zoom-out', 'Zoom out', 'i-minus')}${button('zoom-reset', 'Reset zoom', 'i-check')}
      ${button('fullscreen', 'Toggle fullscreen', 'i-max')}${button('devtools', 'Developer tools', 'i-menu')}
      ${button('export', 'Export data', 'i-download')}${button('about', 'About Swift', 'i-shield')}
    </div></div>`;
}

function panelAbout() {
  return `<div class="panel-head"><div class="head-icon"><svg><use href="#i-shield"/></svg></div>
      <div><h2>About Swift</h2><p>Built for speed. Designed for privacy.</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close"><svg><use href="#i-close"/></svg></button></div>
    <div class="panel-body"><div class="about-hero">
      <svg viewBox="0 0 64 64" aria-hidden="true"><use href="#swift-mark"/></svg>
      <h3>${esc(state.edition ? state.edition.name : 'Swift')} ${esc(state.edition ? state.edition.version : state.version)}</h3><p>${esc(state.edition ? state.edition.channel : 'Stable')} channel · Move fast. Leave nothing behind.</p>
      <p style="margin-top:18px"><span class="badge">No telemetry</span> <span class="badge">Local data</span> <span class="badge">Open defaults</span></p>
    </div>
    <div class="panel-section"><h3>Take it with you</h3><div class="row">
      <button class="btn" data-action="external" data-url="https://swift-tech.surge.sh"><svg><use href="#i-external"/></svg>Swift Technologies</button>
      <button class="btn" data-action="external" data-url="https://swift-browser.surge.sh"><svg><use href="#i-external"/></svg>Website</button>
      <button class="btn" data-action="external" data-url="https://github.com/404henryyynotfound/swift-browser"><svg><use href="#i-external"/></svg>Source</button>
    </div></div>
    <div class="panel-section"><p style="color:var(--faint);line-height:1.6;font-size:12px">Swift uses the Chromium rendering engine through Electron. It blocks known third-party trackers with a bundled list, masks common fingerprinting surfaces, upgrades connections to HTTPS where possible, and never sends your browsing data to a Swift server. Privacy is a default, not a setting.</p></div>
    </div>`;
}

function commandList() {
  return COMMANDS.concat(state.apps.map((item) => ({
    id: `app:${item.id}`,
    label: `Open ${item.name}`,
    icon: 'i-bolt',
    key: item.comingSoon ? 'Soon' : ''
  })));
}

const PANELS = {
  privacy: panelPrivacy, settings: panelSettings, bookmarks: panelBookmarks,
  history: panelHistory, palette: panelPalette, menu: panelMenu, about: panelAbout
};

async function openPanel(name) {
  if (!PANELS[name]) return;
  if (state.panel) await closePanel(true);
  state.panel = name;
  $('#panel').innerHTML = PANELS[name]();
  $('#overlay').hidden = false;
  $('#panel').setAttribute('aria-label', `${name} panel`);
  await call('panel', true);
  if (name === 'palette') {
    $('#palette-input').value = '';
    renderCommands();
    $('#palette-input').focus();
  }
  if (name === 'bookmarks' || name === 'history') $('#list-search').focus();
}

async function closePanel(switching = false) {
  if (!state.panel) return;
  state.panel = null;
  $('#overlay').hidden = true;
  $('#panel').innerHTML = '';
  if (!switching) await call('panel', false);
}

async function refreshPanel() {
  if (state.panel && PANELS[state.panel]) $('#panel').innerHTML = PANELS[state.panel]();
}

/* ---------- suggestions, find, commands ---------- */

function buildSuggestions(query) {
  const needle = query.trim().toLowerCase();
  const results = [];
  if (needle) {
    const hits = state.history.concat(state.bookmarks).filter((item) =>
      (item.url || '').toLowerCase().includes(needle) || (item.title || '').toLowerCase().includes(needle));
    const seen = new Set();
    for (const hit of hits) {
      if (seen.has(hit.url)) continue;
      seen.add(hit.url);
      results.push({ label: hit.title || hostOf(hit.url), url: hit.url, kind: 'Visit' });
      if (results.length >= 5) break;
    }
    results.push({ label: `Search for “${query.trim()}”`, url: query.trim(), kind: 'Search' });
  }
  state.suggestions = results;
  state.suggestionIndex = -1;
  renderSuggestions();
}

function renderSuggestions() {
  const box = $('#suggestions');
  if (!state.suggestions.length || document.activeElement !== $('#address')) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = state.suggestions.map((item, index) => `<button class="suggestion${index === state.suggestionIndex ? ' selected' : ''}" data-suggestion="${index}">
    <svg><use href="#${item.kind === 'Search' ? 'i-search' : 'i-history'}"/></svg>
    <span>${esc(item.label)}</span><span style="margin-left:auto;color:var(--faint);font-size:10px">${esc(item.kind)}</span></button>`).join('');
}

function openFind() {
  state.findVisible = true;
  $('#findbar').hidden = false;
  $('#chrome').classList.add('finding');
  $('#find-input').focus();
  $('#find-input').select();
}

function closeFind() {
  state.findVisible = false;
  $('#findbar').hidden = true;
  $('#chrome').classList.remove('finding');
  call('find-stop');
}

async function runCommand(id) {
  await closePanel();
  if (id.startsWith('app:')) {
    const appId = id.slice(4);
    const meta = state.apps.find((item) => item.id === appId);
    if (meta && !meta.comingSoon) await call('new-tab', `swift://${appId}`);
    return;
  }
  switch (id) {
    case 'new-tab': { const tab = await call('new-tab'); if (tab) await call('activate-tab', tab); break; }
    case 'private-tab': { const tab = await call('new-private-window'); if (tab) await call('activate-tab', tab); toast('Private tab opened'); break; }
    case 'privacy': await openPanel('privacy'); break;
    case 'settings': await openPanel('settings'); break;
    case 'bookmarks': await openPanel('bookmarks'); break;
    case 'history': await openPanel('history'); break;
    case 'about': await openPanel('about'); break;
    case 'add-bookmark': {
      const tab = activeTab();
      if (tab && tab.url !== NEW_TAB) {
        await call('add-bookmark', { title: tab.title, url: tab.url });
        await refreshData();
        toast('Bookmark saved');
      } else toast('Open a page first', 'i-bookmark');
      break;
    }
    case 'sleep-tab': if (state.activeId) { await call('sleep-tab', state.activeId); toast('Tab put to sleep', 'i-sleep'); } break;
    case 'duplicate-tab': await call('duplicate-tab'); break;
    case 'turbo': {
      await call('set-setting', 'turbo', !state.settings.turbo);
      await refreshData();
      toast(`Turbo mode ${state.settings.turbo ? 'on' : 'off'}`, 'i-bolt');
      break;
    }
    case 'find': openFind(); break;
    case 'zoom-in': await call('zoom', 'in'); break;
    case 'zoom-out': await call('zoom', 'out'); break;
    case 'zoom-reset': await call('zoom', 'reset'); break;
    case 'fullscreen': await call('fullscreen'); break;
    case 'devtools': await call('devtools'); break;
    case 'clear-site-data': await call('clear-site-data'); toast('Site data cleared'); break;
    case 'export': {
      const done = await call('export-data');
      toast(done ? 'Data exported' : 'Export cancelled', done ? 'i-check' : 'i-close');
      break;
    }
    default: break;
  }
}

async function refreshData() {
  const [s, bookmarks, history, privacy] = await Promise.all([
    call('state'), call('bookmarks'), call('history'), call('privacy-stats')
  ]);
  state.tabs = s.tabs;
  state.activeId = s.activeId;
  state.settings = s.settings;
  state.bookmarks = bookmarks;
  state.history = history;
  state.stats = privacy;
  state.apps = s.apps || [];
  state.auth = s.auth || null;
  state.edition = s.edition || null;
  renderAll();
  if (state.panel) await refreshPanel();
}

/* ---------- events ---------- */

function bind() {
  $('#tabs').addEventListener('click', async (event) => {
    const close = event.target.closest('[data-close]');
    if (close) { event.stopPropagation(); await call('close-tab', close.dataset.close); return; }
    const tab = event.target.closest('[data-tab]');
    if (tab) await call('activate-tab', tab.dataset.tab);
  });
  $('#add-tab').addEventListener('click', async () => {
    const id = await call('new-tab');
    await call('activate-tab', id);
    $('#address').focus();
  });
  $('#go-home').addEventListener('click', async () => {
    const tab = activeTab();
    if (tab) await call('navigate', tab.id, NEW_TAB);
  });
  $('#go-back').addEventListener('click', () => call('back'));
  $('#go-forward').addEventListener('click', () => call('forward'));
  $('#reload').addEventListener('click', () => call('reload'));
  $('#win-min').addEventListener('click', () => call('minimize'));
  $('#win-max').addEventListener('click', () => call('maximize'));
  $('#win-close').addEventListener('click', () => call('close-window'));

  $('#address-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('#address').value.trim();
    const picked = state.suggestionIndex >= 0 ? state.suggestions[state.suggestionIndex] : null;
    if (state.activeId) await call('navigate', state.activeId, picked ? picked.url : query);
    $('#address').blur();
    $('#suggestions').hidden = true;
  });
  $('#address').addEventListener('focus', (event) => {
    event.target.select();
    buildSuggestions(event.target.value);
  });
  $('#address').addEventListener('input', (event) => buildSuggestions(event.target.value));
  $('#address').addEventListener('blur', () => setTimeout(() => { $('#suggestions').hidden = true; }, 160));
  $('#address').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && state.suggestions.length) {
      event.preventDefault();
      state.suggestionIndex = Math.min(state.suggestionIndex + 1, state.suggestions.length - 1);
      renderSuggestions();
    } else if (event.key === 'ArrowUp' && state.suggestions.length) {
      event.preventDefault();
      state.suggestionIndex = Math.max(state.suggestionIndex - 1, -1);
      renderSuggestions();
    } else if (event.key === 'Escape') {
      const tab = activeTab();
      $('#address').value = tab && tab.url !== NEW_TAB ? tab.url : '';
      $('#suggestions').hidden = true;
      $('#address').blur();
    }
  });
  $('#suggestions').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-suggestion]');
    if (!button) return;
    const picked = state.suggestions[Number(button.dataset.suggestion)];
    if (picked && state.activeId) await call('navigate', state.activeId, picked.url);
    $('#suggestions').hidden = true;
  });

  $('#shield').addEventListener('click', () => openPanel('privacy'));
  $('#open-privacy').addEventListener('click', () => openPanel('privacy'));
  $('#open-bookmarks').addEventListener('click', () => openPanel('bookmarks'));
  $('#open-history').addEventListener('click', () => openPanel('history'));
  $('#open-menu').addEventListener('click', () => openPanel('menu'));
  $('#open-find').addEventListener('click', openFind);
  $('#bookmark-toggle').addEventListener('click', async () => {
    const tab = activeTab();
    if (!tab || tab.url === NEW_TAB) return;
    await runCommand('add-bookmark');
  });

  $('#nt-search').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('#nt-input').value.trim();
    if (query && state.activeId) await call('navigate', state.activeId, query);
  });
  $('#nt-links').addEventListener('click', async (event) => {
    const link = event.target.closest('[data-url]');
    if (link && state.activeId) await call('navigate', state.activeId, link.dataset.url);
  });
  document.addEventListener('click', async (event) => {
    const app = event.target.closest('[data-app]');
    if (!app) return;
    const meta = state.apps.find((item) => item.id === app.dataset.app);
    if (!meta || meta.comingSoon) return;
    await call('new-tab', `swift://${app.dataset.app}`);
  });
  $('#toggle-rail').addEventListener('click', async () => {
    await call('set-setting', 'showSidebar', state.settings.showSidebar === false);
    await refreshData();
  });
  $('#rail-account').addEventListener('click', async () => {
    await call('new-tab', 'swift://id');
  });

  $('#find-input').addEventListener('input', () => call('find', $('#find-input').value, false));
  $('#find-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); call('find', $('#find-input').value, !event.shiftKey); }
  });
  $('#find-next').addEventListener('click', () => call('find', $('#find-input').value, true));
  $('#find-prev').addEventListener('click', () => call('find', $('#find-input').value, false));
  $('#find-close').addEventListener('click', closeFind);

  $('#panel').addEventListener('click', async (event) => {
    const command = event.target.closest('[data-command]');
    if (command) { await runCommand(command.dataset.command); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      const kind = action.dataset.action;
      if (kind === 'close') await closePanel();
      else if (kind === 'settings') await openPanel('settings');
      else if (kind === 'reset-stats') { await call('reset-stats'); await refreshData(); toast('Counters reset'); }
      else if (kind === 'clear-site-data') { await call('clear-site-data'); toast('Site data cleared'); }
      else if (kind === 'clear-history') { await call('clear-history'); await refreshData(); toast('History cleared'); }
      else if (kind === 'add-bookmark') await runCommand('add-bookmark');
      else if (kind === 'export') await runCommand('export');
      else if (kind === 'external') call('open-external', action.dataset.url);
      return;
    }
    const remove = event.target.closest('[data-remove-bookmark]');
    if (remove) {
      event.stopPropagation();
      await call('remove-bookmark', remove.dataset.removeBookmark);
      await refreshData();
      return;
    }
    const entry = event.target.closest('[data-url]');
    if (entry && state.activeId) {
      await closePanel();
      await call('navigate', state.activeId, entry.dataset.url);
      return;
    }
    const toggle = event.target.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      await call('set-setting', key, !state.settings[key]);
      await refreshData();
      return;
    }
    const commandRow = event.target.closest('.command[data-id]');
    if (commandRow) await runCommand(commandRow.dataset.id);
  });

  $('#panel').addEventListener('change', async (event) => {
    const select = event.target.closest('[data-select]');
    if (!select) return;
    const key = select.dataset.select;
    const value = key === 'sleepAfterMs' ? Number(select.value) : select.value;
    await call('set-setting', key, value);
    await refreshData();
  });

  $('#panel').addEventListener('input', (event) => {
    if (event.target.id === 'palette-input') renderCommands(event.target.value);
    if (event.target.id === 'list-search') filterEntries(event.target.value);
  });

  $('#panel').addEventListener('keydown', async (event) => {
    if (event.target.id !== 'palette-input') return;
    const rows = $$('#command-list .command');
    if (!rows.length) return;
    let index = rows.findIndex((row) => row.classList.contains('selected'));
    if (event.key === 'ArrowDown') { index = Math.min(index + 1, rows.length - 1); event.preventDefault(); }
    else if (event.key === 'ArrowUp') { index = Math.max(index - 1, 0); event.preventDefault(); }
    else if (event.key === 'Enter') {
      const selected = rows.find((row) => row.classList.contains('selected')) || rows[0];
      if (selected) await runCommand(selected.dataset.id);
      return;
    } else return;
    rows.forEach((row, i) => row.classList.toggle('selected', i === index));
    rows[index].scrollIntoView({ block: 'nearest' });
  });

  window.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape') {
      if (state.panel) closePanel();
      else if (state.findVisible) closeFind();
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      return;
    }
    if (mod && (event.key === 'f' || event.key === 'F')) { event.preventDefault(); openFind(); }
  });

  window.swift.on('swift:tabs', ({ tabs, activeId }) => {
    state.tabs = tabs;
    state.activeId = activeId;
    renderTabs();
    renderOmnibox();
  });
  window.swift.on('swift:stats', (payload) => {
    state.stats = payload;
    renderOmnibox();
    if (state.panel === 'privacy') refreshPanel();
  });
  window.swift.on('swift:settings', (next) => {
    state.settings = next;
    renderScore();
  });
  window.swift.on('swift:find-result', (result) => { $('#find-count').textContent = result.text || ''; });
  window.swift.on('swift:download', (download) => {
    if (download.state === 'started') toast(`Downloading ${download.name}`, 'i-download');
    else if (download.state === 'completed') toast(`Saved ${download.name}`, 'i-download');
    else if (download.state === 'cancelled' || download.state === 'interrupted') toast(`Download stopped: ${download.name}`, 'i-close');
  });
  window.swift.on('swift:focus-address', () => {
    if (state.findVisible) closeFind();
    const tab = activeTab();
    if (tab && tab.url === NEW_TAB) $('#nt-input').focus();
    else $('#address').focus();
  });
  window.swift.on('swift:open-panel', (name) => openPanel(name));
  window.swift.on('swift:auth-changed', async () => {
    await refreshData();
    toast('Swift ID updated', 'i-lock');
  });
}

function renderCommands(filter = '') {
  const needle = filter.trim().toLowerCase();
  const rows = commandList().filter((command) => command.label.toLowerCase().includes(needle));
  $('#command-list').innerHTML = rows.length ? rows.map((command, index) => `<button class="command${index === 0 ? ' selected' : ''}" data-id="${command.id}">
    <svg><use href="#${command.icon}"/></svg>${esc(command.label)}${command.key ? `<kbd>${esc(command.key)}</kbd>` : ''}</button>`).join('')
    : '<div class="empty"><strong>No matching commands</strong>Try “privacy”, “sleep” or “bookmark”.</div>';
}

function filterEntries(query) {
  const needle = query.trim().toLowerCase();
  $$('#list-body .entry').forEach((entry) => {
    entry.hidden = !!needle && !(entry.textContent || '').toLowerCase().includes(needle);
  });
}

async function boot() {
  bind();
  await refreshData();
  updateClock();
  setInterval(updateClock, 30000);
  setInterval(() => { state.tipIndex += 1; renderScore(); }, 12000);
  $('#nt-input').value = '';
}

boot().catch((error) => {
  console.error('[swift ui] boot failed', error);
  document.body.innerHTML = `<div style="padding:40px;color:#eaf0ff;font-family:sans-serif"><h1>Swift could not start</h1><pre>${esc(error && error.message ? error.message : error)}</pre></div>`;
});
