'use strict';

/* Unit checks for the local Swift ID and app data backend. Runs without
   Electron by using a fake ipcMain that records invoke handlers. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAppsBackend } = require('./swift-apps');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swift-apps-test-'));
const handlers = new Map();
const events = [];
const backend = createAppsBackend(dir, { notify: (channel, payload) => events.push([channel, payload]) });
backend.registerIpc({ handle: (channel, fn) => handlers.set(channel, fn) });

const invoke = (channel, ...args) => {
  const handler = handlers.get(channel);
  assert.ok(handler, `missing handler ${channel}`);
  const result = handler({}, ...args);
  if (result && result.ok === false) throw new Error(result.error);
  return result.value;
};

(async () => {
  assert.strictEqual(backend.authState().hasAccount, false);
  assert.strictEqual(invoke('swift:auth:state').signedIn, false);

  const account = invoke('swift:auth:signup', { name: 'Test User', email: 'test@example.com', password: 'correct-horse' });
  assert.strictEqual(account.signedIn, true);
  assert.strictEqual(account.email, 'test@example.com');
  assert.ok(events.some(([channel]) => channel === 'swift:auth-changed'));

  assert.throws(() => invoke('swift:auth:signup', { name: 'Other', email: 'other@example.com', password: 'long-password' }), /already has a Swift ID/);
  invoke('swift:auth:signout');
  assert.strictEqual(invoke('swift:auth:state').signedIn, false);
  assert.throws(() => invoke('swift:auth:signin', 'wrong-password'), /does not match/);
  invoke('swift:auth:signin', 'correct-horse');
  assert.strictEqual(invoke('swift:auth:state').signedIn, true);

  const chat = {
    threads: [{ id: 'c1', title: 'Launch', messages: [{ id: 'm1', author: 'Test User', text: 'TODO: ship the release notes', time: '12:00' }] }]
  };
  invoke('swift:apps:save', 'chat', chat);
  assert.deepStrictEqual(invoke('swift:apps:get', 'chat'), chat);

  const notes = { notes: [{ id: 'n1', text: 'Q3 invoice from Sarah', time: Date.now() }] };
  invoke('swift:apps:save', 'notes', notes);
  const found = invoke('swift:ai:search', 'Q3 invoice Sarah');
  assert.ok(found.results.some((hit) => hit.appId === 'notes'));
  assert.match(found.notice, /coming soon/);

  const summary = invoke('swift:meet:summary', 'We discussed the launch.\nAction: email the team\nWe will ship Friday');
  assert.ok(summary.actions.includes('email the team'));
  assert.strictEqual(invoke('swift:apps:save', 'meet', {
    rooms: [],
    transcripts: [{ id: 't1', room: 'swift-test', text: 'Action: email the team', time: Date.now(), summary: summary.summary, actions: summary.actions }]
  }).transcripts.length, 1);

  const pulled = invoke('swift:apps:collect-actions');
  assert.strictEqual(pulled.added, 3);
  assert.strictEqual(invoke('swift:apps:get', 'tasks').tasks.length, 3);

  const file = invoke('swift:drive:upload', { name: 'q3-invoice.txt', type: 'text/plain', data: Buffer.from('secret invoice contents').toString('base64') });
  const encrypted = fs.readFileSync(path.join(dir, 'swift-drive', `${file.id}.enc`), 'utf8');
  assert.ok(!encrypted.includes('secret invoice'), 'plaintext must never be stored on disk');
  const downloaded = invoke('swift:drive:download', file.id);
  assert.strictEqual(Buffer.from(downloaded.data, 'base64').toString('utf8'), 'secret invoice contents');
  invoke('swift:auth:signout');
  assert.throws(() => invoke('swift:drive:download', file.id), /signing in again/);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('swift apps backend: all checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
