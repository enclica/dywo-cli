/**
 * DYWO Client-Side Runtime
 * A tiny (~4-5kb minified) vanilla JavaScript framework for the browser.
 * Injected into every compiled DYWO project's HTML at build time.
 *
 * Sections:
 *   1. Utilities
 *   2. Reactivity (Proxy-based)
 *   3. Template Engine (directives, interpolation)
 *   4. Component System (mount, lifecycle, registry)
   *   5. Client-Side Router (hash + history modes)
 *   5b. Event Routing / System Bus (dywo-emit, dywo-on, dywo-send, dywo-receive)
 *   6. Public API (window.Dywo)
 *   7. Auto-initialization
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. UTILITIES
  // ─────────────────────────────────────────────────────────────────────────────

  var _exprCache = {};
  var _renderCache = new WeakMap();

  function getAllKeys(obj) {
    var keys = [];
    var seen = {};
    var current = obj;
    while (current && current !== Object.prototype) {
      var ownKeys = Object.getOwnPropertyNames(current);
      for (var i = 0; i < ownKeys.length; i++) {
        var key = ownKeys[i];
        if (!seen[key] && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) && key.slice(0, 2) !== '__') {
          seen[key] = true;
          keys.push(key);
        }
      }
      current = Object.getPrototypeOf(current);
    }
    return keys;
  }

  function evalExpr(expr, ctx) {
    expr = expr.trim();
    if (!expr) return undefined;

    var ctxCache = _renderCache.get(ctx);
    if (ctxCache && expr in ctxCache) return ctxCache[expr];

    var keys = getAllKeys(ctx);
    var cacheKey = expr + '\0' + keys.join(',');
    var fn = _exprCache[cacheKey];
    if (!fn) {
      try {
        fn = new Function(keys.join(','), 'return (' + expr + ')');
        _exprCache[cacheKey] = fn;
      } catch (e) {
        return undefined;
      }
    }

    try {
      var args = new Array(keys.length);
      for (var i = 0; i < keys.length; i++) args[i] = ctx[keys[i]];
      var result = fn.apply(null, args);
      if (!ctxCache) {
        ctxCache = {};
        _renderCache.set(ctx, ctxCache);
      }
      ctxCache[expr] = result;
      return result;
    } catch (e) {
      return undefined;
    }
  }

  function extractExprDeps(expr, dataKeys) {
    if (!expr) return {};
    var stripped = expr.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
    var idents = stripped.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
    var deps = {};
    for (var i = 0; i < idents.length; i++) {
      if (dataKeys.indexOf(idents[i]) !== -1) {
        deps[idents[i]] = true;
      }
    }
    return deps;
  }

  /** Resolve a dotted path on an object, e.g. "user.name" on ctx. */
  function resolvePath(obj, path) {
    return path.split('.').reduce(function (o, k) {
      return o != null ? o[k] : undefined;
    }, obj);
  }

  /** Set a value at a dotted path on an object. */
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var last = parts.pop();
    var target = parts.reduce(function (o, k) { return o[k]; }, obj);
    target[last] = value;
  }

  /** Iterate over a NodeList / array safely. */
  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i], i);
  }

  /** Clone a DOM node deeply. */
  function cloneNode(node) {
    return node.cloneNode(true);
  }

  /** Convert an HTML string into a document fragment. */
  function parseHTML(html) {
    var tpl = document.createElement('template');
    if (tpl.content !== undefined) {
      tpl.innerHTML = html;
      return tpl.content.cloneNode(true);
    }
    // Fallback for browsers without <template>
    var div = document.createElement('div');
    div.innerHTML = html;
    var frag = document.createDocumentFragment();
    while (div.firstChild) frag.appendChild(div.firstChild);
    return frag;
  }

  /** Generate a short unique id. */
  var _uid = 0;
  function uid() { return 'dywo-' + (++_uid); }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1b. BUILT-IN HELPERS (~50 available in {{ }} expressions)
  // ─────────────────────────────────────────────────────────────────────────────

  var $helpers = {

    // ── Date/Time (10) ──────────────────────────────────────────────────────
    year:       new Date().getFullYear(),
    month:      new Date().getMonth() + 1,
    day:        new Date().getDate(),
    hour:       new Date().getHours(),
    minute:     new Date().getMinutes(),
    second:     new Date().getSeconds(),
    now:        function () { return new Date(); },
    today:      function () { return new Date().toISOString().slice(0, 10); },
    timestamp:  function () { return Date.now(); },
    formatDate: function (d, locale, opts) {
      try { return new Intl.DateTimeFormat(locale || 'en-US', opts).format(d instanceof Date ? d : new Date(d)); }
      catch (e) { return String(d); }
    },

    // ── Math (8) ────────────────────────────────────────────────────────────
    abs:    Math.abs,
    round:  Math.round,
    ceil:   Math.ceil,
    floor:  Math.floor,
    min:    Math.min,
    max:    Math.max,
    random: function (lo, hi) {
      if (lo === undefined) return Math.random();
      if (hi === undefined) { hi = lo; lo = 0; }
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    },
    clamp: function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

    // ── String (6) ──────────────────────────────────────────────────────────
    upper:      function (s) { return s == null ? '' : String(s).toUpperCase(); },
    lower:      function (s) { return s == null ? '' : String(s).toLowerCase(); },
    trim:       function (s) { return s == null ? '' : String(s).trim(); },
    truncate:   function (s, n, end) {
      s = s == null ? '' : String(s); n = n || 50;
      return s.length > n ? s.slice(0, n) + (end || '…') : s;
    },
    capitalize: function (s) {
      s = s == null ? '' : String(s);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    slug: function (s) {
      return s == null ? '' : String(s).toLowerCase().trim()
        .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '');
    },

    // ── Formatting (3) ──────────────────────────────────────────────────────
    currency: function (n, sym, locale) {
      try { return new Intl.NumberFormat(locale || 'en-US', { style: 'currency', currency: sym || 'USD' }).format(n); }
      catch (e) { return (sym || '$') + Number(n).toFixed(2); }
    },
    percent: function (n, digits) {
      try { return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: digits || 0 }).format(n); }
      catch (e) { return (n * 100).toFixed(digits || 0) + '%'; }
    },
    number: function (n, locale) {
      try { return new Intl.NumberFormat(locale || 'en-US').format(n); }
      catch (e) { return String(n); }
    },

    // ── Array (8) ───────────────────────────────────────────────────────────
    len:     function (a) { return a && a.length != null ? a.length : 0; },
    first:   function (a) { return Array.isArray(a) ? a[0] : undefined; },
    last:    function (a) { return Array.isArray(a) ? a[a.length - 1] : undefined; },
    sort:    function (a) { return Array.isArray(a) ? a.slice().sort() : []; },
    reverse: function (a) { return Array.isArray(a) ? a.slice().reverse() : []; },
    join:    function (a, sep) { return Array.isArray(a) ? a.join(sep == null ? ', ' : sep) : ''; },
    range:   function (start, end, step) {
      if (end === undefined) { end = start; start = 0; }
      step = step || (start <= end ? 1 : -1);
      var r = [];
      if (step > 0) { for (var i = start; i < end; i += step) r.push(i); }
      else { for (var j = start; j > end; j += step) r.push(j); }
      return r;
    },
    chunk: function (a, size) {
      if (!Array.isArray(a) || !size) return [];
      var r = [];
      for (var i = 0; i < a.length; i += size) r.push(a.slice(i, i + size));
      return r;
    },

    // ── Comparison / Logic (8) ──────────────────────────────────────────────
    eq:      function (a, b) { return a === b; },
    neq:     function (a, b) { return a !== b; },
    gt:      function (a, b) { return a > b; },
    gte:     function (a, b) { return a >= b; },
    lt:      function (a, b) { return a < b; },
    lte:     function (a, b) { return a <= b; },
    isEmpty: function (v) {
      if (v == null) return true;
      if (typeof v === 'string' || Array.isArray(v)) return v.length === 0;
      if (typeof v === 'object') return Object.keys(v).length === 0;
      return false;
    },
    if_: function (cond, a, b) { return cond ? a : b; },

    // ── Type (1) ────────────────────────────────────────────────────────────
    typeof_: function (v) { return typeof v; },

    // ── URL (3) ─────────────────────────────────────────────────────────────
    urlPath:  typeof window !== 'undefined' ? window.location.pathname : '/',
    urlQuery: typeof window !== 'undefined' ? window.location.search : '',
    urlHash:  typeof window !== 'undefined' ? window.location.hash : '',

    // ── Encoding (5) ────────────────────────────────────────────────────────
    encode:    function (s) { return encodeURIComponent(s == null ? '' : s); },
    decode:    function (s) { try { return decodeURIComponent(s); } catch (e) { return s; } },
    json:      function (v, pretty) { return JSON.stringify(v, null, pretty ? 2 : 0); },
    parseJson: function (s) { try { return JSON.parse(s); } catch (e) { return null; } },
    escape:    function (s) {
      return s == null ? '' : String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // ── Utility (6) ─────────────────────────────────────────────────────────
    uuid: function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },
    clone: function (v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } },
    merge: function () { return Object.assign.apply(null, [{}].concat(Array.prototype.slice.call(arguments))); },
    $ref: function (id) { return typeof document !== 'undefined' ? document.getElementById(id) : null; },
    $el: function (sel) { return typeof document !== 'undefined' ? document.querySelector(sel) : null; },
    $focus: function (id) { var el = typeof document !== 'undefined' ? document.getElementById(id) : null; if (el) el.focus(); }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. REACTIVITY
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a reactive proxy around a plain data object.
   * When any property is set, all registered watchers are notified with
   * the full dotted path (e.g. "user.name") for fine-grained tracking.
   *
   * @param {Object} data     - Plain object to make reactive.
   * @param {Function} notify - Called whenever a property changes.
   * @param {string} [prefix] - Internal: dotted path prefix for nested objects.
   * @returns {Proxy}
   */
  function makeReactive(data, notify, prefix) {
    prefix = prefix || '';
    return new Proxy(data, {
      set: function (target, key, value) {
        var old = target[key];
        target[key] = value;
        if (old !== value) notify(prefix + key, value, old);
        return true;
      },
      get: function (target, key) {
        var val = target[key];
        if (val !== null && typeof val === 'object' && !val.__dywoProxy) {
          var nested = makeReactive(val, notify, prefix + key + '.');
          Object.defineProperty(val, '__dywoProxy', { value: true, enumerable: false });
          target[key] = nested;
          return nested;
        }
        return val;
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2b. SYSTEM BUS (Event Routing Helpers)
  // ─────────────────────────────────────────────────────────────────────────────

  function findSystemForNode(node) {
    var el = node;
    while (el && el !== document) {
      if (el.nodeType === Node.ELEMENT_NODE) {
        if (el.__dywoSystem) return el.__dywoSystem;
        if (el.hasAttribute && el.hasAttribute('dywo-system')) return el.getAttribute('dywo-system');
      }
      el = el.parentNode;
    }
    return null;
  }

  function inferDomEvent(node) {
    var tag = node.tagName.toLowerCase();
    if (tag === 'form') return 'submit';
    if (tag === 'select') return 'change';
    if (tag === 'input') {
      var type = (node.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio' || type === 'file') return 'change';
      return 'input';
    }
    if (tag === 'textarea') return 'input';
    return 'click';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2b. SYSTEM STATE (shared state across components)
  // ─────────────────────────────────────────────────────────────────────────────

  var _systemState = {};
  var _stateSubscribers = {};
  var _persistedKeys = {};
  var _persistedStateKeys = {};

  function getSystemState(key) {
    if (!_systemState[key]) {
      var raw = {};
      _systemState[key] = makeReactive(raw, function (path, val) {
        notifyStateSubscribers(key, path, val);
        if (_persistedKeys[key]) {
          persistState(key);
        }
        if (_persistedStateKeys[key]) {
          var pkeys = _persistedStateKeys[key];
          for (var pk in pkeys) {
            try {
              localStorage.setItem(pkeys[pk], JSON.stringify(_systemState[key][pk]));
            } catch (e) {}
          }
        }
      });
    }
    return _systemState[key];
  }

  function subscribeToState(key, callback) {
    if (!_stateSubscribers[key]) _stateSubscribers[key] = [];
    _stateSubscribers[key].push(callback);
  }

  function notifyStateSubscribers(key, path, val) {
    var subs = _stateSubscribers[key];
    if (!subs) return;
    for (var i = 0; i < subs.length; i++) {
      subs[i](path, val);
    }
  }

  function persistState(key) {
    try {
      localStorage.setItem('dywo-state-' + key, JSON.stringify(_systemState[key]));
    } catch (e) {}
  }

  function processState(node, instance, bindings) {
    var key = node.getAttribute('dywo-state');
    node.removeAttribute('dywo-state');

    var systemName = findSystemForNode(node);
    var state;

    if (systemName) {
      var sys = getSystem(systemName);
      state = sys.state;
    } else {
      state = getSystemState(key);
    }

    var data = instance.$data;
    if (data) {
      var dataKeys = Object.keys(data);
      for (var i = 0; i < dataKeys.length; i++) {
        if (!(dataKeys[i] in state)) {
          state[dataKeys[i]] = data[dataKeys[i]];
        }
      }
    }

    instance.$data = state;
    instance._ctx = null;

    var stateKey = systemName || key;
    subscribeToState(stateKey, function (path) {
      instance._ctx = null;
      if (!instance._pendingKeys) {
        instance._pendingKeys = {};
        Promise.resolve().then(function () {
          var keys = instance._pendingKeys;
          instance._pendingKeys = null;
          rerenderInstance(instance, keys);
        });
      }
      instance._pendingKeys[path] = true;
    });
  }

  function processBindState(node, instance, bindings) {
    var key = node.getAttribute('dywo-bind-state');
    node.removeAttribute('dywo-bind-state');

    var systemName = findSystemForNode(node);
    var state, propPath, stateKey;

    if (systemName) {
      var sys = getSystem(systemName);
      state = sys.state;
      propPath = key;
      stateKey = systemName;
    } else {
      var dotIndex = key.indexOf('.');
      if (dotIndex !== -1) {
        stateKey = key.slice(0, dotIndex);
        propPath = key.slice(dotIndex + 1);
      } else {
        stateKey = key;
        propPath = null;
      }
      state = getSystemState(stateKey);
    }

    var tagName = node.tagName.toLowerCase();
    var isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    var isCheckbox = isInput && node.type === 'checkbox';

    function update() {
      var val = propPath ? resolvePath(state, propPath) : state;
      if (isInput) {
        if (isCheckbox) {
          node.checked = !!val;
        } else {
          node.value = val == null ? '' : val;
        }
      } else {
        node.textContent = val == null ? '' : val;
      }
    }

    if (isInput) {
      var eventName = tagName === 'select' ? 'change' : 'input';
      node.addEventListener(eventName, function () {
        var newVal = isCheckbox ? node.checked : node.value;
        if (propPath) {
          setPath(state, propPath, newVal);
        }
      });
    }

    subscribeToState(stateKey, function () {
      update();
    });

    update();
    bindings.push({ update: update, deps: null });
  }

  function processPersist(node) {
    var key = node.getAttribute('dywo-persist');
    node.removeAttribute('dywo-persist');

    var systemName = findSystemForNode(node);
    var state, storageKey;

    if (systemName) {
      var sys = getSystem(systemName);
      state = sys.state;
      storageKey = 'dywo-system-' + systemName + '-' + key;

      if (!_persistedStateKeys[systemName]) _persistedStateKeys[systemName] = {};
      _persistedStateKeys[systemName][key] = storageKey;
    } else {
      state = getSystemState(key);
      storageKey = 'dywo-state-' + key;
      _persistedKeys[key] = true;
    }

    try {
      var stored = localStorage.getItem(storageKey);
      if (stored !== null) {
        var parsed = JSON.parse(stored);
        if (systemName) {
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            var pkeys = Object.keys(parsed);
            for (var i = 0; i < pkeys.length; i++) {
              state[pkeys[i]] = parsed[pkeys[i]];
            }
          } else {
            state[key] = parsed;
          }
        } else {
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            var rkeys = Object.keys(parsed);
            for (var j = 0; j < rkeys.length; j++) {
              state[rkeys[j]] = parsed[rkeys[j]];
            }
          }
        }
      }
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. TEMPLATE ENGINE
  // ─────────────────────────────────────────────────────────────────────────────

  var INTERP_RE = /\{\{((?:[^'"{}]|'[^']*'|"[^"]*")*?)\}\}/g;
  var ESC_OPEN = '\x00DYWO_ESC_OPEN\x00';
  var ESC_CLOSE = '\x00DYWO_ESC_CLOSE\x00';

  /**
   * Walk all DOM nodes inside `root`, process DYWO directives and
   * text interpolations. Returns a list of "binding" descriptors that
   * the component can call to update when state changes.
   *
   * @param {Node}     root      - Container node to walk.
   * @param {Object}   instance  - Component instance (has .$data, .methods, etc.)
   * @param {Object}   registry  - Component registry (child components by name)
   * @returns {Array}  bindings  - Array of { update: fn } objects
   */
  function processTemplate(root, instance, registry) {
    var bindings = [];

    walkNode(root, instance, registry, bindings);

    return bindings;
  }

  /**
   * Recursively walk a node tree, expanding directives top-down.
   * Children are processed after their parent directives so that dywo-if /
   * dywo-for can replace nodes before we try to descend into them.
   */
  function walkNode(node, instance, registry, bindings) {
    if (node.nodeType === Node.TEXT_NODE) {
      processTextNode(node, instance, bindings);
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    var tagName = node.tagName.toLowerCase();

    // ── Replace custom component tags ───────────────────────────────────────
    // e.g. <MyComponent /> or <my-component></my-component>
    var compName = node.tagName; // preserve original case
    var comp = registry[compName] || registry[toPascalCase(tagName)];
    if (comp && tagName !== 'router-view' && comp !== instance.$def) {
      var childInstance = createInstance(comp, instance, registry);
      var childEl = childInstance.$el;
      node.parentNode && node.parentNode.replaceChild(childEl, node);
      childInstance._mount(childEl);
      return; // already processed by child
    }

    // ── <router-view> placeholder ────────────────────────────────────────────
    if (tagName === 'router-view') {
      bindings.push({ type: 'router-view', node: node, instance: instance });
      return;
    }

    // ── dywo-persist (must run before dywo-state to restore localStorage) ────
    if (node.hasAttribute('dywo-persist')) {
      processPersist(node);
    }

    // ── dywo-state (must be before other directives to swap $data) ───────────
    if (node.hasAttribute('dywo-state')) {
      processState(node, instance, bindings);
    }

    // ── dywo-if ─────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-if')) {
      processIf(node, instance, registry, bindings);
      return; // processIf manages children
    }

    // ── dywo-for ────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-for')) {
      processFor(node, instance, registry, bindings);
      return;
    }

    // ── dywo-html ───────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-html')) {
      processHtml(node, instance, bindings);
    }

    // ── dywo-model ──────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-model')) {
      processModel(node, instance, bindings);
    }

    // ── dywo-class ──────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-class')) {
      processClass(node, instance, bindings);
    }

    // ── dywo-show ──────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-show')) {
      processShow(node, instance, bindings);
    }

    // ── dywo-bind-state ──────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-bind-state')) {
      processBindState(node, instance, bindings);
    }

    // ── dywo-on:* debounce/throttle preprocessing ──────────────────────────────
    var _timingAttrs = node.attributes;
    var _hasTiming = false;
    for (var _ti = 0; _ti < _timingAttrs.length; _ti++) {
      var _tn = _timingAttrs[_ti].name;
      if (_tn.indexOf('dywo-on:') === 0 && /\.(debounce|throttle)(\.|$)/.test(_tn)) {
        _hasTiming = true;
        break;
      }
    }
    if (_hasTiming) {
      node.__dywoTimingProcessed = true;
      var _timingSnapshot = Array.prototype.slice.call(node.attributes);
      for (var _tj = 0; _tj < _timingSnapshot.length; _tj++) {
        var _tAttr = _timingSnapshot[_tj];
        if (_tAttr.name.indexOf('dywo-on:') === 0 && /\.(debounce|throttle)(\.|$)/.test(_tAttr.name)) {
          processOnWithTiming(node, _tAttr, instance);
        }
      }
    }

    // ── dywo-bind:* ─────────────────────────────────────────────────────────
    var attrs = Array.prototype.slice.call(node.attributes);
    var boundAttrs = {};
    attrs.forEach(function (attr) {
      if (attr.name.indexOf('dywo-bind:') === 0) {
        boundAttrs[attr.name.slice('dywo-bind:'.length)] = true;
        processBind(node, attr, instance, bindings);
      } else if (attr.name.indexOf('dywo-on:') === 0) {
        processOn(node, attr, instance);
      }
    });

    // ── Attribute interpolation ({{ }} in attribute values) ──────────────────
    processAttrInterpolation(node, instance, bindings, boundAttrs);

    // ── dywo-link (SPA anchor) ───────────────────────────────────────────────
    if (node.hasAttribute('dywo-link') && tagName === 'a') {
      processDywoLink(node);
    }

    // ── dywo-system (must be before emit/on/send/receive) ───────────────────
    if (node.hasAttribute('dywo-system')) {
      processSystem(node, instance);
    }

    // ── dywo-connect (must be before emit/on/send/receive) ──────────────────
    if (node.hasAttribute('dywo-connect')) {
      processConnect(node, instance);
    }

    // ── dywo-emit (system event emission) ───────────────────────────────────
    if (node.hasAttribute('dywo-emit')) {
      processEmit(node, instance);
    }

    // ── dywo-on (system event handling) ─────────────────────────────────────
    if (node.hasAttribute('dywo-on')) {
      processOnSystem(node, instance);
    }

    // ── dywo-send (standalone data sender) ──────────────────────────────────
    if (node.hasAttribute('dywo-send')) {
      processSend(node, instance);
    }

    // ── dywo-receive (standalone data receiver) ─────────────────────────────
    if (node.hasAttribute('dywo-receive')) {
      processReceive(node, instance);
    }

    // ── dywo-action ─────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-action')) {
      processAction(node, instance, bindings);
    }

    // ── dywo-trigger ────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-trigger')) {
      processTrigger(node, instance);
    }

    // ── dywo-lazy (defer processing until visible) ─────────────────────────────
    if (node.hasAttribute('dywo-lazy')) {
      processLazy(node, instance, registry, bindings);
      return;
    }

    // ── dywo-virtual (virtual scrolling with dywo-for) ────────────────────────
    if (node.hasAttribute('dywo-virtual') && node.hasAttribute('dywo-for')) {
      processVirtualScroll(node, instance, registry, bindings);
      return;
    }

    // ── dywo-memo (memoize expressions) ───────────────────────────────────────
    if (node.hasAttribute('dywo-memo')) {
      processMemo(node, instance, bindings);
    }

    // ── dywo-img-lazy (lazy load images) ──────────────────────────────────────
    if (node.hasAttribute('dywo-img-lazy')) {
      processImgLazy(node, instance);
    }

    // ── dywo-prefetch (hover prefetch) ────────────────────────────────────────
    if (node.hasAttribute('dywo-prefetch')) {
      processPrefetchDirective(node, instance);
    }

    // ── dywo-idle (defer to idle time) ────────────────────────────────────────
    if (node.hasAttribute('dywo-idle')) {
      processIdle(node, instance);
    }

    // ── Route prefetching (hover on dywo-link) ────────────────────────────────
    if (node.hasAttribute('dywo-link')) {
      processRoutePrefetch(node);
    }

    // ── CSS Containment ───────────────────────────────────────────────────────
    applyCssContainment(node);

    // ── dywo-ref ──────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-ref')) {
      processRef(node, instance);
    }

    // ── dywo-teleport ─────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-teleport')) {
      processTeleport(node, instance);
    }

    // ── dywo-slot ─────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-slot')) {
      processSlot(node, instance, registry, bindings);
    }

    // ── dywo-slot-name ────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-slot-name')) {
      processSlotName(node, instance, registry, bindings);
      return;
    }

    // ── dywo-watch ────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-watch')) {
      processWatch(node, instance, bindings);
    }

    // ── dywo-transition-group ─────────────────────────────────────────────────
    if (node.hasAttribute('dywo-transition-group')) {
      processTransitionGroup(node, instance, bindings);
    }

    // ── dywo-keep-alive ───────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-keep-alive')) {
      processKeepAlive(node, instance);
    }

    // ── dywo-error-boundary ───────────────────────────────────────────────────
    if (node.hasAttribute('dywo-error-boundary')) {
      processErrorBoundary(node, instance, registry, bindings);
    }

    // ── dywo-text ─────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-text')) {
      processText(node, instance, bindings);
    }

    // ── dywo-style ────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-style')) {
      processStyle(node, instance, bindings);
    }

    // ── dywo-focus ────────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-focus')) {
      processFocus(node, instance, bindings);
    }

    // ── dywo-scroll ───────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-scroll')) {
      processScroll(node, instance);
    }

    // ── dywo-resize ───────────────────────────────────────────────────────────
    if (node.hasAttribute('dywo-resize')) {
      processResize(node, instance);
    }

    // ── Recurse into children ────────────────────────────────────────────────
    // Work on a static snapshot so mutations inside don't break iteration
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function (child) {
      walkNode(child, instance, registry, bindings);
    });
  }

  // ── Text interpolation ─────────────────────────────────────────────────────

  var _interpCache = {};

  function processTextNode(node, instance, bindings) {
    var raw = node.textContent;
    var hasEscape = raw.indexOf('\\{\\{') !== -1 || raw.indexOf('\\}\\}') !== -1;
    if (raw.indexOf('{{') === -1 && !hasEscape) return;

    if (hasEscape) {
      raw = raw.replace(/\\\{\\\{/g, ESC_OPEN).replace(/\\\}\\\}/g, ESC_CLOSE);
    }

    var parts = _interpCache[raw];
    if (!parts) {
      parts = [];
      var lastIndex = 0;
      var match;
      INTERP_RE.lastIndex = 0;
      while ((match = INTERP_RE.exec(raw)) !== null) {
        if (match.index > lastIndex) {
          parts.push({ type: 'text', value: raw.slice(lastIndex, match.index) });
        }
        parts.push({ type: 'expr', expr: match[1].trim() });
        lastIndex = INTERP_RE.lastIndex;
      }
      if (lastIndex < raw.length) {
        parts.push({ type: 'text', value: raw.slice(lastIndex) });
      }
      _interpCache[raw] = parts;
    }

    function update() {
      var ctx = buildCtx(instance);
      var result = '';
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (part.type === 'text') {
          result += part.value;
        } else {
          var val = evalExpr(part.expr, ctx);
          result += val == null ? '' : val;
        }
      }
      if (hasEscape) {
        result = result.replace(new RegExp(ESC_OPEN, 'g'), '{{').replace(new RegExp(ESC_CLOSE, 'g'), '}}');
      }
      node.textContent = result;
    }

    update();
    var dataKeys = Object.keys(instance.$data || {});
    var deps = {};
    for (var di = 0; di < parts.length; di++) {
      if (parts[di].type === 'expr') {
        var partDeps = extractExprDeps(parts[di].expr, dataKeys);
        for (var dk in partDeps) deps[dk] = true;
      }
    }
    bindings.push({ update: update, deps: deps });
  }

  // ── dywo-if / dywo-else ────────────────────────────────────────────────────

  function processIf(node, instance, registry, bindings) {
    var expr = node.getAttribute('dywo-if');
    node.removeAttribute('dywo-if');

    // Find adjacent dywo-else sibling
    var elseSibling = null;
    var next = node.nextSibling;
    while (next) {
      if (next.nodeType === Node.ELEMENT_NODE) {
        if (next.hasAttribute('dywo-else')) {
          elseSibling = next;
          elseSibling.removeAttribute('dywo-else');
        }
        break;
      }
      next = next.nextSibling;
    }

    // Placeholder comments to preserve position in DOM
    var ifAnchor = document.createComment('dywo-if');
    var elseAnchor = elseSibling ? document.createComment('dywo-else') : null;

    node.parentNode.insertBefore(ifAnchor, node);
    node.parentNode.removeChild(node);

    if (elseSibling) {
      elseSibling.parentNode.insertBefore(elseAnchor, elseSibling);
      elseSibling.parentNode.removeChild(elseSibling);
    }

    var ifNode = null;
    var elseNode = null;

    function update() {
      var show = !!evalExpr(expr, buildCtx(instance));

      if (show) {
        if (!ifNode) {
          ifNode = cloneNode(node);
          walkNode(ifNode, instance, registry, bindings);
        }
        if (!ifAnchor.parentNode.contains(ifNode)) {
          ifAnchor.parentNode.insertBefore(ifNode, ifAnchor.nextSibling);
        }
        if (elseNode && elseAnchor.parentNode.contains(elseNode)) {
          elseAnchor.parentNode.removeChild(elseNode);
        }
      } else {
        if (ifNode && ifAnchor.parentNode.contains(ifNode)) {
          ifAnchor.parentNode.removeChild(ifNode);
        }
        if (elseSibling) {
          if (!elseNode) {
            elseNode = cloneNode(elseSibling);
            walkNode(elseNode, instance, registry, bindings);
          }
          if (!elseAnchor.parentNode.contains(elseNode)) {
            elseAnchor.parentNode.insertBefore(elseNode, elseAnchor.nextSibling);
          }
        }
      }
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  // ── dywo-for ───────────────────────────────────────────────────────────────

  function processFor(node, instance, registry, bindings) {
    // Syntax: "item in items" or "(item, index) in items"
    var expr = node.getAttribute('dywo-for');
    node.removeAttribute('dywo-for');

    var match = expr.match(/^\(?(\w+)(?:\s*,\s*(\w+))?\)?\s+in\s+(.+)$/);
    if (!match) {
      console.warn('[DYWO] Invalid dywo-for expression:', expr);
      return;
    }

    var itemVar = match[1];
    var indexVar = match[2] || null;
    var listExpr = match[3].trim();

    var tplNode = node.cloneNode(true);
    var anchor = document.createComment('dywo-for:' + expr);
    node.parentNode.insertBefore(anchor, node);
    node.parentNode.removeChild(node);

    var renderedNodes = [];

    function update() {
      var list = evalExpr(listExpr, buildCtx(instance));
      if (!Array.isArray(list)) list = [];

      // Remove old rendered nodes
      renderedNodes.forEach(function (n) {
        n.parentNode && n.parentNode.removeChild(n);
      });
      renderedNodes = [];

      var parent = anchor.parentNode;
      var insertBefore = anchor.nextSibling;

      list.forEach(function (item, idx) {
        // Build a scoped context for this iteration
        var iterCtx = Object.create(buildCtx(instance));
        iterCtx[itemVar] = item;
        if (indexVar) iterCtx[indexVar] = idx;

        // Create a fake instance wrapping the iteration context
        var iterInstance = Object.create(instance);
        iterInstance.$data = iterCtx;
        iterInstance.$methods = instance.$methods || {};
        iterInstance._ctx = null;

        var clone = cloneNode(tplNode);
        var childBindings = [];
        walkNode(clone, iterInstance, registry, childBindings);

        if (insertBefore) {
          parent.insertBefore(clone, insertBefore);
        } else {
          parent.appendChild(clone);
        }

        renderedNodes.push(clone);
      });
    }

    update();
    bindings.push({ update: update, deps: null });
  }

  // ── dywo-html ──────────────────────────────────────────────────────────────

  function processHtml(node, instance, bindings) {
    var expr = node.getAttribute('dywo-html');
    node.removeAttribute('dywo-html');

    function update() {
      node.innerHTML = evalExpr(expr, buildCtx(instance)) || '';
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  // ── dywo-model ─────────────────────────────────────────────────────────────

  function processModel(node, instance, bindings) {
    var prop = node.getAttribute('dywo-model');
    node.removeAttribute('dywo-model');

    var isCheckbox = node.type === 'checkbox';
    var isSelect = node.tagName.toLowerCase() === 'select';

    function update() {
      var val = resolvePath(instance.$data, prop);
      if (isCheckbox) {
        node.checked = !!val;
      } else {
        node.value = val == null ? '' : val;
      }
    }

    var eventName = isSelect ? 'change' : 'input';
    node.addEventListener(eventName, function () {
      var newVal = isCheckbox ? node.checked : node.value;
      setPath(instance.$data, prop, newVal);
    });

    update();
    var modelDeps = {};
    modelDeps[prop.split('.')[0]] = true;
    bindings.push({ update: update, deps: modelDeps });
  }

  // ── dywo-class ──────────────────────────────────────────────────────────────

  function processClass(node, instance, bindings) {
    var expr = node.getAttribute('dywo-class');
    node.removeAttribute('dywo-class');
    var staticClass = node.className || '';

    function update() {
      var val = evalExpr(expr, buildCtx(instance));
      var extra = '';

      if (typeof val === 'string') {
        extra = val;
      } else if (Array.isArray(val)) {
        extra = val.filter(Boolean).join(' ');
      } else if (val && typeof val === 'object') {
        var parts = [];
        var keys = Object.keys(val);
        for (var i = 0; i < keys.length; i++) {
          if (val[keys[i]]) parts.push(keys[i]);
        }
        extra = parts.join(' ');
      }

      node.className = extra ? (staticClass + ' ' + extra) : staticClass;
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  // ── dywo-show ──────────────────────────────────────────────────────────────

  function processShow(node, instance, bindings) {
    var expr = node.getAttribute('dywo-show');
    node.removeAttribute('dywo-show');
    var transition = node.getAttribute('dywo-transition');
    if (transition) node.removeAttribute('dywo-transition');

    function update() {
      var show = !!evalExpr(expr, buildCtx(instance));
      if (transition) {
        if (show) {
          node.style.display = '';
          node.offsetHeight;
          node.classList.add('dywo-enter-active');
          node.classList.remove('dywo-leave-active');
          setTimeout(function() { node.classList.remove('dywo-enter-active'); }, 300);
        } else {
          node.classList.add('dywo-leave-active');
          node.classList.remove('dywo-enter-active');
          setTimeout(function() {
            if (node.classList.contains('dywo-leave-active')) {
              node.style.display = 'none';
              node.classList.remove('dywo-leave-active');
            }
          }, 300);
        }
      } else {
        node.style.display = show ? '' : 'none';
      }
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  // ── dywo-bind:attr ─────────────────────────────────────────────────────────

  function processBind(node, attr, instance, bindings) {
    var attrName = attr.name.slice('dywo-bind:'.length);
    var expr = attr.value;
    node.removeAttribute(attr.name);

    var tagName = node.tagName.toLowerCase();
    var isInput = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    var isValueBind = attrName === 'value' && isInput;
    var isCheckedBind = attrName === 'checked' && tagName === 'input';

    function update() {
      var val = evalExpr(expr, buildCtx(instance));
      if (isValueBind) {
        node.value = val == null ? '' : val;
      } else if (isCheckedBind) {
        node.checked = !!val;
      } else if (val == null || val === false) {
        node.removeAttribute(attrName);
      } else if (val === true) {
        node.setAttribute(attrName, '');
      } else {
        node.setAttribute(attrName, val);
      }
    }

    if (isValueBind || isCheckedBind) {
      var eventName = (tagName === 'select' || isCheckedBind) ? 'change' : 'input';
      node.addEventListener(eventName, function () {
        var newVal = isCheckedBind ? node.checked : node.value;
        setPath(instance.$data, expr.trim(), newVal);
      });
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  // ── Attribute interpolation ({{ }} in attribute values) ────────────────────

  var _attrInterpCache = {};

  function processAttrInterpolation(node, instance, bindings, skipAttrs) {
    var attrs = Array.prototype.slice.call(node.attributes);
    for (var i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      var name = attr.name;
      var raw = attr.value;

      if (skipAttrs[name]) continue;
      if (name.indexOf('dywo-') === 0) continue;
      if (raw.indexOf('{{') === -1) continue;

      (function(attrName, template) {
        var parts = _attrInterpCache[template];
        if (!parts) {
          parts = [];
          var lastIndex = 0;
          var match;
          INTERP_RE.lastIndex = 0;
          while ((match = INTERP_RE.exec(template)) !== null) {
            if (match.index > lastIndex) {
              parts.push({ type: 'text', value: template.slice(lastIndex, match.index) });
            }
            parts.push({ type: 'expr', expr: match[1].trim() });
            lastIndex = INTERP_RE.lastIndex;
          }
          if (lastIndex < template.length) {
            parts.push({ type: 'text', value: template.slice(lastIndex) });
          }
          _attrInterpCache[template] = parts;
        }

        function update() {
          var ctx = buildCtx(instance);
          var result = '';
          for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            if (part.type === 'text') {
              result += part.value;
            } else {
              var val = evalExpr(part.expr, ctx);
              result += val == null ? '' : val;
            }
          }
          node.setAttribute(attrName, result);
        }

        update();
        var dataKeys = Object.keys(instance.$data || {});
        var deps = {};
        for (var di = 0; di < parts.length; di++) {
          if (parts[di].type === 'expr') {
            var partDeps = extractExprDeps(parts[di].expr, dataKeys);
            for (var dk in partDeps) deps[dk] = true;
          }
        }
        bindings.push({ update: update, deps: deps });
      })(name, raw);
    }
  }

  // ── dywo-on:event ──────────────────────────────────────────────────────────

  function processOn(node, attr, instance) {
    if (node.__dywoTimingProcessed && /\.(debounce|throttle)(\.|$)/.test(attr.name)) return;
    var fullEventName = attr.name.slice('dywo-on:'.length);
    var parts = fullEventName.split('.');
    var eventName = parts[0];
    var modifiers = parts.slice(1);
    var handlerExpr = attr.value.trim();
    node.removeAttribute(attr.name);

    var listenerOpts = {};
    if (modifiers.indexOf('once') !== -1) listenerOpts.once = true;
    if (modifiers.indexOf('capture') !== -1) listenerOpts.capture = true;
    if (modifiers.indexOf('passive') !== -1) listenerOpts.passive = true;

    node.addEventListener(eventName, function (event) {
      if (modifiers.indexOf('self') !== -1 && event.target !== node) return;
      if (modifiers.indexOf('prevent') !== -1) event.preventDefault();
      if (modifiers.indexOf('stop') !== -1) event.stopPropagation();

      var ctx = buildCtx(instance);
      ctx.$event = event;

      var inlineCall = handlerExpr.match(/^(\w+)\((.*)\)$/);
      if (inlineCall) {
        var methodName = inlineCall[1];
        var method = instance.$methods[methodName] || ctx[methodName];
        if (typeof method === 'function') {
          var argStr = inlineCall[2].trim();
          var args = argStr ? evalExpr('[' + argStr + ']', ctx) : [];
          method.apply(ctx, args);
        }
      } else {
        var fn = instance.$methods[handlerExpr] || ctx[handlerExpr];
        if (typeof fn === 'function') {
          fn.call(ctx, event);
        } else {
          evalExpr(handlerExpr, ctx);
        }
      }
    }, listenerOpts);
  }

  // ── dywo-link (SPA navigation) ─────────────────────────────────────────────

  function processDywoLink(anchor) {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      var href = anchor.getAttribute('href');
      if (href) router.navigate(href);
    });
  }

  // ── dywo-emit (System Event Emission) ───────────────────────────────────────

  function processEmit(node, instance) {
    var eventName = node.getAttribute('dywo-emit');
    node.removeAttribute('dywo-emit');
    var sendKey = node.getAttribute('dywo-send');
    if (sendKey) node.removeAttribute('dywo-send');

    var systemName = findSystemForNode(node);
    if (!systemName) {
      console.warn('[DYWO] dywo-emit: no ancestor with dywo-system found');
      return;
    }

    var sys = getSystem(systemName);
    var domEvent = inferDomEvent(node);

    node.addEventListener(domEvent, function (event) {
      var data;
      if (sendKey) {
        data = resolvePath(instance.$data, sendKey);
      } else if (domEvent === 'input' || domEvent === 'change') {
        data = node.type === 'checkbox' ? node.checked : node.value;
      } else {
        data = event;
      }
      sys.emit(eventName, data);
    });
  }

  // ── dywo-on (System Event Handling) ─────────────────────────────────────────

  function processOnSystem(node, instance) {
    var raw = node.getAttribute('dywo-on');
    node.removeAttribute('dywo-on');
    var receiveKey = node.getAttribute('dywo-receive');
    if (receiveKey) node.removeAttribute('dywo-receive');

    var systemName = findSystemForNode(node);
    if (!systemName) {
      console.warn('[DYWO] dywo-on: no ancestor with dywo-system found');
      return;
    }

    var sys = getSystem(systemName);
    var pairs = raw.split(',');

    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].trim();
      var colonIdx = pair.indexOf(':');
      if (colonIdx === -1) continue;
      var eventName = pair.slice(0, colonIdx).trim();
      var method = pair.slice(colonIdx + 1).trim();

      sys.on(eventName, method, instance);

      if (receiveKey) {
        sys.receive(eventName, receiveKey, instance);
      }
    }
  }

  // ── dywo-send (standalone data sender) ──────────────────────────────────────

  function processSend(node, instance) {
    var dataKey = node.getAttribute('dywo-send');
    node.removeAttribute('dywo-send');
    if (!dataKey) return;

    var systemName = findSystemForNode(node);
    if (!systemName) {
      console.warn('[DYWO] dywo-send: no ancestor with dywo-system found');
      return;
    }

    var sys = getSystem(systemName);
    var domEvent = inferDomEvent(node);

    node.addEventListener(domEvent, function () {
      var data = resolvePath(instance.$data, dataKey);
      sys.emit(dataKey, data);
    });
  }

  // ── dywo-receive (standalone data receiver) ─────────────────────────────────

  function processReceive(node, instance) {
    var dataKey = node.getAttribute('dywo-receive');
    node.removeAttribute('dywo-receive');
    if (!dataKey) return;

    var systemName = findSystemForNode(node);
    if (!systemName) {
      console.warn('[DYWO] dywo-receive: no ancestor with dywo-system found');
      return;
    }

    var sys = getSystem(systemName);
    sys.receive(dataKey, dataKey, instance);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3b. PREDONE SYSTEMS
  // ─────────────────────────────────────────────────────────────────────────────

  var _systems = {};

  function getSystem(name) {
    if (!_systems[name]) {
      var sys = {
        name: name,
        connections: [],
        actions: {},
        _handlers: {},
        _receivers: {},
        state: getSystemState(name)
      };
      sys.emit = function (eventName, data) {
        var handlers = sys._handlers[eventName];
        if (handlers) {
          for (var i = 0; i < handlers.length; i++) {
            var h = handlers[i];
            var ctx = buildCtx(h.instance);
            var fn = h.instance.$methods[h.method];
            if (typeof fn === 'function') fn.call(ctx, data);
          }
        }
        var receivers = sys._receivers[eventName];
        if (receivers && data !== undefined) {
          for (var j = 0; j < receivers.length; j++) {
            var r = receivers[j];
            setPath(r.instance.$data, r.prop, data);
          }
        }
      };
      sys.on = function (eventName, method, instance) {
        if (!sys._handlers[eventName]) sys._handlers[eventName] = [];
        sys._handlers[eventName].push({ instance: instance, method: method });
      };
      sys.receive = function (eventName, prop, instance) {
        if (!sys._receivers[eventName]) sys._receivers[eventName] = [];
        sys._receivers[eventName].push({ instance: instance, prop: prop });
      };
      _systems[name] = sys;
    }
    return _systems[name];
  }

  function processSystem(node, instance) {
    var name = node.getAttribute('dywo-system');
    node.removeAttribute('dywo-system');
    if (!name) return;

    var sys = getSystem(name);
    sys.node = node;
    node.__dywoSystem = name;
  }

  function processConnect(node, instance) {
    var systemName = node.getAttribute('dywo-connect');
    node.removeAttribute('dywo-connect');
    if (!systemName) return;

    var sys = getSystem(systemName);
    var entry = { node: node, instance: instance, actions: {} };
    sys.connections.push(entry);
    node.__dywoConnection = systemName;

    node.addEventListener('dywo-system-event', function (e) {
      var detail = e.detail;
      if (!detail) return;
      var handler = entry.actions[detail.action];
      if (typeof handler === 'function') {
        handler.call(buildCtx(instance), detail.payload);
      }
    });
  }

  function processAction(node, instance, bindings) {
    var attrVal = node.getAttribute('dywo-action');
    node.removeAttribute('dywo-action');
    if (!attrVal) return;

    var systemName = node.__dywoConnection || findSystemForNode(node);
    if (!systemName) {
      console.warn('[DYWO] dywo-action="' + attrVal + '" used outside a system or connection');
      return;
    }

    var sys = getSystem(systemName);
    var ctx = buildCtx(instance);
    var fn = instance.$methods[attrVal] || (typeof ctx[attrVal] === 'function' ? ctx[attrVal] : null);

    if (!fn) {
      console.warn('[DYWO] dywo-action: method "' + attrVal + '" not found');
      return;
    }

    var connEntry = null;
    for (var i = 0; i < sys.connections.length; i++) {
      if (sys.connections[i].node === node || sys.connections[i].instance === instance) {
        connEntry = sys.connections[i];
        break;
      }
    }

    if (connEntry) {
      connEntry.actions[attrVal] = fn;
    }
    sys.actions[attrVal] = sys.actions[attrVal] || [];
    sys.actions[attrVal].push({ fn: fn, instance: instance, node: node });

    if (!sys._directHandlers) sys._directHandlers = {};
    sys._directHandlers[attrVal] = function () {
      return fn.apply(buildCtx(instance), arguments);
    };
  }

  function processTrigger(node, instance) {
    var attrVal = node.getAttribute('dywo-trigger');
    node.removeAttribute('dywo-trigger');
    if (!attrVal) return;

    var triggerMatch = attrVal.match(/^(\w+):(\w+)(?:\((.*)\))?$/);
    if (!triggerMatch) {
      console.warn('[DYWO] dywo-trigger expects "systemName:actionName" or "systemName:actionName(args)", got:', attrVal);
      return;
    }

    var systemName = triggerMatch[1];
    var actionName = triggerMatch[2];
    var inlineArgStr = triggerMatch[3];
    var eventAttr = node.getAttribute('dywo-trigger-on');
    var eventName = eventAttr || 'click';
    if (eventAttr) node.removeAttribute('dywo-trigger-on');

    node.addEventListener(eventName, function (e) {
      var sys = _systems[systemName];
      if (!sys) {
        console.warn('[DYWO] trigger: system "' + systemName + '" not found');
        return;
      }

      var payload = null;
      if (inlineArgStr !== undefined && inlineArgStr.trim() !== '') {
        var ctx = buildCtx(instance);
        var parsed = evalExpr('[' + inlineArgStr + ']', ctx);
        payload = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        var payloadExpr = node.getAttribute('dywo-trigger-data');
        if (payloadExpr) {
          payload = evalExpr(payloadExpr, buildCtx(instance));
        }
      }

      var result;

      for (var i = 0; i < sys.connections.length; i++) {
        var conn = sys.connections[i];
        var evt = new CustomEvent('dywo-system-event', {
          detail: { action: actionName, payload: payload, source: node },
          bubbles: false
        });
        conn.node.dispatchEvent(evt);
      }

      var globalHandlers = sys.actions[actionName];
      if (globalHandlers) {
        for (var j = 0; j < globalHandlers.length; j++) {
          var h = globalHandlers[j];
          var alreadyNotified = false;
          for (var k = 0; k < sys.connections.length; k++) {
            if (sys.connections[k].node === h.node) { alreadyNotified = true; break; }
          }
          if (!alreadyNotified) {
            result = h.fn.apply(buildCtx(h.instance), Array.isArray(payload) ? payload : [payload]);
          }
        }
      }

      return result;
    });
  }

  function systemEmit(systemName, actionName, payload) {
    var sys = _systems[systemName];
    if (!sys) return;
    var args = Array.isArray(payload) ? payload : (payload !== undefined ? [payload] : []);
    var result;
    for (var i = 0; i < sys.connections.length; i++) {
      var evt = new CustomEvent('dywo-system-event', {
        detail: { action: actionName, payload: payload, source: null },
        bubbles: false
      });
      sys.connections[i].node.dispatchEvent(evt);
    }
    var handlers = sys.actions[actionName];
    if (handlers) {
      for (var j = 0; j < handlers.length; j++) {
        var h = handlers[j];
        var alreadyNotified = false;
        for (var k = 0; k < sys.connections.length; k++) {
          if (sys.connections[k].node === h.node) { alreadyNotified = true; break; }
        }
        if (!alreadyNotified) {
          result = h.fn.apply(buildCtx(h.instance), args);
        }
      }
    }
    return result;
  }

  // ── Build evaluation context from instance ─────────────────────────────────

  function buildCtx(instance) {
    if (instance._ctx) return instance._ctx;

    var ctx = Object.create($helpers);
    var data = instance.$data || {};

    var chain = [];
    var chainVisited = [];
    var p = data;
    while (p && p !== Object.prototype && p !== $helpers) {
      if (chainVisited.indexOf(p) !== -1) break;
      chainVisited.push(p);
      chain.unshift(p);
      p = Object.getPrototypeOf(p);
      if (chain.length > 50) break;
    }
    var definedKeys = {};
    for (var ci = 0; ci < chain.length; ci++) {
      var dKeys = Object.getOwnPropertyNames(chain[ci]);
      for (var di = 0; di < dKeys.length; di++) {
        var key = dKeys[di];
        if (key in ctx || definedKeys[key]) continue;
        if (key.slice(0, 2) === '__') continue;
        definedKeys[key] = true;
        (function(k) {
          Object.defineProperty(ctx, k, {
            get: function() { return data[k]; },
            set: function(val) { data[k] = val; },
            enumerable: true,
            configurable: true
          });
        })(key);
      }
    }

    var methodsSeen = {};
    var proto = instance;
    while (proto) {
      var methods = proto.$methods;
      if (methods) {
        var mId = methods.__dywoMethodId;
        if (!mId) {
          mId = ++_uid;
          Object.defineProperty(methods, '__dywoMethodId', { value: mId, enumerable: false });
        }
        if (!methodsSeen[mId]) {
          methodsSeen[mId] = true;
          var mkeys = Object.keys(methods);
          for (var j = 0; j < mkeys.length; j++) {
            if (!(mkeys[j] in ctx)) {
              ctx[mkeys[j]] = methods[mkeys[j]].bind(ctx);
            }
          }
        }
      }
      proto = Object.getPrototypeOf(proto);
      if (proto === Object.prototype || proto === null) break;
    }

    ctx.$route = instance.$route || router._currentRoute;
    ctx.$router = router;

    instance._ctx = ctx;
    return ctx;
  }

  // ── camelCase / PascalCase helpers ─────────────────────────────────────────

  function toPascalCase(str) {
    return str.split('-').map(function (s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }).join('');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. COMPONENT SYSTEM
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Inject component scoped styles into document.head.
   * Safe to call multiple times — deduplicates by scopeId.
   * Must be called BEFORE component elements are mounted so styles
   * are available when the browser paints.
   */
  function injectComponentStyles(styles, scopeId) {
    if (!styles || !scopeId || typeof document === 'undefined' || !document.head) return;
    if (document.querySelector('style[data-dywo-scope="' + scopeId + '"]')) return;
    var cssText = styles.filter(Boolean).join('\n');
    if (!cssText) return;
    var el = document.createElement('style');
    el.setAttribute('data-dywo-scope', scopeId);
    el.textContent = cssText;
    document.head.appendChild(el);
  }

  /**
   * Stamp the scoped CSS attribute on every element within a root node
   * so that scoped selectors like `.foo[data-dywo-abc123]` match.
   */
  function stampScopeAttr(root, scopeAttr) {
    root.setAttribute(scopeAttr, '');
    var descendants = root.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) {
      descendants[i].setAttribute(scopeAttr, '');
    }
  }

  /** Global component registry: name → definition object */
  var globalRegistry = {};

  /**
   * Create a component instance from a definition object.
   * The instance holds reactive $data, bound $methods, and lifecycle hooks.
   *
   * @param {Object} def          - Component definition (from .dywo compilation).
   * @param {Object} parentInst   - Parent instance (for context propagation).
   * @param {Object} localReg     - Local component registry (from def.components).
   * @returns {Object}            - Component instance
   */
  function createInstance(def, parentInst, localReg) {
    var registry = Object.assign({}, globalRegistry, localReg || {}, def.components || {});

    var rawData = typeof def.data === 'function' ? def.data.call({}) : {};

    var instance = {
      $def: def,
      $registry: registry,
      $bindings: [],
      $el: null,
      $route: (parentInst && parentInst.$route) || router._currentRoute,
      $parent: parentInst || null,
      $children: [],
      $mounted: false,
      $methods: {},
      $refs: {}
    };

    // Bind all methods to the evaluation context
    var methods = def.methods || {};
    Object.keys(methods).forEach(function (k) {
      instance.$methods[k] = function () {
        return methods[k].apply(buildCtx(instance), arguments);
      };
    });

    // Make data reactive; on any change schedule a batched selective re-render
    instance.$data = makeReactive(rawData, function (key) {
      instance._ctx = null;
      if (!instance._pendingKeys) {
        instance._pendingKeys = {};
        Promise.resolve().then(function() {
          var keys = instance._pendingKeys;
          instance._pendingKeys = null;
          rerenderInstance(instance, keys);
        });
      }
      instance._pendingKeys[key] = true;
    });

    if (def.computed) setupComputed(instance, def.computed);

    // Inject styles BEFORE creating DOM elements so they're available at paint time
    if (def.__styles && def.__scopeId) {
      injectComponentStyles(def.__styles, def.__scopeId);
    }

    // Create a root DOM element from the component template
    var frag = parseHTML(def.__template || '<div></div>');
    // If the template produces a single root element, unwrap it; otherwise wrap
    var root;
    if (frag.childNodes.length === 1 && frag.firstChild.nodeType === Node.ELEMENT_NODE) {
      root = frag.firstChild;
    } else {
      root = document.createElement('div');
      root.appendChild(frag);
    }

    // Stamp scope attribute (data-{scopeId}) on ALL elements for scoped CSS
    if (def.__scopeId) {
      stampScopeAttr(root, 'data-' + def.__scopeId);
    }

    instance.$el = root;

    instance._mount = function (el) { mountInstance(instance, el); };
    instance._rerender = function (keys) { rerenderInstance(instance, keys); };

    return instance;
  }

  /**
   * Mount a component instance into the DOM.
   * Processes the template, attaches bindings, calls mounted() hook.
   */
  function mountInstance(instance, targetEl) {
    var def = instance.$def;

    // Process the live DOM (instance.$el already inserted into target by caller)
    instance.$bindings = processTemplate(targetEl, instance, instance.$registry);

    // Hook up <router-view> placeholders
    instance.$bindings.forEach(function (b) {
      if (b.type === 'router-view') {
        router._registerView(b.node, instance);
      }
    });

    instance.$mounted = true;

    if (typeof def.mounted === 'function') {
      def.mounted.call(buildCtx(instance));
    }
  }

  /**
   * Prototype method: re-render bindings selectively.
   * When called with changedKeys (from reactive setter), only bindings
   * whose deps overlap with the changed keys are updated.
   * When called without changedKeys (e.g. router), all bindings update.
   */
  function rerenderInstance(instance, changedKeys) {
    _renderCache = new WeakMap();
    instance.$bindings.forEach(function (b) {
      if (typeof b.update !== 'function') return;
      if (changedKeys && b.deps !== null) {
        var shouldUpdate = false;
        if (b.deps) {
          for (var dep in b.deps) {
            for (var ck in changedKeys) {
              if (ck === dep || ck.indexOf(dep + '.') === 0) {
                shouldUpdate = true;
                break;
              }
            }
            if (shouldUpdate) break;
          }
        }
        if (!shouldUpdate) return;
      }
      try { b.update(); } catch (e) { /* ignore stale node errors */ }
    });
  }

  /**
   * Public mount function: mounts a component definition to a CSS selector
   * or DOM element, replacing its contents.
   *
   * @param {Object}          componentDef  - Component definition object.
   * @param {string|Element}  selector      - Target DOM element or selector.
   * @returns {Object}                      - Component instance
   */
  function mount(componentDef, selector) {
    var targetEl = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;

    if (!targetEl) {
      console.error('[DYWO] mount: target not found:', selector);
      return null;
    }

    // Inject component styles BEFORE creating the instance or touching the DOM
    if (componentDef.__styles && componentDef.__scopeId) {
      injectComponentStyles(componentDef.__styles, componentDef.__scopeId);
    }

    var instance = createInstance(componentDef, null, {});

    // Replace target content with component root element
    targetEl.innerHTML = '';
    targetEl.appendChild(instance.$el);

    mountInstance(instance, instance.$el);

    // Register routes if this is the root component
    if (componentDef.routes && Array.isArray(componentDef.routes)) {
      router._registerRoutes(componentDef.routes, instance);
    }

    return instance;
  }

  /**
   * Hydrate server-rendered HTML with client-side interactivity.
   * Finds elements with data-dywo-ssr="true", merges server data,
   * and attaches bindings without re-rendering the DOM.
   *
   * @param {Object}          componentDef  - Component definition object.
   * @param {string|Element}  selector      - Target DOM element or selector.
   * @returns {Object}                      - Component instance
   */
  function hydrate(componentDef, selector) {
    var targetEl = typeof selector === 'string'
      ? document.querySelector(selector)
      : selector;

    if (!targetEl) {
      console.error('[DYWO] hydrate: target not found:', selector);
      return null;
    }

    if (componentDef.__styles && componentDef.__scopeId) {
      injectComponentStyles(componentDef.__styles, componentDef.__scopeId);
    }

    var registry = Object.assign({}, globalRegistry, componentDef.components || {});

    var rawData = typeof componentDef.data === 'function' ? componentDef.data.call({}) : {};

    var ssrData = global.__DYWO_SSR_DATA__ || {};
    Object.assign(rawData, ssrData);

    var instance = {
      $def: componentDef,
      $registry: registry,
      $bindings: [],
      $el: targetEl,
      $route: router._currentRoute,
      $parent: null,
      $children: [],
      $mounted: false,
      $methods: {}
    };

    var methods = componentDef.methods || {};
    Object.keys(methods).forEach(function (k) {
      instance.$methods[k] = function () {
        return methods[k].apply(buildCtx(instance), arguments);
      };
    });

    instance.$data = makeReactive(rawData, function (key) {
      instance._ctx = null;
      if (!instance._pendingKeys) {
        instance._pendingKeys = {};
        Promise.resolve().then(function() {
          var keys = instance._pendingKeys;
          instance._pendingKeys = null;
          rerenderInstance(instance, keys);
        });
      }
      instance._pendingKeys[key] = true;
    });

    if (componentDef.__scopeId) {
      stampScopeAttr(targetEl, 'data-' + componentDef.__scopeId);
    }

    var ssrRoot = targetEl.querySelector('[data-dywo-ssr]') || targetEl;
    ssrRoot.removeAttribute('data-dywo-ssr');

    instance.$bindings = processTemplate(ssrRoot, instance, registry);

    instance.$bindings.forEach(function (b) {
      if (b.type === 'router-view') {
        router._registerView(b.node, instance);
      }
    });

    instance.$mounted = true;

    if (typeof componentDef.mounted === 'function') {
      componentDef.mounted.call(buildCtx(instance));
    }

    if (componentDef.routes && Array.isArray(componentDef.routes)) {
      router._registerRoutes(componentDef.routes, instance);
    }

    return instance;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. CLIENT-SIDE ROUTER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Minimal client-side router supporting:
   *   - Hash mode (#/path) — default
   *   - History mode (/path) — opt-in via window.__DYWO_ROUTER_MODE__ = 'history'
   *   - Path parameters: /user/:id
   *   - <router-view> placeholder replacement
   *   - dywo-link anchors for SPA navigation
   */
  var router = (function () {
    var _routes = [];
    var _listeners = [];
    var _currentRoute = { path: '/', params: {}, query: {} };
    var _routerViews = []; // { node, instance }
    var _rootInstance = null;
    var _mode = 'hash'; // 'hash' or 'history'

    /** Parse a URL path + search string into { path, params, query }. */
    function parsePath(rawPath) {
      var parts = rawPath.split('?');
      var path = parts[0] || '/';
      var queryStr = parts[1] || '';
      var query = {};
      if (queryStr) {
        queryStr.split('&').forEach(function (pair) {
          var kv = pair.split('=');
          query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
        });
      }
      return { path: path, query: query };
    }

    /** Match a URL path against a route pattern. Returns params or null. */
    function matchRoute(pattern, urlPath) {
      if (pattern === '*') return {};

      var patternParts = pattern.split('/');
      var urlParts = urlPath.split('/');

      if (patternParts.length !== urlParts.length) return null;

      var params = {};
      for (var i = 0; i < patternParts.length; i++) {
        if (patternParts[i].charAt(0) === ':') {
          params[patternParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
        } else if (patternParts[i] !== urlParts[i]) {
          return null;
        }
      }
      return params;
    }

    /** Get the current URL path depending on router mode. */
    function getCurrentPath() {
      if (_mode === 'history') {
        return window.location.pathname + window.location.search;
      }
      var hash = window.location.hash;
      if (!hash || hash === '#') return '/';
      return hash.slice(1); // strip leading '#'
    }

    /** Render the matched route into all registered <router-view> nodes. */
    function renderRoute(routeObj) {
      _currentRoute = routeObj;

      // Update $route on root instance and trigger re-render
      if (_rootInstance) {
        _rootInstance.$route = routeObj;
        rerenderInstance(_rootInstance);
      }

      _routerViews.forEach(function (rv) {
        var viewNode = rv.node;
        var hostInstance = rv.instance;

        // Clear current content
        var parent = viewNode.parentNode;
        if (!parent) return;

        // Remove previously rendered route component sibling (if any)
        var existing = viewNode.__dywoRouteEl;
        if (existing && existing.parentNode) {
          existing.parentNode.removeChild(existing);
        }

        if (!routeObj.component) return;

        var childInstance = createInstance(routeObj.component, hostInstance, {});
        childInstance.$route = routeObj;

        parent.insertBefore(childInstance.$el, viewNode.nextSibling);
        viewNode.__dywoRouteEl = childInstance.$el;

        mountInstance(childInstance, childInstance.$el);
      });

      // Notify listeners
      _listeners.forEach(function (fn) { fn(routeObj); });
    }

    /** Resolve the current path to a route and render it. */
    function resolve() {
      var parsed = parsePath(getCurrentPath());
      var matched = null;
      var params = {};

      for (var i = 0; i < _routes.length; i++) {
        var route = _routes[i];
        var p = matchRoute(route.path, parsed.path);
        if (p !== null) {
          matched = route;
          params = p;
          break;
        }
      }

      // Fallback to wildcard
      if (!matched) {
        for (var j = 0; j < _routes.length; j++) {
          if (_routes[j].path === '*') {
            matched = _routes[j];
            params = {};
            break;
          }
        }
      }

      renderRoute({
        path: parsed.path,
        params: params,
        query: parsed.query,
        component: matched ? matched.component : null
      });
    }

    /** Navigate to a path. */
    function navigate(path) {
      if (_mode === 'history') {
        window.history.pushState(null, '', path);
        resolve();
      } else {
        // Normalize: strip leading '#' if user accidentally included it
        var hash = path.charAt(0) === '#' ? path : '#' + path;
        window.location.hash = hash;
        // hashchange event will trigger resolve()
      }
    }

    /** Bootstrap: register routes, attach event listeners, resolve initial path. */
    function start(routes, rootInstance, mode) {
      _routes = routes || [];
      _rootInstance = rootInstance;
      _mode = mode || global.__DYWO_ROUTER_MODE__ || 'hash';

      if (_mode === 'history') {
        window.addEventListener('popstate', resolve);
      } else {
        window.addEventListener('hashchange', resolve);
      }

      // Intercept all dywo-link anchors (delegated, catches future anchors too)
      document.addEventListener('click', function (e) {
        var el = e.target;
        while (el && el !== document) {
          if (el.tagName === 'A' && el.hasAttribute('dywo-link')) {
            e.preventDefault();
            navigate(el.getAttribute('href'));
            return;
          }
          el = el.parentNode;
        }
      });

      resolve();
    }

    return {
      _currentRoute: _currentRoute,
      _routes: _routes,

      _registerRoutes: function (routes, rootInstance) {
        start(routes, rootInstance);
      },

      _registerView: function (node, instance) {
        _routerViews.push({ node: node, instance: instance });
        if (_routes.length > 0) {
          resolve();
        }
      },

      navigate: navigate,

      back: function () { window.history.back(); },

      forward: function () { window.history.forward(); },

      onRoute: function (callback) {
        _listeners.push(callback);
      }
    };
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────────

  /** Global component definition store. */
  function defineComponent(name, def) {
    def.name = def.name || name;
    globalRegistry[name] = def;
    return def;
  }

  /**
   * Create a standalone reactive object (not tied to a component).
   * Changes do NOT automatically update any DOM — this is a utility
   * for sharing state between components.
   *
   * @param {Object} data
   * @returns {Proxy}
   */
  function reactive(data) {
    return makeReactive(data, function () {});
  }

  /**
   * Auto-initialization entry point.
   * Looks for:
   *   1. window.__DYWO_APP__ = { component, el }  (set by bundled entry module)
   *   2. <div id="app" data-dywo-root="ComponentName">
   */
  function _init() {
    // 1. Inject transition styles first
    if (typeof document !== 'undefined' && document.head) {
      if (!document.querySelector('style[data-dywo-transitions]')) {
        var style = document.createElement('style');
        style.setAttribute('data-dywo-transitions', '');
        style.textContent = '.dywo-enter-active{animation:dywoEnter .3s ease-out}.dywo-leave-active{animation:dywoLeave .3s ease-in}@keyframes dywoEnter{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}@keyframes dywoLeave{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-10px)}}';
        document.head.appendChild(style);
      }

      // 2. Inject all registered component styles BEFORE mounting any components
      var regKeys = Object.keys(globalRegistry);
      for (var i = 0; i < regKeys.length; i++) {
        var def = globalRegistry[regKeys[i]];
        if (def && def.__styles && def.__scopeId) {
          injectComponentStyles(def.__styles, def.__scopeId);
        }
      }
    }

    // 3. Mount or hydrate the app after all styles are in place
    if (global.__DYWO_APP__) {
      var app = global.__DYWO_APP__;
      var hasSSR = typeof document !== 'undefined' && document.querySelector('[data-dywo-ssr]');
      if (hasSSR) {
        hydrate(app.component, app.el || '#app');
      } else {
        mount(app.component, app.el || '#app');
      }
      return;
    }

    // Fallback: look for data-dywo-root attribute
    var rootEl = document.querySelector('[data-dywo-root]');
    if (rootEl) {
      var compName = rootEl.getAttribute('data-dywo-root');
      var def = globalRegistry[compName];
      if (def) {
        var hasSSR = rootEl.querySelector('[data-dywo-ssr]');
        if (hasSSR) {
          hydrate(def, rootEl);
        } else {
          mount(def, rootEl);
        }
      } else {
        console.warn('[DYWO] Component not found in registry:', compName);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. EXPOSE GLOBAL API
  // ─────────────────────────────────────────────────────────────────────────────

  global.Dywo = {
    mount: mount,
    hydrate: hydrate,
    reactive: reactive,
    router: router,
    defineComponent: defineComponent,
    helpers: $helpers,
    _init: _init,
    systems: {
      trigger: function (systemName, actionName, args) {
        var sys = _systems[systemName];
        if (!sys) {
          console.warn('[DYWO] systems.trigger: system "' + systemName + '" not found');
          return;
        }
        if (sys._directHandlers && sys._directHandlers[actionName]) {
          return sys._directHandlers[actionName].apply(null, args || []);
        }
        return systemEmit(systemName, actionName, args);
      },
      register: function (systemName, actions) {
        var sys = getSystem(systemName);
        if (!sys._directHandlers) sys._directHandlers = {};
        var keys = Object.keys(actions);
        for (var i = 0; i < keys.length; i++) {
          if (typeof actions[keys[i]] === 'function') {
            sys._directHandlers[keys[i]] = actions[keys[i]];
          }
        }
      },
      get: function (systemName) {
        return _systems[systemName] || null;
      },
      emit: systemEmit,
      on: function (systemName, eventName, method, instance) {
        var sys = getSystem(systemName);
        sys.on(eventName, method, instance);
      },
      receive: function (systemName, eventName, prop, instance) {
        var sys = getSystem(systemName);
        sys.receive(eventName, prop, instance);
      },
      bus: function (systemName) {
        return getSystem(systemName);
      },
      getState: getSystemState,
      setState: function (key, value) {
        var state = getSystemState(key);
        if (typeof value === 'object' && value !== null) {
          var keys = Object.keys(value);
          for (var i = 0; i < keys.length; i++) {
            state[keys[i]] = value[keys[i]];
          }
        }
      },
      persistState: function (key) {
        _persistedKeys[key] = true;
        persistState(key);
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 7b. ERROR HANDLING
  // ─────────────────────────────────────────────────────────────────────────────

  var _errModal = null;

  function showErrModal(type, msg, stack, comp) {
    if (_errModal) _errModal.remove();
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:8px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow:auto;box-shadow:0 4px 24px rgba(0,0,0,.3)';
    var hdr = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><span style="background:#e53e3e;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700">' + type + '</span></div>';
    var compStr = comp ? '<div style="color:#718096;font-size:13px;margin-bottom:8px">Component: <strong>' + comp + '</strong></div>' : '';
    var msgEl = '<div style="font-size:16px;font-weight:600;color:#1a202c;margin-bottom:12px">' + msg + '</div>';
    var stackEl = stack ? '<pre style="background:#1a202c;color:#e2e8f0;padding:16px;border-radius:6px;font-size:12px;overflow:auto;max-height:300px;font-family:monospace;line-height:1.5">' + stack + '</pre>' : '';
    var btns = '<div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end"><button id="dywo-err-copy" style="padding:8px 16px;border:1px solid #cbd5e0;background:#fff;border-radius:6px;cursor:pointer;font-size:13px">Copy to Clipboard</button><button id="dywo-err-dismiss" style="padding:8px 16px;border:none;background:#e53e3e;color:#fff;border-radius:6px;cursor:pointer;font-size:13px">Dismiss</button></div>';
    card.innerHTML = hdr + compStr + msgEl + stackEl + btns;
    ov.appendChild(card);
    document.body.appendChild(ov);
    _errModal = ov;
    ov.querySelector('#dywo-err-dismiss').onclick = function () { ov.remove(); _errModal = null; };
    ov.querySelector('#dywo-err-copy').onclick = function () {
      var txt = type + ': ' + msg + (comp ? '\nComponent: ' + comp : '') + (stack ? '\n\n' + stack : '');
      navigator.clipboard.writeText(txt);
      var b = this; b.textContent = 'Copied!';
      setTimeout(function () { b.textContent = 'Copy to Clipboard'; }, 2000);
    };
    ov.addEventListener('click', function (e) { if (e.target === ov) { ov.remove(); _errModal = null; } });
  }

  function detectComp(s) {
    if (!s) return null;
    var m = s.match(/dywo-(\w+)/i);
    return m ? m[1] : null;
  }

  window.onerror = function (msg, src, line, col, err) {
    var st = err && err.stack ? err.stack : (src + ':' + line + ':' + col);
    showErrModal('Runtime Error', String(msg), st, detectComp(st));
  };

  window.onunhandledrejection = function (e) {
    var r = e.reason, msg = r && r.message ? r.message : String(r), st = r && r.stack ? r.stack : '';
    showErrModal('Unhandled Promise Rejection', msg, st, detectComp(st));
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AUTO-INIT
  // ─────────────────────────────────────────────────────────────────────────────

  function _safeInit() {
    try { global.Dywo._init(); }
    catch (e) {
      var st = e && e.stack ? e.stack : '';
      showErrModal('Init Error', e && e.message ? e.message : String(e), st, detectComp(st));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _safeInit);
  } else {
    setTimeout(_safeInit, 0);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. PRECONDITION HANDLING (Hover Prefetch)
  // ─────────────────────────────────────────────────────────────────────────────

  var _prefetchCache = {};
  var _prefetching = {};

  function prefetchUrl(url) {
    if (_prefetchCache[url] || _prefetching[url]) return;
    _prefetching[url] = true;
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.onload = function() {
      if (xhr.status === 200) {
        _prefetchCache[url] = xhr.responseText;
      }
      delete _prefetching[url];
    };
    xhr.onerror = function() { delete _prefetching[url]; };
    xhr.send();
  }

  function getPrefetched(url) {
    return _prefetchCache[url] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9b. DYWO-PREFETCH DIRECTIVE
  // ─────────────────────────────────────────────────────────────────────────────

  function processPrefetchDirective(node, instance) {
    var url = node.getAttribute('data-prefetch-url') || node.getAttribute('href');
    node.removeAttribute('dywo-prefetch');
    if (!url) return;

    node.addEventListener('mouseenter', function() { prefetchUrl(url); });
    node.addEventListener('focus', function() { prefetchUrl(url); });

    node.addEventListener('click', function(e) {
      var cached = getPrefetched(url);
      if (cached) {
        e.preventDefault();
        if (window.history && window.history.pushState) {
          window.history.pushState(null, '', url);
        }
        var mainContent = document.querySelector('[dywo-prefetch-target]') || document.querySelector('#app') || document.querySelector('main');
        if (mainContent) {
          mainContent.innerHTML = cached;
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9c. DYWO-LAZY DIRECTIVE (Lazy Loading)
  // ─────────────────────────────────────────────────────────────────────────────

  function processLazy(node, instance, registry, bindings) {
    var threshold = parseFloat(node.getAttribute('dywo-lazy-threshold')) || 0;
    node.removeAttribute('dywo-lazy');
    node.removeAttribute('dywo-lazy-threshold');

    var placeholder = document.createComment('dywo-lazy');
    node.parentNode.insertBefore(placeholder, node);
    var originalNode = node;
    node.parentNode.removeChild(node);
    var mounted = false;

    if (typeof IntersectionObserver !== 'undefined') {
      var observer = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting && !mounted) {
            mounted = true;
            var clone = cloneNode(originalNode);
            placeholder.parentNode.insertBefore(clone, placeholder);
            placeholder.parentNode.removeChild(placeholder);
            walkNode(clone, instance, registry, bindings);
            observer.disconnect();
          }
        }
      }, { threshold: threshold });
      observer.observe(originalNode);
      if (originalNode.parentNode) {
        originalNode.parentNode.insertBefore(originalNode, placeholder.nextSibling);
        observer.observe(originalNode);
        originalNode.style.visibility = 'hidden';
      }
    } else {
      var fallback = cloneNode(originalNode);
      placeholder.parentNode.insertBefore(fallback, placeholder);
      placeholder.parentNode.removeChild(placeholder);
      walkNode(fallback, instance, registry, bindings);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9d. DYWO-ON DEBOUNCE / THROTTLE MODIFIERS
  // ─────────────────────────────────────────────────────────────────────────────

  function processOnWithTiming(node, attr, instance) {
    var fullEventName = attr.name.slice('dywo-on:'.length);
    var parts = fullEventName.split('.');
    var eventName = parts[0];
    var modifiers = parts.slice(1);
    var handlerExpr = attr.value.trim();
    node.removeAttribute(attr.name);

    var isDebounce = modifiers.indexOf('debounce') !== -1;
    var isThrottle = modifiers.indexOf('throttle') !== -1;
    var delay = 300;
    for (var i = 0; i < modifiers.length; i++) {
      var n = parseInt(modifiers[i], 10);
      if (!isNaN(n) && n > 0) { delay = n; break; }
    }

    var timerId = null;
    var lastExec = 0;

    var listenerOpts = {};
    if (modifiers.indexOf('once') !== -1) listenerOpts.once = true;
    if (modifiers.indexOf('capture') !== -1) listenerOpts.capture = true;
    if (modifiers.indexOf('passive') !== -1) listenerOpts.passive = true;

    function executeHandler(event) {
      var ctx = buildCtx(instance);
      ctx.$event = event;
      var inlineCall = handlerExpr.match(/^(\w+)\((.*)\)$/);
      if (inlineCall) {
        var methodName = inlineCall[1];
        var method = instance.$methods[methodName] || ctx[methodName];
        if (typeof method === 'function') {
          var argStr = inlineCall[2].trim();
          var args = argStr ? evalExpr('[' + argStr + ']', ctx) : [];
          method.apply(ctx, args);
        }
      } else {
        var fn = instance.$methods[handlerExpr] || ctx[handlerExpr];
        if (typeof fn === 'function') fn.call(ctx, event);
        else evalExpr(handlerExpr, ctx);
      }
    }

    node.addEventListener(eventName, function(event) {
      if (modifiers.indexOf('self') !== -1 && event.target !== node) return;
      if (modifiers.indexOf('prevent') !== -1) event.preventDefault();
      if (modifiers.indexOf('stop') !== -1) event.stopPropagation();

      if (isDebounce) {
        if (timerId) clearTimeout(timerId);
        timerId = setTimeout(function() { executeHandler(event); }, delay);
      } else if (isThrottle) {
        var now = Date.now();
        if (now - lastExec >= delay) {
          lastExec = now;
          executeHandler(event);
        }
      } else {
        executeHandler(event);
      }
    }, listenerOpts);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9e. DYWO-MEMO DIRECTIVE
  // ─────────────────────────────────────────────────────────────────────────────

  var _memoCache = new WeakMap();

  function processMemo(node, instance, bindings) {
    var expr = node.getAttribute('dywo-memo');
    node.removeAttribute('dywo-memo');
    if (!expr) return;

    var dataKeys = Object.keys(instance.$data || {});
    var deps = extractExprDeps(expr, dataKeys);
    var depKeys = Object.keys(deps);

    if (!_memoCache.has(instance)) _memoCache.set(instance, {});
    var instanceMemo = _memoCache.get(instance);

    function update() {
      var ctx = buildCtx(instance);
      var depSignature = '';
      for (var i = 0; i < depKeys.length; i++) {
        depSignature += depKeys[i] + ':' + JSON.stringify(ctx[depKeys[i]]) + '|';
      }
      if (instanceMemo[expr] && instanceMemo[expr].sig === depSignature) {
        node.textContent = instanceMemo[expr].val;
        return;
      }
      var result = evalExpr(expr, ctx);
      instanceMemo[expr] = { sig: depSignature, val: result };
      node.textContent = result == null ? '' : result;
    }

    update();
    bindings.push({ update: update, deps: deps });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9f. DYWO-IMG-LAZY DIRECTIVE
  // ─────────────────────────────────────────────────────────────────────────────

  function processImgLazy(node, instance) {
    var src = node.getAttribute('dywo-img-lazy');
    node.removeAttribute('dywo-img-lazy');
    if (!src) return;

    var placeholder = node.getAttribute('data-placeholder') || '';
    node.removeAttribute('data-placeholder');
    if (placeholder) node.setAttribute('src', placeholder);
    node.style.background = node.style.background || '#f0f0f0';
    node.setAttribute('data-lazy-src', src);

    if (typeof IntersectionObserver !== 'undefined') {
      var observer = new IntersectionObserver(function(entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            var img = new Image();
            img.onload = function() {
              node.setAttribute('src', src);
              node.style.background = '';
            };
            img.src = src;
            observer.unobserve(node);
          }
        }
      }, { rootMargin: '200px' });
      observer.observe(node);
    } else {
      node.setAttribute('src', src);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9g. ROUTE PREFETCHING
  // ─────────────────────────────────────────────────────────────────────────────

  var _routeComponentCache = {};

  function processRoutePrefetch(node) {
    var href = node.getAttribute('href');
    if (!href) return;

    node.addEventListener('mouseenter', function() {
      if (_routeComponentCache[href]) return;
      var routes = router._routes;
      for (var i = 0; i < routes.length; i++) {
        var route = routes[i];
        var patternParts = route.path.split('/');
        var urlParts = href.split('/');
        if (patternParts.length === urlParts.length) {
          var matched = true;
          for (var j = 0; j < patternParts.length; j++) {
            if (patternParts[j].charAt(0) !== ':' && patternParts[j] !== urlParts[j]) {
              matched = false;
              break;
            }
          }
          if (matched && route.component) {
            _routeComponentCache[href] = route.component;
            break;
          }
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9h. DYWO-IDLE DIRECTIVE
  // ─────────────────────────────────────────────────────────────────────────────

  function processIdle(node, instance) {
    var handlerExpr = node.getAttribute('dywo-idle');
    node.removeAttribute('dywo-idle');
    if (!handlerExpr) return;

    var rIC = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : function(cb) { return setTimeout(cb, 1); };

    rIC(function() {
      var ctx = buildCtx(instance);
      var fn = instance.$methods[handlerExpr] || ctx[handlerExpr];
      if (typeof fn === 'function') {
        fn.call(ctx);
      } else {
        evalExpr(handlerExpr, ctx);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9i. VIRTUAL SCROLLING
  // ─────────────────────────────────────────────────────────────────────────────

  function processVirtualScroll(node, instance, registry, bindings) {
    var expr = node.getAttribute('dywo-for');
    node.removeAttribute('dywo-for');
    node.removeAttribute('dywo-virtual');

    var itemHeight = parseInt(node.getAttribute('dywo-virtual-height'), 10) || 50;
    node.removeAttribute('dywo-virtual-height');

    var match = expr.match(/^\(?(\w+)(?:\s*,\s*(\w+))?\)?\s+in\s+(.+)$/);
    if (!match) return;

    var itemVar = match[1];
    var indexVar = match[2] || null;
    var listExpr = match[3].trim();

    var tplNode = node.cloneNode(true);
    var anchor = document.createComment('dywo-virtual:' + expr);
    node.parentNode.insertBefore(anchor, node);
    node.parentNode.removeChild(node);

    var container = document.createElement('div');
    container.style.cssText = 'overflow-y:auto;position:relative;';
    anchor.parentNode.insertBefore(container, anchor.nextSibling);

    var spacer = document.createElement('div');
    spacer.style.cssText = 'pointer-events:none;';
    container.appendChild(spacer);

    var renderedNodes = [];
    var lastStart = -1;
    var lastEnd = -1;

    function update() {
      var list = evalExpr(listExpr, buildCtx(instance));
      if (!Array.isArray(list)) list = [];

      var totalHeight = list.length * itemHeight;
      spacer.style.height = totalHeight + 'px';

      var scrollTop = container.scrollTop;
      var containerHeight = container.clientHeight || 300;
      var startIdx = Math.max(0, Math.floor(scrollTop / itemHeight) - 2);
      var endIdx = Math.min(list.length - 1, Math.ceil((scrollTop + containerHeight) / itemHeight) + 2);

      if (startIdx === lastStart && endIdx === lastEnd) return;
      lastStart = startIdx;
      lastEnd = endIdx;

      for (var r = 0; r < renderedNodes.length; r++) {
        renderedNodes[r].parentNode && renderedNodes[r].parentNode.removeChild(renderedNodes[r]);
      }
      renderedNodes = [];

      for (var i = startIdx; i <= endIdx; i++) {
        var iterCtx = Object.create(buildCtx(instance));
        iterCtx[itemVar] = list[i];
        if (indexVar) iterCtx[indexVar] = i;

        var iterInstance = Object.create(instance);
        iterInstance.$data = iterCtx;
        iterInstance.$methods = instance.$methods || {};
        iterInstance._ctx = null;

        var clone = cloneNode(tplNode);
        clone.style.cssText = 'position:absolute;top:' + (i * itemHeight) + 'px;left:0;right:0;height:' + itemHeight + 'px;';
        var childBindings = [];
        walkNode(clone, iterInstance, registry, childBindings);
        container.appendChild(clone);
        renderedNodes.push(clone);
      }
    }

    update();
    container.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    bindings.push({ update: update, deps: null });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9j. CSS CONTAINMENT
  // ─────────────────────────────────────────────────────────────────────────────

  function applyCssContainment(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.hasAttribute('dywo-no-contain')) {
      node.removeAttribute('dywo-no-contain');
      return;
    }
    var tagName = node.tagName.toLowerCase();
    if (tagName === 'div' || tagName === 'section' || tagName === 'article' ||
        tagName === 'aside' || tagName === 'main' || tagName === 'header' ||
        tagName === 'footer' || tagName === 'nav') {
      if (!node.style.contain || node.style.contain === '') {
        node.style.contain = 'layout style paint';
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. DEVELOPER EXPERIENCE DIRECTIVES
  // ─────────────────────────────────────────────────────────────────────────────

  function setupComputed(instance, computedDef) {
    var cache = {};
    var valid = false;
    var keys = Object.keys(computedDef);

    instance.$computed = { def: computedDef, keys: keys };

    var origCtx = instance._ctx;
    Object.defineProperty(instance, '_ctx', {
      get: function() { return origCtx; },
      set: function(v) {
        if (v === null) valid = false;
        else valid = true;
        origCtx = v;
      },
      configurable: true,
      enumerable: false
    });

    for (var i = 0; i < keys.length; i++) {
      (function(key) {
        Object.defineProperty(instance.$data, key, {
          get: function() {
            if (!valid || !(key in cache)) {
              var ctx = {};
              var d = instance.$data;
              var allKeys = Object.keys(d);
              for (var di = 0; di < allKeys.length; di++) {
                if (keys.indexOf(allKeys[di]) === -1) {
                  ctx[allKeys[di]] = d[allKeys[di]];
                }
              }
              var m = instance.$methods || {};
              var mk = Object.keys(m);
              for (var mi = 0; mi < mk.length; mi++) ctx[mk[mi]] = m[mk[mi]];
              cache[key] = computedDef[key].call(ctx);
            }
            return cache[key];
          },
          enumerable: true,
          configurable: true
        });
      })(keys[i]);
    }
  }

  function processRef(node, instance) {
    var refName = node.getAttribute('dywo-ref');
    node.removeAttribute('dywo-ref');
    if (!refName) return;
    if (!instance.$refs) instance.$refs = {};
    instance.$refs[refName] = node;
  }

  function processTeleport(node, instance) {
    var selector = node.getAttribute('dywo-teleport');
    node.removeAttribute('dywo-teleport');
    if (!selector) return;

    var target = document.querySelector(selector);
    if (!target) {
      console.warn('[DYWO] dywo-teleport: target not found:', selector);
      return;
    }

    var originalParent = node.parentNode;
    var placeholder = document.createComment('dywo-teleport:' + selector);
    originalParent.insertBefore(placeholder, node);
    originalParent.removeChild(node);
    target.appendChild(node);

    if (!instance._teleports) instance._teleports = [];
    instance._teleports.push({
      node: node,
      placeholder: placeholder,
      originalParent: originalParent
    });
  }

  function processSlot(node, instance, registry, bindings) {
    var slotName = node.getAttribute('dywo-slot');
    node.removeAttribute('dywo-slot');
    if (!slotName) return;

    if (!instance._slotContent) instance._slotContent = {};
    instance._slotContent[slotName] = node.cloneNode(true);
  }

  function processSlotName(node, instance, registry, bindings) {
    var slotName = node.getAttribute('dywo-slot-name');
    node.removeAttribute('dywo-slot-name');
    if (!slotName) return;

    var parent = instance.$parent;
    var slotContent = parent && parent._slotContent && parent._slotContent[slotName];

    if (slotContent) {
      var clone = slotContent.cloneNode(true);
      node.parentNode.replaceChild(clone, node);
      walkNode(clone, instance, registry, bindings);
    }
  }

  function processWatch(node, instance, bindings) {
    var expr = node.getAttribute('dywo-watch');
    node.removeAttribute('dywo-watch');
    if (!expr) return;

    var pairs = expr.split(',');
    for (var i = 0; i < pairs.length; i++) {
      var pair = pairs[i].trim();
      var colonIdx = pair.indexOf(':');
      if (colonIdx === -1) continue;
      var dataKey = pair.slice(0, colonIdx).trim();
      var methodName = pair.slice(colonIdx + 1).trim();

      (function(key, method) {
        var lastVal = resolvePath(instance.$data, key);
        var deps = {};
        deps[key.split('.')[0]] = true;

        function update() {
          var currentVal = resolvePath(instance.$data, key);
          if (currentVal !== lastVal) {
            var oldVal = lastVal;
            lastVal = currentVal;
            var ctx = buildCtx(instance);
            var fn = instance.$methods[method] || ctx[method];
            if (typeof fn === 'function') {
              fn.call(ctx, currentVal, oldVal);
            }
          }
        }

        update();
        bindings.push({ update: update, deps: deps });
      })(dataKey, methodName);
    }
  }

  function processTransitionGroup(node, instance, bindings) {
    var transitionName = node.getAttribute('dywo-transition-group');
    node.removeAttribute('dywo-transition-group');
    if (!transitionName) return;

    var prevChildren = [];

    function update() {
      var currentChildren = Array.prototype.slice.call(node.children);
      var added = [];
      var removed = [];

      for (var i = 0; i < currentChildren.length; i++) {
        if (prevChildren.indexOf(currentChildren[i]) === -1) {
          added.push(currentChildren[i]);
        }
      }

      for (var j = 0; j < prevChildren.length; j++) {
        if (currentChildren.indexOf(prevChildren[j]) === -1) {
          removed.push(prevChildren[j]);
        }
      }

      for (var ai = 0; ai < added.length; ai++) {
        added[ai].classList.add(transitionName + '-enter');
        added[ai].classList.add(transitionName + '-enter-active');
        (function(el) {
          setTimeout(function() {
            el.classList.remove(transitionName + '-enter');
            el.classList.remove(transitionName + '-enter-active');
          }, 300);
        })(added[ai]);
      }

      for (var ri = 0; ri < removed.length; ri++) {
        removed[ri].classList.add(transitionName + '-leave');
        removed[ri].classList.add(transitionName + '-leave-active');
        (function(el) {
          setTimeout(function() {
            if (el.parentNode) el.parentNode.removeChild(el);
          }, 300);
        })(removed[ri]);
      }

      prevChildren = currentChildren;
    }

    prevChildren = Array.prototype.slice.call(node.children);
    bindings.push({ update: update, deps: null });
  }

  function processKeepAlive(node, instance) {
    var attrVal = node.getAttribute('dywo-keep-alive');
    node.removeAttribute('dywo-keep-alive');

    if (!instance._keepAliveCache) instance._keepAliveCache = {};
    node.__dywoKeepAlive = true;
    node.__dywoKeepAliveInstance = instance;
  }

  function processErrorBoundary(node, instance, registry, bindings) {
    var handlerName = node.getAttribute('dywo-error-boundary');
    node.removeAttribute('dywo-error-boundary');

    var fallbackContent = null;
    var errorState = { hasError: false, error: null };

    var fallbackEl = node.querySelector('[dywo-error-fallback]');
    if (fallbackEl) {
      fallbackContent = fallbackEl.cloneNode(true);
      fallbackEl.parentNode.removeChild(fallbackEl);
      fallbackContent.removeAttribute('dywo-error-fallback');
      fallbackContent.style.display = 'none';
      node.appendChild(fallbackContent);
    }

    node.__dywoErrorBoundary = {
      handler: handlerName,
      instance: instance,
      fallback: fallbackContent,
      errorState: errorState
    };

    function update() {
      if (errorState.hasError && fallbackContent) {
        fallbackContent.style.display = '';
      } else if (fallbackContent) {
        fallbackContent.style.display = 'none';
      }
    }

    bindings.push({ update: update, deps: null });
  }

  function processText(node, instance, bindings) {
    var expr = node.getAttribute('dywo-text');
    node.removeAttribute('dywo-text');

    function update() {
      var val = evalExpr(expr, buildCtx(instance));
      node.textContent = val == null ? '' : val;
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  function processStyle(node, instance, bindings) {
    var expr = node.getAttribute('dywo-style');
    node.removeAttribute('dywo-style');
    var staticStyle = node.getAttribute('style') || '';

    function update() {
      var val = evalExpr(expr, buildCtx(instance));
      if (val && typeof val === 'object') {
        var keys = Object.keys(val);
        for (var i = 0; i < keys.length; i++) {
          var prop = keys[i].replace(/([A-Z])/g, '-$1').toLowerCase();
          if (val[keys[i]] == null || val[keys[i]] === false) {
            node.style.removeProperty(prop);
          } else {
            node.style.setProperty(prop, val[keys[i]]);
          }
        }
      } else if (typeof val === 'string') {
        node.setAttribute('style', staticStyle + (staticStyle ? ';' : '') + val);
      }
    }

    update();
    bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
  }

  function processFocus(node, instance, bindings) {
    var expr = node.getAttribute('dywo-focus');
    node.removeAttribute('dywo-focus');

    function update() {
      var shouldFocus = expr ? !!evalExpr(expr, buildCtx(instance)) : true;
      if (shouldFocus) {
        node.focus();
      }
    }

    update();
    if (expr) {
      bindings.push({ update: update, deps: extractExprDeps(expr, Object.keys(instance.$data || {})) });
    }
  }

  function processScroll(node, instance) {
    var dataKey = node.getAttribute('dywo-scroll');
    node.removeAttribute('dywo-scroll');
    if (!dataKey) return;

    function onScroll() {
      var pos = {
        scrollTop: node.scrollTop,
        scrollLeft: node.scrollLeft,
        scrollHeight: node.scrollHeight,
        scrollWidth: node.scrollWidth,
        clientHeight: node.clientHeight,
        clientWidth: node.clientWidth
      };
      setPath(instance.$data, dataKey, pos);
    }

    node.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function processResize(node, instance) {
    var methodName = node.getAttribute('dywo-resize');
    node.removeAttribute('dywo-resize');
    if (!methodName) return;

    if (typeof ResizeObserver !== 'undefined') {
      var observer = new ResizeObserver(function(entries) {
        var entry = entries[0];
        var ctx = buildCtx(instance);
        var fn = instance.$methods[methodName] || ctx[methodName];
        if (typeof fn === 'function') {
          fn.call(ctx, {
            width: entry.contentRect.width,
            height: entry.contentRect.height,
            entry: entry
          });
        }
      });
      observer.observe(node);

      if (!instance._observers) instance._observers = [];
      instance._observers.push(observer);
    }
  }

})(typeof window !== 'undefined' ? window : this);
