module.exports = {
  pages: {
    index: {
      entry: './src/pages/index.dywo',
      title: '{{PROJECT_NAME}} — Digital Experiences That Matter'
    },
    about: {
      entry: './src/pages/about.dywo',
      title: '{{PROJECT_NAME}} — About Us'
    },
    contact: {
      entry: './src/pages/contact.dywo',
      title: '{{PROJECT_NAME}} — Contact'
    }
  },
  output: {
    dir: './dist',
    publicPath: 'auto'
  },
  alias: {
    '@': './src',
    '@components': './src/components',
    '@pages': './src/pages'
  },
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
