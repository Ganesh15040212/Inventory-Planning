const { sql, getPool } = require('../config/db');

// POST /api/history - Save a calculation
const saveHistory = async (req, res) => {
  try {
    const {
      itemCode, itemName, upcCode, stockOnHand, lastOneMonthSale, lastOneYearSale,
      cost, seasonMultiplier, averagePerMonth, systemRequirement, staffRequirement,
      finalRequirement, afterPurchaseStock, purchaseAmount, rotation, sizeModel, supplierName,
    } = req.body;

    if (!itemCode || !itemName) {
      return res.status(400).json({ success: false, message: 'Item code and name are required' });
    }

    const pool = await getPool();
    const result = await pool.request()
      .input('username', sql.VarChar(100), req.user.username)
      .input('itemCode', sql.Int, parseInt(itemCode))
      .input('itemName', sql.VarChar(255), itemName)
      .input('upcCode', sql.VarChar(50), upcCode || '')
      .input('stockOnHand', sql.Float, parseFloat(stockOnHand) || 0)
      .input('lastOneMonthSale', sql.Float, parseFloat(lastOneMonthSale) || 0)
      .input('lastOneYearSale', sql.Float, parseFloat(lastOneYearSale) || 0)
      .input('cost', sql.Float, parseFloat(cost) || 0)
      .input('seasonMultiplier', sql.Float, parseFloat(seasonMultiplier) || 1)
      .input('averagePerMonth', sql.Float, parseFloat(averagePerMonth) || 0)
      .input('systemRequirement', sql.Float, parseFloat(systemRequirement) || 0)
      .input('staffRequirement', sql.Float, parseFloat(staffRequirement) || 0)
      .input('finalRequirement', sql.Float, parseFloat(finalRequirement) || 0)
      .input('afterPurchaseStock', sql.Float, parseFloat(afterPurchaseStock) || 0)
      .input('purchaseAmount', sql.Float, parseFloat(purchaseAmount) || 0)
      .input('rotation', sql.Float, parseFloat(rotation) || 0)
      .input('sizeModel', sql.VarChar(100), sizeModel || '')
      .input('supplierName', sql.VarChar(255), supplierName || '')
      .query(`
        INSERT INTO tbl_InventoryPlanningHistory
          (Username, ItemCode, ItemName, UPCCode, StockOnHand, LastOneMonthSale, LastOneYearSale,
           Cost, SeasonMultiplier, AveragePerMonth, SystemRequirement, StaffRequirement,
           FinalRequirement, AfterPurchaseStock, PurchaseAmount, Rotation, SizeModel, SupplierName)
        OUTPUT INSERTED.Id
        VALUES
          (@username, @itemCode, @itemName, @upcCode, @stockOnHand, @lastOneMonthSale, @lastOneYearSale,
           @cost, @seasonMultiplier, @averagePerMonth, @systemRequirement, @staffRequirement,
           @finalRequirement, @afterPurchaseStock, @purchaseAmount, @rotation, @sizeModel, @supplierName)
      `);

    const newId = result.recordset[0]?.Id;
    return res.json({ success: true, message: 'Calculation saved to history', data: { Id: newId } });
  } catch (err) {
    console.error('Save history error:', err);
    return res.status(500).json({ success: false, message: 'Failed to save calculation' });
  }
};

module.exports = { saveHistory };
