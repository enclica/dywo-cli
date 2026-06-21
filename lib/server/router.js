'use strict';

class Router {
  constructor() {
    this.routes = [];
  }
  get(path, ...handlers) { this._add('GET', path, handlers); return this; }
  post(path, ...handlers) { this._add('POST', path, handlers); return this; }
  put(path, ...handlers) { this._add('PUT', path, handlers); return this; }
  patch(path, ...handlers) { this._add('PATCH', path, handlers); return this; }
  delete(path, ...handlers) { this._add('DELETE', path, handlers); return this; }
  all(path, ...handlers) { this._add('*', path, handlers); return this; }
  
  _add(method, path, handlers) {
    const paramNames = [];
    const regexStr = path.replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    }).replace(/\*/g, '(.*)');
    this.routes.push({ method, path, regex: new RegExp('^' + regexStr + '$'), paramNames, handlers });
  }
  
  mount(prefix, router) {
    router.routes.forEach(route => {
      this.routes.push({
        ...route,
        path: prefix + route.path,
        regex: new RegExp('^' + prefix + route.regex.source.slice(1))
      });
    });
    return this;
  }
}

module.exports = { Router };
