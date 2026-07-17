require('dotenv').config();
const { sql, getPool } = require('./config/db');

async function initDatabase() {
  console.log('🔄 Checking database tables...');
  try {
    const pool = await getPool();

    // 1. Create/Recreate tbl_InventoryPlanningHistory table if it doesn't exist or has wrong column
    console.log('⏳ Checking table: tbl_InventoryPlanningHistory...');
    
    // We drop the table if it contains CreatedDate instead of CalculationDate to fix the previous schema bug
    await pool.request().query(`
      IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[tbl_InventoryPlanningHistory]') AND name = 'CreatedDate')
      BEGIN
        DROP TABLE [dbo].[tbl_InventoryPlanningHistory];
        PRINT 'ℹ️ Dropping outdated table tbl_InventoryPlanningHistory for recreation...';
      END

      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[tbl_InventoryPlanningHistory]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[tbl_InventoryPlanningHistory] (
          [Id] INT IDENTITY(1,1) PRIMARY KEY,
          [Username] VARCHAR(100) NOT NULL,
          [ItemCode] INT NOT NULL,
          [ItemName] VARCHAR(255) NOT NULL,
          [UPCCode] VARCHAR(50) NULL,
          [StockOnHand] FLOAT NOT NULL DEFAULT 0,
          [LastOneMonthSale] FLOAT NOT NULL DEFAULT 0,
          [LastOneYearSale] FLOAT NOT NULL DEFAULT 0,
          [Cost] FLOAT NOT NULL DEFAULT 0,
          [SeasonMultiplier] FLOAT NOT NULL DEFAULT 1,
          [AveragePerMonth] FLOAT NOT NULL DEFAULT 0,
          [SystemRequirement] FLOAT NOT NULL DEFAULT 0,
          [StaffRequirement] FLOAT NOT NULL DEFAULT 0,
          [FinalRequirement] FLOAT NOT NULL DEFAULT 0,
          [AfterPurchaseStock] FLOAT NOT NULL DEFAULT 0,
          [PurchaseAmount] FLOAT NOT NULL DEFAULT 0,
          [Rotation] FLOAT NOT NULL DEFAULT 0,
          [SizeModel] VARCHAR(100) NULL,
          [SupplierName] VARCHAR(255) NULL,
          [CalculationDate] DATETIME NOT NULL DEFAULT GETDATE()
        );
        PRINT '✅ Table tbl_InventoryPlanningHistory created successfully with CalculationDate.';
      END
      ELSE
      BEGIN
        PRINT 'ℹ️ Table tbl_InventoryPlanningHistory already exists.';
      END
    `);

    // 2. Create tbl_InventoryUsers table if it doesn't exist
    console.log('⏳ Checking table: tbl_InventoryUsers...');
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[tbl_InventoryUsers]') AND type in (N'U'))
      BEGIN
        CREATE TABLE [dbo].[tbl_InventoryUsers] (
          [Id] INT IDENTITY(1,1) PRIMARY KEY,
          [Username] VARCHAR(100) NOT NULL UNIQUE,
          [PasswordHash] VARCHAR(255) NOT NULL,
          [FullName] VARCHAR(100) NULL,
          [Role] VARCHAR(50) NULL,
          [CreatedDate] DATETIME NOT NULL DEFAULT GETDATE()
        );
        PRINT '✅ Table tbl_InventoryUsers created successfully.';
      END
      ELSE
      BEGIN
        PRINT 'ℹ️ Table tbl_InventoryUsers already exists.';
      END
    `);

    console.log('\n🎉 Database initialization finished successfully!\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message);
    process.exit(1);
  }
}

initDatabase();
