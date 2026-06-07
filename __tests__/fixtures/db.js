const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { TENANT_ID } = require('./constants');
const { disconnectFromDatabase } = require('../../database');

// The @shelf/jest-mongodb preset (configured in jest.config.js + the pinned
// jest-mongodb-config.js) starts ONE in-memory MongoDB for the whole test run.
// We connect to that shared server instead of starting a separate
// MongoMemoryServer per suite — which was slow and flaky (each suite paid a
// fresh mongod launch and timed out at 10s).
//
// Net effect: tests never touch an external MongoDB and never launch their own
// mongod; they share the single in-memory instance the preset manages and tears
// down automatically.
//
// jest.config.js overrides `testEnvironment` to 'node', so the preset's custom
// environment (which would inject global.__MONGO_URI__) is not active. The
// shared URI is still available two other ways the preset's global setup
// provides: process.env.MONGO_URL, and the globalConfig.json it writes to the
// project root. We resolve from whichever is present.
const resolveSharedUri = () => {
  if (global.__MONGO_URI__) {
    return global.__MONGO_URI__;
  }
  if (process.env.MONGO_URL) {
    return process.env.MONGO_URL;
  }
  // globalConfig.json is written to jest's rootDir (the project root).
  const candidates = [
    path.join(process.cwd(), 'globalConfig.json'),
    path.resolve(__dirname, '../../globalConfig.json')
  ];
  for (const file of candidates) {
    try {
      const { mongoUri } = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (mongoUri) {
        return mongoUri;
      }
    } catch (e) {
      // try next candidate
    }
  }
  throw new Error(
    'Could not resolve the in-memory MongoDB URI. Ensure tests run via jest so ' +
      'the @shelf/jest-mongodb preset global setup runs (see jest.config.js ' +
      '`preset` and jest-mongodb-config.js).'
  );
};

module.exports.connect = async () => {
  const baseUri = resolveSharedUri();
  // The @shelf/jest-mongodb preset gives ONE in-memory server for ALL jest
  // workers. Give each worker its OWN database (keyed by JEST_WORKER_ID) so
  // tests running in parallel don't read/write/drop the same `test` db and
  // clobber each other. The returned URI carries the per-worker db name so the
  // app's connectToDatabase() (which tests pass it to) hits the SAME db as the
  // DAO/default connection — they must agree for seeded data to be visible.
  const workerId = process.env.JEST_WORKER_ID || '1';
  const dbName = `${TENANT_ID}_${workerId}`;
  const uri = `${baseUri.replace(/\/+$/, '')}/${dbName}`;
  await mongoose.connect(uri);
  // Start from a clean database so leftovers from a previous suite in this same
  // worker can't pollute this one.
  await mongoose.connection.dropDatabase();
  return uri; // Return the URI to be used in tests
};

// Full teardown: drop the suite's data and close BOTH connections so they don't
// accumulate on the shared server across suites (the cause of jest not exiting
// gracefully / hanging at the end of a full run).
const teardown = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
  // Also close the app's connectToDatabase() singleton connection.
  await disconnectFromDatabase();
};

module.exports.closeDatabase = teardown;
module.exports.clearDatabase = teardown;
