'use strict';

const cors = require('./cors');
const { jwt, session, apiKey, basicAuth } = require('./auth');
const rateLimit = require('./rate-limit');
const logger = require('./logger');
const bodyParser = require('./body-parser');
const compression = require('./compression');
const security = require('./security');
const upload = require('./upload');

module.exports = {
  cors,
  jwt,
  session,
  apiKey,
  basicAuth,
  rateLimit,
  logger,
  bodyParser,
  compression,
  security,
  upload
};
