const { sql, getPool } = require('../config/db');

// Name of the historical/old database on the same SQL Server instance
const OLD_DB = 'ERP_OLD';

const cleanBarcode = (upc) => {
  if (!upc) return '';
  const clean = String(upc).trim();
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return String(Math.round(parseFloat(clean)));
  }
  return clean;
};

// Calculate business formulas
const calculateFormulas = (data, seasonMultiplier = 1.0, staffRequirement = 0, yearPeriodMonths = 12, daysCount = 30) => {
  const { stockOnHand, lastOneMonthSale, lastOneYearSale, cost } = data;

  // Normalise month-period sales to a per-30-day rate
  const avgMonthSale = lastOneMonthSale > 0 ? lastOneMonthSale / (daysCount / 30.4375) : 0;
  const avgPerMonth = lastOneYearSale > 0 ? lastOneYearSale / yearPeriodMonths : 0;

  const systemRequirement = (lastOneMonthSale * seasonMultiplier) - stockOnHand;
  const finalRequirement = systemRequirement + staffRequirement;
  const afterPurchaseStock = stockOnHand + staffRequirement;
  const purchaseAmount = cost * staffRequirement;
  const rotation = lastOneMonthSale > 0 ? stockOnHand / lastOneMonthSale : 0;

  return {
    averagePerMonth: parseFloat(avgPerMonth.toFixed(2)),
    systemRequirement: parseFloat(systemRequirement.toFixed(2)),
    finalRequirement: parseFloat(finalRequirement.toFixed(2)),
    afterPurchaseStock: parseFloat(afterPurchaseStock.toFixed(2)),
    purchaseAmount: parseFloat(purchaseAmount.toFixed(2)),
    rotation: parseFloat(rotation.toFixed(2)),
  };
};

