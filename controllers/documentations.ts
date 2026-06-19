import _ from 'lodash';
import path from 'path';
import { Role } from '@taiger-common/core';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import { ten_minutes_cache } from '../cache/node-cache';
import logger from '../services/logger';
import { ORIGIN, AWS_S3_PUBLIC_BUCKET_NAME } from '../config';
import { getS3Object } from '../aws/s3';
import DocumentationService from '../services/documentations';

const valid_categories = [
  'howtostart',
  'application',
  'base-documents',
  'cv-ml-rl',
  'portal-instruction',
  'certification',
  'uniassist',
  'visa',
  'enrolment'
];

const updateInternalDocumentationPage = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');

  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const interna_doc_page_existed =
    await DocumentationService.upsertDocspageByCategory('internal', fields);

  return res
    .status(201)
    .send({ success: true, data: interna_doc_page_existed });
});

const getInternalDocumentationsPage = asyncHandler(async (req, res) => {
  const docspage = await DocumentationService.getDocspageByCategory('internal');
  return res.send({ success: true, data: !docspage ? {} : docspage });
});

const updateDocumentationPage = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const doc_page_existed = await DocumentationService.upsertDocspageByCategory(
    req.params.category,
    fields
  );
  const success = ten_minutes_cache.set(req.url, doc_page_existed);
  if (success) {
    logger.info('cache set update successfully');
  }
  return res.status(201).send({ success: true, data: doc_page_existed });
});

const getCategoryDocumentationsPage = asyncHandler(async (req, res) => {
  const { user } = req;
  // TODO: validate req.params.category
  if (
    valid_categories.findIndex(
      (category) => category === req.params.category
    ) === -1
  ) {
    logger.error('getCategoryDocumentationsPage : invalid category');
    throw new ErrorResponse(400, 'invalid category');
  }

  if (req.params.category === 'internal') {
    if (
      user.role !== Role.Admin &&
      user.role !== Role.Agent &&
      user.role !== Role.Editor
    ) {
      logger.error('getCategoryDocumentationsPage : Not authorized');
      throw new ErrorResponse(403, 'Not authorized');
    }
  }

  // Use redis/cache
  const value = ten_minutes_cache.get(req.url);
  if (value === undefined) {
    // cache miss
    logger.info('cache miss');
    const docspage = await DocumentationService.getDocspageByCategory(
      req.params.category
    );
    const success = ten_minutes_cache.set(req.url, docspage);
    if (success) {
      logger.info('cache set successfully');
    }
    return res.send({ success: true, data: !docspage ? {} : docspage });
  }
  logger.info('cache hit');
  return res.send({ success: true, data: !value ? {} : value });
});

const getAllDocumentations = asyncHandler(async (req, res) => {
  const document = await DocumentationService.getAllDocumentations();
  return res.send({ success: true, data: document });
});

const getAllInternalDocumentations = asyncHandler(async (req, res) => {
  const document = await DocumentationService.getAllInternalDocumentations();
  return res.send({ success: true, data: document });
});

const getDocumentation = asyncHandler(async (req, res) => {
  const document = await DocumentationService.getDocumentationById(
    req.params.doc_id
  );
  return res.send({ success: true, data: document });
});

const getInternalDocumentation = asyncHandler(async (req, res) => {
  const document = await DocumentationService.getInternalDocumentationById(
    req.params.doc_id
  );
  return res.send({ success: true, data: document });
});

const createDocumentation = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  const newDoc = await DocumentationService.createDocumentation(fields);
  return res.send({ success: true, data: newDoc });
});

const createInternalDocumentation = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  const newDoc = await DocumentationService.createInternalDocumentation(fields);
  return res.send({ success: true, data: newDoc });
});

const uploadDocImage = asyncHandler(async (req, res) => {
  const filePath = req.file.key.split('/');
  let imageurl = new URL(`/api/docs/file/${filePath[1]}`, ORIGIN).href;
  imageurl = imageurl.replace(/\\/g, '/');
  // TODO: to overwrite cache image, pdf, docs, file here.
  return res.send({ success: true, data: imageurl });
});

const getDocFile = asyncHandler(async (req, res) => {
  const {
    params: { object_key }
  } = req;

  const fileKey = path.join('Documentations', object_key).replace(/\\/g, '/');

  // Use redis/cache
  // TODO: need to update when new uploaded file with same key name!
  const value = ten_minutes_cache.get(req.originalUrl);
  if (value === undefined) {
    // cache miss
    logger.info(`cache miss: ${req.originalUrl}`);
    const response = await getS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
    const success = ten_minutes_cache.set(
      req.originalUrl,
      Buffer.from(response as Uint8Array)
    );
    if (success) {
      logger.info('cache set successfully');
    }
    res.attachment(object_key);
    return res.end(response);
  }
  logger.info('cache hit');
  res.attachment(object_key);
  return res.end(value);
});

const uploadDocDocs = asyncHandler(async (req, res) => {
  const filePath = req.file.key.split('/');
  const fileName = filePath[1];
  let docUrl = new URL(`/api/docs/file/${encodeURIComponent(fileName)}`, ORIGIN)
    .href;
  docUrl = docUrl.replace(/\\/g, '/');
  let extname = path.extname(fileName);
  extname = extname.replace('.', '');
  // TODO: to delete cache key for image, pdf, docs, file here.
  const value = ten_minutes_cache.del(
    `/api/docs/file/${encodeURIComponent(fileName)}`
  );
  // encodeURIComponent convert chinese to url match charater %E7%94%B3%E8%AB%8 etc.
  if (value === 1) {
    logger.info('cache key deleted successfully');
  }
  return res.send({
    success: true,
    url: docUrl,
    title: req.file.key,
    extension: extname
  });
});

const updateDocumentation = asyncHandler(async (req, res) => {
  const fields = req.body;
  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const updated_doc = await DocumentationService.updateDocumentationById(
    req.params.id,
    fields
  );
  return res.status(201).send({ success: true, data: updated_doc });
});

const updateInternalDocumentation = asyncHandler(async (req, res) => {
  const fields = req.body;
  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const updated_doc =
    await DocumentationService.updateInternalDocumentationById(
      req.params.id,
      fields
    );
  return res.status(201).send({ success: true, data: updated_doc });
});

const deleteDocumentation = asyncHandler(async (req, res) => {
  await DocumentationService.deleteDocumentationById(req.params.id);
  // TODO: delete documents images
  return res.send({ success: true });
});

const deleteInternalDocumentation = asyncHandler(async (req, res) => {
  await DocumentationService.deleteInternalDocumentationById(req.params.id);
  // TODO: delete documents images
  return res.send({ success: true });
});

export = {
  // DocumentationS3GarbageCollector,
  updateInternalDocumentationPage,
  getInternalDocumentationsPage,
  updateDocumentationPage,
  getCategoryDocumentationsPage,
  getAllDocumentations,
  getAllInternalDocumentations,
  getDocumentation,
  getInternalDocumentation,
  createDocumentation,
  createInternalDocumentation,
  uploadDocImage,
  getDocFile,
  uploadDocDocs,
  updateDocumentation,
  updateInternalDocumentation,
  deleteDocumentation,
  deleteInternalDocumentation
};
