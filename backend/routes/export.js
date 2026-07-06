const express = require('express');
const router = express.Router();
const {
  exportExcel, exportPDF, exportSalesExcel, exportSalesPDF, getSalesData,
  getStockValuationGroups, getCategoryStats, exportStockValuationExcel, exportStockValuationPDF,
  getOverallStockData, exportOverallStockExcel, exportOverallStockPDF
} = require('../controllers/exportController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

router.get('/excel', exportExcel);
router.get('/pdf', exportPDF);
router.get('/sales-excel', exportSalesExcel);
router.get('/sales-pdf', exportSalesPDF);
router.get('/sales-data', getSalesData);

// Stock Valuation routes
router.get('/stock-valuation/groups', getStockValuationGroups);
router.get('/stock-valuation/category-stats', getCategoryStats);
router.get('/stock-valuation/excel', exportStockValuationExcel);
router.get('/stock-valuation/pdf', exportStockValuationPDF);

// Overall Stock Report routes
router.get('/overall-stock-excel', exportOverallStockExcel);
router.get('/overall-stock-pdf', exportOverallStockPDF);
router.get('/overall-stock-data', getOverallStockData);

module.exports = router;

