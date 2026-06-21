module.exports = {
  entry: './src/main.dywo',
  output: {
    dir: './dist',
    publicPath: 'auto'
  },
  srcDir: './src',
  publicDir: './public',
  compress: {
    js: { minify: true, dropConsole: false },
    css: { minify: true, autoprefixer: true },
    html: { minify: true, removeComments: true },
    gzip: true
  },
  devServer: {
    port: 3000,
    open: true
  }
};
