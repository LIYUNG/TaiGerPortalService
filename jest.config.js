module.exports = {
  testEnvironment: 'node',
  preset: '@shelf/jest-mongodb',
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
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 30,
      functions: 50,
      lines: 50
    }
  }
};