// GET /api/items/:itemCode
const getItemDetails = async (req, res) => {
  try {
    const { itemCode } = req.params;
    const seasonMultiplier = parseFloat(req.query.seasonMultiplier) || 1.0;
    const staffRequirement = parseFloat(req.query.staffRequirement) || 0;
    
    let monthFrom = req.query.monthFromDate;
    let monthTo = req.query.monthToDate;
    let yearFrom = req.query.yearFromDate;
    let yearTo = req.query.yearToDate;

    if (!itemCode) {
      return res.status(400).json({ success: false, message: 'Item code is required' });
    }

    const pool = await getPool();

    // Default dates from stmStockLedger MAX date if not provided
    const maxDateResult = await pool.request().query(`SELECT ISNULL(MAX(DocumentDate), GETDATE()) AS MaxDate FROM stmStockLedger`);
    const dbMaxDate = maxDateResult.recordset[0]?.MaxDate || new Date();
    const maxDateStr = new Date(dbMaxDate).toISOString().split('T')[0];

    // Validate date strings to ensure they are valid SQL Server DATETIME values (>= 1753)
    const isValidSqlDate = (dateStr) => {
      if (!dateStr || typeof dateStr !== 'string') return false;
      const parts = dateStr.split('-');
      if (parts.length !== 3) return false;
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      const day = parseInt(parts[2]);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return false;
      if (year < 1753 || year > 9999) return false;
      if (month < 1 || month > 12) return false;
      if (day < 1 || day > 31) return false;
      return true;
    };

    if (!isValidSqlDate(monthTo)) monthTo = maxDateStr;
    if (!isValidSqlDate(monthFrom)) {
      const d = new Date(dbMaxDate);
      d.setMonth(d.getMonth() - 1);
      monthFrom = d.toISOString().split('T')[0];
    }
    if (!isValidSqlDate(yearTo)) yearTo = maxDateStr;
    if (!isValidSqlDate(yearFrom)) {
      const d = new Date(dbMaxDate);
      d.setFullYear(d.getFullYear() - 1);
      yearFrom = d.toISOString().split('T')[0];
    }

    const request = pool.request();
    const isNumeric = /^\d+$/.test(itemCode.trim());

    // 1. Get item master info - prioritize UPC/Barcode and Display Code first
    request.input('upcCode', sql.VarChar(50), itemCode.trim());
    let itemQuery = `
      SELECT TOP 1 i.code, i.Name, i.UPCCode, s.name AS SizeName, sup.name AS SupplierName, d.udfcode AS ItemCodeDisplay
      FROM mstitem i
      LEFT JOIN mstsize s ON i.SizeCode = s.code
      LEFT JOIN mstsupplier sup ON i.SupplierAcCode = sup.code
      LEFT JOIN mstitemdetail d ON i.code = d.code
      WHERE i.UPCCode = @upcCode OR d.udfcode = @upcCode
    `;

    let itemResult = await request.query(itemQuery);

    // Fallback: If no item is found and the input is numeric, search by internal item code
    if (itemResult.recordset.length === 0 && isNumeric) {
      const fallbackRequest = pool.request();
      fallbackRequest.input('itemCode', sql.Int, parseInt(itemCode));
      const fallbackQuery = `
        SELECT TOP 1 i.code, i.Name, i.UPCCode, s.name AS SizeName, sup.name AS SupplierName, d.udfcode AS ItemCodeDisplay
        FROM mstitem i
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstsupplier sup ON i.SupplierAcCode = sup.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        WHERE i.code = @itemCode
      `;
      itemResult = await fallbackRequest.query(fallbackQuery);
    }

    if (itemResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: `Item "${itemCode}" not found in the system` });
    }

    const item = itemResult.recordset[0];
    const internalCode = item.code;

    // 2. Run stock, sales, last-purchase cost, and last-purchase supplier queries in parallel
    const [stockResult, oneSalesResult, yearSalesResult, lastPurchaseResult] = await Promise.all([
      // Current stock — sum of all transactions in stmStockLedger
      pool.request()
        .input('itemCode', sql.Int, internalCode)
        .query(`
          SELECT ISNULL(SUM(Quantity), 0) AS StockOnHand
          FROM stmStockLedger
          WHERE ItemCode = @itemCode AND StockPointCode = 2
        `),

      // Month sales — UNION current DB + old DB for full history
      pool.request()
        .input('itemCode', sql.Int, internalCode)
        .input('monthFrom', sql.VarChar(10), monthFrom)
        .input('monthTo', sql.VarChar(10), monthTo)
        .query(`
          SELECT ISNULL(SUM(ABS(Quantity)), 0) AS LastOneMonthSale
          FROM (
            SELECT Quantity
            FROM stmStockLedger
            WHERE ItemCode = @itemCode
              AND Quantity < 0
              AND VoucherTypeCode = 503
              AND StockPointCode = 2
              AND DocumentDate BETWEEN @monthFrom AND @monthTo
            UNION ALL
            SELECT Quantity
            FROM ${OLD_DB}.dbo.stmStockLedger
            WHERE ItemCode = @itemCode
              AND Quantity < 0
              AND VoucherTypeCode = 503
              AND StockPointCode = 2
              AND DocumentDate BETWEEN @monthFrom AND @monthTo
          ) combined
        `),

      // Year sales — UNION current DB + old DB for full history
      pool.request()
        .input('itemCode', sql.Int, internalCode)
        .input('yearFrom', sql.VarChar(10), yearFrom)
        .input('yearTo', sql.VarChar(10), yearTo)
        .query(`
          SELECT ISNULL(SUM(ABS(Quantity)), 0) AS LastOneYearSale
          FROM (
            SELECT Quantity
            FROM stmStockLedger
            WHERE ItemCode = @itemCode
              AND Quantity < 0
              AND VoucherTypeCode = 503
              AND StockPointCode = 2
              AND DocumentDate BETWEEN @yearFrom AND @yearTo
            UNION ALL
            SELECT Quantity
            FROM ${OLD_DB}.dbo.stmStockLedger
            WHERE ItemCode = @itemCode
              AND Quantity < 0
              AND VoucherTypeCode = 503
              AND StockPointCode = 2
              AND DocumentDate BETWEEN @yearFrom AND @yearTo
          ) combined
        `),

      // Last purchase cost + supplier — most recent across BOTH databases
      pool.request()
        .input('itemCode', sql.Int, internalCode)
        .query(`
          SELECT TOP 1
            pd.Rate AS LastPurchaseCost,
            ISNULL(s.name, '') AS LastSupplierName
          FROM (
            SELECT pd.Rate, ph.DocumentDate, ph.PartyCode
            FROM tranPurchaseDetail pd
            INNER JOIN tranPurchaseHeader ph ON pd.HeaderCode = ph.Code
            WHERE pd.ItemCode = @itemCode AND pd.Rate > 0
            UNION ALL
            SELECT pd.Rate, ph.DocumentDate, ph.PartyCode
            FROM ${OLD_DB}.dbo.tranPurchaseDetail pd
            INNER JOIN ${OLD_DB}.dbo.tranPurchaseHeader ph ON pd.HeaderCode = ph.Code
            WHERE pd.ItemCode = @itemCode AND pd.Rate > 0
          ) pd
          LEFT JOIN mstsupplier s ON pd.PartyCode = s.code
          ORDER BY pd.DocumentDate DESC
        `),
    ]);

    const stockOnHand = parseFloat(stockResult.recordset[0]?.StockOnHand || 0);
    const lastOneMonthSale = parseFloat(oneSalesResult.recordset[0]?.LastOneMonthSale || 0);
    const lastOneYearSale = parseFloat(yearSalesResult.recordset[0]?.LastOneYearSale || 0);

    // Hierarchical cost selection:
    // 1. Check latest RunningAvgRateBC in stmStockLedger
    // 2. Check BaseCost in mstUPCPrice (PricingCode = 1)
    // 3. Check BaseCost in mstitemdetail
    // 4. Check LastPurchaseCost from tranPurchaseDetail
    let cost = 0;

    // 1. Ledger Avg Rate
    const ledgerCostRes = await pool.request()
      .input('itemCode', sql.Int, internalCode)
      .query(`
        SELECT TOP 1 RunningAvgRateBC
        FROM stmStockLedger
        WHERE ItemCode = @itemCode AND RunningAvgRateBC > 0 AND StockPointCode = 2
        ORDER BY DocumentDate DESC, Code DESC
      `);
    cost = parseFloat(ledgerCostRes.recordset[0]?.RunningAvgRateBC || 0);

    // 2. Fallback: mstUPCPrice
    if (!cost) {
      const upcCostRes = await pool.request()
        .input('itemCode', sql.Int, internalCode)
        .query(`
          SELECT TOP 1 BaseCost
          FROM mstUPCPrice
          WHERE itemcode = @itemCode AND PricingCode = 1 AND BaseCost > 0
          ORDER BY code DESC
        `);
      cost = parseFloat(upcCostRes.recordset[0]?.BaseCost || 0);
    }

    // 3. Fallback: mstitemdetail
    if (!cost) {
      const detailCostRes = await pool.request()
        .input('itemCode', sql.Int, internalCode)
        .query(`SELECT ISNULL(BaseCost, 0) AS BaseCost FROM mstitemdetail WHERE code = @itemCode`);
      cost = parseFloat(detailCostRes.recordset[0]?.BaseCost || 0);
    }

    // 4. Fallback: Last Purchase Cost
    if (!cost) {
      cost = parseFloat(lastPurchaseResult.recordset[0]?.LastPurchaseCost || 0);
    }

    // Use last purchase supplier if available, fallback to item master supplier
    const lastSupplierName = lastPurchaseResult.recordset[0]?.LastSupplierName?.trim() || '';
    const supplierName = lastSupplierName || (item.SupplierName ? item.SupplierName.trim() : '—');

    // Calculate year period in months
    const d1 = new Date(yearFrom);
    const d2 = new Date(yearTo);
    const diffTime = Math.abs(d2 - d1);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 365;
    const yearPeriodMonths = diffDays / 30.4375;

    // Calculate exact day count for month period (Bug 3 fix — days not months)
    const m1 = new Date(monthFrom);
    const m2 = new Date(monthTo);
    const monthDiffTime = Math.abs(m2 - m1);
    const daysCount = Math.max(1, Math.ceil(monthDiffTime / (1000 * 60 * 60 * 24)) + 1);

    const rawData = { stockOnHand, lastOneMonthSale, lastOneYearSale, cost };
    const formulas = calculateFormulas(rawData, seasonMultiplier, staffRequirement, yearPeriodMonths, daysCount);

    return res.json({
      success: true,
      data: {
        itemCode: item.ItemCodeDisplay ? item.ItemCodeDisplay.trim() : String(internalCode),
        itemName: item.Name ? item.Name.trim() : '',
        upcCode: cleanBarcode(item.UPCCode),
        sizeModel: item.SizeName ? item.SizeName.trim() : '—',
        supplierName,
        stockOnHand,
        lastOneMonthSale,
        lastOneYearSale,
        cost,
        seasonMultiplier,
        staffRequirement,
        ...formulas,
      },
    });
  } catch (err) {
    console.error('Item details error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve item data', error: err.message });
  }
};

