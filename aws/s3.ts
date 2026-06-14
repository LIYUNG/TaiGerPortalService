const {
  S3Client,
  NoSuchKey,
  S3ServiceException,
  GetObjectCommand,
  DeleteObjectCommand,
  waitUntilObjectNotExists,
  DeleteObjectsCommand,
  PutObjectCommand,
  ListObjectsCommand
} = require('@aws-sdk/client-s3');

const logger = require('../services/logger');
const { AWS_KEY_CONFIG } = require('./constants');

const s3Client = new S3Client(AWS_KEY_CONFIG);

const putS3Object = async ({ bucketName, key, Body, ContentType }) => {
  const client = new S3Client({});
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body,
    ContentType
  });

  try {
    const response = await client.send(command);
  } catch (caught) {
    if (
      caught instanceof S3ServiceException &&
      caught.name === 'EntityTooLarge'
    ) {
      logger.error(
        `Error from S3 while uploading object to ${bucketName}. \
The object was too large. To upload objects larger than 5GB, use the S3 console (160GB max) \
or the multipart upload API (5TB max).`
      );
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while uploading object to ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
};
const getS3Object = async (bucketName, objectKey) => {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey
      })
    );
    const str = await response.Body.transformToByteArray();
    return str;
  } catch (caught) {
    if (caught instanceof NoSuchKey) {
      logger.error(
        `Error from S3 while getting object "${objectKey}" from "${bucketName}". No such key exists.`
      );
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while getting object from ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
};

const deleteS3Object = async (bucketName, objectKey) => {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKey
      })
    );
    await waitUntilObjectNotExists(
      { client: s3Client },
      { Bucket: bucketName, Key: objectKey }
    );
    // A successful delete, or a delete for a non-existent object, both return
    // a 204 response code.
    logger.info(
      `The object "${objectKey}" from bucket "${bucketName}" was deleted, or it didn't exist.`
    );
  } catch (caught) {
    if (
      caught instanceof S3ServiceException &&
      caught.name === 'NoSuchBucket'
    ) {
      logger.error(
        `Error from S3 while deleting object from ${bucketName}. The bucket doesn't exist.`
      );
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while deleting object from ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
};

// objectKeys = [{Key: 'abc/hey.pdf},{Key:'abc/key.pdf'}]
const deleteS3Objects = async ({ bucketName, objectKeys }) => {
  try {
    const { Deleted } = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objectKeys
        }
      })
    );
    await Promise.all(
      objectKeys.map((objectKey) =>
        waitUntilObjectNotExists(
          { client: s3Client },
          { Bucket: bucketName, Key: objectKey.Key }
        )
      )
    );

    logger.info(
      `Successfully deleted ${Deleted.length} objects from S3 bucket. Deleted objects:`
    );
    logger.info(Deleted.map((d) => ` • ${d.Key}`).join('\n'));
  } catch (caught) {
    if (
      caught instanceof S3ServiceException &&
      caught.name === 'NoSuchBucket'
    ) {
      logger.error(
        `Error from S3 while deleting objects from ${bucketName}. The bucket doesn't exist.`
      );
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while deleting objects from ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
};

const listS3ObjectsV2 = async ({ bucketName, Prefix }) => {
  try {
    const command = new ListObjectsCommand({
      Bucket: bucketName,
      Prefix
    });

    const response = await s3Client.send(command);
    return response;
  } catch (caught) {
    if (
      caught instanceof S3ServiceException &&
      caught.name === 'NoSuchBucket'
    ) {
      logger.error(
        `Error from S3 while listing objects from ${bucketName}. The bucket doesn't exist.`
      );
    } else if (caught instanceof S3ServiceException) {
      logger.error(
        `Error from S3 while deleting listS3Objects from ${bucketName}.  ${caught.name}: ${caught.message}`
      );
    } else {
      throw caught;
    }
  }
};

async function uploadJsonToS3(responseJson, bucketName, fileName) {
  try {
    // Prepare the file content
    const jsonData = JSON.stringify(responseJson);

    // Upload to S3
    const result = await putS3Object({
      bucketName,
      key: fileName,
      Body: jsonData,
      ContentType: 'application/json'
    });
    console.log('File uploaded successfully');
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
}

module.exports = {
  s3Client,
  putS3Object,
  uploadJsonToS3,
  getS3Object,
  deleteS3Object,
  deleteS3Objects,
  listS3ObjectsV2
};
