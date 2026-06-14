import { Router } from 'express';
import logger from '../services/logger';
import { CRM_API_TARGET, isDev } from '../config';

import accountRouter from './account';
import applicationsRouter from './applications';
import admissionsRouter from './admissions';
import agentsRouter from './agents';
import allCoursesRouter from './allcourses';
import authRouter from './auth';
import auditRouter from './audit';
import aiAssistRouter from './ai_assist';
import complaintsRouter from './complaints';
import communicationsRouter from './communications';
import coursekewordsRouter from './coursekeywords';
import coursesRouter from './courses';
import documentationsRouter from './documentations';
import docsModiRouter from './documents_modification';
import expensesRouter from './expenses';
import eventsRouter from './events';
import interviewsRouter from './interviews';
import notesRouter from './notes';
import portalsRouter from './portal_information';
import programRequirementsRouter from './program_requirements';
import programsRouter from './programs';
import permissionsRouter from './permissions';
import searchesRouter from './searches';
import studentsRouter from './students';
import studentsApplicationRouter from './student_applications';
import taigeraisRouter from './taigerais';
import teamsRouter from './teams';
import ticketsRouter from './tickets';
import uniassistRouter from './uniassist';
import usersRouter from './users';
import widgetsRouter from './widget';
import CRMRouter from './crm';

function setupCrmProxy(app, target) {
  if (!isDev()) return;

  if (!target) {
    logger.warn('CRM_API_TARGET not set, skipping CRM proxy');
    app.use('/crm-api', (req, res) => {
      res.status(501).json({ error: 'CRM API target not configured' });
    });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
  const { createProxyMiddleware } = require('http-proxy-middleware');
  logger.info('Using dev proxy for CRM API', target);
  app.use(
    '/crm-api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      logLevel: 'debug',
      cookieDomainRewrite: 'localhost',
      pathRewrite: {
        '^/crm-api': ''
      }
    })
  );
}

const router = (app) => {
  setupCrmProxy(app, CRM_API_TARGET); // enable local CRM lambda function calls

  const apiRouter = Router();
  apiRouter.use('/account', accountRouter);
  apiRouter.use('/applications', applicationsRouter);
  apiRouter.use('/student-applications', studentsApplicationRouter);
  apiRouter.use('/students', studentsRouter);
  apiRouter.use('/agents', agentsRouter);
  apiRouter.use('/all-courses', allCoursesRouter);
  apiRouter.use('/audit', auditRouter);
  apiRouter.use('/ai-assist', aiAssistRouter);
  apiRouter.use('/admissions', admissionsRouter);
  apiRouter.use('/course-keywords', coursekewordsRouter);
  apiRouter.use('/courses', coursesRouter);
  apiRouter.use('/complaints', complaintsRouter);
  apiRouter.use('/communications', communicationsRouter);
  apiRouter.use('/docs', documentationsRouter);
  apiRouter.use('/document-threads', docsModiRouter);
  apiRouter.use('/expenses', expensesRouter);
  apiRouter.use('/events', eventsRouter);
  apiRouter.use('/interviews', interviewsRouter);
  apiRouter.use('/notes', notesRouter);
  apiRouter.use('/portal-informations', portalsRouter);
  apiRouter.use('/permissions', permissionsRouter);
  apiRouter.use('/program-requirements', programRequirementsRouter);
  apiRouter.use('/programs', programsRouter);
  apiRouter.use('/search', searchesRouter);
  apiRouter.use('/taigerai', taigeraisRouter);
  apiRouter.use('/teams', teamsRouter);
  apiRouter.use('/tickets', ticketsRouter);
  apiRouter.use('/uniassist', uniassistRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/widgets', widgetsRouter);
  apiRouter.use('/crm', CRMRouter);
  app.use('/api', apiRouter);
  app.use('/auth', authRouter);
};

module.exports = router;
