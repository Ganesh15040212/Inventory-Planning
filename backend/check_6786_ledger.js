const { getPool } = require('./config/db');

(async () => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT * FROM stmStockLedger WHERE ItemCode = 6786
    `);
    console.log('Ledger records for 6786:', result.recordset);
  } catch(e) {
    console.error(e.message);
  }
  process.exit(0);
})();
