import { defineConfig } from 'drizzle-kit';
require('dotenv').config({ path: '.env.development' });

const { POSTGRES_URI } = process.env;

export default defineConfig({
  schema: './drizzle/schema/schema.js',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: POSTGRES_URI
  }
});
