// Unit tests for aws/s3.js. All AWS SDK boundaries are mocked: no network.
//
// The module builds Command objects from '@aws-sdk/client-s3' and pushes them
// through a client's send(). We replace each Command with a lightweight class
// that records its input, replace S3Client.send with a jest.fn, and stub the
// waiter. The error classes (NoSuchKey, S3ServiceException) are real-ish
// classes so the `instanceof` branches in the module can be exercised.

// Everything the factory needs is defined inside it (jest hoists jest.mock
// above imports and forbids referencing out-of-scope, non-`mock`-prefixed
// vars). The shared send() spy is exposed on the mocked module as `__send`.
jest.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(input) {
      this.input = input;
    }
  }
  class PutObjectCommand extends FakeCommand {}
  class GetObjectCommand extends FakeCommand {}
  class DeleteObjectCommand extends FakeCommand {}
  class DeleteObjectsCommand extends FakeCommand {}
  class ListObjectsCommand extends FakeCommand {}

  class S3ServiceException extends Error {
    constructor(name, message) {
      super(message);
      this.name = name || 'S3ServiceException';
    }
  }
  class NoSuchKey extends S3ServiceException {
    constructor(message) {
      super('NoSuchKey', message);
    }
  }

  // Shared across the module-level s3Client and the per-call `new S3Client({})`
  // created inside putS3Object.
  const send = jest.fn();
  const waitUntilObjectNotExists = jest.fn().mockResolvedValue({});

  class S3Client {
    send(command) {
      return send(command);
    }
  }

  return {
    __send: send,
    S3Client,
    NoSuchKey,
    S3ServiceException,
    GetObjectCommand,
    DeleteObjectCommand,
    waitUntilObjectNotExists,
    DeleteObjectsCommand,
    PutObjectCommand,
    ListObjectsCommand
  };
});

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

import sdk from '@aws-sdk/client-s3';

const {
  __send: send,
  NoSuchKey,
  S3ServiceException,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsCommand,
  waitUntilObjectNotExists
} = sdk;
import logger from '../../services/logger';
import s3 from '../../aws/s3';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('putS3Object', () => {
  test('builds a PutObjectCommand and sends it', async () => {
    send.mockResolvedValueOnce({ ETag: 'x' });
    await s3.putS3Object({
      bucketName: 'b',
      key: 'k',
      Body: 'data',
      ContentType: 'text/plain'
    });

    expect(send).toHaveBeenCalledTimes(1);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: 'b',
      Key: 'k',
      Body: 'data',
      ContentType: 'text/plain'
    });
  });

  test('logs EntityTooLarge S3ServiceException without throwing', async () => {
    send.mockRejectedValueOnce(
      new S3ServiceException('EntityTooLarge', 'too big')
    );
    await expect(
      s3.putS3Object({ bucketName: 'b', key: 'k', Body: 'd' })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('too large');
  });

  test('logs generic S3ServiceException without throwing', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('AccessDenied', 'nope'));
    await expect(
      s3.putS3Object({ bucketName: 'b', key: 'k', Body: 'd' })
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('AccessDenied');
  });

  test('rethrows non-S3 errors', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(
      s3.putS3Object({ bucketName: 'b', key: 'k', Body: 'd' })
    ).rejects.toThrow('boom');
  });
});

describe('getS3Object', () => {
  test('builds a GetObjectCommand and returns the transformed body', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: jest.fn().mockResolvedValue(bytes) }
    });

    const result = await s3.getS3Object('bucket', 'obj/key');
    expect(result).toBe(bytes);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'bucket', Key: 'obj/key' });
  });

  test('logs NoSuchKey and returns undefined', async () => {
    send.mockRejectedValueOnce(new NoSuchKey('missing'));
    const result = await s3.getS3Object('bucket', 'obj/key');
    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('No such key');
  });

  test('logs generic S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('Throttling', 'slow'));
    await s3.getS3Object('bucket', 'obj/key');
    expect(logger.error.mock.calls[0][0]).toContain('Throttling');
  });

  test('rethrows non-S3 errors', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(s3.getS3Object('bucket', 'obj/key')).rejects.toThrow('boom');
  });
});

