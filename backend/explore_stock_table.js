const { getPool, sql } = require('./config/db');

(async () => {
  try {
    const pool = await getPool();

    // 1. Get TBL_Stock columns
    const cols = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'TBL_Stock'
      ORDER BY ORDINAL_POSITION
    `);
    console.log('\n=== TBL_Stock COLUMNS ===');
    cols.recordset.forEach(r => console.log(r.COLUMN_NAME, '-', r.DATA_TYPE));

    // 2. Get sample rows from TBL_Stock
    const samples = await pool.request().query(`SELECT TOP 5 * FROM TBL_Stock`);
    console.log('\n=== TBL_Stock SAMPLE ROWS ===');
    console.log(JSON.stringify(samples.recordset, null, 2));

    // 3. Check if there are multiple records per ItemCode
    const duplicateCheck = await pool.request().query(`
      SELECT TOP 3 ItemCode, COUNT(*) AS RecordCount
      FROM TBL_Stock
      GROUP BY ItemCode
      HAVING COUNT(*) > 1
    `);
    console.log('\n=== TBL_Stock DUPLICATE CHECK per ItemCode ===');
    console.log(JSON.stringify(duplicateCheck.recordset, null, 2));

  } catch(e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();
