'use strict';

/* Swift apps runtime. Every app is local-first: data lives in the encrypted
   device profile, and the only bridge is the narrow swiftApps API. */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const APP_ID = document.body.dataset.app || 'id';
const call = (name, ...args) => window.swiftApps.invoke(`swift:${name}`, ...args);
const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const uid = (prefix = 'i') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const state = {
  meta: [], auth: null, data: null, selectedThread: null, meet: null,
  filter: 'all', filterText: '', slide: 0, aiQuery: '', saveTimer: null
};

function metaFor(id) {
  return state.meta.find((item) => item.id === id) || { id, name: `Swift ${id}`, icon: '✦', color: '#6366f1', tagline: '' };
}

function toast(message) {
  const el = $('#app-toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function fail(error) {
  toast(error && error.message ? error.message : String(error));
}

function save(appId, data) {
  state.data = data;
  const indicator = $('#save-state');
  if (indicator) indicator.classList.add('busy');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await call('apps:save', appId, data);
      if (indicator) indicator.classList.remove('busy');
    } catch (error) { fail(error); }
  }, 260);
}

function go(appId) { location.href = `swift://${appId}`; }

function header() {
  const meta = metaFor(APP_ID);
  document.title = meta.name;
  $('#app-glyph').textContent = meta.icon;
  $('#app-glyph').style.color = meta.color;
  $('#app-title').textContent = meta.name;
  $('#app-tagline').textContent = meta.tagline || 'Made for focus.';
  const chip = $('#account-chip');
  if (state.auth && state.auth.signedIn) {
    chip.innerHTML = `<span class="avatar">${esc(state.auth.name.slice(0, 1).toUpperCase())}</span><span>${esc(state.auth.name)}</span>`;
    chip.title = 'Swift ID · ' + state.auth.email;
  } else {
    chip.innerHTML = '<span class="avatar">?</span><span>Sign in with Swift</span>';
    chip.title = 'Open Swift ID';
  }
  $('#shell').hidden = false;
}

function authGate() {
  $('#app-body').innerHTML = `<div class="auth-layout"><div class="card auth-card">
    <div class="mark">${esc(metaFor(APP_ID).icon)}</div>
    <h2>${esc(metaFor(APP_ID).name)} needs your Swift ID</h2>
    <p>Your workspace is stored locally and unlocked with your Swift account. There is no cloud copy and no server to trust.</p>
    ${state.auth && state.auth.hasAccount ? `<div class="notice" style="margin-bottom:16px">This device already has a Swift ID for <strong>${esc(state.auth.email)}</strong>. Sign in to continue.</div>` : ''}
    <button class="btn primary" data-act="open-id" style="width:100%">Open Swift ID</button>
    <div class="auth-switch">New here? <button class="link-btn" data-act="open-id">Create an account</button></div>
  </div></div>`;
}

/* ---------- Swift ID ---------- */

function renderId() {
  const auth = state.auth;
  if (!auth.hasAccount) {
    $('#app-body').innerHTML = `<div class="auth-layout"><div class="card auth-card">
      <div class="mark">⬟</div>
      <h2>Create your Swift ID</h2>
      <p>One sign-in for every Swift app. Your account stays on this device — no email verification server, no tracking, no billing backend.</p>
      <form id="signup-form">
        <div class="field-group"><label class="field-label" for="su-name">Your name</label><input id="su-name" class="field" required autocomplete="name" placeholder="Alex Rivera"></div>
        <div class="field-group"><label class="field-label" for="su-email">Email address</label><input id="su-email" class="field" type="email" required autocomplete="email" placeholder="you@example.com"></div>
        <div class="field-group"><label class="field-label" for="su-pass">Password (8+ characters)</label><input id="su-pass" class="field" type="password" required minlength="8" autocomplete="new-password" placeholder="Choose a strong password"></div>
        <div class="field-group"><label class="field-label" for="su-confirm">Confirm password</label><input id="su-confirm" class="field" type="password" required minlength="8" autocomplete="new-password"></div>
        <div id="auth-error" class="error-text"></div>
        <button class="btn primary" type="submit" style="width:100%">Create Swift ID</button>
      </form>
      <div class="auth-switch">Your password is salted and hashed locally with PBKDF2. It never leaves this device.</div>
    </div></div>`;
    $('#signup-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = $('#auth-error');
      error.textContent = '';
      if ($('#su-pass').value !== $('#su-confirm').value) { error.textContent = 'Those passwords do not match.'; return; }
      try {
        await call('auth:signup', { name: $('#su-name').value, email: $('#su-email').value, password: $('#su-pass').value });
        state.auth = await call('auth:state');
        header(); renderId(); toast('Swift ID created — welcome to Swift');
      } catch (err) { error.textContent = err.message; }
    });
    return;
  }

  if (!auth.signedIn) {
    $('#app-body').innerHTML = `<div class="auth-layout"><div class="card auth-card">
      <div class="mark">⬟</div>
      <h2>Welcome back</h2>
      <p>Sign in to unlock your Swift apps and locally encrypted Drive.</p>
      <form id="signin-form">
        <div class="field-group"><label class="field-label" for="si-email">Swift ID</label><input id="si-email" class="field" value="${esc(auth.email)}" readonly></div>
        <div class="field-group"><label class="field-label" for="si-pass">Password</label><input id="si-pass" class="field" type="password" required autocomplete="current-password" placeholder="Your password"></div>
        <div id="auth-error" class="error-text"></div>
        <button class="btn primary" type="submit" style="width:100%">Sign in with Swift</button>
      </form>
      <div class="auth-switch">Forgot your password? Local accounts cannot be recovered remotely — keep your device password safe.</div>
    </div></div>`;
    $('#signin-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await call('auth:signin', $('#si-pass').value);
        state.auth = await call('auth:state');
        header(); renderId(); toast('Signed in with Swift ID');
      } catch (err) { $('#auth-error').textContent = err.message; }
    });
    return;
  }

  const tiles = state.meta.map((item) => `<button class="app-tile${item.comingSoon ? ' soon' : ''}" data-act="open-app" data-app-id="${esc(item.id)}" ${item.comingSoon ? 'disabled' : ''}>
    <span class="glyph" style="background:${esc(item.color)}">${esc(item.icon)}</span>
    <span><strong>${esc(item.name)}</strong><br><span class="faint small">${esc(item.tagline)}</span></span>
  </button>`).join('');
  $('#app-body').innerHTML = `<div class="wrap">
    <div class="hero"><span class="eyebrow">Swift ID · single sign-on</span><h2>One account. Every Swift app.</h2><p>Sign in once on this device and move between your apps without another password.</p></div>
    <div class="card"><div class="account-hero">
      <span class="avatar">${esc(auth.name.slice(0, 1).toUpperCase())}</span>
      <div><h3>${esc(auth.name)}</h3><p>${esc(auth.email)}</p></div>
      <span class="spacer"></span><span class="pill good">Signed in locally</span>
      <button class="btn ghost" data-act="signout">Sign out</button>
    </div></div>
    <div class="section-title"><h2>Your apps</h2><span>Click to open in a new tab</span></div>
    <div class="app-directory">${tiles}</div>
    <div class="card" style="margin-top:18px"><h3>Sign in with Swift</h3><p>Any Swift app can ask for this login. Your credentials are checked on this device only — there is no external identity provider, and no billing account is created until subscriptions launch.</p></div>
    <div class="notice" style="margin-top:14px">Swift Mail is coming soon: your @swift.email address needs a custom domain first. We will add it here automatically when it launches.</div>
  </div>`;
}

