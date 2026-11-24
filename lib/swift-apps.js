'use strict';

/* Local-first backend for the Swift apps. Nothing here talks to a server:
   account credentials, app data and encrypted Drive files stay in userData. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Store = require('./store');

const APP_META = [
  { id: 'chat', name: 'Swift Chat', icon: '◈', color: '#22d3ee', tagline: 'Threads, not noise.' },
  { id: 'meet', name: 'Swift Meet', icon: '◎', color: '#a855f7', tagline: 'Meetings that summarize themselves.' },
  { id: 'ai', name: 'Swift AI', icon: '✦', color: '#6366f1', tagline: 'One answer across all your apps.' },
  { id: 'docs', name: 'Swift Docs', icon: '▤', color: '#38bdf8', tagline: 'Distraction-free blocks.' },
  { id: 'sheets', name: 'Swift Sheets', icon: '▦', color: '#34d399', tagline: 'Formulas meet live data.' },
  { id: 'decks', name: 'Swift Decks', icon: '▥', color: '#fbbf24', tagline: 'Outlines into slides.' },
  { id: 'notes', name: 'Swift Notes', icon: '✎', color: '#f472b6', tagline: 'Catch a thought in a second.' },
  { id: 'calendar', name: 'Swift Calendar', icon: '▣', color: '#60a5fa', tagline: 'Time, protected.' },
  { id: 'drive', name: 'Swift Drive', icon: '⬡', color: '#2dd4bf', tagline: 'Encrypted files, plain-English search.' },
  { id: 'tasks', name: 'Swift Tasks', icon: '✓', color: '#4ade80', tagline: 'Every action item, one list.' },
  { id: 'id', name: 'Swift ID', icon: '⬟', color: '#c084fc', tagline: 'One sign-in for everything.' },
  { id: 'mail', name: 'Swift Mail', icon: '✉', color: '#f87171', tagline: 'Coming soon.', comingSoon: true }
];

const APP_IDS = APP_META.map((item) => item.id);
const DATA_APPS = APP_IDS.filter((id) => id !== 'id' && id !== 'mail');

function blankData() {
  return {
    chat: { threads: [] },
    meet: { rooms: [], transcripts: [] },
    ai: { recent: [] },
    docs: { blocks: [], updated: 0 },
    sheets: { rows: [], connectors: [] },
    decks: { title: 'Untitled deck', outline: '', theme: 'aurora' },
    notes: { notes: [] },
    calendar: { events: [], booking: { slug: 'swift', duration: 30 } },
    drive: { files: [] },
    tasks: { tasks: [] }
  };
}

function uid(prefix = 'i') {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, max);
}

function hashPassword(password, salt, purpose, iterations = 210000) {
  return crypto.pbkdf2Sync(String(password), `${salt}:${purpose}`, iterations, 32, 'sha256');
}

function createAppsBackend(userDataPath, options = {}) {
  const store = new Store(path.join(userDataPath, 'swift-apps.json'));
  const authFile = path.join(userDataPath, 'swift-id.json');
  const driveDir = path.join(userDataPath, 'swift-drive');
  let account = null;
  let sessionKey = null; // in memory only — never persisted
  try { account = JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { /* no account */ }
  fs.mkdirSync(driveDir, { recursive: true });

  const data = Object.assign(blankData(), store.get('apps', {}));
  const notify = typeof options.notify === 'function' ? options.notify : () => {};

  function persist() {
    store.set('apps', data);
    store.save();
  }

  function authState() {
    return {
      hasAccount: !!account,
      signedIn: !!(account && sessionKey),
      email: account ? account.email : '',
      name: account ? account.name : ''
    };
  }

  function changed() {
    notify('swift:auth-changed', authState());
  }

  function getData(appId) {
    if (!DATA_APPS.includes(appId)) return null;
    return data[appId];
  }

  function saveData(appId, next) {
    if (!DATA_APPS.includes(appId)) throw new Error('Unknown Swift app');
    if (!sessionKey) throw new Error('Sign in with Swift ID first');
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('Invalid app data');
    if (JSON.stringify(next).length > 4 * 1024 * 1024) throw new Error('That document is too large for the local store');
    data[appId] = next;
    persist();
    notify('swift:app-data', { appId, data: next });
    return next;
  }

  function signup(payload) {
    const name = cleanText(payload && payload.name, 80).trim();
    const email = cleanText(payload && payload.email, 160).trim().toLowerCase();
    const password = String((payload && payload.password) || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your name and a valid email address');
    if (password.length < 8) throw new Error('Use a password of at least 8 characters');
    if (account) throw new Error('This device already has a Swift ID. Sign in instead.');
    const salt = crypto.randomBytes(16).toString('hex');
    account = {
      name, email, salt,
      hash: hashPassword(password, salt, 'auth').toString('hex'),
      created: Date.now()
    };
    fs.writeFileSync(authFile, JSON.stringify(account, null, 2), { mode: 0o600 });
    sessionKey = hashPassword(password, salt, 'drive');
    changed();
    return authState();
  }

  function signin(password) {
    if (!account) throw new Error('Create a Swift ID first');
    const candidate = hashPassword(String(password || ''), account.salt, 'auth');
    const stored = Buffer.from(account.hash || '', 'hex');
    if (stored.length !== candidate.length || !crypto.timingSafeEqual(candidate, stored)) {
      throw new Error('That password does not match this Swift ID');
    }
    sessionKey = hashPassword(String(password), account.salt, 'drive');
    changed();
    return authState();
  }

  function signout() {
    sessionKey = null;
    changed();
    return authState();
  }

  function requireDriveKey() {
    if (!sessionKey) throw new Error('Unlock Swift Drive by signing in again');
    return sessionKey;
  }

  function uploadFile(payload) {
    const key = requireDriveKey();
    const name = cleanText(payload && payload.name, 180).trim() || 'Untitled file';
    const type = cleanText(payload && payload.type, 100) || 'application/octet-stream';
    const raw = String((payload && payload.data) || '');
    const buffer = Buffer.from(raw, 'base64');
    if (!buffer.length) throw new Error('That file is empty');
    if (buffer.length > 20 * 1024 * 1024) throw new Error('Swift Drive files are limited to 20 MB locally');
    const id = uid('f');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    fs.writeFileSync(path.join(driveDir, `${id}.enc`), encrypted, { mode: 0o600 });
    const entry = {
      id, name, type, size: buffer.length, time: Date.now(),
      iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64')
    };
    data.drive.files.unshift(entry);
    data.drive.files = data.drive.files.slice(0, 500);
    persist();
    notify('swift:app-data', { appId: 'drive', data: data.drive });
    return entry;
  }

  function downloadFile(id) {
    const key = requireDriveKey();
    const entry = data.drive.files.find((file) => file.id === id);
    if (!entry) throw new Error('File not found');
    const encrypted = fs.readFileSync(path.join(driveDir, `${id}.enc`));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return { name: entry.name, type: entry.type, data: plain.toString('base64') };
  }

  function deleteFile(id) {
    const entry = data.drive.files.find((file) => file.id === id);
    if (!entry) return false;
    data.drive.files = data.drive.files.filter((file) => file.id !== id);
    persist();
    notify('swift:app-data', { appId: 'drive', data: data.drive });
    try { fs.unlinkSync(path.join(driveDir, `${id}.enc`)); } catch { /* already gone */ }
    return true;
  }

  function textOf(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(textOf).join(' ');
    if (value && typeof value === 'object') {
      return Object.values(value).map(textOf).join(' ');
    }
    return '';
  }

  function aiSearch(query) {
    const needle = cleanText(query, 200).trim().toLowerCase();
    if (!needle) return { results: [], notice: '' };
    const tokens = needle.split(/\s+/).filter((word) => word.length > 1);
    const results = [];
    const push = (appId, title, text, target) => {
      const haystack = `${title} ${text}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      if (!score) return;
      const at = haystack.indexOf(tokens[0]);
      const snippet = text.replace(/\s+/g, ' ').slice(Math.max(0, at - 40), Math.max(0, at - 40) + 180);
      results.push({ appId, title, snippet: snippet || title, target, score });
    };

    for (const thread of data.chat.threads || []) {
      for (const message of thread.messages || []) push('chat', thread.title, message.text, `swift://chat?thread=${thread.id}`);
    }
    for (const note of data.notes.notes || []) push('notes', 'Note', note.text, 'swift://notes');
    for (const block of data.docs.blocks || []) push('docs', data.docs.title || 'Document', block.text, 'swift://docs');
    for (const event of data.calendar.events || []) {
      push('calendar', event.title, `${event.date} ${event.start || ''} ${event.notes || ''}`, 'swift://calendar');
    }
    for (const task of data.tasks.tasks || []) push('tasks', task.title, task.source || '', 'swift://tasks');
    for (const file of data.drive.files || []) push('drive', file.name, `${file.type} ${formatBytes(file.size)}`, 'swift://drive');
    for (const transcript of data.meet.transcripts || []) {
      push('meet', transcript.room || 'Meeting', `${transcript.text} ${textOf(transcript.summary)}`, 'swift://meet');
    }
    for (const connector of data.sheets.connectors || []) {
      push('sheets', connector.name, textOf(connector.data), 'swift://sheets');
    }

    results.sort((a, b) => b.score - a.score);
    data.ai.recent = [needle, ...(data.ai.recent || []).filter((item) => item !== needle)].slice(0, 8);
    persist();
    const notice = /mail|email|inbox|invoice/i.test(needle)
      ? 'Swift Mail is coming soon. Your own @swift.email address needs a custom domain first — search will include mail here the day it launches.'
      : '';
    return { results: results.slice(0, 30), notice };
  }

  function meetSummary(transcript) {
    const lines = cleanText(transcript, 20000).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const actions = [];
    for (const line of lines) {
      if (/^\s*(todo|action|follow[- ]?up|next step)\s*:/i.test(line) || /\b(i|we|they) will\b|\bneed to\b|\bremember to\b|\baction item\b/i.test(line)) {
        actions.push(line.replace(/^\s*(todo|action|follow[- ]?up|next step)\s*:\s*/i, '').slice(0, 240));
      }
    }
    const keywords = lines.join(' ').toLowerCase();
    const summary = lines.slice(0, 3).join(' ') ||
      (lines.length ? `Captured ${lines.length} note${lines.length === 1 ? '' : 's'} from this meeting.` : 'No notes yet.');
    return {
      summary: `${summary}${keywords.includes('launch') ? ' Launch discussed.' : ''}`,
      actions: actions.slice(0, 10),
      words: lines.join(' ').split(/\s+/).filter(Boolean).length
    };
  }

  function collectActions() {
    const found = [];
    for (const thread of data.chat.threads || []) {
      for (const message of thread.messages || []) {
        const match = String(message.text || '').match(/(?:^|\n)\s*(?:todo|action)\s*:\s*(.+)/i);
        if (match) found.push({ title: cleanText(match[1], 200), source: `Chat · ${thread.title}` });
      }
    }
    for (const block of data.docs.blocks || []) {
      const match = String(block.text || '').match(/(?:^|\n)\s*(?:todo|action)\s*:\s*(.+)/i);
      if (match) found.push({ title: cleanText(match[1], 200), source: 'Swift Docs' });
    }
    for (const meeting of data.meet.transcripts || []) {
      for (const action of meeting.actions || []) {
        found.push({ title: cleanText(action, 200), source: `Swift Meet · ${meeting.room || 'Meeting'}` });
      }
    }
    const existing = new Set((data.tasks.tasks || []).map((task) => `${task.title}|${task.source}`));
    let added = 0;
    for (const item of found) {
      if (existing.has(`${item.title}|${item.source}`)) continue;
      data.tasks.tasks.unshift({ id: uid('k'), title: item.title, source: item.source, done: false, time: Date.now() });
      added += 1;
    }
    if (added) {
      persist();
      notify('swift:app-data', { appId: 'tasks', data: data.tasks });
    }
    return { added, tasks: data.tasks.tasks };
  }

  function registerIpc(ipcMain) {
    const handle = (channel, handler) => ipcMain.handle(channel, (_event, ...args) => {
      try { return { ok: true, value: handler(...args) }; }
      catch (error) { return { ok: false, error: String(error && error.message ? error.message : error) }; }
    });

    handle('swift:apps:meta', () => APP_META);
    handle('swift:auth:state', () => authState());
    handle('swift:auth:signup', signup);
    handle('swift:auth:signin', signin);
    handle('swift:auth:signout', signout);
    handle('swift:apps:get', getData);
    handle('swift:apps:save', saveData);
    handle('swift:apps:all', () => {
      if (!sessionKey) throw new Error('Sign in with Swift ID first');
      return data;
    });
    handle('swift:drive:upload', uploadFile);
    handle('swift:drive:download', downloadFile);
    handle('swift:drive:delete', deleteFile);
    handle('swift:ai:search', aiSearch);
    handle('swift:meet:summary', meetSummary);
    handle('swift:apps:collect-actions', collectActions);
  }

  return {
    APP_META, APP_IDS, DATA_APPS,
    authState, signup, signin, signout,
    getData, saveData, registerIpc,
    aiSearch, meetSummary, collectActions, blankData
  };
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

module.exports = { APP_META, APP_IDS, createAppsBackend, formatBytes };
