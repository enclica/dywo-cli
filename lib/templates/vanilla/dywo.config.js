module.exports = {
  mode: 'vanilla',
  entry: './src/index.html',
  output: {
    dir: './dist',
    publicPath: 'auto'
  },
  compress: {
    js: { minify: true, dropConsole: false },
    css: { minify: true, autoprefixer: true },
    html: { minify: true, removeComments: true },
    gzip: true
  },
  devServer: {
    port: 3000,
    open: true,
    reload: true
  }
};