/* ---------- Swift Mail (coming soon) ---------- */

function renderMail() {
  $('#app-body').innerHTML = `<div class="wrap narrow">
    <div class="hero"><span class="eyebrow">Coming soon</span><h2>Swift Mail is on its way.</h2><p>A calm inbox with the same privacy rules as the rest of Swift — no trackers, no read receipts you did not agree to, and action items that flow straight into Swift Tasks.</p></div>
    <div class="card"><h3>Your own @swift.email address</h3><p>We are waiting on a custom domain before we can offer addresses. Nothing to set up yet: when it launches, your Swift ID will claim one automatically and Swift AI will search your mail alongside docs, notes and calendar.</p></div>
    <div class="grid three" style="margin-top:14px">
      <div class="card"><h3>✉ Private by default</h3><p>Remote images and tracking pixels stay off until you choose otherwise.</p></div>
      <div class="card"><h3>✓ Action items</h3><p>Messages become tasks in Swift Tasks without copy-paste.</p></div>
      <div class="card"><h3>✦ Search everywhere</h3><p>One question across mail, docs, notes and calendar.</p></div>
    </div>
    <div class="row" style="margin-top:18px"><button class="btn" data-act="open-app" data-app-id="id">Back to Swift ID</button><span class="faint small">No custom domain yet — coming soon!</span></div>
  </div>`;
}

/* ---------- Swift Chat ---------- */

function renderChat() {
  const data = state.data;
  const threads = data.threads || [];
  if (!threads.length) threads.push({ id: uid('c'), title: 'General', created: Date.now(), messages: [] });
  if (!state.selectedThread || !threads.some((t) => t.id === state.selectedThread)) state.selectedThread = threads[0].id;
  const current = threads.find((t) => t.id === state.selectedThread);
  const list = threads.map((thread) => `<button class="thread${thread.id === state.selectedThread ? ' active' : ''}" data-act="thread" data-id="${esc(thread.id)}">
    <strong>${esc(thread.title)}</strong><span>${(thread.messages || []).length} messages · topic thread</span></button>`).join('');
  const messages = (current.messages || []).map((message) => `<div class="message${message.author === state.auth.name ? ' mine' : ''}">
    <span class="avatar">${esc(message.author.slice(0, 1).toUpperCase())}</span>
    <div class="bubble">${esc(message.text)}<small>${esc(message.author)} · ${esc(message.time)}</small></div>
  </div>`).join('');
  $('#app-body').innerHTML = `<div class="wrap"><div class="split">
    <div class="card"><div class="section-title" style="margin-top:0"><h3>Topics</h3></div>
      <div class="thread-list">${list}</div>
      <form id="new-thread" class="row" style="margin-top:12px"><input class="field" name="title" placeholder="New topic…" required><button class="btn" type="submit">+</button></form>
    </div>
    <div class="card"><div class="section-title" style="margin-top:0"><h2>${esc(current.title)}</h2><span>Replies stay in this thread</span></div>
      <div class="messages">${messages || '<div class="empty"><strong>Quiet here.</strong>Start the conversation with a topic, not a shout.</div>'}</div>
      <form id="chat-form" class="composer"><input class="field" name="message" placeholder="Write a reply… (type TODO: to create a task)" required autocomplete="off"><button class="btn primary" type="submit">Send</button></form>
    </div>
  </div></div>`;
  $('#new-thread').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = new FormData(event.target).get('title').trim();
    if (!title) return;
    const thread = { id: uid('c'), title, created: Date.now(), messages: [] };
    data.threads.push(thread);
    state.selectedThread = thread.id;
    save('chat', data); renderChat();
  });
  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = new FormData(event.target).get('message').trim();
    if (!text) return;
    current.messages.push({ id: uid('m'), author: state.auth.name, text, time: nowTime() });
    save('chat', data); renderChat();
    if (/^\s*(todo|action)\s*:/i.test(text)) toast('Action captured — pull it into Swift Tasks');
  });
}

/* ---------- Swift Meet ---------- */

let meetState = null;

