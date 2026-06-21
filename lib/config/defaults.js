module.exports = {
  // Entry point - single entry
  entry: './src/main.dywo',

  // Output
  output: {
    dir: './dist',
    publicPath: 'auto',
    filename: {
      js: '[name].[contenthash:8].js',
      css: '[name].[contenthash:8].css',
      html: 'index.html'
    },
    clean: true
  },

  // Static assets directory (copied as-is to output)
  publicDir: './public',

  // Source directory
  srcDir: './src',

  // Path aliases (empty by default — users set these in dywo.config.js)
  alias: {},

  // Compression and minification
  compress: {
    js: {
      minify: true,
      dropConsole: false,
      dropDebugger: true
    },
    css: {
      minify: true,
      autoprefixer: true
    },
    html: {
      minify: true,
      removeComments: true
    },
    gzip: false,
    brotli: false
  },

  // Dev server
  devServer: {
    port: 3000,
    host: 'localhost',
    open: true,
    hmr: true,
    historyApiFallback: true,
    proxy: {}
  },

  // Build targets (browserslist string)
  targets: 'defaults',

  // Source maps
  sourceMaps: {
    dev: 'eval-source-map',
    prod: false
  },

  // Babel config extension
  babel: {
    presets: [],
    plugins: []
  },

  // Multi-page entries (takes precedence over `entry` if set)
  pages: null,

  // Default HTML template
  template: null,

  // LEGCOMP — Legacy compatibility compiler
  // Generates a version of the built site for very old browsers
  // (IE 4/5, Netscape 3/4 — Windows 95-2000 era).
  // Output is written to <output.dir>/<legcomp.output>/.
  legcomp: {
    enabled: false,        // Set true to generate legacy build alongside normal build
    target: 'ie5',         // Target browser: 'ie4', 'ie5', 'netscape4', 'opera5'
    output: 'legacy',      // Subdirectory inside output dir for legacy files
    embed: true,           // Embed all JS/CSS into a single HTML file
    warnings: true         // Print compatibility warnings for modern features
  },

  // Webpack config extender (user can set this as a function)
  webpack: null
};
