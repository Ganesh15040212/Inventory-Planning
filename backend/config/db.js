require('dotenv').config();
let sql;
let config;

if (process.env.DB_USER) {
  // Production / SQL Server Authentication (uses pure JS driver, safe for Linux/cPanel)
  sql = require('mssql');
  config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'ERP_DB',
    options: {
      encrypt: false,
      trustServerCertificate: true,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  };
} else {
  // Local Development / Windows Authentication (requires native msnodesqlv8)
  try {
    sql = require('mssql/msnodesqlv8');
  } catch (err) {
    // Graceful fallback to pure JS mssql if msnodesqlv8 is not installed (e.g. during cPanel test phase)
    sql = require('mssql');
  }
  config = {
    driver: 'msnodesqlv8',
    connectionString: `Driver={ODBC Driver 17 for SQL Server};Server=${process.env.DB_SERVER || 'localhost'};Database=${process.env.DB_NAME || 'ERP_DB'};Trusted_Connection=yes;Encrypt=no;`,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      trustServerCertificate: true,
    },
  };
}

let poolPromise;

const getPool = async () => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`✅ Connected to SQL Server (${process.env.DB_USER ? 'SQL Authentication' : 'Windows Authentication'})`);
        return pool;
      })
      .catch((err) => {
        console.error('❌ Database Connection Failed:', err.message);
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
};

module.exports = { sql, getPool };
