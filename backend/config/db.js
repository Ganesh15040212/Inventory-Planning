require('dotenv').config();

// Determine if we should use the Windows-only msnodesqlv8 driver or standard cross-platform mssql
const useMsnodesql = process.platform === 'win32' && !process.env.DB_USER;
const sql = useMsnodesql ? require('mssql/msnodesqlv8') : require('mssql');

const server = process.env.DB_SERVER || 'localhost';
const database = process.env.DB_DATABASE || process.env.DB_NAME || 'ERP_DB';
const user = process.env.DB_USER;
const password = process.env.DB_PASSWORD;

let config;

if (useMsnodesql) {
  // Local Windows Auth (msnodesqlv8)
  const serverInstance = server.includes('\\') ? server : `${server}\\SQLEXPRESS`;
  config = {
    driver: 'msnodesqlv8',
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${serverInstance};Database=${database};Trusted_Connection=yes;Encrypt=no;`,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: { trustServerCertificate: true }
  };
  console.log(`[Database] Using Windows Authentication via msnodesqlv8. Server: ${serverInstance}`);
} else {
  // SQL Server Auth via Tedious (Standard cross-platform driver - works on Linux/cPanel)
  config = {
    server: server,
    database: database,
    user: user,
    password: password,
    port: parseInt(process.env.DB_PORT) || 1433,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  };
  console.log(`[Database] Using SQL Server Authentication via Tedious. Server: ${server}`);
}

let poolPromise;

const connectWithFallback = async () => {
  try {
    console.log(`Connecting to SQL Server at ${server}...`);
    const pool = new sql.ConnectionPool(config);
    await pool.connect();
    console.log(`✅ Connected to database: ${database} on ${server}`);
    return pool;
  } catch (err) {
    console.warn(`⚠️ Connection failed to ${server}:`, err.message);

    // Fallback logic for local debugging
    if (server !== 'localhost' && server !== '127.0.0.1') {
      console.log(`🔄 Attempting fallback to local SQL Server (localhost)...`);
      let fallbackPool;
      if (process.platform === 'win32') {
        const msnodesql = require('mssql/msnodesqlv8');
        const fallbackConfig = {
          driver: 'msnodesqlv8',
          connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=ERP_DB;Trusted_Connection=yes;Encrypt=no;`,
          pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
          options: { trustServerCertificate: true }
        };
        fallbackPool = new msnodesql.ConnectionPool(fallbackConfig);
      } else {
        const fallbackConfig = {
          server: 'localhost',
          database: 'ERP_DB',
          options: { trustServerCertificate: true },
          pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
        };
        fallbackPool = new sql.ConnectionPool(fallbackConfig);
      }
      try {
        await fallbackPool.connect();
        console.log(`✅ Connected to Fallback SQL Server: localhost`);
        return fallbackPool;
      } catch (fallbackErr) {
        console.error(`❌ Fallback connection failed:`, fallbackErr.message);
        throw fallbackErr;
      }
    } else {
      throw err;
    }
  }
};

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = connectWithFallback().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
};

module.exports = { sql, getPool };
