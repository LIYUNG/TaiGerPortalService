module.exports = {
  testEnvironment: 'node',
  // No database: DAO unit tests mock the Mongoose models, and integration tests
  // mock the DAO layer (see __tests__/integration/*). Nothing connects to Mongo,
  // so the @shelf/jest-mongodb preset / in-memory server is no longer used and
  // the whole suite is deterministic.
  watchPathIgnorePatterns: ['globalConfig'],
  testRegex: '/__tests__/.*\\.(test|spec)\\.jsx?$',
  setupFilesAfterEnv: ['jest-extended'],
  transformIgnorePatterns: ['/node_modules/(?!(axios|nanoid)/)'],
  moduleNameMapper: {
    '^nanoid$': '<rootDir>/__mocks__/nanoid.js'
  },
  // Lowered from 100000 — 15s is ample for in-memory operations.
  // A timeout failure now indicates an accidental real network call.
  testTimeout: 15000,
  // Each worker loads the full model graph (models/index.js compiles every
  // model on the default connection) + mongoose + a DB connection, so a worker
  // is memory-heavy. Cap parallelism and recycle bloated workers to avoid
  // out-of-memory worker kills (SIGTERM) and the half-read-module "UNKNOWN:
  // open/read" errors they cause on a loaded machine. (`npm test` additionally
  // forces --runInBand.)
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
  collectCoverage: true,
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 30,
      functions: 50,
      lines: 50
    }
  }
};
