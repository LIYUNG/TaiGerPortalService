import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import methodOverride from 'method-override';
import helmet from 'helmet';

import './middlewares/passport';

import router from './routes';
import { ORIGIN, isProd, isTest } from './config';
import httpLogger from './services/httpLogger';
import logger from './services/logger';
import { errorHandler } from './middlewares/error-handler';
import { requestContextMiddleware } from './middlewares/requestContext';

import { checkTenantDBMiddleware } from './middlewares/tenantMiddleware';
import { decryptCookieMiddleware } from './middlewares/decryptCookieMiddleware';

import compression from 'compression';

const app = express();
app.set('trust proxy', 1);
// First in the chain: establish the per-request context (ALB X-Amzn-Trace-Id ->
// requestId) so every downstream log line — including httpLogger and the error
// handler — is tagged with the request's id.
app.use(requestContextMiddleware);
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
    exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    origin: ORIGIN,
    credentials: true
  })
);
app.use(cookieParser());
app.get('/health', async (req, res) => {
  logger.info('healthy check');
  // Optional: read ECS task metadata (if awsvpc mode)
  let ecsMetadata = {};
  const metadataUri = process.env.ECS_CONTAINER_METADATA_URI_V4;
  logger.info('metadataUri', { metadataUri });
  try {
    if (metadataUri) {
      const metadata = await fetch(`${metadataUri}/task`);
      ecsMetadata = await metadata.json();
    }
  } catch (err) {
    logger.warn('ECS metadata unavailable', { error: err.message });
  }
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date(),
    ecsTaskArn: `taskId: ${ecsMetadata.TaskARN?.split('/').pop()}` || null // taskId in ecs-task-arn
  });
});
app.use(decryptCookieMiddleware);
app.use(checkTenantDBMiddleware);

app.use(methodOverride('_method')); // in order to make delete request
app.use(express.json());
app.use(compression());

if (isProd()) {
  app.use(httpLogger);
}
if (!isProd() && !isTest()) {
  app.use(morgan('dev'));
}

router(app);
app.use(errorHandler);

export = { app };