// POST /api/items/calculate
const recalculate = async (req, res) => {
  try {
    const { stockOnHand, lastOneMonthSale, lastOneYearSale, cost, seasonMultiplier, staffRequirement } = req.body;

    if (stockOnHand === undefined || lastOneMonthSale === undefined) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const rawData = {
      stockOnHand: parseFloat(stockOnHand) || 0,
      lastOneMonthSale: parseFloat(lastOneMonthSale) || 0,
      lastOneYearSale: parseFloat(lastOneYearSale) || 0,
      cost: parseFloat(cost) || 0,
    };

    const formulas = calculateFormulas(rawData, parseFloat(seasonMultiplier) || 1.0, parseFloat(staffRequirement) || 0);

    return res.json({ success: true, data: formulas });
  } catch (err) {
    console.error('Recalculate error:', err);
    return res.status(500).json({ success: false, message: 'Calculation failed' });
  }
};

// GET /api/items/search?q=searchTerm
const searchItems = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Search term must be at least 2 characters' });
    }

    const pool = await getPool();
    const isNumeric = /^\d+$/.test(q.trim());

    let query, request = pool.request();

    if (isNumeric) {
      request.input('code', sql.Int, parseInt(q));
      request.input('search', sql.VarChar(100), `%${q}%`);
      query = `
        SELECT TOP 20 i.code, i.Name, i.UPCCode, d.udfcode AS ItemCodeDisplay
        FROM mstitem i
        LEFT JOIN mstitemdetail d ON i.code = d.code
        WHERE i.code = @code OR i.UPCCode LIKE @search OR d.udfcode LIKE @search
        ORDER BY i.code
      `;
    } else {
      request.input('search', sql.VarChar(255), `%${q}%`);
      query = `
        SELECT TOP 20 i.code, i.Name, i.UPCCode, d.udfcode AS ItemCodeDisplay
        FROM mstitem i
        LEFT JOIN mstitemdetail d ON i.code = d.code
        WHERE i.Name LIKE @search OR d.udfcode LIKE @search
        ORDER BY i.code
      `;
    }

    const result = await request.query(query);
    return res.json({
      success: true,
      data: result.recordset.map(r => ({
        code: r.ItemCodeDisplay ? r.ItemCodeDisplay.trim() : String(r.code),
        name: r.Name ? r.Name.trim() : '',
        upcCode: cleanBarcode(r.UPCCode),
      })),
    });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ success: false, message: 'Search failed' });
  }
};

