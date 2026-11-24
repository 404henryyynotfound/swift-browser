/* Swift landing page — all interactions are local and dependency-free. */
(function () {
  'use strict';

  var doc = document;
  var reducedQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var closeMenu = function () {};

  function prefersReducedMotion() {
    return !!(reducedQuery && reducedQuery.matches);
  }

  function onMediaChange(query, handler) {
    if (!query) return;
    if (query.addEventListener) {
      query.addEventListener('change', handler);
    } else if (query.addListener) {
      query.addListener(handler);
    }
  }

  function formatNumber(value) {
    try {
      return value.toLocaleString('en-US');
    } catch (error) {
      return String(value);
    }
  }

  /* ---------- Scroll reveal ---------- */

  function initReveal() {
    var items = Array.prototype.slice.call(doc.querySelectorAll('.reveal'));
    if (!items.length) return;

    if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
      items.forEach(function (item) { item.classList.add('is-visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    items.forEach(function (item) { observer.observe(item); });
  }

  /* ---------- Illustrative counters ---------- */

  function initCounters() {
    var counters = Array.prototype.slice.call(doc.querySelectorAll('[data-counter]'));
    if (!counters.length) return;

    function run(element) {
      if (element.getAttribute('data-done') === '1') return;
      element.setAttribute('data-done', '1');

      var target = parseInt(element.getAttribute('data-to'), 10);
      if (isNaN(target)) target = 0;

      if (prefersReducedMotion() || target === 0) {
        element.textContent = formatNumber(target);
        return;
      }

      var duration = Math.max(250, parseInt(element.getAttribute('data-duration'), 10) || 1500);
      var start = null;

      function tick(now) {
        if (start === null) start = now;
        var progress = Math.min(1, (now - start) / duration);
        var eased = 1 - Math.pow(1 - progress, 3);
        element.textContent = formatNumber(Math.round(target * eased));
        if (progress < 1) {
          window.requestAnimationFrame(tick);
        } else {
          element.textContent = formatNumber(target);
        }
      }

      window.requestAnimationFrame(tick);
    }

    if (!('IntersectionObserver' in window)) {
      counters.forEach(run);
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        run(entry.target);
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.4 });

    counters.forEach(function (counter) { observer.observe(counter); });
  }

  /* ---------- WebGL hero field ---------- */

  var vertexSource = [
    'attribute vec2 a_position;',
    'varying vec2 v_uv;',
    'void main() {',
    '  v_uv = a_position * 0.5 + 0.5;',
    '  gl_Position = vec4(a_position, 0.0, 1.0);',
    '}'
  ].join('\n');

  var fragmentSource = [
    'precision mediump float;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform float u_motion;',
    'uniform vec2 u_pointer;',
    'varying vec2 v_uv;',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  f = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);',
    '}',
    'float fbm(vec2 p) {',
    '  float v = 0.0;',
    '  float amp = 0.5;',
    '  for (int i = 0; i < 4; i++) {',
    '    v += amp * noise(p);',
    '    p *= 2.02;',
    '    amp *= 0.5;',
    '  }',
    '  return v;',
    '}',
    'void main() {',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(u_resolution.y, 1.0);',
    '  float t = u_time;',
    '  float m = u_motion;',
    '  vec2 drift = vec2(t * 0.045, -t * 0.032) * m;',
    '  vec2 q = vec2(fbm(p * 1.6 + drift), fbm(p * 1.6 + vec2(3.7, 1.2) - drift * 0.7));',
    '  vec2 r = vec2(fbm(p * 2.0 + 2.2 * q + vec2(1.7, 9.2) + drift * 0.5),',
    '                fbm(p * 2.0 + 2.2 * q + vec2(8.3, 2.8) - drift * 0.4));',
    '  float field = fbm(p * 1.35 + 2.6 * r);',
    '  float ribbon = sin((p.x * 1.2 + p.y * 0.7 + r.x * 2.6 + t * 0.22 * m) * 3.0);',
    '  ribbon = smoothstep(0.1, 0.95, ribbon * 0.5 + 0.5);',
    '  float glow = pow(max(0.0, 1.25 - length(p - vec2(0.22, -0.03) - u_pointer * 0.05)), 2.4);',
    '  vec3 navy = vec3(0.027, 0.043, 0.086);',
    '  vec3 cyan = vec3(0.133, 0.827, 0.933);',
    '  vec3 indigo = vec3(0.388, 0.400, 0.945);',
    '  vec3 violet = vec3(0.659, 0.333, 0.969);',
    '  vec3 col = navy;',
    '  col = mix(col, indigo, smoothstep(0.28, 0.95, field) * 0.62);',
    '  col = mix(col, violet, smoothstep(0.48, 0.98, r.y) * 0.5);',
    '  col = mix(col, cyan, ribbon * 0.32 + glow * 0.28);',
    '  col += cyan * glow * 0.1;',
    '  float vignette = smoothstep(1.4, 0.2, length(p));',
    '  col *= mix(0.5, 1.0, vignette);',
    '  col *= mix(0.88, 1.0, v_uv.y);',
    '  col += (hash(gl_FragCoord.xy) - 0.5) * 0.016;',
    '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
    '}'
  ].join('\n');

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      if (window.console && console.warn) console.warn('Swift: shader compile failed', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl) {
    var vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    var fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }

    var program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      if (window.console && console.warn) console.warn('Swift: shader link failed', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function initWebGL() {
    var hero = doc.querySelector('.hero');
    var canvas = doc.getElementById('hero-gl');
    if (!hero || !canvas) return;

    var gl = null;
    try {
      var options = {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'high-performance'
      };
      gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    } catch (error) {
      gl = null;
    }
    if (!gl) return; // CSS gradient fallback stays visible.

    var program = createProgram(gl);
    if (!program) return;

    var buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    var position = gl.getAttribLocation(program, 'a_position');
    if (position < 0) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    var uniforms = {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      motion: gl.getUniformLocation(program, 'u_motion'),
      pointer: gl.getUniformLocation(program, 'u_pointer')
    };

    var width = 0;
    var height = 0;
    var elapsed = 0;
    var last = 0;
    var raf = 0;
    var running = false;
    var onScreen = true;
    var disposed = false;
    var pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    function draw(time) {
      if (disposed) return;
      pointer.x += (pointer.tx - pointer.x) * 0.045;
      pointer.y += (pointer.ty - pointer.y) * 0.045;
      if (uniforms.time) gl.uniform1f(uniforms.time, time);
      if (uniforms.motion) gl.uniform1f(uniforms.motion, prefersReducedMotion() ? 0 : 1);
      if (uniforms.pointer) gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function frame(now) {
      if (!running) return;
      if (last) elapsed += Math.min((now - last) / 1000, 0.05);
      last = now;
      draw(elapsed);
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (running || disposed || prefersReducedMotion() || doc.hidden || !onScreen) return;
      running = true;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    }

    function updateLoop() {
      if (disposed) return;
      if (prefersReducedMotion()) {
        stop();
        draw(0);
        return;
      }
      if (doc.hidden || !onScreen) {
        stop();
        return;
      }
      start();
    }

    function resize() {
      if (disposed) return;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Capping DPR keeps the drawing buffer bounded on high-density displays.
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var nextWidth = Math.max(1, Math.round(rect.width * dpr));
      var nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      if (uniforms.resolution) gl.uniform2f(uniforms.resolution, width, height);
      draw(elapsed);
    }

    resize();
    draw(0);
    hero.classList.add('has-webgl');

    var resizeObserver = null;
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(function () { resize(); });
      resizeObserver.observe(canvas);
    }
    window.addEventListener('resize', resize, { passive: true });
    onMediaChange(reducedQuery, updateLoop);
    doc.addEventListener('visibilitychange', updateLoop);

    if ('IntersectionObserver' in window) {
      var visibilityObserver = new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        updateLoop();
      }, { threshold: 0 });
      visibilityObserver.observe(hero);
    }

    if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) {
      hero.addEventListener('pointermove', function (event) {
        var rect = hero.getBoundingClientRect();
        pointer.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        pointer.ty = (0.5 - (event.clientY - rect.top) / rect.height) * 2;
      }, { passive: true });
      hero.addEventListener('pointerleave', function () {
        pointer.tx = 0;
        pointer.ty = 0;
      }, { passive: true });
    }

    canvas.addEventListener('webglcontextlost', function (event) {
      event.preventDefault();
      disposed = true;
      stop();
      hero.classList.remove('has-webgl');
    }, false);

    updateLoop();

    window.addEventListener('pagehide', function (event) {
      if (event.persisted) return;
      disposed = true;
      stop();
      if (resizeObserver) resizeObserver.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    }, false);
  }

  /* ---------- Mobile navigation ---------- */

  function initMenu() {
    var toggle = doc.querySelector('.nav-toggle');
    var nav = doc.getElementById('primary-nav');
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    closeMenu = function () { setOpen(false); };

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.key === 'Esc') setOpen(false);
    });
    doc.addEventListener('click', function (event) {
      if (!nav.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 860) setOpen(false);
    }, { passive: true });
  }

  /* ---------- Smooth in-page links ---------- */

  function initAnchors() {
    var links = Array.prototype.slice.call(doc.querySelectorAll('a[href^="#"]'));
    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        var hash = link.getAttribute('href');
        if (!hash || hash === '#') return;
        var target = doc.getElementById(hash.slice(1));
        if (!target) return;

        event.preventDefault();
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', hash);
        try {
          target.focus({ preventScroll: true });
        } catch (error) {
          target.focus();
        }
        closeMenu();
      });
    });
  }

  /* ---------- Header state ---------- */

  function initHeader() {
    var header = doc.getElementById('site-header');
    if (!header) return;
    var ticking = false;

    function update() {
      header.classList.toggle('is-scrolled', window.scrollY > 12);
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ---------- Copy install commands ---------- */

  function legacyCopy(text) {
    var field = doc.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    doc.body.appendChild(field);
    field.select();
    var copied = false;
    try {
      copied = doc.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    doc.body.removeChild(field);
    return copied;
  }

  function initCopy() {
    var buttons = Array.prototype.slice.call(doc.querySelectorAll('[data-copy-target]'));
    buttons.forEach(function (button) {
      var label = button.querySelector('.copy-button__label');
      var original = label ? label.textContent : 'Copy';

      button.addEventListener('click', function () {
        var source = doc.getElementById(button.getAttribute('data-copy-target'));
        if (!source) return;
        var text = source.textContent.trim();

        function finish(copied) {
          if (label) label.textContent = copied ? 'Copied' : 'Copy failed';
          button.classList.toggle('is-copied', !!copied);
          button.setAttribute('aria-label', copied ? 'Command copied to clipboard' : 'Copy failed; select the command manually');
          if (button.copyTimer) window.clearTimeout(button.copyTimer);
          button.copyTimer = window.setTimeout(function () {
            if (label) label.textContent = original;
            button.classList.remove('is-copied');
            button.setAttribute('aria-label', 'Copy install command');
          }, 1800);
        }

        if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { finish(legacyCopy(text)); });
        } else {
          finish(legacyCopy(text));
        }
      });
    });
  }

  /* ---------- Card glow and misc ---------- */

  function initCardGlow() {
    if (prefersReducedMotion()) return;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    var cards = Array.prototype.slice.call(doc.querySelectorAll('.speed-card, .feature-card'));
    cards.forEach(function (card) {
      card.addEventListener('pointermove', function (event) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty('--x', ((event.clientX - rect.left) / rect.width * 100) + '%');
        card.style.setProperty('--y', ((event.clientY - rect.top) / rect.height * 100) + '%');
      }, { passive: true });
    });
  }

  function initYear() {
    var year = doc.querySelector('[data-year]');
    if (year) year.textContent = String(new Date().getFullYear());
  }

  function init() {
    initReveal();
    initCounters();
    initWebGL();
    initMenu();
    initAnchors();
    initHeader();
    initCopy();
    initCardGlow();
    initYear();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
