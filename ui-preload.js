'use strict';

/* Bridge between the browser chrome (a trusted local page) and the main
   process. Only the channels listed here exist: web pages never see this. */

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'swift:state', 'swift:settings', 'swift:set-setting', 'swift:new-tab', 'swift:close-tab',
  'swift:activate-tab', 'swift:navigate', 'swift:back', 'swift:forward', 'swift:reload',
  'swift:stop', 'swift:duplicate-tab', 'swift:privacy-stats', 'swift:reset-stats',
  'swift:bookmarks', 'swift:add-bookmark', 'swift:remove-bookmark', 'swift:history',
  'swift:clear-history', 'swift:clear-site-data', 'swift:resolve-url', 'swift:open-external',
  'swift:minimize', 'swift:maximize', 'swift:close-window', 'swift:fullscreen',
  'swift:find', 'swift:find-stop', 'swift:zoom', 'swift:devtools', 'swift:new-private-window',
  'swift:export-data', 'swift:version', 'swift:focus-address', 'swift:frame', 'swift:sleep-tab',
  'swift:panel', 'swift:auth-state', 'swift:edition'
];

const EVENTS = [
  'swift:tabs', 'swift:tab', 'swift:stats', 'swift:download', 'swift:settings',
  'swift:find-result', 'swift:focus-address', 'swift:open-panel', 'swift:auth-changed'
];

const invoke = (channel, ...args) => {
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown Swift channel: ${channel}`);
  return ipcRenderer.invoke(channel, ...args);
};

contextBridge.exposeInMainWorld('swift', {
  platform: process.platform,
  invoke,
  on: (event, handler) => {
    if (!EVENTS.includes(event) || typeof handler !== 'function') return () => {};
    const listener = (_event, ...args) => handler(...args);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }
});