// GET /api/items/dashboard-stats
const getDashboardStats = async (req, res) => {
  try {
    const pool = await getPool();

    const [itemsResult, stockResult, salesResult, historyResult, recentResult] = await Promise.all([
      pool.request().query(`SELECT COUNT(*) AS TotalItems FROM mstitem`),
      pool.request().query(`SELECT ISNULL(SUM(ClBalQty), 0) AS TotalStock FROM TBL_Stock`),
      pool.request().query(`
        DECLARE @MaxDate DATE = (SELECT ISNULL(MAX(DocumentDate), GETDATE()) FROM stmStockLedger);
        DECLARE @OneMonthAgo DATE = DATEADD(MONTH, -1, @MaxDate);
        SELECT ISNULL(SUM(ABS(NetAmountDC) - ISNULL(TaxAmountDC, 0)), 0) AS MonthSales
        FROM (
          SELECT NetAmountDC, TaxAmountDC, DocumentDate FROM stmStockLedger WHERE Quantity < 0 AND VoucherTypeCode = 503 AND StockPointCode = 2
          UNION ALL
          SELECT NetAmountDC, TaxAmountDC, DocumentDate FROM ${OLD_DB}.dbo.stmStockLedger WHERE Quantity < 0 AND VoucherTypeCode = 503 AND StockPointCode = 2
        ) combined
        WHERE DocumentDate BETWEEN @OneMonthAgo AND @MaxDate
      `),
      pool.request().query(`
        DECLARE @MaxDate DATE = (SELECT ISNULL(MAX(DocumentDate), GETDATE()) FROM stmStockLedger);
        DECLARE @OneYearAgo DATE = DATEADD(YEAR, -1, @MaxDate);
        SELECT ISNULL(SUM(ABS(NetAmountDC) - ISNULL(TaxAmountDC, 0)), 0) AS YearSales
        FROM (
          SELECT NetAmountDC, TaxAmountDC, DocumentDate FROM stmStockLedger WHERE Quantity < 0 AND VoucherTypeCode = 503 AND StockPointCode = 2
          UNION ALL
          SELECT NetAmountDC, TaxAmountDC, DocumentDate FROM ${OLD_DB}.dbo.stmStockLedger WHERE Quantity < 0 AND VoucherTypeCode = 503 AND StockPointCode = 2
        ) combined
        WHERE DocumentDate BETWEEN @OneYearAgo AND @MaxDate
      `),
      pool.request().query(`
        SELECT TOP 5 Id, Username, ItemCode, ItemName, UPCCode, CalculationDate,
               StockOnHand, LastOneMonthSale, LastOneYearSale, Cost, SeasonMultiplier,
               AveragePerMonth, SystemRequirement, StaffRequirement, FinalRequirement,
               AfterPurchaseStock, PurchaseAmount, Rotation, SizeModel, SupplierName
        FROM tbl_InventoryPlanningHistory
        ORDER BY CalculationDate DESC
      `),
    ]);

    return res.json({
      success: true,
      data: {
        totalItems: itemsResult.recordset[0]?.TotalItems || 0,
        totalStock: parseFloat(stockResult.recordset[0]?.TotalStock || 0),
        monthSales: parseFloat(salesResult.recordset[0]?.MonthSales || 0),
        yearSales: parseFloat(historyResult.recordset[0]?.YearSales || 0),
        recentHistory: (recentResult.recordset || []).map(h => ({
          ...h,
          UPCCode: cleanBarcode(h.UPCCode)
        })),
      },
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard statistics' });
  }
};

module.exports = { getItemDetails, recalculate, searchItems, getDashboardStats };