function renderMeet() {
  const data = state.data;
  if (!meetState) meetState = { room: 'swift-' + Math.random().toString(36).slice(2, 8), joined: false, transcript: '', summary: null };
  $('#app-body').innerHTML = `<div class="wrap">
    <div class="hero"><span class="eyebrow">Browser-native meetings</span><h2>Talk now. Read the summary later.</h2><p>Camera and mic stay in your browser. Rooms connect tabs on this device with WebRTC — no download, no meeting server. Notes are summarized locally.</p></div>
    <div class="card"><div class="row"><label class="field-label" for="room-name" style="margin:0">Room</label><input id="room-name" class="field" style="max-width:260px" value="${esc(meetState.room)}"><button class="btn primary" data-act="meet-toggle">${meetState.joined ? 'Leave room' : 'Join room'}</button><span class="pill">${meetState.joined ? 'Connected locally' : 'Not connected'}</span></div></div>
    <div class="video-grid" style="margin-top:14px">
      <div class="video-tile"><video id="local-video" autoplay muted playsinline></video><div class="placeholder">◉</div><div class="label">You</div></div>
      <div class="video-tile"><video id="remote-video" autoplay playsinline></video><div class="placeholder">◎</div><div class="label">Guest in this browser</div></div>
    </div>
    <div class="meet-controls"><button class="btn ghost" data-act="mic-toggle">Toggle mic</button><button class="btn ghost" data-act="cam-toggle">Toggle camera</button><span class="faint small" id="meet-status">Open this room in another Swift tab to test a two-way call.</span></div>
    <div class="card"><div class="section-title" style="margin-top:0"><h3>Meeting notes &amp; AI summary</h3><span>Local heuristics — no model upload</span></div>
      <textarea id="meet-notes" class="field" placeholder="Paste or write notes, one line each. Lines with “Action:” or “we will…” become action items.">${esc(meetState.transcript)}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="meet-summary">Generate summary</button><button class="btn ghost" data-act="meet-save">Save notes</button></div>
      <div id="meet-summary-output">${meetState.summary ? summaryHtml(meetState.summary) : ''}</div>
    </div>
  </div>`;
  const roomInput = $('#room-name');
  roomInput.addEventListener('change', () => { meetState.room = roomInput.value.trim() || 'swift-room'; });
  $('#meet-notes').addEventListener('input', (event) => { meetState.transcript = event.target.value; });
  if (meetState.joined) startLocalPreview().catch(fail);
}

