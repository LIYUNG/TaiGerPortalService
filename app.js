const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const helmet = require('helmet');

require('./middlewares/passport');

const router = require('./routes');
const { ORIGIN, CRM_API_TARGET, isProd, isDev, isTest } = require('./config');
const { errorHandler } = require('./middlewares/error-handler');
const httpLogger = require('./services/httpLogger');
const logger = require('./services/logger');

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
app.get('/health', async (req, res) => {
  console.log('healthy check');
  // Optional: read ECS task metadata (if awsvpc mode)
  let ecsMetadata = {};
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  console.log('metadataUri', metadataUri);
  try {
    if (metadataUri) {
      const metadata = await fetch(`${metadataUri}/task`);
      ecsMetadata = await metadata.json();
    }
  } catch (err) {
    console.warn('ECS metadata unavailable:', err.message);
  }
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date(),
    ecsTaskArn: `taskId: ${ecsMetadata.TaskARN?.split('/').pop()}` || null // taskId in ecs-task-arn
  });
});
app.use(decryptCookieMiddleware);
app.use(checkTenantDBMiddleware);
app.use(tenantMiddleware);

app.use(methodOverride('_method')); // in order to make delete request
app.use(express.json());
app.use(compression());

if (isDev()) {
  logger.info('Using dev proxy for CRM API', CRM_API_TARGET);
  const { createProxyMiddleware } = require('http-proxy-middleware');

  app.use(
    '/crm-api',
    createProxyMiddleware({
      target: CRM_API_TARGET,
      changeOrigin: true,
      logLevel: 'debug',
      cookieDomainRewrite: 'localhost',
      pathRewrite: {
        '^/crm-api': '' // remove /crm-api from the start of the path
      }
    })
  );
}

if (isProd()) {
  app.use(httpLogger);
}
if (!isProd() && !isTest()) {
  app.use(morgan('dev'));
}

router(app);

app.use(errorHandler);

module.exports = { app };
