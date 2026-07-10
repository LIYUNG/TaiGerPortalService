// Unit tests for database.js. No real Mongo/Postgres connections are made:
// - mongoose.mockCreateConnection is mocked to return a fake connection whose
//   .model()/.discriminator are spies, so we can assert every model is
//   registered and that the connection is memoized.
// - 'pg' Pool and 'mockDrizzle-orm/node-postgres' mockDrizzle are mocked so the
//   Postgres helpers can be exercised (memoization + teardown) without a DB.
//
// database.js memoizes module-level state (appConnection / postgresPool /
// postgresClient), so each scenario re-requires the module via a fresh
// module registry helper.

// ---- mongoose mock -------------------------------------------------------
const makeFakeUserModel = () => ({
  discriminator: jest.fn()
});

const mockCreateConnection = jest.fn();

// Keep the real mongoose surface (Types/Schema/model) so requiring the model
// graph via models/User.js -> @taiger-common/model still works; only override
// createConnection so no real connection is opened.
jest.mock('mongoose', () => ({
  ...jest.requireActual('mongoose'),
  createConnection: (...args: any[]) => mockCreateConnection(...args)
}));

// ---- pg / mockDrizzle mocks --------------------------------------------------
const mockPoolEnd = jest.fn().mockResolvedValue(undefined);
const mockPoolCtor = jest
  .fn()
  .mockImplementation(function Pool(this: any, opts: any) {
    this.opts = opts;
    this.end = mockPoolEnd;
  });
jest.mock('pg', () => ({ Pool: mockPoolCtor }));

const mockDrizzle = jest.fn().mockReturnValue({ __drizzle: true });
jest.mock('drizzle-orm/node-postgres', () => ({ drizzle: mockDrizzle }));

// Build a fresh fake connection for a require cycle.
const makeFakeConnection = () => {
  const userModel = makeFakeUserModel();
  const registered: Record<string, any> = {};
  const conn = {
    registered,
    userModel,
    closed: 0,
    model: jest.fn((name, schema) => {
      if (schema !== undefined) {
        registered[name] = schema;
      }
      if (name === 'User') return userModel;
      return { name };
    }),
    close: jest.fn().mockImplementation(function close() {
      conn.closed += 1;
      return Promise.resolve();
    })
  };
  return conn;
};

// Re-require database.js with a clean module registry. Returns the module plus
// the fake connection that mockCreateConnection will hand out.
const loadDatabase = () => {
  jest.resetModules();
  const conn = makeFakeConnection();
  mockCreateConnection.mockReturnValue(conn);
  // eslint-disable-next-line global-require
  const db = require('../database');
  return { db, conn };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPoolEnd.mockResolvedValue(undefined);
  mockDrizzle.mockReturnValue({ __drizzle: true });
});

describe('mongoDb', () => {
  test('builds a mongo URI with retryWrites and majority write concern', () => {
    const { db } = loadDatabase();
    const uri = db.mongoDb('SomeDb');
    expect(uri).toContain('/SomeDb?');
    expect(uri).toContain('retryWrites=true');
    expect(uri).toContain('w=majority');
  });
});

describe('Postgres helpers', () => {
  test('getPostgresDb lazily builds a Pool + mockDrizzle client and memoizes both', () => {
    const { db } = loadDatabase();
    const client1 = db.getPostgresDb();
    const client2 = db.getPostgresDb();

    expect(client1).toBe(client2);
    expect(mockPoolCtor).toHaveBeenCalledTimes(1);
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
    // mockDrizzle is called with the pool and a schema option.
    const [poolArg, opts] = mockDrizzle.mock.calls[0];
    expect(poolArg).toBeInstanceOf(mockPoolCtor);
    expect(opts).toHaveProperty('schema');
  });

  test('Pool is created with the configured connection string', () => {
    const { db } = loadDatabase();
    db.getPostgresDb();
    expect(mockPoolCtor.mock.calls[0][0]).toHaveProperty('connectionString');
  });

  test('closePostgresPool ends the pool and resets the cached client', async () => {
    const { db } = loadDatabase();
    db.getPostgresDb();
    await db.closePostgresPool();
    expect(mockPoolEnd).toHaveBeenCalledTimes(1);

    // After closing, a new getPostgresDb rebuilds the pool + client.
    db.getPostgresDb();
    expect(mockPoolCtor).toHaveBeenCalledTimes(2);
    expect(mockDrizzle).toHaveBeenCalledTimes(2);
  });

  test('closePostgresPool is a no-op when no pool exists', async () => {
    const { db } = loadDatabase();
    await db.closePostgresPool();
    expect(mockPoolEnd).not.toHaveBeenCalled();
  });
});

describe('exports', () => {
  test('exposes the expected public surface', () => {
    const { db } = loadDatabase();
    expect(Object.keys(db).sort()).toEqual(
      ['mongoDb', 'getPostgresDb', 'closePostgresPool', 'tenantDb'].sort()
    );
    expect(db.tenantDb).toBe('Tenant');
  });
});
