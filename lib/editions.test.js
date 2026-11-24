'use strict';

const assert = require('assert');
const { EDITIONS, detectEdition, visibleApps } = require('./editions');

assert.strictEqual(detectEdition([], {}).id, 'stable');
assert.strictEqual(detectEdition([], { SWIFT_EDITION: 'lite' }).id, 'lite');
assert.strictEqual(detectEdition(['--edition', 'enterprise'], {}).id, 'enterprise');
assert.strictEqual(detectEdition(['--edition=canary'], {}).id, 'nightly');
assert.strictEqual(detectEdition(['--edition=dev'], {}).id, 'developer');
assert.strictEqual(detectEdition(['--edition=unknown'], {}).id, 'stable');

assert.deepStrictEqual(Object.keys(EDITIONS), ['stable', 'lite', 'enterprise', 'beta', 'nightly', 'developer']);
assert.ok(EDITIONS.lite.defaults.turbo);
assert.strictEqual(EDITIONS.enterprise.lockedSettings.includes('trackerBlocking'), true);
assert.strictEqual(EDITIONS.nightly.channel, 'Nightly / Canary');
assert.strictEqual(EDITIONS.developer.remoteDebugging, true);

const meta = [{ id: 'chat' }, { id: 'meet' }, { id: 'ai' }, { id: 'drive' }, { id: 'id' }];
assert.deepStrictEqual(visibleApps(meta, EDITIONS.lite).map((item) => item.id), ['chat', 'id']);
assert.deepStrictEqual(visibleApps(meta, EDITIONS.enterprise).map((item) => item.id), ['chat', 'meet', 'ai', 'drive', 'id']);

console.log('swift editions: all checks passed');
