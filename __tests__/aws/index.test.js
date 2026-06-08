// Unit tests for aws/index.js
//
// The only logic here is callApiGateway: it builds a SignatureV4 signer, signs
// the request, and forwards it through axios. We mock axios, @aws-sdk/signature-v4
// (capturing the signer config + sign() output), the sha256 lib, and the local
// ses/s3/sts submodules + logger. No network, no AWS.

const mockSign = jest.fn();
const mockSignerCtor = jest.fn();
jest.mock('@aws-sdk/signature-v4', () => ({
  SignatureV4: jest.fn().mockImplementation((config) => {
    mockSignerCtor(config);
    return { sign: mockSign };
  })
}));
jest.mock('@aws-crypto/sha256-browser', () => ({ Sha256: class Sha256 {} }));
jest.mock('axios', () => jest.fn());
jest.mock('../../aws/ses', () => ({
  ses: { _ses: true },
  limiter: { _limiter: true },
  SendRawEmailCommand: class SendRawEmailCommand {}
}));
jest.mock('../../aws/s3', () => ({ s3Client: { _s3: true } }));
jest.mock('../../aws/sts', () => ({ getTemporaryCredentials: jest.fn() }));
jest.mock('../../config', () => ({ AWS_REGION: 'eu-central-1' }));
jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

const axios = require('axios');
const { SignatureV4 } = require('@aws-sdk/signature-v4');
const logger = require('../../services/logger');
const awsIndex = require('../../aws/index');

const creds = {
  AccessKeyId: 'AKIA',
  SecretAccessKey: 'secret',
  SessionToken: 'token'
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('aws/index exports', () => {
  it('re-exports the submodule clients and helpers', () => {
    expect(awsIndex).toEqual(
      expect.objectContaining({
        s3Client: { _s3: true },
        ses: { _ses: true },
        limiter: { _limiter: true },
        getTemporaryCredentials: expect.any(Function),
        callApiGateway: expect.any(Function),
        SendRawEmailCommand: expect.any(Function)
      })
    );
  });
});

describe('callApiGateway', () => {
  it('builds the signer with execute-api config and returns response.data', async () => {
    mockSign.mockResolvedValue({
      method: 'POST',
      headers: { host: 'api.test' }
    });
    axios.mockResolvedValue({ data: { ok: true } });

    const result = await awsIndex.callApiGateway(
      creds,
      'https://api.test/path?q=1',
      'POST',
      { a: 1 },
      { 'X-Extra': 'v' }
    );

    expect(result).toEqual({ ok: true });

    // signer constructed with the right credentials/region/service
    expect(SignatureV4).toHaveBeenCalledTimes(1);
    const signerConfig = SignatureV4.mock.calls[0][0];
    expect(signerConfig).toEqual(
      expect.objectContaining({
        region: 'eu-central-1',
        service: 'execute-api',
        credentials: {
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
          sessionToken: 'token'
        }
      })
    );

    // sign() called with parsed URL parts + JSON body + extra header
    const signArg = mockSign.mock.calls[0][0];
    expect(signArg).toEqual(
      expect.objectContaining({
        method: 'POST',
        hostname: 'api.test',
        path: '/path',
        protocol: 'https:',
        body: JSON.stringify({ a: 1 })
      })
    );
    expect(signArg.headers).toEqual(
      expect.objectContaining({
        host: 'api.test',
        'Content-Type': 'application/json',
        'X-Extra': 'v'
      })
    );

    // axios called with the signed request merged with url/data
    expect(axios).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.test/path?q=1',
        method: 'POST',
        data: { a: 1 }
      })
    );
  });

  it('omits Content-Type and body when there is no requestBody', async () => {
    mockSign.mockResolvedValue({ method: 'GET', headers: {} });
    axios.mockResolvedValue({ data: 'ok' });

    await awsIndex.callApiGateway(creds, 'https://api.test/x', 'GET');

    const signArg = mockSign.mock.calls[0][0];
    expect(signArg.body).toBeUndefined();
    expect(signArg.headers['Content-Type']).toBeUndefined();
  });

  it('logs and rethrows when signing/axios fails', async () => {
    mockSign.mockRejectedValue(new Error('sign fail'));

    await expect(
      awsIndex.callApiGateway(creds, 'https://api.test/x', 'GET')
    ).rejects.toThrow('sign fail');
    expect(logger.error).toHaveBeenCalled();
  });
});
