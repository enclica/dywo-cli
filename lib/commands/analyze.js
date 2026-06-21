async function analyze(options) {
  const buildOptions = { env: 'production', analyze: true, watch: false };
  return require('./build')(buildOptions);
}

module.exports = analyze;