function summaryHtml(summary) {
  return `<div class="summary-box" style="margin-top:14px"><strong>AI summary</strong><p style="margin:6px 0 0;color:var(--muted)">${esc(summary.summary)}</p>
    <p class="small faint" style="margin:6px 0 0">${summary.words} words captured locally</p>
    ${summary.actions.length ? `<div style="margin-top:10px"><strong class="small">Action items</strong><ul style="margin:6px 0 0;padding-left:20px;color:var(--muted)">${summary.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
  </div>`;
}

async function startLocalPreview() {
  const video = $('#local-video');
  if (!video || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Camera access is not available here');
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  meetState.stream = stream;
  meetState.micOn = true;
  meetState.camOn = true;
  video.srcObject = stream;
  const placeholder = video.parentElement.querySelector('.placeholder');
  if (placeholder) placeholder.hidden = true;
}

function meetChannel(message) {
  if (!meetState || !meetState.channel || !meetState.peerId) return;
  meetState.channel.postMessage(Object.assign({ from: meetState.peerId }, message));
}

function ensurePeer() {
  if (meetState.pc) return meetState.pc;
  const pc = new RTCPeerConnection({ iceServers: [] });
  if (meetState.stream) for (const track of meetState.stream.getTracks()) pc.addTrack(track, meetState.stream);
  pc.onicecandidate = (event) => { if (event.candidate) meetChannel({ type: 'ice', candidate: event.candidate.toJSON() }); };
  pc.ontrack = (event) => {
    const remote = $('#remote-video');
    if (remote) {
      remote.srcObject = event.streams[0];
      const placeholder = remote.parentElement.querySelector('.placeholder');
      if (placeholder) placeholder.hidden = true;
    }
  };
  meetState.pc = pc;
  return pc;
}

async function joinMeet() {
  meetState.peerId = uid('p');
  meetState.channel = new BroadcastChannel(`swift-meet-${meetState.room}`);
  meetState.channel.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || msg.from === meetState.peerId) return;
    try {
      if (msg.type === 'hello') {
        meetState.remoteId = msg.from;
        $('#meet-status').textContent = 'Guest found in another tab.';
        if (meetState.peerId < msg.from) {
          const offer = await ensurePeer().createOffer();
          await meetState.pc.setLocalDescription(offer);
          meetChannel({ type: 'offer', description: meetState.pc.localDescription });
        }
      } else if (msg.type === 'offer') {
        meetState.remoteId = msg.from;
        const pc = ensurePeer();
        await pc.setRemoteDescription(msg.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        meetChannel({ type: 'answer', description: pc.localDescription });
      } else if (msg.type === 'answer') {
        await meetState.pc.setRemoteDescription(msg.description);
      } else if (msg.type === 'ice' && msg.candidate && meetState.pc) {
        await meetState.pc.addIceCandidate(msg.candidate);
      }
    } catch (error) { console.warn('[swift meet]', error); }
  };
  await startLocalPreview();
  meetChannel({ type: 'hello' });
  meetState.joined = true;
  renderMeet();
  toast(`Joined ${meetState.room}`);
}

function leaveMeet() {
  if (meetState.channel) meetState.channel.close();
  if (meetState.pc) meetState.pc.close();
  if (meetState.stream) meetState.stream.getTracks().forEach((track) => track.stop());
  meetState = Object.assign({}, meetState, { channel: null, pc: null, stream: null, joined: false, remoteId: null });
  renderMeet();
  toast('Left the room');
}

async function generateMeetSummary() {
  try {
    const summary = await call('meet:summary', meetState.transcript);
    meetState.summary = summary;
    $('#meet-summary-output').innerHTML = summaryHtml(summary);
    const data = state.data;
    data.transcripts.unshift({ id: uid('t'), room: meetState.room, text: meetState.transcript, time: Date.now(), summary: summary.summary, actions: summary.actions });
    data.transcripts = data.transcripts.slice(0, 50);
    save('meet', data);
    if (summary.actions.length) {
      const result = await call('apps:collect-actions');
      toast(`Summary saved · ${result.added} action items pulled into Tasks`);
    } else toast('Summary saved locally');
  } catch (error) { fail(error); }
}

/* ---------- Swift AI ---------- */

function renderAi() {
  const data = state.data;
  const recent = (data.recent || []).slice(0, 6);
  $('#app-body').innerHTML = `<div class="wrap narrow">
    <div class="ai-hero"><div class="mark">✦</div><span class="eyebrow">Swift AI</span><h2>Ask once. Search everywhere.</h2><p>One question across your docs, notes, chats, calendar, tasks, sheets and encrypted Drive filenames. Everything runs locally — nothing is sent to a model.</p>
      <form id="ai-form" class="ai-prompt"><input class="field" id="ai-input" placeholder="e.g. Q3 invoice from Sarah" value="${esc(state.aiQuery)}" autocomplete="off"><button class="btn primary" type="submit">Search</button></form>
      ${recent.length ? `<div class="row" style="justify-content:center;margin-top:12px">${recent.map((item) => `<button class="pill" data-act="ai-query" data-query="${esc(item)}">${esc(item)}</button>`).join('')}</div>` : ''}
    </div>
    <div id="ai-output"></div>
  </div>`;
  $('#ai-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('#ai-input').value.trim();
    if (!query) return;
    state.aiQuery = query;
    try {
      const result = await call('ai:search', query);
      const data = state.data;
      data.recent = [query, ...(data.recent || []).filter((item) => item !== query)].slice(0, 8);
      save('ai', data);
      renderAi();
      $('#ai-output').innerHTML = `${result.notice ? `<div class="notice" style="margin-bottom:12px">${esc(result.notice)}</div>` : ''}
        ${result.results.length ? result.results.map((hit) => `<button class="ai-result" data-act="open-url" data-url="${esc(hit.target)}" style="width:100%;text-align:left">
          <span class="ai-src">${esc(metaFor(hit.appId).name)} · ${esc(hit.title)}</span><div class="muted" style="margin-top:4px">${esc(hit.snippet)}</div></button>`).join('') : '<div class="empty"><strong>Nothing found locally</strong>Try a word you remember from a note, doc or event.</div>'}`;
    } catch (error) { fail(error); }
  });
}

/* ---------- Swift Docs ---------- */

function renderDocs() {
  const data = state.data;
  data.title = data.title || 'Untitled document';
  if (!data.blocks || !data.blocks.length) data.blocks = [{ id: uid('b'), type: 'p', text: '' }];
  const rows = data.blocks.map((block) => `<div class="block-row" data-type="${esc(block.type)}" data-id="${esc(block.id)}">
    <select class="field" data-block-type="${esc(block.id)}" aria-label="Block type">
      ${['p', 'h1', 'bullet', 'quote', 'code'].map((type) => `<option value="${type}"${block.type === type ? ' selected' : ''}>${({ p: 'Text', h1: 'Heading', bullet: '• List', quote: 'Quote', code: 'Code' })[type]}</option>`).join('')}
    </select>
    <div contenteditable="true" spellcheck="true" data-block="${esc(block.id)}">${esc(block.text)}</div>
    <button class="btn icon ghost" data-act="remove-block" data-id="${esc(block.id)}" title="Remove block">×</button>
  </div>`).join('');
  $('#app-body').innerHTML = `<div class="wrap"><div class="doc-toolbar">
      <button class="btn" data-act="add-block">+ Block</button>
      <button class="btn ghost" data-act="export-doc">Export Markdown</button>
      <button class="btn ghost" data-act="pull-actions">Pull action items</button>
      <span class="spacer"></span><span class="faint small">Autosaved on this device</span>
    </div>
    <div class="doc-page"><input id="doc-title" class="doc-title-input" value="${esc(data.title)}" placeholder="Untitled document" aria-label="Document title">${rows}</div>
  </div>`;
  $('#doc-title').addEventListener('input', (event) => { data.title = event.target.value; save('docs', data); });
  $$('[data-block]').forEach((el) => {
    el.addEventListener('input', () => {
      const block = data.blocks.find((item) => item.id === el.dataset.block);
      if (block) { block.text = el.innerText; save('docs', data); }
    });
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      const index = data.blocks.findIndex((item) => item.id === el.dataset.block);
      const block = { id: uid('b'), type: 'p', text: '' };
      data.blocks.splice(index + 1, 0, block);
      save('docs', data); renderDocs();
      const next = document.querySelector(`[data-block="${block.id}"]`);
      if (next) next.focus();
    });
  });
  $$('[data-block-type]').forEach((select) => {
    select.addEventListener('change', () => {
      const block = data.blocks.find((item) => item.id === select.dataset.blockType);
      if (block) { block.type = select.value; save('docs', data); renderDocs(); }
    });
  });
}

/* ---------- Swift Sheets ---------- */

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function cellValue(rows, ref) {
  const match = String(ref || '').match(/^([A-Z]+)(\d+)$/i);
  if (!match) return 0;
  const col = COLS.indexOf(match[1].toUpperCase());
  const row = parseInt(match[2], 10) - 1;
  const value = rows && rows[row] && rows[row][col];
  return value == null || value === '' ? 0 : value;
}

function evalFormula(expression, rows) {
  const source = String(expression || '').replace(/^=/, '').trim();
  const aggregate = source.match(/^(SUM|AVG|MIN|MAX|COUNT)\(([A-Z]+\d+):([A-Z]+\d+)\)$/i);
  if (aggregate) {
    const [startCol, startRow] = [COLS.indexOf(aggregate[2].match(/^[A-Z]+/)[0].toUpperCase()), parseInt(aggregate[2].match(/\d+$/)[0], 10) - 1];
    const [endCol, endRow] = [COLS.indexOf(aggregate[3].match(/^[A-Z]+/)[0].toUpperCase()), parseInt(aggregate[3].match(/\d+$/)[0], 10) - 1];
    const values = [];
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
      for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col += 1) {
        const value = rows[row] && rows[row][col];
        if (value !== '' && value != null && !isNaN(Number(value))) values.push(Number(value));
      }
    }
    const fn = aggregate[1].toUpperCase();
    if (fn === 'SUM') return values.reduce((sum, n) => sum + n, 0);
    if (fn === 'COUNT') return values.length;
    if (!values.length) return 0;
    if (fn === 'AVG') return values.reduce((sum, n) => sum + n, 0) / values.length;
    if (fn === 'MIN') return Math.min(...values);
    return Math.max(...values);
  }
  const substituted = source.replace(/[A-Z]+\d+/gi, (ref) => String(cellValue(rows, ref)));
  if (!/^[0-9+\-*/().\s%]+$/.test(substituted)) return '=ERR';
  try {
    const value = Function(`"use strict";return (${substituted})`)(); // numbers/operators only
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : '=ERR';
  } catch { return '=ERR'; }
}

function renderSheets() {
  const data = state.data;
  if (!data.rows || !data.rows.length) data.rows = Array.from({ length: 8 }, () => Array(COLS.length).fill(''));
  const table = data.rows.map((row, rowIndex) => `<tr><th>${rowIndex + 1}</th>${COLS.map((col, colIndex) => {
    const raw = row[colIndex] || '';
    const shown = raw.startsWith('=') ? evalFormula(raw, data.rows) : raw;
    return `<td><input class="${raw.startsWith('=') ? 'formula' : ''}" data-cell="${col}${rowIndex + 1}" value="${esc(String(shown))}" data-raw="${esc(raw)}" aria-label="Cell ${col}${rowIndex + 1}"></td>`;
  }).join('')}</tr>`).join('');
  const connectors = (data.connectors || []).map((connector) => `<div class="card" style="padding:12px"><div class="row"><span class="pill good">● Live JSON</span><strong>${esc(connector.name)}</strong><span class="spacer"></span><button class="btn icon ghost" data-act="remove-connector" data-id="${esc(connector.id)}" title="Remove">×</button></div><pre class="small faint" style="white-space:pre-wrap;max-height:120px;overflow:auto">${esc(JSON.stringify(connector.data, null, 2).slice(0, 500))}</pre></div>`).join('');
  $('#app-body').innerHTML = `<div class="wrap"><div class="section-title" style="margin-top:0"><h2>Formulas that stay correct when data moves</h2><span>Local grid · =SUM(A1:A8) · =A1*2</span></div>
    <div class="sheet-wrap"><table class="sheet"><thead><tr><th></th>${COLS.map((col) => `<th class="col">${col}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table></div>
    <div class="section-title"><h3>Live data connectors</h3><span>Paste JSON or load a URL</span></div>
    <div class="grid two"><div class="card"><form id="connector-form">
      <div class="field-group"><label class="field-label" for="conn-name">Source name</label><input id="conn-name" class="field" placeholder="Q3 revenue API" required></div>
      <div class="field-group"><label class="field-label" for="conn-url">JSON URL (optional)</label><input id="conn-url" class="field" placeholder="https://example.com/data.json"></div>
      <div class="field-group"><label class="field-label" for="conn-json">JSON payload</label><textarea id="conn-json" class="field" placeholder='{"revenue": 4200}'></textarea></div>
      <div id="conn-error" class="error-text"></div><button class="btn primary" type="submit">Add connector</button>
    </form></div><div>${connectors || '<div class="empty"><strong>No connectors yet</strong>Attach live data without breaking formulas.</div>'}</div></div>
  </div>`;
  $$('[data-cell]').forEach((input) => {
    input.addEventListener('change', () => {
      const ref = input.dataset.cell;
      const match = ref.match(/^([A-Z]+)(\d+)$/);
      const col = COLS.indexOf(match[1]);
      const row = parseInt(match[2], 10) - 1;
      data.rows[row][col] = input.value.trim();
      save('sheets', data); renderSheets();
    });
  });
  $('#connector-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#conn-name').value.trim();
    const url = $('#conn-url').value.trim();
    let payload = $('#conn-json').value.trim();
    if (url && !payload) {
      try {
        const response = await fetch(url);
        payload = await response.text();
      } catch { $('#conn-error').textContent = 'That URL blocked browser fetch. Paste its JSON below instead.'; return; }
    }
    let parsed;
    try { parsed = JSON.parse(payload); } catch { $('#conn-error').textContent = 'Enter valid JSON.'; return; }
    data.connectors.unshift({ id: uid('n'), name, url, data: parsed, time: Date.now() });
    save('sheets', data); renderSheets(); toast('Connector attached');
  });
}

/* ---------- Swift Decks ---------- */

function parseSlides(outline) {
  const slides = [];
  let current = { title: 'Untitled slide', bullets: [] };
  for (const raw of String(outline || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#\s+/.test(line)) {
      if (current.bullets.length || slides.length) slides.push(current);
      current = { title: line.replace(/^#\s+/, ''), bullets: [] };
    } else if (/^[-*•]\s+/.test(line)) current.bullets.push(line.replace(/^[-*•]\s+/, ''));
    else if (!slides.length && current.title === 'Untitled slide') current.title = line;
    else current.bullets.push(line);
  }
  slides.push(current);
  return slides.length ? slides : [{ title: 'Untitled slide', bullets: [] }];
}

function renderDecks() {
  const data = state.data;
  const slides = parseSlides(data.outline);
  state.slide = Math.min(state.slide, slides.length - 1);
  const slide = slides[state.slide];
  $('#app-body').innerHTML = `<div class="wrap"><div class="grid two">
    <div class="card"><div class="section-title" style="margin-top:0"><h3>Your outline</h3><span># slide · - bullet</span></div>
      <textarea id="deck-outline" class="field" style="min-height:420px;font-family:ui-monospace,Menlo,monospace" placeholder="# The story&#10;- Point one&#10;- Point two&#10;# The numbers&#10;- Growth">${esc(data.outline || '')}</textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-act="deck-build">Build slides</button><button class="btn ghost" data-act="deck-export">Export</button></div>
    </div>
    <div><div class="deck-stage"><div class="slide"><span class="eyebrow">${esc(data.title || 'Presentation')}</span><h2>${esc(slide.title)}</h2><ul>${slide.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul><div class="slide-number">${state.slide + 1} / ${slides.length} · Swift Decks</div></div></div>
      <div class="row" style="margin-top:10px;justify-content:center"><button class="btn ghost" data-act="deck-prev">← Previous</button><span class="faint small">${state.slide + 1} / ${slides.length}</span><button class="btn ghost" data-act="deck-next">Next →</button></div>
    </div>
  </div></div>`;
  $('#deck-outline').addEventListener('input', (event) => { data.outline = event.target.value; save('decks', data); });
}

/* ---------- Swift Notes ---------- */

let recording = null;

function renderNotes() {
  const data = state.data;
  const query = state.filterText.trim().toLowerCase();
  const notes = (data.notes || []).filter((note) => !query || String(note.text).toLowerCase().includes(query));
  $('#app-body').innerHTML = `<div class="wrap"><div class="card"><div class="row"><input id="note-input" class="field" placeholder="Catch a thought, a link, or a voice memo…" style="flex:1"><button class="btn primary" data-act="add-note">Capture</button><button class="btn ghost" data-act="record-note">● Record</button></div><div id="record-status" class="small faint" style="margin-top:8px">Voice memos stay on this device.</div></div>
    <div class="section-title"><h2>Quick notes</h2><input id="note-search" class="field" style="max-width:240px" placeholder="Filter notes…" value="${esc(state.filterText)}"></div>
    <div class="note-grid">${notes.length ? notes.map((note) => `<div class="note${note.pinned ? ' pinned' : ''}" style="background:${esc(note.color || '#10182b')};border-color:${note.pinned ? 'rgba(251,191,36,.4)' : 'var(--line)'}">
      <div class="note-text" contenteditable="true" data-note-text="${esc(note.id)}">${esc(note.text)}</div>
      ${note.voice ? `<audio controls src="data:${esc(note.voice.type || 'audio/webm')};base64,${esc(note.voice.data)}"></audio>` : ''}
      <div class="note-foot"><span>${new Date(note.time).toLocaleDateString()}</span>${/https?:\/\//.test(note.text) ? '<span class="pill">link</span>' : ''}<span class="spacer"></span>
        <button class="link-btn" data-act="pin-note" data-id="${esc(note.id)}">${note.pinned ? 'Unpin' : 'Pin'}</button>
        <button class="link-btn" data-act="remove-note" data-id="${esc(note.id)}" style="color:var(--bad)">Delete</button></div>
    </div>`).join('') : '<div class="empty"><strong>Nothing captured yet.</strong>Your next thought can start here.</div>'}</div>
  </div>`;
  $('#note-search').addEventListener('input', (event) => {
    state.filterText = event.target.value;
    const position = event.target.selectionStart;
    renderNotes();
    const search = $('#note-search');
    search.focus(); search.setSelectionRange(position, position);
  });
  $$('[data-note-text]').forEach((el) => el.addEventListener('input', () => {
    const note = data.notes.find((item) => item.id === el.dataset.noteText);
    if (note) { note.text = el.innerText; save('notes', data); }
  }));
}

function addNote(text, voice) {
  const data = state.data;
  const colors = ['#10182b', 'rgba(34,211,238,.08)', 'rgba(168,85,247,.09)', 'rgba(52,211,153,.08)', 'rgba(251,191,36,.08)'];
  data.notes.unshift({ id: uid('z'), text, voice, color: colors[data.notes.length % colors.length], pinned: false, time: Date.now() });
  save('notes', data); renderNotes();
}

async function toggleRecording() {
  if (recording && recording.recorder && recording.recorder.state === 'recording') {
    recording.recorder.stop();
    return;
  }
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Voice memos are not supported here'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        if (blob.size < 1024 * 1024) addNote('Voice memo · ' + new Date().toLocaleString(), { type: blob.type, data: String(reader.result).split(',')[1] });
        else toast('Voice memo too large to keep locally');
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach((track) => track.stop());
      recording = null;
    };
    recorder.start();
    recording = { recorder, stream };
    $('#record-status').textContent = 'Recording… click Record again to stop.';
  } catch (error) { fail(error); }
}

/* ---------- Swift Calendar ---------- */

function renderCalendar() {
  const data = state.data;
  const events = [...(data.events || [])].sort((a, b) => `${a.date}${a.start || ''}`.localeCompare(`${b.date}${b.start || ''}`));
  const conflicts = new Set();
  for (let i = 0; i < events.length; i += 1) {
    for (let j = i + 1; j < events.length; j += 1) {
      if (events[i].date === events[j].date && events[i].start && events[i].end &&
          events[i].start < events[j].end && events[j].start < events[i].end) {
        conflicts.add(events[i].id); conflicts.add(events[j].id);
      }
    }
  }
  const slug = (data.booking && data.booking.slug) || 'swift';
  $('#app-body').innerHTML = `<div class="wrap"><div class="split">
    <div class="card"><h3>Add an event</h3><form id="event-form">
      <div class="field-group"><label class="field-label">Title</label><input name="title" class="field" required placeholder="Design review"></div>
      <div class="field-group"><label class="field-label">Date</label><input name="date" class="field" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
      <div class="row"><div class="field-group" style="flex:1"><label class="field-label">Start</label><input name="start" class="field" type="time" value="09:00"></div>
      <div class="field-group" style="flex:1"><label class="field-label">End</label><input name="end" class="field" type="time" value="10:00"></div></div>
      <div class="field-group"><label class="field-label">Kind</label><select name="type" class="field"><option value="meeting">Meeting</option><option value="focus">Focus</option><option value="personal">Personal</option></select></div>
      <button class="btn primary" type="submit" style="width:100%">Add to calendar</button>
    </form>
    <div class="section-title"><h3>Focus time</h3></div><button class="btn ghost" data-act="add-focus" style="width:100%">Block two hours of focus</button>
    <div class="section-title"><h3>Booking link</h3></div><div class="field-group"><input id="booking-slug" class="field" value="${esc(slug)}" aria-label="Booking slug"></div>
      <code class="small">swift://calendar?book=${esc(slug)}</code><div><button class="btn ghost" data-act="copy-booking" style="margin-top:8px">Copy link</button></div>
    </div>
    <div class="card"><div class="section-title" style="margin-top:0"><h2>Schedule</h2><span>${events.length} events · ${conflicts.size} conflicts</span></div>
      ${events.length ? events.map((event) => `<div class="event-item${conflicts.has(event.id) ? ' conflict' : ''}">
        <span class="event-time">${esc(event.date.slice(5))} · ${esc(event.start || '')}</span>
        <div style="flex:1"><strong>${esc(event.title)}</strong><div class="faint small">${esc(event.end ? event.start + '–' + event.end : 'All day')} · ${esc(event.type || 'meeting')}${conflicts.has(event.id) ? ' · conflict' : ''}</div></div>
        <button class="btn icon ghost" data-act="remove-event" data-id="${esc(event.id)}" title="Remove">×</button>
      </div>`).join('') : '<div class="empty"><strong>A clear calendar.</strong>Add an event or protect some focus time.</div>'}
    </div>
  </div></div>`;
  $('#event-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    data.events.push({ id: uid('e'), title: String(form.get('title')).trim(), date: form.get('date'), start: form.get('start'), end: form.get('end'), type: form.get('type') });
    save('calendar', data); renderCalendar();
  });
  $('#booking-slug').addEventListener('change', (event) => {
    data.booking = Object.assign({}, data.booking, { slug: event.target.value.trim() || 'swift' });
    save('calendar', data);
  });
}

/* ---------- Swift Drive ---------- */

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function renderDrive() {
  const data = state.data;
  const query = state.filterText.trim().toLowerCase();
  const tokens = query.replace(/\b(find|show|get|the|from|for|my|a)\b/g, ' ').split(/\s+/).filter((word) => word.length > 1);
  const files = (data.files || []).filter((file) => !tokens.length || tokens.every((token) => file.name.toLowerCase().includes(token)));
  $('#app-body').innerHTML = `<div class="wrap"><div class="section-title" style="margin-top:0"><h2>Encrypted file storage</h2><span>${(data.files || []).length} files · AES-256-GCM on this device</span></div>
    <div class="card dropzone" id="dropzone"><div style="font-size:32px">⬡</div><strong>Drop files here or choose from your device</strong><p>Encrypted with a key derived from your Swift ID password. No plaintext is written to disk.</p>
      <input id="file-input" type="file" multiple style="margin-top:10px"><div class="small faint" style="margin-top:8px">Local files only · 20 MB maximum each</div></div>
    <div class="section-title"><h3>Your files</h3><input id="drive-search" class="field" style="max-width:340px" placeholder='Try “find the Q3 invoice from Sarah”' value="${esc(state.filterText)}"></div>
    ${files.length ? files.map((file) => `<div class="file-row"><span class="file-icon">▧</span><div style="flex:1"><strong>${esc(file.name)}</strong><div class="faint small">${formatBytes(file.size)} · ${new Date(file.time).toLocaleDateString()} · encrypted</div></div>
      <button class="btn ghost" data-act="download-file" data-id="${esc(file.id)}">Download</button><button class="btn icon danger" data-act="delete-file" data-id="${esc(file.id)}" title="Delete">×</button></div>`).join('') : '<div class="empty"><strong>No files yet.</strong>Upload one to see local encryption in action.</div>'}
    <div class="notice" style="margin-top:16px">Natural-language search matches words in file names, e.g. “Q3 invoice Sarah”. Full text search inside encrypted files is planned for a future release.</div>
  </div>`;
  $('#file-input').addEventListener('change', (event) => uploadFiles(event.target.files));
  const zone = $('#dropzone');
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault(); zone.classList.remove('drag');
    uploadFiles(event.dataTransfer.files);
  });
  $('#drive-search').addEventListener('input', (event) => {
    state.filterText = event.target.value;
    const position = event.target.selectionStart;
    renderDrive();
    const input = $('#drive-search');
    input.focus(); input.setSelectionRange(position, position);
  });
}

