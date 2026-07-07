require('dotenv').config();
const bcrypt = require('bcrypt');
const { sql, getPool } = require('./config/db');

async function seed() {
  console.log('🌱 Starting database seed...');

  try {
    const pool = await getPool();

    // Generate hashes
    const adminHash = await bcrypt.hash('admin123', 10);
    const staffHash = await bcrypt.hash('staff123', 10);

    // Upsert admin user
    await pool.request()
      .input('username', sql.VarChar(100), 'admin')
      .input('hash', sql.VarChar(255), adminHash)
      .input('fullname', sql.VarChar(100), 'Administrator')
      .input('role', sql.VarChar(50), 'Admin')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM tbl_InventoryUsers WHERE Username = @username)
          INSERT INTO tbl_InventoryUsers (Username, PasswordHash, FullName, Role)
          VALUES (@username, @hash, @fullname, @role)
        ELSE
          UPDATE tbl_InventoryUsers SET PasswordHash = @hash WHERE Username = @username
      `);
    console.log('✅ Admin user seeded (admin / admin123)');

    // Upsert staff user
    await pool.request()
      .input('username', sql.VarChar(100), 'staff')
      .input('hash', sql.VarChar(255), staffHash)
      .input('fullname', sql.VarChar(100), 'Inventory Staff')
      .input('role', sql.VarChar(50), 'Staff')
      .query(`
        IF NOT EXISTS (SELECT 1 FROM tbl_InventoryUsers WHERE Username = @username)
          INSERT INTO tbl_InventoryUsers (Username, PasswordHash, FullName, Role)
          VALUES (@username, @hash, @fullname, @role)
        ELSE
          UPDATE tbl_InventoryUsers SET PasswordHash = @hash WHERE Username = @username
      `);
    console.log('✅ Staff user seeded (staff / staff123)');

    console.log('\n🎉 Seed completed successfully!\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
