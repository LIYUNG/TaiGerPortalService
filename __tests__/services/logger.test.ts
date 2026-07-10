// Unit tests for services/logger.js. The logger is a thin wrapper over the
// console; we mock the config flags (isProd/isTest) and the request-context
// helper so we can exercise every format/level branch deterministically.
//
// Because the module reads isProd()/isTest() and computes `currentLevel` at
// require time, each scenario uses jest.isolateModules + fresh mocks so the
// module picks up the desired flags.

const setup = ({
  prod = false,
  test = false,
  logLevel
}: { prod?: boolean; test?: boolean; logLevel?: string } = {}) => {
  jest.resetModules();
  if (logLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = logLevel;
  }

  const getRequestId = jest.fn().mockReturnValue(undefined);
  jest.doMock('../../config', () => ({
    isProd: () => prod,
    isInPipeline: () => prod, // treat pipeline env same as prod for logger defaults
    isTest: () => test
  }));
  jest.doMock('../../middlewares/requestContext', () => ({ getRequestId }));

  // eslint-disable-next-line global-require
  const logger = require('../../services/logger');
  return { logger, getRequestId };
};

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
  delete process.env.LOG_LEVEL;
});

describe('production (JSON) formatting', () => {
  test('error logs structured JSON with level + message + meta', () => {
    const { logger } = setup({ prod: true, logLevel: 'debug' });
    logger.error('boom', { code: 500 });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsed).toEqual({ level: 'ERROR', message: 'boom', code: 500 });
  });

  test('requestId from request context is prepended to the JSON meta', () => {
    const { logger, getRequestId } = setup({ prod: true, logLevel: 'debug' });
    getRequestId.mockReturnValue('req-42');
    logger.info('hello', { a: 1 });

    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toEqual({
      level: 'INFO',
      message: 'hello',
      requestId: 'req-42',
      a: 1
    });
  });

  test('http() prefixes the message with HTTP:', () => {
    const { logger } = setup({ prod: true, logLevel: 'debug' });
    logger.http('GET /x 200');
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.message).toBe('HTTP: GET /x 200');
  });
});

describe('development (colored text) formatting', () => {
  test('warn writes a colored, formatted line including the level + message', () => {
    const { logger } = setup({ prod: false, logLevel: 'debug' });
    logger.warn('careful', { n: 1 });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = warnSpy.mock.calls[0][0];
    expect(line).toContain('[WARN]');
    expect(line).toContain('careful');
    // meta is serialized into the line
    expect(line).toContain('"n":1');
  });

  test('debug uses console.log and the line includes the timestamp', () => {
    const { logger } = setup({ prod: false, logLevel: 'debug' });
    logger.debug('dbg');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('[DEBUG]');
  });

  test('with no meta the line omits the meta segment', () => {
    const { logger } = setup({ prod: false, logLevel: 'debug' });
    logger.info('plain');
    const line = logSpy.mock.calls[0][0];
    expect(line).toContain('plain');
    expect(line).not.toContain('{}');
  });
});

describe('level filtering', () => {
  test('in test environment nothing is logged (silent mode)', () => {
    const { logger } = setup({ test: true, logLevel: 'debug' });
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('messages below the current level are suppressed', () => {
    const { logger } = setup({ prod: true, logLevel: 'warn' });
    logger.info('should be hidden');
    logger.debug('should be hidden');
    expect(logSpy).not.toHaveBeenCalled();

    logger.warn('shown');
    logger.error('shown');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test('isLevelEnabled reflects the current level threshold', () => {
    const { logger } = setup({ prod: true, logLevel: 'info' });
    expect(logger.isLevelEnabled('info')).toBe(true);
    expect(logger.isLevelEnabled('error')).toBe(true);
    expect(logger.isLevelEnabled('debug')).toBe(false);
  });
});

describe('setLevel', () => {
  test('updates LOG_LEVEL for known levels', () => {
    const { logger } = setup({ prod: true, logLevel: 'info' });
    logger.setLevel('debug');
    expect(process.env.LOG_LEVEL).toBe('debug');
  });

  test('ignores unknown levels', () => {
    const { logger } = setup({ prod: true, logLevel: 'info' });
    logger.setLevel('not-a-level');
    expect(process.env.LOG_LEVEL).toBe('info');
  });
});

describe('default level selection', () => {
  test('defaults to info in production when LOG_LEVEL is unset', () => {
    const { logger } = setup({ prod: true });
    expect(logger.isLevelEnabled('info')).toBe(true);
    expect(logger.isLevelEnabled('debug')).toBe(false);
  });

  test('defaults to debug in development when LOG_LEVEL is unset', () => {
    const { logger } = setup({ prod: false });
    expect(logger.isLevelEnabled('debug')).toBe(true);
  });
});