describe('deleteS3Object', () => {
  test('sends a DeleteObjectCommand, waits, and logs success', async () => {
    send.mockResolvedValueOnce({});
    await s3.deleteS3Object('bucket', 'obj/key');

    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'bucket', Key: 'obj/key' });
    expect(waitUntilObjectNotExists).toHaveBeenCalledWith(
      { client: expect.anything() },
      { Bucket: 'bucket', Key: 'obj/key' }
    );
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  test('logs NoSuchBucket S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('NoSuchBucket', 'gone'));
    await s3.deleteS3Object('bucket', 'obj/key');
    expect(logger.error.mock.calls[0][0]).toContain("doesn't exist");
  });

  test('logs generic S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('AccessDenied', 'nope'));
    await s3.deleteS3Object('bucket', 'obj/key');
    expect(logger.error.mock.calls[0][0]).toContain('AccessDenied');
  });

  test('rethrows non-S3 errors', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(s3.deleteS3Object('bucket', 'obj/key')).rejects.toThrow(
      'boom'
    );
  });
});

describe('deleteS3Objects', () => {
  const objectKeys = [{ Key: 'a/1.pdf' }, { Key: 'a/2.pdf' }];

  test('sends a DeleteObjectsCommand, waits for each, and logs deleted keys', async () => {
    send.mockResolvedValueOnce({ Deleted: objectKeys });
    await s3.deleteS3Objects({ bucketName: 'bucket', objectKeys });

    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(DeleteObjectsCommand);
    expect(cmd.input).toEqual({
      Bucket: 'bucket',
      Delete: { Objects: objectKeys }
    });
    expect(waitUntilObjectNotExists).toHaveBeenCalledTimes(objectKeys.length);
    expect(logger.info).toHaveBeenCalled();
  });

  test('logs NoSuchBucket S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('NoSuchBucket', 'gone'));
    await s3.deleteS3Objects({ bucketName: 'bucket', objectKeys });
    expect(logger.error.mock.calls[0][0]).toContain("doesn't exist");
  });

  test('logs generic S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('Throttling', 'slow'));
    await s3.deleteS3Objects({ bucketName: 'bucket', objectKeys });
    expect(logger.error.mock.calls[0][0]).toContain('Throttling');
  });

  test('rethrows non-S3 errors', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(
      s3.deleteS3Objects({ bucketName: 'bucket', objectKeys })
    ).rejects.toThrow('boom');
  });
});

describe('listS3ObjectsV2', () => {
  test('builds a ListObjectsCommand and returns the response', async () => {
    const response = { Contents: [{ Key: 'a' }] };
    send.mockResolvedValueOnce(response);

    const result = await s3.listS3ObjectsV2({
      bucketName: 'bucket',
      Prefix: 'a/'
    });
    expect(result).toBe(response);
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(ListObjectsCommand);
    expect(cmd.input).toEqual({ Bucket: 'bucket', Prefix: 'a/' });
  });

  test('logs NoSuchBucket S3ServiceException and returns undefined', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('NoSuchBucket', 'gone'));
    const result = await s3.listS3ObjectsV2({
      bucketName: 'bucket',
      Prefix: 'a/'
    });
    expect(result).toBeUndefined();
    expect(logger.error.mock.calls[0][0]).toContain("doesn't exist");
  });

  test('logs generic S3ServiceException', async () => {
    send.mockRejectedValueOnce(new S3ServiceException('AccessDenied', 'nope'));
    await s3.listS3ObjectsV2({ bucketName: 'bucket', Prefix: 'a/' });
    expect(logger.error.mock.calls[0][0]).toContain('AccessDenied');
  });

  test('rethrows non-S3 errors', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(
      s3.listS3ObjectsV2({ bucketName: 'bucket', Prefix: 'a/' })
    ).rejects.toThrow('boom');
  });
});

describe('uploadJsonToS3', () => {
  test('stringifies the payload and uploads it as application/json', async () => {
    send.mockResolvedValueOnce({});
    await s3.uploadJsonToS3({ a: 1 }, 'bucket', 'file.json');

    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toEqual({
      Bucket: 'bucket',
      Key: 'file.json',
      Body: JSON.stringify({ a: 1 }),
      ContentType: 'application/json'
    });
    expect(logger.info).toHaveBeenCalledWith('File uploaded successfully');
  });

  test('rethrows when the underlying put throws a non-S3 error', async () => {
    send.mockRejectedValueOnce(new Error('boom'));
    await expect(
      s3.uploadJsonToS3({ a: 1 }, 'bucket', 'file.json')
    ).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});
