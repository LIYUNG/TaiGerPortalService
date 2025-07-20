const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const helmet = require('helmet');
const { ORIGIN, isTest } = require('./config');

require('./middlewares/passport');

const router = require('./routes');
const { errorHandler } = require('./middlewares/error-handler');
const { isProd } = require('./config');
const httpLogger = require('./services/httpLogger');
const {
  tenantMiddleware,
  checkTenantDBMiddleware
} = require('./middlewares/tenantMiddleware');
const {
  decryptCookieMiddleware
} = require('./middlewares/decryptCookieMiddleware');

const compression = require('compression');

const app = express();
app.set('trust proxy', 1);
app.use(helmet.contentSecurityPolicy());
app.use(helmet.crossOriginEmbedderPolicy());
app.use(helmet.crossOriginOpenerPolicy());
// app.use(helmet.crossOriginResourcePolicy());
app.use(helmet.dnsPrefetchControl());
app.use(helmet.expectCt());
app.use(helmet.frameguard());
app.use(helmet.hidePoweredBy());
app.use(helmet.hsts());
app.use(helmet.ieNoOpen());
app.use(helmet.noSniff());
app.use(helmet.originAgentCluster());
app.use(helmet.permittedCrossDomainPolicies());
app.use(helmet.referrerPolicy());
app.use(helmet.xssFilter());
app.use(
  cors({
    exposedHeaders: ['Content-Disposition'],
    origin: ORIGIN,
    credentials: true
  })
);
app.use(cookieParser());
app.get('/health', (req, res) => {
  console.log('healthy check');
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});
app.use(decryptCookieMiddleware);
app.use(checkTenantDBMiddleware);
app.use(tenantMiddleware);

app.use(methodOverride('_method')); // in order to make delete request
app.use(express.json());
app.use(compression());
app.use((req, res, next) => {
  req.headers['accept-encoding'] = 'gzip';
  next();
});

if (isProd()) {
  app.use(httpLogger);
}
if (!isProd() && !isTest()) {
  app.use(morgan('dev'));
}

router(app);

app.use(errorHandler);

module.exports = { app };
