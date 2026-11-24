'use strict';

/* Bridge for the local Swift apps served from swift://. It is deliberately
   separate from the browser's own preload: apps get only the data channels
   they need, and never see Node or the chrome's privileged IPC. */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'swift:apps:meta', 'swift:auth:state', 'swift:auth:signup', 'swift:auth:signin',
  'swift:auth:signout', 'swift:apps:get', 'swift:apps:save', 'swift:apps:all',
  'swift:drive:upload', 'swift:drive:download', 'swift:drive:delete',
  'swift:ai:search', 'swift:meet:summary', 'swift:apps:collect-actions'
];

const EVENTS = ['swift:auth-changed', 'swift:app-data'];

async function invoke(channel, ...args) {
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown Swift app channel: ${channel}`);
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && result.ok === false) throw new Error(result.error || 'Swift request failed');
  return result && typeof result === 'object' && result.ok === true ? result.value : result;
}

contextBridge.exposeInMainWorld('swiftApps', {
  appId: location.hostname,
  platform: process.platform,
  invoke,
  on(event, handler) {
    if (!EVENTS.includes(event) || typeof handler !== 'function') return () => {};
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
});
