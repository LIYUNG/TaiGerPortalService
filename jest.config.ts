import type { Config } from '@jest/types';

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  watchPathIgnorePatterns: ['globalConfig'],
  // Never scan compiled output (local `npm run build` artifact; absent in CI).
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  coveragePathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/'],
  testRegex: '/__tests__/.*\\.(test|spec)\\.[jt]sx?$',
  transform: {
    '^.+\\.[tj]sx?$': 'ts-jest'
  },
  moduleFileExtensions: ['js', 'ts', 'json', 'node'],
  setupFilesAfterEnv: ['jest-extended'],
  transformIgnorePatterns: ['/node_modules/(?!(axios|nanoid)/)'],
  moduleNameMapper: {
    '^nanoid$': '<rootDir>/__mocks__/nanoid.js'
  },
  testTimeout: 15000,
  maxWorkers: '50%',
  workerIdleMemoryLimit: '512MB',
  coverageReporters: ['text-summary', 'html', 'lcov'],
  collectCoverage: true,

  coverageThreshold: {
    global: {
      statements: 90,
      branches: 80,
      functions: 90,
      lines: 90
    }
  }
};

export default config;
