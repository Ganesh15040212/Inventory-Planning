const fs = require('fs');
const path = require('path');

// ─── 1. MODIFY BACKEND: exportController.js ──────────────────────────────────
console.log('Modifying backend/controllers/exportController.js...');
let exportContent = fs.readFileSync('d:/Inventory/backend/controllers/exportController.js', 'utf8');

// Replace Excel currency format mask '[$₹-439]#,##0.00' with '#,##0.00'
exportContent = exportContent.split("'[$₹-439]#,##0.00'").join("'#,##0.00'");

// Remove 'Rs. ' prefixes
exportContent = exportContent.split("`Rs. ${").join("`${");
exportContent = exportContent.split("'VALUE (Rs.)'").join("'VALUE'");
exportContent = exportContent.split("'RETAIL (Rs.)'").join("'RETAIL'");
exportContent = exportContent.split("'COST (Rs.)'").join("'COST'");
exportContent = exportContent.split("'RETAIL (Rs.)', 'COST (Rs.)'").join("'RETAIL', 'COST'");
exportContent = exportContent.split("value: 'VALUE (₹)'").join("value: 'VALUE'");

// Write back exportController.js
fs.writeFileSync('d:/Inventory/backend/controllers/exportController.js', exportContent, 'utf8');
console.log('✅ Modified exportController.js');


// ─── 2. MODIFY FRONTEND: Dashboard.jsx ───────────────────────────────────────
console.log('Modifying frontend/src/pages/Dashboard.jsx...');
let dashboardContent = fs.readFileSync('d:/Inventory/frontend/src/pages/Dashboard.jsx', 'utf8');
dashboardContent = dashboardContent.split("`Rs. ${").join("`${");
fs.writeFileSync('d:/Inventory/frontend/src/pages/Dashboard.jsx', dashboardContent, 'utf8');
console.log('✅ Modified Dashboard.jsx');


// ─── 3. MODIFY FRONTEND: Export.jsx ──────────────────────────────────────────
console.log('Modifying frontend/src/pages/Export.jsx...');
let exportJsxContent = fs.readFileSync('d:/Inventory/frontend/src/pages/Export.jsx', 'utf8');

// Remove rupee symbols
exportJsxContent = exportJsxContent.split("`₹${").join("`${");
exportJsxContent = exportJsxContent.split("VALUE ₹").join("VALUE");
exportJsxContent = exportJsxContent.split("₹{").join("{");
exportJsxContent = exportJsxContent.split("VALUE (₹)").join("VALUE");

fs.writeFileSync('d:/Inventory/frontend/src/pages/Export.jsx', exportJsxContent, 'utf8');
console.log('✅ Modified Export.jsx');


// ─── 4. MODIFY FRONTEND: SalesReport.jsx ──────────────────────────────────────
console.log('Modifying frontend/src/pages/SalesReport.jsx...');
let salesContent = fs.readFileSync('d:/Inventory/frontend/src/pages/SalesReport.jsx', 'utf8');

// Remove rupee symbols
salesContent = salesContent.split("₹{").join("{");

fs.writeFileSync('d:/Inventory/frontend/src/pages/SalesReport.jsx', salesContent, 'utf8');
console.log('✅ Modified SalesReport.jsx');

console.log('\n🎉 Currency removal finished successfully!\n');
