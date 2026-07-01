import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MONGODB_URI, POSTGRES_URI } from './config';


import * as postgresSchema from './drizzle/schema/schema';
import { programSchema } from './models/Program';

// The service is no longer multi-tenant: we maintain exactly ONE shared
// Mongoose connection instead of a per-tenant map of connections.
const appConnection = null;
const tenantDb = 'Tenant';

const mongoDb = (dbName) =>
  `${MONGODB_URI}/${dbName}?retryWrites=true&w=majority`;

// The version-control + program-change plugins are applied ONCE on the shared
// programSchema in models/Program.js (they resolve sibling models from the
// model's own connection), so here we only need to compile the per-request
// Program model from that already-plugged schema.
const applyProgramSchema = (db) => db.model('Program', programSchema);

let postgresPool;
let postgresClient;

const getPostgresPool = () => {
  if (!postgresPool) {
    postgresPool = new Pool({ connectionString: POSTGRES_URI });
  }
  return postgresPool;
};

const getPostgresDb = () => {
  if (!postgresClient) {
    postgresPool = getPostgresPool();
    postgresClient = drizzle(postgresPool, { schema: postgresSchema });
  }
  return postgresClient;
};

const closePostgresPool = async () => {
  if (postgresPool) {
    await postgresPool.end();
    postgresPool = null;
    postgresClient = null;
  }
};

export { mongoDb, getPostgresDb, closePostgresPool, tenantDb };