async function uploadFiles(files) {
  for (const file of Array.from(files || [])) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      await call('drive:upload', { name: file.name, type: file.type || 'application/octet-stream', data: btoa(binary) });
      toast(`Encrypted ${file.name}`);
    } catch (error) { fail(error); }
  }
  renderDrive();
}

async function downloadFile(id) {
  try {
    const file = await call('drive:download', id);
    const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(`Decrypted ${file.name}`);
  } catch (error) { fail(error); }
}

/* ---------- Swift Tasks ---------- */

function renderTasks() {
  const data = state.data;
  const tasks = data.tasks || [];
  const shown = tasks.filter((task) => state.filter === 'all' || (state.filter === 'open' && !task.done) || (state.filter === 'done' && task.done));
  $('#app-body').innerHTML = `<div class="wrap narrow"><div class="hero"><span class="eyebrow">One list</span><h2>Everything you agreed to do.</h2><p>Actions flow in from Swift Chat threads, Swift Docs and Swift Meet summaries.</p></div>
    <div class="card"><form id="task-form" class="row"><input name="title" class="field" style="flex:1" placeholder="Add a task…" required><button class="btn primary" type="submit">Add</button></form></div>
    <div class="section-title"><h3>Tasks</h3><div class="row">${['all', 'open', 'done'].map((filter) => `<button class="btn ${state.filter === filter ? 'primary' : 'ghost'}" data-act="task-filter" data-filter="${filter}">${filter}</button>`).join('')}<button class="btn ghost" data-act="pull-actions">Pull action items</button></div></div>
    ${shown.length ? shown.map((task) => `<div class="task${task.done ? ' done' : ''}"><input type="checkbox" data-task-toggle="${esc(task.id)}" ${task.done ? 'checked' : ''} aria-label="Complete task"><div style="flex:1"><div class="task-title">${esc(task.title)}</div><div class="task-source">${esc(task.source || 'Added manually')}</div></div><button class="btn icon ghost" data-act="remove-task" data-id="${esc(task.id)}" title="Delete">×</button></div>`).join('') : '<div class="empty"><strong>All clear.</strong>Pull action items from your other apps when you are ready.</div>'}
  </div>`;
  $('#task-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const title = new FormData(event.target).get('title').trim();
    if (!title) return;
    data.tasks.unshift({ id: uid('k'), title, source: 'Added manually', done: false, time: Date.now() });
    save('tasks', data); renderTasks();
  });
  $$('[data-task-toggle]').forEach((box) => box.addEventListener('change', () => {
    const task = data.tasks.find((item) => item.id === box.dataset.taskToggle);
    if (task) { task.done = box.checked; save('tasks', data); renderTasks(); }
  }));
}

