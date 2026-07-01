import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { MONGODB_URI, POSTGRES_URI } from './config';

import * as postgresSchema from './drizzle/schema/schema';

const tenantDb = 'Tenant';

const mongoDb = (dbName: string) =>
  `${MONGODB_URI}/${dbName}?retryWrites=true&w=majority`;

let postgresPool: Pool;
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
