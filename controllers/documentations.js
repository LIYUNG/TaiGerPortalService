const _ = require('lodash');
const path = require('path');
const { Role } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { ten_minutes_cache } = require('../cache/node-cache');
const logger = require('../services/logger');
const { ORIGIN, AWS_S3_PUBLIC_BUCKET_NAME } = require('../config');
const { getS3Object } = require('../aws/s3');

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
  const interna_doc_page_existed = await req.db
    .model('Docspage')
    .findOneAndUpdate({ category: 'internal' }, fields, {
      upsert: true,
      new: true
    });

  return res
    .status(201)
    .send({ success: true, data: interna_doc_page_existed });
});

const getInternalDocumentationsPage = asyncHandler(async (req, res) => {
  const docspage = await req.db.model('Docspage').findOne({
    category: 'internal'
  });
  return res.send({ success: true, data: !docspage ? {} : docspage });
});

const updateDocumentationPage = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const doc_page_existed = await req.db
    .model('Docspage')
    .findOneAndUpdate({ category: req.params.category }, fields, {
      upsert: true,
      new: true
    });
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
    const docspage = await req.db.model('Docspage').findOne({
      category: req.params.category
    });
    const success = ten_minutes_cache.set(req.url, docspage);
    if (success) {
      logger.info('cache set successfully');
    }
    return res.send({ success: true, data: !docspage ? {} : docspage });
  }
  logger.info('cache hit');
  return res.send({ success: true, data: !value ? {} : value });
});

const getCategoryDocumentations = asyncHandler(async (req, res) => {
  // TODO: validate req.params.category
  if (
    valid_categories.findIndex(
      (category) => category === req.params.category
    ) === -1
  ) {
    logger.error('getCategoryDocumentations : invalid category');
    throw new ErrorResponse(400, 'invalid category');
  }
  const documents = await req.db.model('Documentation').find(
    {
      category: req.params.category
    },
    { text: 0 } // exclude text field
  );
  return res.send({ success: true, data: documents });
});

const getAllDocumentations = asyncHandler(async (req, res) => {
  const document = await req.db
    .model('Documentation')
    .find()
    .select('title category');
  return res.send({ success: true, data: document });
});

const getAllInternalDocumentations = asyncHandler(async (req, res) => {
  const document = await req.db
    .model('Internaldoc')
    .find()
    .select('title internal category');
  return res.send({ success: true, data: document });
});

const getDocumentation = asyncHandler(async (req, res) => {
  const document = await req.db
    .model('Documentation')
    .findById(req.params.doc_id);
  return res.send({ success: true, data: document });
});

const getInternalDocumentation = asyncHandler(async (req, res) => {
  const document = await req.db
    .model('Internaldoc')
    .findById(req.params.doc_id);
  return res.send({ success: true, data: document });
});

const createDocumentation = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  const newDoc = await req.db.model('Documentation').create(fields);
  return res.send({ success: true, data: newDoc });
});

const createInternalDocumentation = asyncHandler(async (req, res) => {
  const fields = _.omit(req.body, '_id');
  const newDoc = await req.db.model('Internaldoc').create(fields);
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
      Buffer.from(response)
    );
    if (success) {
      logger.info('cache set successfully');
    }
    res.attachment(object_key);
    return res.end(response);
  } else {
    logger.info('cache hit');
    res.attachment(object_key);
    return res.end(value);
  }
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
  const updated_doc = await req.db
    .model('Documentation')
    .findByIdAndUpdate(req.params.id, fields, { new: true });
  return res.status(201).send({ success: true, data: updated_doc });
});

const updateInternalDocumentation = asyncHandler(async (req, res) => {
  const fields = req.body;
  fields.author = `${req.user.firstname} ${req.user.lastname}`;
  const updated_doc = await req.db
    .model('Internaldoc')
    .findByIdAndUpdate(req.params.id, fields, { new: true });
  return res.status(201).send({ success: true, data: updated_doc });
});

const deleteDocumentation = asyncHandler(async (req, res) => {
  await req.db.model('Documentation').findByIdAndDelete(req.params.id);
  // TODO: delete documents images
  return res.send({ success: true });
});

const deleteInternalDocumentation = asyncHandler(async (req, res) => {
  await req.db.model('Internaldoc').findByIdAndDelete(req.params.id);
  // TODO: delete documents images
  return res.send({ success: true });
});

module.exports = {
  // DocumentationS3GarbageCollector,
  updateInternalDocumentationPage,
  getInternalDocumentationsPage,
  updateDocumentationPage,
  getCategoryDocumentationsPage,
  getCategoryDocumentations,
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
