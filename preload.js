'use strict';

/* Injected into every web page. Installs Swift's fingerprint defenses before
   page scripts run. Configuration comes from the main process synchronously,
   so a site cannot read it from the DOM or flip it off. */

const { ipcRenderer } = require('electron');

let config = {};
try {
  config = ipcRenderer.sendSync('swift:content-config', location.href) || {};
} catch {
  config = { level: 'off' };
}

const level = config.level || 'off';
if (level !== 'off' && !config.allowed) {
  const define = (object, key, value) => {
    try {
      Object.defineProperty(object, key, { get: () => value, configurable: false, enumerable: true });
    } catch { /* a hostile page may have frozen the object first */ }
  };

  define(navigator, 'webdriver', false);
  define(navigator, 'hardwareConcurrency', 8);
  define(navigator, 'deviceMemory', 8);
  define(navigator, 'languages', ['en-US', 'en']);
  define(navigator, 'language', 'en-US');

  // A believable, boring hardware profile shared by every Swift user.
  define(screen, 'width', 1920);
  define(screen, 'height', 1080);
  define(screen, 'availWidth', 1920);
  define(screen, 'availHeight', 1040);
  define(screen, 'colorDepth', 24);
  define(screen, 'pixelDepth', 24);
  define(window, 'devicePixelRatio', 1);

  if (navigator.connection && typeof navigator.connection === 'object') {
    define(navigator.connection, 'effectiveType', '4g');
    define(navigator.connection, 'rtt', 50);
    define(navigator.connection, 'downlink', 10);
    define(navigator.connection, 'saveData', false);
  }

  // Mask the GPU strings that WebGL exposes through the debug extension.
  const maskContext = (proto) => {
    if (!proto) return;
    const original = proto.getParameter;
    if (typeof original !== 'function') return;
    proto.getParameter = function (parameter) {
      if (parameter === 37445 || parameter === 0x9245) return 'Swift';
      if (parameter === 37446 || parameter === 0x9246) return 'Swift Graphics';
      return original.call(this, parameter);
    };
  };
  maskContext(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  maskContext(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);

  if (level === 'strict') {
    // Deterministic per-session canvas noise: stable within a five-minute
    // window so normal apps still work, different across sessions.
    const bucket = Math.floor(Date.now() / 300000) % 997;
    const jitter = () => ((bucket * 2654435761) >>> 0) % 3;

    const patchGetImageData = (proto) => {
      if (!proto || typeof proto.getImageData !== 'function') return;
      const original = proto.getImageData;
      proto.getImageData = function (...args) {
        const image = original.apply(this, args);
        try {
          if (image.data.length > 4) image.data[0] = (image.data[0] + jitter()) & 255;
        } catch { /* ignore read-only buffers */ }
        return image;
      };
    };
    patchGetImageData(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype);

    if (typeof HTMLCanvasElement !== 'undefined') {
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...args) {
        try {
          const copy = document.createElement('canvas');
          copy.width = this.width;
          copy.height = this.height;
          const ctx = copy.getContext('2d');
          if (!ctx) return originalToDataURL.apply(this, args);
          ctx.drawImage(this, 0, 0);
          const image = ctx.getImageData(0, 0, copy.width, copy.height);
          if (image.data.length > 4) image.data[0] = (image.data[0] + jitter()) & 255;
          ctx.putImageData(image, 0, 0);
          return originalToDataURL.apply(copy, args);
        } catch {
          return originalToDataURL.apply(this, args);
        }
      };
    }

    // Timers are quantised to make timing-based fingerprinting noisier.
    const originalNow = performance.now.bind(performance);
    Object.defineProperty(performance, 'now', {
      configurable: false,
      value: () => Math.round(originalNow() / 5) * 5
    });
  }
}
