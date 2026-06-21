'use strict';

/**
 * DYWO Server-Side Rendering
 * Renders .dywo components to HTML strings for initial page load.
 * The client-side runtime then hydrates the rendered HTML.
 */

class SSRRenderer {
  constructor(options = {}) {
    this.cache = options.cache ? new Map() : null;
    this.cacheTTL = options.cacheTTL || 60000;
  }

  /**
   * Render a component definition to an HTML string.
   * @param {Object} componentDef - Component definition (from .dywo compilation)
   * @param {Object} props - Initial props/data
   * @param {Object} options - Render options
   * @returns {string} HTML string
   */
  render(componentDef, props = {}, options = {}) {
    const cacheKey = componentDef.name + JSON.stringify(props);
    if (this.cache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.time < this.cacheTTL) {
        return cached.html;
      }
    }

    const data = typeof componentDef.data === 'function' 
      ? componentDef.data.call({}) 
      : {};
    Object.assign(data, props);

    let html = componentDef.__template || '<div></div>';
    
    html = this._processInterpolations(html, data, componentDef);
    html = this._processDirectives(html, data, componentDef);
    
    if (componentDef.__scopeId) {
      html = this._addScopeAttrs(html, componentDef.__scopeId);
    }

    const result = options.hydrate !== false 
      ? `<div data-dywo-ssr="true" data-dywo-component="${componentDef.name || ''}">${html}</div>`
      : html;

    if (this.cache) {
      this.cache.set(cacheKey, { html: result, time: Date.now() });
    }

    return result;
  }

  _processInterpolations(html, data, componentDef) {
    return html.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (match, expr) => {
      try {
        const keys = Object.keys(data);
        const vals = keys.map(k => data[k]);
        const fn = new Function(...keys, 'return (' + expr + ')');
        const result = fn(...vals);
        return result == null ? '' : String(result);
      } catch (e) {
        return '';
      }
    });
  }

  _processDirectives(html, data, componentDef) {
    html = html.replace(/<(\w+)[^>]*\s+dywo-if="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g, 
      (match, tag, expr, content) => {
        try {
          const keys = Object.keys(data);
          const vals = keys.map(k => data[k]);
          const fn = new Function(...keys, 'return (' + expr + ')');
          return fn(...vals) ? content : '';
        } catch (e) {
          return '';
        }
      }
    );

    html = html.replace(/(dywo-show="([^"]*)")/g, (match, full, expr) => {
      try {
        const keys = Object.keys(data);
        const vals = keys.map(k => data[k]);
        const fn = new Function(...keys, 'return (' + expr + ')');
        return fn(...vals) ? '' : 'style="display:none"';
      } catch (e) {
        return '';
      }
    });

    return html;
  }

  _addScopeAttrs(html, scopeId) {
    return html.replace(/<(\w+)/g, `<$1 data-${scopeId}`);
  }

  /**
   * Render a full HTML page with the component.
   */
  renderPage(componentDef, props = {}, options = {}) {
    const componentHtml = this.render(componentDef, props, options);
    const styles = componentDef.__styles ? componentDef.__styles.join('\n') : '';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title || 'DYWO App'}</title>
  ${styles ? `<style>${styles}</style>` : ''}
</head>
<body>
  <div id="app">${componentHtml}</div>
  <script>window.__DYWO_SSR_DATA__ = ${JSON.stringify(props)};</script>
</body>
</html>`;
  }
}

module.exports = { SSRRenderer };
