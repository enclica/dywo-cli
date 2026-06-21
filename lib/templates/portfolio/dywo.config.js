module.exports = {
  entry: './src/main.dywo',
  output: {
    dir: './dist',
    publicPath: 'auto'
  },
  alias: {
    '@': './src',
    '@components': './src/components',
    '@assets': './src/assets'
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
    historyApiFallback: true
  }
};
