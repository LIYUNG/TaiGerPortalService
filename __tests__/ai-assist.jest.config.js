module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: '/__tests__/services/ai_assist\\.test\\.js$',
  setupFilesAfterEnv: ['jest-extended'],
  transformIgnorePatterns: ['/node_modules/(?!(nanoid)/)'],
  moduleNameMapper: {
    '^nanoid$': '<rootDir>/__mocks__/nanoid.js'
  },
  testTimeout: 15000
};