/* ---------- events ---------- */

function render() {
  header();
  if (APP_ID === 'id') return renderId();
  if (APP_ID === 'mail') return renderMail();
  if (!state.auth || !state.auth.signedIn) return authGate();
  switch (APP_ID) {
    case 'chat': return renderChat();
    case 'meet': return renderMeet();
    case 'ai': return renderAi();
    case 'docs': return renderDocs();
    case 'sheets': return renderSheets();
    case 'decks': return renderDecks();
    case 'notes': return renderNotes();
    case 'calendar': return renderCalendar();
    case 'drive': return renderDrive();
    case 'tasks': return renderTasks();
    default: return renderId();
  }
}

async function loadData() {
  state.data = await call('apps:get', APP_ID) || {};
  render();
}

$('#account-chip').addEventListener('click', () => go('id'));

$('#app-body').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const act = button.dataset.act;
  const data = state.data;
  if (act === 'open-id') return go('id');
  if (act === 'open-app') return go(button.dataset.appId);
  if (act === 'open-url') return go(new URL(button.dataset.url).hostname);
  if (act === 'signout') {
    try { await call('auth:signout'); state.auth = await call('auth:state'); render(); toast('Signed out'); } catch (error) { fail(error); }
  } else if (act === 'thread') {
    state.selectedThread = button.dataset.id; renderChat();
  } else if (act === 'meet-toggle') {
    meetState.joined ? leaveMeet() : await joinMeet();
  } else if (act === 'mic-toggle' || act === 'cam-toggle') {
    if (!meetState || !meetState.stream) return toast('Join the room first');
    const tracks = meetState.stream.getTracks().filter((track) => track.kind === (act === 'mic-toggle' ? 'audio' : 'video'));
    const enabled = !tracks.every((track) => track.enabled);
    tracks.forEach((track) => { track.enabled = enabled; });
    toast(`${act === 'mic-toggle' ? 'Mic' : 'Camera'} ${enabled ? 'on' : 'off'}`);
  } else if (act === 'meet-summary') await generateMeetSummary();
  else if (act === 'meet-save') {
    data.transcripts.unshift({ id: uid('t'), room: meetState.room, text: meetState.transcript, time: Date.now(), summary: '', actions: [] });
    save('meet', data); toast('Notes saved');
  } else if (act === 'ai-query') {
    state.aiQuery = button.dataset.query; renderAi();
    const input = $('#ai-input'); input.value = state.aiQuery; input.form.requestSubmit();
  } else if (act === 'add-block') {
    data.blocks.push({ id: uid('b'), type: 'p', text: '' }); save('docs', data); renderDocs();
    const blocks = $$('[data-block]'); if (blocks.length) blocks[blocks.length - 1].focus();
  } else if (act === 'remove-block') {
    data.blocks = data.blocks.filter((block) => block.id !== button.dataset.id); save('docs', data); renderDocs();
  } else if (act === 'export-doc') {
    const markdown = [`# ${data.title || 'Untitled document'}`, ...data.blocks.map((block) => ({
      h1: `## ${block.text}`, bullet: `- ${block.text}`, quote: `> ${block.text}`, code: `\`\`\`\n${block.text}\n\`\`\``, p: block.text
    })[block.type] || block.text)].join('\n\n');
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${(data.title || 'swift-doc').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } else if (act === 'remove-connector') {
    data.connectors = data.connectors.filter((item) => item.id !== button.dataset.id); save('sheets', data); renderSheets();
  } else if (act === 'deck-build') {
    data.outline = $('#deck-outline').value; state.slide = 0; save('decks', data); renderDecks(); toast('Slides generated');
  } else if (act === 'deck-prev' || act === 'deck-next') {
    data.outline = $('#deck-outline') ? $('#deck-outline').value : data.outline;
    state.slide = Math.max(0, state.slide + (act === 'deck-next' ? 1 : -1)); renderDecks();
  } else if (act === 'deck-export') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'swift-deck.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } else if (act === 'add-note') {
    const text = $('#note-input').value.trim(); if (!text) return; addNote(text);
  } else if (act === 'record-note') await toggleRecording();
  else if (act === 'pin-note') {
    const note = data.notes.find((item) => item.id === button.dataset.id);
    if (note) { note.pinned = !note.pinned; save('notes', data); renderNotes(); }
  } else if (act === 'remove-note') {
    data.notes = data.notes.filter((item) => item.id !== button.dataset.id); save('notes', data); renderNotes();
  } else if (act === 'add-focus') {
    const date = new Date().toISOString().slice(0, 10);
    data.events.push({ id: uid('e'), title: 'Focus time', date, start: '14:00', end: '16:00', type: 'focus' });
    save('calendar', data); renderCalendar(); toast('Two hours of focus protected');
  } else if (act === 'copy-booking') {
    const slug = $('#booking-slug').value.trim() || 'swift';
    try { await navigator.clipboard.writeText(`swift://calendar?book=${slug}`); toast('Booking link copied'); }
    catch { toast(`swift://calendar?book=${slug}`); }
  } else if (act === 'remove-event') {
    data.events = data.events.filter((item) => item.id !== button.dataset.id); save('calendar', data); renderCalendar();
  } else if (act === 'download-file') await downloadFile(button.dataset.id);
  else if (act === 'delete-file') {
    try { await call('drive:delete', button.dataset.id); toast('File deleted'); } catch (error) { fail(error); }
  } else if (act === 'task-filter') {
    state.filter = button.dataset.filter; renderTasks();
  } else if (act === 'remove-task') {
    data.tasks = data.tasks.filter((item) => item.id !== button.dataset.id); save('tasks', data); renderTasks();
  } else if (act === 'pull-actions') {
    try {
      const result = await call('apps:collect-actions');
      toast(result.added ? `${result.added} action items pulled into Tasks` : 'No new action items found');
      if (APP_ID === 'tasks') { state.data = await call('apps:get', 'tasks'); renderTasks(); }
    } catch (error) { fail(error); }
  }
});

window.swiftApps.on('swift:auth-changed', async (next) => {
  state.auth = next;
  if (!next.signedIn) state.data = null;
  if (APP_ID !== 'id' && APP_ID !== 'mail') {
    if (next.signedIn && !state.data) await loadData();
    else render();
  } else render();
});

window.swiftApps.on('swift:app-data', (payload) => {
  if (payload.appId === APP_ID && payload.appId === 'drive' && !document.activeElement) {
    state.data = payload.data;
    renderDrive();
  }
});

async function boot() {
  state.meta = await call('apps:meta') || [];
  state.auth = await call('auth:state');
  header();
  if (APP_ID === 'id' || APP_ID === 'mail' || (state.auth && state.auth.signedIn)) await loadData();
  else render();
}

boot().catch((error) => {
  console.error('[swift apps] boot failed', error);
  $('#shell').hidden = false;
  $('#app-body').innerHTML = `<div class="auth-layout"><div class="card auth-card"><h2>Swift could not open this app</h2><p class="error-text">${esc(error && error.message ? error.message : error)}</p></div></div>`;
});
