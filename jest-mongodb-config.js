// Configuration for the @shelf/jest-mongodb preset (see jest.config.js).
//
// Tests run against an in-memory MongoDB (mongodb-memory-server) — they never
// touch an external/real database. Two things make this reliable:
//
//   1. Pin the binary version so CI/dev machines never try to *download* a new
//      mongod on the fly (the default is 7.x, which isn't cached locally and
//      times out behind restricted networks). 6.0.9 is a stable release already
//      present in the local cache and starts in ~1s.
//   2. Use ONE shared server for all suites/workers (default true) so we don't
//      pay a fresh mongod launch per test file. The fixture in
//      __tests__/fixtures/db.js connects to this shared instance.
module.exports = {
  mongodbMemoryServerOptions: {
    binary: {
      version: '6.0.9',
      skipMD5: true
    },
    autoStart: false,
    // Pin a low, fixed port. The default behaviour picks a random high port,
    // which on Windows intermittently lands in a reserved/excluded range
    // (Hyper-V/WSL reserve chunks of 49152-65535) and fails with EACCES. 27018
    // sits below those ranges. There is a single shared server per run, so a
    // fixed port does not collide between suites.
    instance: { port: 27018 }
  },
  useSharedDBForAllJestWorkers: true
};
