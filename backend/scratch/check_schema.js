const { getPool } = require('../config/db');

async function check() {
  try {
    const pool = await getPool();
    
    // Fetch all categories grouped by their parent group
    const categoriesByGroup = await pool.request().query(`
      SELECT 
        g.name AS GroupName,
        c.name AS CategoryName
      FROM mstproductcategory c
      INNER JOIN mstproductgroup g ON c.productgroupcode = g.code
      ORDER BY g.name, c.name
    `);
    
    // Group them in JS for nice display
    const mapping = {};
    categoriesByGroup.recordset.forEach(row => {
      const gName = row.GroupName;
      if (!mapping[gName]) mapping[gName] = [];
      mapping[gName].push(row.CategoryName);
    });

    console.log('--- CATEGORIES GROUPED BY PRODUCT GROUP ---');
    console.log(JSON.stringify(mapping, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

check();
