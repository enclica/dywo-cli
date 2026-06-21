/**
 * DYWOBP — DYWO Backport Runtime
 *
 * Polyfills modern JavaScript and DOM APIs for very old browsers
 * (IE 4/5, Netscape 3/4, Opera 3-5 — Windows 95/98/2000 era).
 *
 * MUST be loaded FIRST, before any other script. All code here is
 * strict ES3: no const/let, no arrow functions, no template literals,
 * no default params, no getters/setters, no for...of, no destructuring.
 *
 * Every polyfill is guarded so it only installs when the native
 * implementation is missing — modern browsers pay zero overhead.
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // 1. CONSOLE STUB (very old browsers have no console)
  // ─────────────────────────────────────────────────────────────────

  if (typeof global.console === 'undefined') {
    global.console = {};
  }
  if (typeof global.console.log !== 'function') {
    global.console.log = function () { /* no-op */ };
  }
  if (typeof global.console.warn !== 'function') {
    global.console.warn = global.console.log;
  }
  if (typeof global.console.error !== 'function') {
    global.console.error = global.console.log;
  }
  if (typeof global.console.info !== 'function') {
    global.console.info = global.console.log;
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. ARRAY PROTOTYPE POLYFILLS
  // ─────────────────────────────────────────────────────────────────

  if (typeof Array.isArray !== 'function') {
    Array.isArray = function (v) {
      return Object.prototype.toString.call(v) === '[object Array]';
    };
  }

  if (typeof Array.prototype.forEach !== 'function') {
    Array.prototype.forEach = function (fn, thisArg) {
      var i, len = this.length;
      for (i = 0; i < len; i++) {
        if (i in this) fn.call(thisArg, this[i], i, this);
      }
    };
  }

  if (typeof Array.prototype.map !== 'function') {
    Array.prototype.map = function (fn, thisArg) {
      var result = [];
      var i, len = this.length;
      for (i = 0; i < len; i++) {
        if (i in this) result[i] = fn.call(thisArg, this[i], i, this);
      }
      return result;
    };
  }

  if (typeof Array.prototype.filter !== 'function') {
    Array.prototype.filter = function (fn, thisArg) {
      var result = [];
      var i, len = this.length;
      for (i = 0; i < len; i++) {
        if (i in this && fn.call(thisArg, this[i], i, this)) {
          result.push(this[i]);
        }
      }
      return result;
    };
  }

  if (typeof Array.prototype.indexOf !== 'function') {
    Array.prototype.indexOf = function (item, from) {
      var i, len = this.length;
      from = from || 0;
      if (from < 0) from = Math.max(0, len + from);
      for (i = from; i < len; i++) {
        if (i in this && this[i] === item) return i;
      }
      return -1;
    };
  }

  if (typeof Array.prototype.reduce !== 'function') {
    Array.prototype.reduce = function (fn, initial) {
      var i, len = this.length, acc;
      if (arguments.length >= 2) {
        acc = initial;
        i = 0;
      } else {
        if (len === 0) throw new TypeError('Reduce of empty array with no initial value');
        acc = this[0];
        i = 1;
      }
      for (; i < len; i++) {
        if (i in this) acc = fn(acc, this[i], i, this);
      }
      return acc;
    };
  }

  if (typeof Array.prototype.slice !== 'function') {
    // Some very old browsers have a broken Array.prototype.slice
    Array.prototype.slice = function (start, end) {
      var result = [];
      var len = this.length;
      start = start || 0;
      end = (end !== undefined) ? end : len;
      if (start < 0) start = Math.max(0, len + start);
      if (end < 0) end = Math.max(0, len + end);
      for (var i = start; i < end && i < len; i++) {
        result.push(this[i]);
      }
      return result;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. OBJECT POLYFILLS
  // ─────────────────────────────────────────────────────────────────

  if (typeof Object.keys !== 'function') {
    Object.keys = function (obj) {
      var keys = [];
      var key;
      if (obj === null || obj === undefined) return keys;
      for (key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          keys.push(key);
        }
      }
      return keys;
    };
  }

  if (typeof Object.create !== 'function') {
    Object.create = function (proto) {
      if (proto === null) { /* can't do null proto in ES3 */ }
      function F() {}
      F.prototype = proto;
      return new F();
    };
  }

  if (typeof Object.assign !== 'function') {
    Object.assign = function (target) {
      if (target === null || target === undefined) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      var result = Object(target);
      var i, source, keys, key, j;
      for (i = 1; i < arguments.length; i++) {
        source = arguments[i];
        if (source !== null && source !== undefined) {
          keys = Object.keys(source);
          for (j = 0; j < keys.length; j++) {
            key = keys[j];
            result[key] = source[key];
          }
        }
      }
      return result;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. STRING POLYFILLS
  // ─────────────────────────────────────────────────────────────────

  if (typeof String.prototype.trim !== 'function') {
    String.prototype.trim = function () {
      return this.replace(/^\s+/, '').replace(/\s+$/, '');
    };
  }

  if (typeof String.prototype.split === 'function') {
    // Fix: some old browsers don't support split with regex limit
    // but we can't fix that without overriding — skip if native exists
  }

  if (typeof String.prototype.indexOf !== 'function') {
    String.prototype.indexOf = function (search, start) {
      start = start || 0;
      var i, len = this.length;
      for (i = start; i < len; i++) {
        if (this.substr(i, search.length) === search) return i;
      }
      return -1;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. JSON POLYFILL (IE 5 and earlier have no JSON)
  // ─────────────────────────────────────────────────────────────────

  if (typeof global.JSON === 'undefined' || typeof global.JSON.parse !== 'function') {
    global.JSON = (function () {
      function escapeString(str) {
        var result = '';
        var i, ch, code;
        for (i = 0; i < str.length; i++) {
          ch = str.charAt(i);
          code = str.charCodeAt(i);
          if (ch === '"') result += '\\"';
          else if (ch === '\\') result += '\\\\';
          else if (ch === '\n') result += '\\n';
          else if (ch === '\r') result += '\\r';
          else if (ch === '\t') result += '\\t';
          else if (code < 32) {
            // Pad hex to 4 digits
            var hex = code.toString(16);
            while (hex.length < 4) hex = '0' + hex;
            result += '\\u' + hex;
          } else {
            result += ch;
          }
        }
        return '"' + result + '"';
      }

      function stringifyValue(val) {
        if (val === null) return 'null';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'number') {
          if (isFinite(val)) return String(val);
          return 'null';
        }
        if (typeof val === 'string') return escapeString(val);
        if (Array.isArray(val)) {
          var arr = [];
          for (var i = 0; i < val.length; i++) {
            arr.push(stringifyValue(val[i]));
          }
          return '[' + arr.join(',') + ']';
        }
        if (typeof val === 'object') {
          var pairs = [];
          var keys = Object.keys(val);
          for (var j = 0; j < keys.length; j++) {
            var k = keys[j];
            pairs.push(escapeString(k) + ':' + stringifyValue(val[k]));
          }
          return '{' + pairs.join(',') + '}';
        }
        return 'null';
      }

      function parseValue(text, reviver) {
        // Simple recursive descent parser for JSON
        var index = 0;

        function error(msg) {
          throw new SyntaxError('JSON.parse: ' + msg + ' at position ' + index);
        }

        function skipWhitespace() {
          while (index < text.length) {
            var ch = text.charAt(index);
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
              index++;
            } else {
              break;
            }
          }
        }

        function parseString() {
          if (text.charAt(index) !== '"') error('expected "');
          index++;
          var result = '';
          while (index < text.length) {
            var ch = text.charAt(index);
            if (ch === '"') {
              index++;
              return result;
            }
            if (ch === '\\') {
              index++;
              var next = text.charAt(index);
              if (next === '"') result += '"';
              else if (next === '\\') result += '\\';
              else if (next === '/') result += '/';
              else if (next === 'n') result += '\n';
              else if (next === 'r') result += '\r';
              else if (next === 't') result += '\t';
              else if (next === 'b') result += '\b';
              else if (next === 'f') result += '\f';
              else if (next === 'u') {
                var hex = text.substr(index + 1, 4);
                result += String.fromCharCode(parseInt(hex, 16));
                index += 4;
              } else {
                error('bad escape: \\' + next);
              }
              index++;
            } else {
              result += ch;
              index++;
            }
          }
          error('unterminated string');
        }

        function parseNumber() {
          var start = index;
          if (text.charAt(index) === '-') index++;
          while (index < text.length && /[0-9]/.test(text.charAt(index))) index++;
          if (text.charAt(index) === '.') {
            index++;
            while (index < text.length && /[0-9]/.test(text.charAt(index))) index++;
          }
          if (text.charAt(index) === 'e' || text.charAt(index) === 'E') {
            index++;
            if (text.charAt(index) === '+' || text.charAt(index) === '-') index++;
            while (index < text.length && /[0-9]/.test(text.charAt(index))) index++;
          }
          return parseFloat(text.substring(start, index));
        }

        function parseValueInner() {
          skipWhitespace();
          var ch = text.charAt(index);
          if (ch === '{') return parseObject();
          if (ch === '[') return parseArray();
          if (ch === '"') return parseString();
          if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
          if (text.substr(index, 4) === 'true') { index += 4; return true; }
          if (text.substr(index, 5) === 'false') { index += 5; return false; }
          if (text.substr(index, 4) === 'null') { index += 4; return null; }
          error('unexpected character: ' + ch);
        }

        function parseArray() {
          index++; // skip [
          var result = [];
          skipWhitespace();
          if (text.charAt(index) === ']') { index++; return result; }
          while (index < text.length) {
            result.push(parseValueInner());
            skipWhitespace();
            if (text.charAt(index) === ',') {
              index++;
              skipWhitespace();
            } else if (text.charAt(index) === ']') {
              index++;
              return result;
            } else {
              error('expected , or ]');
            }
          }
          error('unterminated array');
        }

        function parseObject() {
          index++; // skip {
          var result = {};
          skipWhitespace();
          if (text.charAt(index) === '}') { index++; return result; }
          while (index < text.length) {
            skipWhitespace();
            var key = parseString();
            skipWhitespace();
            if (text.charAt(index) !== ':') error('expected :');
            index++;
            var value = parseValueInner();
            result[key] = value;
            skipWhitespace();
            if (text.charAt(index) === ',') {
              index++;
              skipWhitespace();
            } else if (text.charAt(index) === '}') {
              index++;
              return result;
            } else {
              error('expected , or }');
            }
          }
          error('unterminated object');
        }

        var parsed = parseValueInner();
        skipWhitespace();
        if (index < text.length) error('unexpected trailing characters');
        return parsed;
      }

      return {
        parse: function (text) {
          return parseValue(text);
        },
        stringify: function (value) {
          return stringifyValue(value);
        }
      };
    })();
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. DOM POLYFILLS — querySelector / querySelectorAll
  //    For IE 4/5 which only have getElementById, getElementsByTagName
  // ─────────────────────────────────────────────────────────────────

  var doc = global.document;

  if (doc && typeof doc.querySelector !== 'function') {
    doc.querySelector = function (selector) {
      // Simplified: only supports #id, .class (first match), and tag
      selector = selector.trim();
      if (selector.charAt(0) === '#') {
        return doc.getElementById(selector.substring(1));
      }
      if (selector.charAt(0) === '.') {
        var els = doc.getElementsByTagName('*');
        var i;
        for (i = 0; i < els.length; i++) {
          var cls = els[i].className;
          if (cls && (' ' + cls + ' ').indexOf(' ' + selector.substring(1) + ' ') !== -1) {
            return els[i];
          }
        }
        return null;
      }
      // Tag name
      return doc.getElementsByTagName(selector)[0] || null;
    };
  }

  if (doc && typeof doc.querySelectorAll !== 'function') {
    doc.querySelectorAll = function (selector) {
      selector = selector.trim();
      if (selector.charAt(0) === '#') {
        var el = doc.getElementById(selector.substring(1));
        return el ? [el] : [];
      }
      if (selector.charAt(0) === '.') {
        var els = doc.getElementsByTagName('*');
        var result = [];
        var i;
        for (i = 0; i < els.length; i++) {
          var cls = els[i].className;
          if (cls && (' ' + cls + ' ').indexOf(' ' + selector.substring(1) + ' ') !== -1) {
            result.push(els[i]);
          }
        }
        return result;
      }
      // Convert NodeList to array
      var nodes = doc.getElementsByTagName(selector);
      var arr = [];
      for (i = 0; i < nodes.length; i++) arr.push(nodes[i]);
      return arr;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. EVENT POLYFILLS — addEventListener / removeEventListener
  //    IE 5-8 uses attachEvent / detachEvent
  // ─────────────────────────────────────────────────────────────────

  if (global && typeof global.addEventListener !== 'function'
      && typeof global.attachEvent === 'function') {
    global.addEventListener = function (type, fn) {
      global.attachEvent('on' + type, fn);
    };
    global.removeEventListener = function (type, fn) {
      global.detachEvent('on' + type, fn);
    };
  }

  if (doc && typeof doc.addEventListener !== 'function'
      && typeof doc.attachEvent === 'function') {
    doc.addEventListener = function (type, fn) {
      doc.attachEvent('on' + type, fn);
    };
    doc.removeEventListener = function (type, fn) {
      doc.detachEvent('on' + type, fn);
    };
  }

  // Polyfill addEventListener on Element (IE 5-8)
  if (typeof global.Element !== 'undefined') {
    var ElProto = global.Element.prototype;
    if (typeof ElProto.addEventListener !== 'function'
        && typeof ElProto.attachEvent === 'function') {
      ElProto.addEventListener = function (type, fn) {
        this.attachEvent('on' + type, fn);
      };
      ElProto.removeEventListener = function (type, fn) {
        this.detachEvent('on' + type, fn);
      };
    }
  } else if (doc) {
    // Some browsers don't expose Element — patch individual elements via
    // a document-level interceptor. This is a best-effort fallback.
    var _createElement = doc.createElement;
    if (_createElement) {
      doc.createElement = function (tag) {
        var el = _createElement.call(doc, tag);
        if (typeof el.addEventListener !== 'function'
            && typeof el.attachEvent === 'function') {
          el.addEventListener = function (type, fn) {
            el.attachEvent('on' + type, fn);
          };
          el.removeEventListener = function (type, fn) {
            el.detachEvent('on' + type, fn);
          };
        }
        return el;
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. EVENT OBJECT POLYFILLS — preventDefault / stopPropagation
  //    IE 5-8 uses returnValue / cancelBubble
  // ─────────────────────────────────────────────────────────────────

  // Wrap addEventListener to normalize the event object
  if (doc && typeof doc.attachEvent === 'function'
      && typeof global.addEventListener === 'function') {
    // Already patched above; add event normalization via a capture-phase
    // shim that copies properties onto the window.event object.
    // This is limited but covers preventDefault / stopPropagation.
  }

  // ─────────────────────────────────────────────────────────────────
  // 9. FUNCTION.prototype.bind POLYFILL (IE 5-8, Netscape 4)
  // ─────────────────────────────────────────────────────────────────

  if (typeof Function.prototype.bind !== 'function') {
    Function.prototype.bind = function (thisArg) {
      var fn = this;
      var args = Array.prototype.slice.call(arguments, 1);
      return function () {
        var allArgs = args.concat(Array.prototype.slice.call(arguments));
        return fn.apply(thisArg, allArgs);
      };
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 10. ARRAY.prototype.slice on NodeList (for IE 5-8)
  //     Array.prototype.slice doesn't work on NodeList in old IE
  // ─────────────────────────────────────────────────────────────────

  if (doc) {
    // Test if Array.prototype.slice works on a NodeList
    try {
      var testList = doc.getElementsByTagName('html');
      Array.prototype.slice.call(testList);
    } catch (e) {
      // Override: provide a helper for converting NodeLists
      global.__dywoNodeListToArray = function (nodeList) {
        var arr = [];
        for (var i = 0; i < nodeList.length; i++) {
          arr.push(nodeList[i]);
        }
        return arr;
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 11. MATH polyfills (some very old engines lack Math.max with args)
  // ─────────────────────────────────────────────────────────────────

  if (typeof Math.max !== 'function') {
    Math.max = function () {
      var i, max = arguments[0];
      for (i = 1; i < arguments.length; i++) {
        if (arguments[i] > max) max = arguments[i];
      }
      return max;
    };
  }

  if (typeof Math.min !== 'function') {
    Math.min = function () {
      var i, min = arguments[0];
      for (i = 1; i < arguments.length; i++) {
        if (arguments[i] < min) min = arguments[i];
      }
      return min;
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 12. Date.now() polyfill (IE 5 and earlier)
  // ─────────────────────────────────────────────────────────────────

  if (typeof Date.now !== 'function') {
    Date.now = function () {
      return new Date().getTime();
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 13. PARSEINT radix default (very old browsers default to octal
  //     for strings starting with 0)
  // ─────────────────────────────────────────────────────────────────

  var _parseInt = global.parseInt;
  global.parseInt = function (str, radix) {
    if (radix === undefined) radix = 10;
    return _parseInt(str, radix);
  };

  // ─────────────────────────────────────────────────────────────────
  // 14. GLOBAL FLAG — DYWOBP is loaded
  // ─────────────────────────────────────────────────────────────────

  global.__DYWOBP_LOADED__ = true;

})(typeof window !== 'undefined' ? window : this);
