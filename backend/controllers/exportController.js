const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { sql, getPool } = require('../config/db');

// Name of the historical/old database on the same SQL Server instance
const OLD_DB = process.env.DB_OLD_DATABASE || 'ERP_OLD';

// Helper: format decimal numbers safely
const fmt = (v) => parseFloat(v || 0).toFixed(2);

const cleanBarcode = (upc) => {
  if (!upc) return '';
  const clean = String(upc).trim();
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return String(Math.round(parseFloat(clean)));
  }
  return clean;
};

// GET /api/export/excel
const exportExcel = async (req, res) => {
  try {
    const pool = await getPool();
    const { ids, itemCode, fromDate, toDate, monthsCount = 1, yearsCount = 1, monthDays, yearDays, svRows } = req.query;

    const mDays = monthDays ? parseInt(monthDays) : (parseFloat(monthsCount) || 30);
    const yDays = yearDays ? parseInt(yearDays) : (parseFloat(yearsCount) * 365.25 || 365);

    const formatMonthRangeLabel = (days) => {
      if (days < 30) return `${days}D`;
      const m = Math.floor(days / 30);
      const d = days % 30;
      return d === 0 ? `${m}M` : `${m}M ${d}D`;
    };

    const formatYearRangeLabel = (days) => {
      if (days < 365) return `${days}D`;
      const y = Math.floor(days / 365);
      const d = days % 365;
      return d === 0 ? `${y}Y` : `${y}Y ${d}D`;
    };

    const monthLabel = `LAST ${formatMonthRangeLabel(mDays)} SALE`;
    const yearLabel = `LAST ${formatYearRangeLabel(yDays)} SALES`;
    const yearSubLabel = `LAST ${formatYearRangeLabel(yDays)}`;

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (ids && ids !== 'all') {
      const idList = ids.split(',').map(Number).filter(Boolean).join(',');
      whereClause += ` AND h.Id IN (${idList})`;
    }
    if (itemCode && itemCode !== 'undefined' && itemCode !== 'null' && String(itemCode).trim() !== '') {
      const itemCodeVal = parseInt(itemCode);
      if (!isNaN(itemCodeVal)) {
        request.input('itemCode', sql.Int, itemCodeVal);
        whereClause += ' AND h.ItemCode = @itemCode';
      }
    }
    if (fromDate && fromDate !== 'undefined' && fromDate !== 'null' && String(fromDate).trim() !== '') {
      const fromDateVal = new Date(fromDate);
      if (!isNaN(fromDateVal.getTime())) {
        request.input('fromDate', sql.DateTime, fromDateVal);
        whereClause += ' AND h.CalculationDate >= @fromDate';
      }
    }
    if (toDate && toDate !== 'undefined' && toDate !== 'null' && String(toDate).trim() !== '') {
      const toDateEnd = new Date(toDate);
      if (!isNaN(toDateEnd.getTime())) {
        toDateEnd.setHours(23, 59, 59, 999);
        request.input('toDate', sql.DateTime, toDateEnd);
        whereClause += ' AND h.CalculationDate <= @toDate';
      }
    }

    const result = await request.query(`
      SELECT h.Id, h.Username, h.ItemCode, h.ItemName, h.UPCCode, h.CalculationDate,
             ISNULL(s.Stock, 0) AS StockOnHand,
             h.LastOneMonthSale, h.LastOneYearSale, h.Cost, h.SeasonMultiplier,
             h.AveragePerMonth, h.SystemRequirement, h.StaffRequirement, h.FinalRequirement,
             h.AfterPurchaseStock, h.PurchaseAmount, h.Rotation, h.SizeModel, h.SupplierName
      FROM tbl_InventoryPlanningHistory h
      LEFT JOIN (
        SELECT i.UPCCode, SUM(sl.Quantity) AS Stock
        FROM stmStockLedger sl
        INNER JOIN mstitem i ON sl.ItemCode = i.code
        WHERE sl.StockPointCode = 2
        GROUP BY i.UPCCode
      ) s ON h.UPCCode = s.UPCCode
      ${whereClause}
      ORDER BY h.CalculationDate DESC
    `);

    const idArray = ids ? ids.split(',').map(Number) : [];
    let records = result.recordset;
    if (idArray.length > 0) {
      records = [...records].sort((a, b) => idArray.indexOf(a.Id) - idArray.indexOf(b.Id));
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'India Silk House Re-Order';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Re-Order Form', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 4 }]
    });

    // 1. Merged Company Banner
    sheet.mergeCells('A1:P1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'INDIA SILK HOUSE';
    titleCell.font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 25;

    // 2. Merged Document Header Subtitle
    const todayFormatted = new Date().toLocaleDateString('en-GB');
    sheet.mergeCells('A2:P2');
    const subCell = sheet.getCell('A2');
    subCell.value = `RE-ORDER FORM - ${todayFormatted}`;
    subCell.font = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF334155' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    // Define table columns in identical spreadsheet layout
    const headers = [
      { header: 'SL NO', key: 'slNo', width: 8 },
      { header: 'ITEM CODE', key: 'ItemCode', width: 12 },
      { header: 'BARCODE', key: 'UPCCode', width: 18 },
      { header: 'ITEM NAME', key: 'ItemName', width: 30 },
      { header: 'System Req', key: 'SystemRequirement', width: 13 },
      { header: 'Staff Req', key: 'StaffRequirement', width: 12 },
      { header: 'Size/Model', key: 'SizeModel', width: 12 },
      { header: 'Stock On Hand', key: 'StockOnHand', width: 14 },
      { header: 'After Purchase', key: 'AfterPurchaseStock', width: 15 },
      { header: monthLabel, key: 'LastOneMonthSale', width: 18 },
      { header: 'Avg Per Month', key: 'AveragePerMonth', width: 14 },
      { header: yearLabel, key: 'LastOneYearSale', width: 18 },
      { header: 'Cost', key: 'Cost', width: 12 },
      { header: 'Amount', key: 'PurchaseAmount', width: 14 },
      { header: 'Current Stock / Rotation of month', key: 'Rotation', width: 18 },
      { header: 'Supplier', key: 'SupplierName', width: 25 }
    ];

    sheet.columns = headers.map(h => ({ key: h.key, width: h.width }));

    // Set Column Headers styled matching the Excel layout (Double-Row merged)
    const headerRow3 = sheet.getRow(3);
    const headerRow4 = sheet.getRow(4);
    headerRow3.height = 22;
    headerRow4.height = 22;

    headerRow3.values = [
      'SL NO', 'ITEM CODE', 'BARCODE', 'ITEM NAME', 'System Req', 'Staff Req', 'Size/Model',
      'Stock On Hand', 'After Purchase', monthLabel,
      yearLabel, '',
      'Cost', 'Amount', 'Current Stock / Rotation of month', 'Supplier'
    ];
    headerRow4.values = [
      '', '', '', '', '', '', '', '', '', '',
      'Avg Per Month', yearSubLabel,
      '', '', '', ''
    ];

    // Merge vertically for columns that don't have subheaders
    const verticalMerges = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'M', 'N', 'O', 'P'];
    verticalMerges.forEach(col => {
      sheet.mergeCells(`${col}3:${col}4`);
    });

    // Merge horizontally for years sales parent header
    sheet.mergeCells('K3:L3');

    // Style both header rows
    [3, 4].forEach(rNum => {
      sheet.getRow(rNum).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FF1E293B' }, name: 'Arial', size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FF94A3B8' } },
          left: { style: 'thin', color: { argb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
          right: { style: 'thin', color: { argb: 'FF94A3B8' } },
        };
      });
    });

    // Populate data
    records.forEach((row, i) => {
      const itemCodeNum = row.ItemCode ? parseInt(row.ItemCode, 10) : '';
      const barcodeCleaned = cleanBarcode(row.UPCCode);
      const barcodeNum = /^\d+$/.test(barcodeCleaned) ? parseInt(barcodeCleaned, 10) : barcodeCleaned;

      const dataRow = sheet.addRow({
        slNo: i + 1,
        ItemCode: itemCodeNum,
        UPCCode: barcodeNum,
        ItemName: row.ItemName?.trim() || '',
        SystemRequirement: parseFloat(row.SystemRequirement) || 0,
        StaffRequirement: parseFloat(row.StaffRequirement) || 0,
        SizeModel: row.SizeModel?.trim() || '—',
        StockOnHand: parseFloat(row.StockOnHand) || 0,
        AfterPurchaseStock: parseFloat(row.AfterPurchaseStock) || 0,
        LastOneMonthSale: parseFloat(row.LastOneMonthSale) || 0,
        AveragePerMonth: parseFloat(row.AveragePerMonth) || 0,
        LastOneYearSale: parseFloat(row.LastOneYearSale) || 0,
        Cost: parseFloat(row.Cost || 0),
        PurchaseAmount: parseFloat(row.PurchaseAmount || 0),
        Rotation: parseFloat(row.Rotation || 0),
        SupplierName: row.SupplierName?.trim() || '—'
      });

      dataRow.height = 20;

      // Apply styling cell by cell
      dataRow.eachCell((cell, colIndex) => {
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF334155' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        // Alignments and specific formatting rules
        if (colIndex === 4 || colIndex === 16) {
          // Item Name & Supplier (Left aligned)
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colIndex === 2 || colIndex === 3) {
          // Item Code (Col 2) & Barcode (Col 3) (Centered, formatted as plain numbers without commas)
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0';
        } else if (colIndex === 13 || colIndex === 14) {
          // Currency (Cost & Amount right aligned, formatted as Rupees)
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
          cell.font = { name: 'Arial', size: 9, bold: colIndex === 14, color: { argb: colIndex === 14 ? 'FF059669' : 'FF334155' } };
        } else if (colIndex === 15) {
          // Rotation (Right aligned, decimal format)
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0.00';
        } else {
          // Numbers and codes (Centered)
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '#,##0';
        }

        // Special system requirement format (Red with parentheses for negative values)
        if (colIndex === 5) {
          cell.numFmt = '#,##0;[Red](#,##0);"-"';
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFDC2626' } };
        }
      });
    });

    // Add Totals row
    const totalRow = sheet.addRow({
      slNo: '',
      ItemCode: '',
      UPCCode: '',
      ItemName: 'TOTAL',
      SystemRequirement: records.reduce((acc, r) => acc + (parseFloat(r.SystemRequirement) || 0), 0),
      StaffRequirement: records.reduce((acc, r) => acc + (parseFloat(r.StaffRequirement) || 0), 0),
      SizeModel: '',
      StockOnHand: records.reduce((acc, r) => acc + (parseFloat(r.StockOnHand) || 0), 0),
      AfterPurchaseStock: records.reduce((acc, r) => acc + (parseFloat(r.AfterPurchaseStock) || 0), 0),
      LastOneMonthSale: '',
      AveragePerMonth: '',
      LastOneYearSale: '',
      Cost: '',
      PurchaseAmount: records.reduce((acc, r) => acc + (parseFloat(r.PurchaseAmount) || 0), 0),
      Rotation: '',
      SupplierName: ''
    });

    totalRow.height = 22;
    totalRow.eachCell((cell, colIndex) => {
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF1E293B' } }
      };

      if (colIndex === 4) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      } else if (colIndex === 14) {
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
        cell.numFmt = '#,##0.00';
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF059669' } };
      } else if (colIndex === 5) {
        cell.numFmt = '#,##0;[Red](#,##0);"-"';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      } else if (colIndex === 6 || colIndex === 8 || colIndex === 9) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.numFmt = '#,##0';
      }
    });

    // Append Stock Valuation table if svRows is passed
    let parsedSvRows = [];
    if (svRows) {
      try {
        parsedSvRows = JSON.parse(svRows);
      } catch (e) {
        console.error('Failed to parse svRows in exportExcel:', e);
      }
    }

    if (parsedSvRows && parsedSvRows.length > 0) {
      // Add blank spacing rows
      sheet.addRow([]);
      sheet.addRow([]);

      // Headers row: aligns CATEGORY under Col 4 (ITEM NAME), QTY under Col 5 (Sys Req), VALUE under Col 6 (Staff Req)
      const svHeaderRow = sheet.addRow({
        ItemName: 'CATEGORY',
        SystemRequirement: 'QTY',
        StaffRequirement: 'VALUE'
      });
      svHeaderRow.height = 22;
      svHeaderRow.eachCell((cell, colIndex) => {
        if (colIndex === 4 || colIndex === 5 || colIndex === 6) {
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
          cell.alignment = { horizontal: colIndex === 4 ? 'left' : (colIndex === 5 ? 'center' : 'right'), vertical: 'middle' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
          };
        }
      });

      // Data rows
      let totalQty = 0;
      let totalValue = 0;
      parsedSvRows.forEach(r => {
        const qty = parseFloat(r.qty) || 0;
        const val = parseFloat(r.value) || 0;
        totalQty += qty;
        totalValue += val;

        const svDataRow = sheet.addRow({
          ItemName: r.categoryName || '',
          SystemRequirement: qty,
          StaffRequirement: val
        });
        svDataRow.height = 20;
        svDataRow.eachCell((cell, colIndex) => {
          if (colIndex === 4 || colIndex === 5 || colIndex === 6) {
            cell.font = { name: 'Arial', size: 9, color: { argb: 'FF334155' } };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
              right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            if (colIndex === 4) {
              cell.alignment = { horizontal: 'left', vertical: 'middle' };
            } else if (colIndex === 5) {
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
              cell.numFmt = '#,##0';
            } else if (colIndex === 6) {
              cell.alignment = { horizontal: 'right', vertical: 'middle' };
              cell.numFmt = '#,##0.00';
            }
          }
        });
      });

      // Totals row
      const svTotalRow = sheet.addRow({
        ItemName: 'TOTAL',
        SystemRequirement: totalQty,
        StaffRequirement: totalValue
      });
      svTotalRow.height = 22;
      svTotalRow.eachCell((cell, colIndex) => {
        if (colIndex === 4 || colIndex === 5 || colIndex === 6) {
          cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF1E293B' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            bottom: { style: 'double', color: { argb: 'FF1E293B' } },
            left: { style: 'thin', color: { argb: 'FF94A3B8' } },
            right: { style: 'thin', color: { argb: 'FF94A3B8' } }
          };
          if (colIndex === 4) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          } else if (colIndex === 5) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.numFmt = '#,##0';
          } else if (colIndex === 6) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0.00';
          }
        }
      });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=re_order_form_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate Excel report' });
  }
};

// GET /api/export/pdf
const exportPDF = async (req, res) => {
  try {
    const pool = await getPool();
    const { ids, itemCode, fromDate, toDate, monthsCount = 1, yearsCount = 1, monthDays, yearDays, svRows } = req.query;

    const mDays = monthDays ? parseInt(monthDays) : (parseFloat(monthsCount) || 30);
    const yDays = yearDays ? parseInt(yearDays) : (parseFloat(yearsCount) * 365.25 || 365);

    const formatMonthRangeLabel = (days) => {
      if (days < 30) return `${days}D`;
      const m = Math.floor(days / 30);
      const d = days % 30;
      return d === 0 ? `${m}M` : `${m}M ${d}D`;
    };

    const formatYearRangeLabel = (days) => {
      if (days < 365) return `${days}D`;
      const y = Math.floor(days / 365);
      const d = days % 365;
      return d === 0 ? `${y}Y` : `${y}Y ${d}D`;
    };

    const monthLabel = `LAST ${formatMonthRangeLabel(mDays)} SALE`;
    const yearLabel = `LAST ${formatYearRangeLabel(yDays)} SALES`;
    const yearSubLabel = `LAST ${formatYearRangeLabel(yDays)}`;

    let whereClause = 'WHERE 1=1';
    const request = pool.request();

    if (ids && ids !== 'all') {
      const idList = ids.split(',').map(Number).filter(Boolean).join(',');
      whereClause += ` AND h.Id IN (${idList})`;
    }
    if (itemCode && itemCode !== 'undefined' && itemCode !== 'null' && String(itemCode).trim() !== '') {
      const itemCodeVal = parseInt(itemCode);
      if (!isNaN(itemCodeVal)) {
        request.input('itemCode', sql.Int, itemCodeVal);
        whereClause += ' AND h.ItemCode = @itemCode';
      }
    }
    if (fromDate && fromDate !== 'undefined' && fromDate !== 'null' && String(fromDate).trim() !== '') {
      const fromDateVal = new Date(fromDate);
      if (!isNaN(fromDateVal.getTime())) {
        request.input('fromDate', sql.DateTime, fromDateVal);
        whereClause += ' AND h.CalculationDate >= @fromDate';
      }
    }
    if (toDate && toDate !== 'undefined' && toDate !== 'null' && String(toDate).trim() !== '') {
      const toDateEnd = new Date(toDate);
      if (!isNaN(toDateEnd.getTime())) {
        toDateEnd.setHours(23, 59, 59, 999);
        request.input('toDate', sql.DateTime, toDateEnd);
        whereClause += ' AND h.CalculationDate <= @toDate';
      }
    }

    const result = await request.query(`
      SELECT h.Id, h.Username, h.ItemCode, h.ItemName, h.UPCCode, h.CalculationDate,
             ISNULL(s.Stock, 0) AS StockOnHand,
             h.LastOneMonthSale, h.LastOneYearSale, h.Cost, h.SeasonMultiplier,
             h.AveragePerMonth, h.SystemRequirement, h.StaffRequirement, h.FinalRequirement,
             h.AfterPurchaseStock, h.PurchaseAmount, h.Rotation, h.SizeModel, h.SupplierName
      FROM tbl_InventoryPlanningHistory h
      LEFT JOIN (
        SELECT i.UPCCode, SUM(sl.Quantity) AS Stock
        FROM stmStockLedger sl
        INNER JOIN mstitem i ON sl.ItemCode = i.code
        WHERE sl.StockPointCode = 2
        GROUP BY i.UPCCode
      ) s ON h.UPCCode = s.UPCCode
      ${whereClause}
      ORDER BY h.CalculationDate DESC
    `);

    const idArray = ids ? ids.split(',').map(Number) : [];
    let records = result.recordset;
    if (idArray.length > 0) {
      records = [...records].sort((a, b) => idArray.indexOf(a.Id) - idArray.indexOf(b.Id));
    }

    // landscape pdf: A4 is 842 pt wide, 595 pt tall
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=re_order_form_${Date.now()}.pdf`);
    doc.pipe(res);

    const leftMargin = 30;
    const tableWidth = 782; // 842 - 60
    const rowHeight = 22;

    const colWidths = [
      22,  // SL NO
      42,  // ITEM CODE
      65,  // BARCODE (UPC)
      115, // ITEM NAME
      42,  // System Req
      42,  // Staff Req
      45,  // Size/Model
      38,  // Stock On Hand
      42,  // After Purchase
      48,  // Last N Month Sale
      38,  // Avg Per Month
      48,  // Last N Year Sales
      38,  // Cost
      48,  // Amount (increased from 42 to prevent header wrap)
      38,  // Rotation
      71   // Supplier (decreased from 77 to balance total width)
    ];

    const aligns = [
      'center', 'center', 'center', 'left', 'center', 'center', 'center', 
      'center', 'center', 'center', 'center', 'center', 'right', 'right', 'center', 'left'
    ];

    const headers = [
      'SL', 'ITEM CODE', 'BARCODE', 'ITEM NAME', 'Sys Req', 'Staff Req', 'Size/Model',
      'Stock', 'After Pur', monthLabel, 'Avg/Mo', yearLabel, 'Cost', 'Amount', 'Rotation', 'Supplier'
    ];

    const drawHeader = (y) => {
      // 1. Draw banner text
      doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('INDIA SILK HOUSE', leftMargin, y - 40, { align: 'center', width: tableWidth });
      const todayStr = new Date().toLocaleDateString('en-GB');
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text(`RE-ORDER FORM - ${todayStr}`, leftMargin, y - 24, { align: 'center', width: tableWidth });

      // 2. Draw Table Column Headers background
      const doubleRowHeight = 24;
      doc.rect(leftMargin, y, tableWidth, doubleRowHeight).fill('#F1F5F9');

      let currentX = leftMargin;
      headers.forEach((h, idx) => {
        const w = colWidths[idx];

        if (idx === 10) {
          // Average Per Month Column (drawn as part of merged header)
          const yearSalesWidth = colWidths[11];
          const mergedWidth = w + yearSalesWidth;
          
          // Draw horizontal merged parent header cell in top half
          doc.rect(currentX, y, mergedWidth, 12).stroke('#CBD5E1');
          doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
          doc.text(yearLabel, currentX + 2, y + 3, {
            width: mergedWidth - 4,
            align: 'center'
          });

          // Draw Avg/Mo sub-header cell in bottom half
          doc.rect(currentX, y + 12, w, 12).stroke('#CBD5E1');
          doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
          doc.text('Avg/Mo', currentX + 1, y + 15, {
            width: w - 2,
            align: 'center'
          });

          // Draw Sales sub-header cell in bottom half
          doc.rect(currentX + w, y + 12, yearSalesWidth, 12).stroke('#CBD5E1');
          doc.fillColor('#0F172A').fontSize(6.5).font('Helvetica-Bold');
          doc.text(yearSubLabel, currentX + w + 1, y + 15, {
            width: yearSalesWidth - 2,
            align: 'center'
          });

        } else if (idx === 11) {
          // Skip, handled by idx === 10
        } else {
          // Standard full-height column headers
          doc.rect(currentX, y, w, doubleRowHeight).stroke('#CBD5E1');
          doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold');
          doc.text(h, currentX + 2, y + 8, {
            width: w - 4,
            align: 'center',
            lineBreak: true
          });
        }
        currentX += w;
      });
    };

    let startY = 80;
    drawHeader(startY);

    let currentY = startY + 24;

    records.forEach((row, index) => {
      // Format fields to build cells list
      const sysReqVal = parseFloat(row.SystemRequirement) || 0;
      const formattedSysReq = sysReqVal > 0 
        ? Math.round(sysReqVal).toString() 
        : `(${Math.abs(Math.round(sysReqVal))})`;

      const cells = [
        (index + 1).toString(),
        row.ItemCode?.toString() || '',
        cleanBarcode(row.UPCCode),
        row.ItemName?.trim() || '',
        formattedSysReq,
        Math.round(parseFloat(row.StaffRequirement) || 0).toString(),
        row.SizeModel?.trim() || '—',
        Math.round(parseFloat(row.StockOnHand) || 0).toString(),
        Math.round(parseFloat(row.AfterPurchaseStock) || 0).toString(),
        Math.round(parseFloat(row.LastOneMonthSale) || 0).toString(),
        Math.round(parseFloat(row.AveragePerMonth) || 0).toString(),
        Math.round(parseFloat(row.LastOneYearSale) || 0).toLocaleString(),
        `${parseFloat(row.Cost || 0).toFixed(2)}`,
        `${parseFloat(row.PurchaseAmount || 0).toFixed(2)}`,
        (parseFloat(row.Rotation) || 0).toFixed(2),
        row.SupplierName?.trim() || '—'
      ];

      // 1. Calculate dynamic row height for this row by measuring string height in PDFKit
      let dynamicRowHeight = 15; // default minimum
      const cellHeights = [];
      cells.forEach((text, i) => {
        const w = colWidths[i];
        doc.font(i === 4 || i === 13 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5);
        const textHeight = doc.heightOfString(String(text), { width: w - 6 });
        cellHeights.push(textHeight);
        if (textHeight + 8 > dynamicRowHeight) {
          dynamicRowHeight = textHeight + 8;
        }
      });

      // Check if we need to insert a page break
      if (currentY + dynamicRowHeight > 520) {
        doc.addPage();
        currentY = startY + 24;
        drawHeader(startY);
      }

      // Draw background using dynamic row height
      doc.rect(leftMargin, currentY, tableWidth, dynamicRowHeight).fill(index % 2 === 0 ? '#FFFFFF' : '#F8FAFC');

      let currentX = leftMargin;
      cells.forEach((text, i) => {
        const w = colWidths[i];
        const textHeight = cellHeights[i];
        
        // Draw border cell bounds
        doc.rect(currentX, currentY, w, dynamicRowHeight).stroke('#E2E8F0');

        // Font and Color overrides
        doc.font(i === 4 || i === 13 ? 'Helvetica-Bold' : 'Helvetica');
        doc.fontSize(7.5);

        if (i === 4) {
          doc.fillColor('#DC2626'); // Red for system requirement
        } else if (i === 13) {
          doc.fillColor('#059669'); // Green for Amount
        } else {
          doc.fillColor('#0F172A'); // Deep dark slate/black
        }

        // Draw vertically-centered text
        const textY = currentY + (dynamicRowHeight - textHeight) / 2;
        doc.text(String(text), currentX + 3, textY, {
          width: w - 6,
          align: aligns[i],
          lineBreak: true // enable natural word wrapping
        });

        currentX += w;
      });

      currentY += dynamicRowHeight;
    });

    // Draw Totals Row
    const totalsRowHeight = 22;
    if (currentY + totalsRowHeight > 520) {
      doc.addPage();
      currentY = startY + 24;
      drawHeader(startY);
    }

    // Background fill
    doc.rect(leftMargin, currentY, tableWidth, totalsRowHeight).fill('#F1F5F9');

    const totalSys = records.reduce((acc, r) => acc + (parseFloat(r.SystemRequirement) || 0), 0);
    const totalStaff = records.reduce((acc, r) => acc + (parseFloat(r.StaffRequirement) || 0), 0);
    const totalStock = records.reduce((acc, r) => acc + (parseFloat(r.StockOnHand) || 0), 0);
    const totalAfter = records.reduce((acc, r) => acc + (parseFloat(r.AfterPurchaseStock) || 0), 0);
    const totalAmount = records.reduce((acc, r) => acc + (parseFloat(r.PurchaseAmount) || 0), 0);

    const formattedTotalSys = totalSys > 0 
      ? Math.round(totalSys).toLocaleString('en-IN') 
      : `(${Math.abs(Math.round(totalSys)).toLocaleString('en-IN')})`;

    let currentX = leftMargin;
    colWidths.forEach((w, i) => {
      // Draw border cell bounds
      doc.rect(currentX, currentY, w, totalsRowHeight).stroke('#94A3B8');

      doc.fontSize(7.5).font('Helvetica-Bold');

      let valText = '';
      if (i === 3) {
        valText = 'TOTAL';
        doc.fillColor('#1E293B');
      } else if (i === 4) {
        valText = formattedTotalSys;
        doc.fillColor(totalSys > 0 ? '#DC2626' : '#059669');
      } else if (i === 5) {
        valText = Math.round(totalStaff).toLocaleString('en-IN');
        doc.fillColor('#7C3AED'); // Purple for staff req
      } else if (i === 7) {
        valText = Math.round(totalStock).toLocaleString('en-IN');
        doc.fillColor('#0F172A');
      } else if (i === 8) {
        valText = Math.round(totalAfter).toLocaleString('en-IN');
        doc.fillColor('#2563EB'); // Brand blue
      } else if (i === 13) {
        valText = `${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        doc.fillColor('#059669'); // Green for Amount
      }

      if (valText) {
        doc.text(valText, currentX + 3, currentY + 7, {
          width: w - 6,
          align: aligns[i]
        });
      }

      currentX += w;
    });

    currentY += totalsRowHeight;

    // Append Stock Valuation table if svRows is passed
    let parsedSvRows = [];
    if (svRows) {
      try {
        parsedSvRows = JSON.parse(svRows);
      } catch (e) {
        console.error('Failed to parse svRows in PDF:', e);
      }
    }

    if (parsedSvRows && parsedSvRows.length > 0) {
      // Check if we need a new page
      const neededHeight = 40 + (parsedSvRows.length * 20) + 30;
      if (currentY + neededHeight > 550) {
        doc.addPage();
        currentY = 40;
      } else {
        currentY += 25; // gap below main table
      }

      const svTableWidth = 350;
      const svColWidths = [180, 70, 100];
      // Offset starting X position to align under column D (ITEM NAME)
      const svStartX = 30 + 22 + 42 + 65; 
      const svRowH = 20;

      // Header background
      doc.rect(svStartX, currentY, svTableWidth, svRowH).fill('#F1F5F9');
      doc.strokeColor('#CBD5E1').rect(svStartX, currentY, svTableWidth, svRowH).stroke();

      // Headers text
      doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold');
      doc.text('CATEGORY', svStartX + 4, currentY + 6, { width: svColWidths[0] - 8, align: 'left' });
      doc.text('QTY', svStartX + svColWidths[0] + 4, currentY + 6, { width: svColWidths[1] - 8, align: 'center' });
      doc.text('VALUE', svStartX + svColWidths[0] + svColWidths[1] + 4, currentY + 6, { width: svColWidths[2] - 8, align: 'right' });

      currentY += svRowH;

      // Draw rows
      let totalQty = 0;
      let totalVal = 0;

      doc.font('Helvetica').fontSize(7);
      parsedSvRows.forEach((r, idx) => {
        const qty = parseFloat(r.qty) || 0;
        const val = parseFloat(r.value) || 0;
        totalQty += qty;
        totalVal += val;

        const rowBg = idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
        doc.rect(svStartX, currentY, svTableWidth, svRowH).fill(rowBg);
        doc.strokeColor('#E2E8F0').rect(svStartX, currentY, svTableWidth, svRowH).stroke();

        doc.fillColor('#334155');
        doc.text(r.categoryName || '', svStartX + 4, currentY + 6, { width: svColWidths[0] - 8, align: 'left' });
        doc.text(Math.round(qty).toLocaleString('en-IN'), svStartX + svColWidths[0] + 4, currentY + 6, { width: svColWidths[1] - 8, align: 'center' });
        doc.text(`${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, svStartX + svColWidths[0] + svColWidths[1] + 4, currentY + 6, { width: svColWidths[2] - 8, align: 'right' });

        currentY += svRowH;
      });

      // Draw Totals row
      doc.rect(svStartX, currentY, svTableWidth, svRowH).fill('#DBEAFE');
      doc.strokeColor('#CBD5E1').rect(svStartX, currentY, svTableWidth, svRowH).stroke();

      doc.fillColor('#1E293B').font('Helvetica-Bold');
      doc.text('TOTAL', svStartX + 4, currentY + 6, { width: svColWidths[0] - 8, align: 'right' });
      doc.text(Math.round(totalQty).toLocaleString('en-IN'), svStartX + svColWidths[0] + 4, currentY + 6, { width: svColWidths[1] - 8, align: 'center' });
      doc.text(`${totalVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, svStartX + svColWidths[0] + svColWidths[1] + 4, currentY + 6, { width: svColWidths[2] - 8, align: 'right' });

      currentY += svRowH;
    }

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate PDF report' });
  }
};

// GET /api/export/sales-excel
const exportSalesExcel = async (req, res) => {
  try {
    const pool = await getPool();
    const { fromDate, toDate, groupCode, categoryCode } = req.query;

    // Default to last 30 days if not provided
    const to = toDate || new Date().toISOString().slice(0, 10);
    const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const getInnerFilters = (detailAlias) => {
      let clause = '';
      if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
        const parsedGroup = parseInt(groupCode);
        if (!isNaN(parsedGroup)) {
          clause += ` AND ${detailAlias}.GroupCode = ${parsedGroup}`;
        }
      }
      if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
        const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
        if (catCodes.length > 0) {
          clause += ` AND ${detailAlias}.CategoryCode IN (${catCodes.join(',')})`;
        }
      }
      return clause;
    };

    const filters1 = getInnerFilters('md');
    const filters2 = getInnerFilters('md2');

    const result = await pool.request()
      .input('fromDate', sql.VarChar(10), from)
      .input('toDate', sql.VarChar(10), to)
      .query(`
        SELECT
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          SUM(ABS(combined.Quantity)) AS Quantity,
          ISNULL(d.BaseCost, 0) AS Cost,
          SUM(ABS(combined.NetAmountDC) - ISNULL(combined.TaxAmountDC, 0)) AS SalesAmount
        FROM (
          SELECT sl.ItemCode, sl.Quantity, sl.NetAmountDC, sl.TaxAmountDC
          FROM stmStockLedger sl
          INNER JOIN mstitem mi ON sl.ItemCode = mi.code
          INNER JOIN mstitemdetail md ON mi.code = md.code
          WHERE sl.Quantity < 0 AND sl.VoucherTypeCode = 503 AND sl.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters1}
          UNION ALL
          SELECT sl2.ItemCode, sl2.Quantity, sl2.NetAmountDC, sl2.TaxAmountDC
          FROM ${OLD_DB}.dbo.stmStockLedger sl2
          INNER JOIN mstitem mi2 ON sl2.ItemCode = mi2.code
          INNER JOIN mstitemdetail md2 ON mi2.code = md2.code
          WHERE sl2.Quantity < 0 AND sl2.VoucherTypeCode = 503 AND sl2.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters2}
        ) combined
        INNER JOIN mstitem i ON combined.ItemCode = i.code
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        GROUP BY combined.ItemCode, i.UPCCode, i.Name, s.name, d.BaseCost
        HAVING SUM(ABS(combined.Quantity)) > 0
        ORDER BY i.Name
      `);

    const records = result.recordset;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'India Silk House Sales Report';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Sales Report', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 3 }]
    });

    // 1. Company Banner
    sheet.mergeCells('A1:G1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'INDIA SILK HOUSE';
    titleCell.font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 25;

    // 2. Report Subtitle
    const formatDateStr = (ymd) => {
      const parts = ymd.split('-');
      return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : ymd;
    };
    sheet.mergeCells('A2:G2');
    const subCell = sheet.getCell('A2');
    subCell.value = `SALES REPORT (${formatDateStr(from)} TO ${formatDateStr(to)})`;
    subCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF475569' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    // Table Headers
    const headers = [
      { header: 'SL NO', key: 'slNo', width: 8 },
      { header: 'BARCODE', key: 'Barcode', width: 18 },
      { header: 'ITEM NAME', key: 'ItemName', width: 35 },
      { header: 'SIZE NAME', key: 'SizeName', width: 14 },
      { header: 'QUANTITY', key: 'Quantity', width: 12 },
      { header: 'COST AMOUNT', key: 'CostAmount', width: 16 },
      { header: 'SALES AMOUNT', key: 'SalesAmount', width: 16 }
    ];

    sheet.columns = headers.map(h => ({ key: h.key, width: h.width }));

    const headerRow = sheet.getRow(3);
    headerRow.height = 24;
    headerRow.values = headers.map(h => h.header);

    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF1E293B' }, name: 'Arial', size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } },
      };
    });

    // Populate Rows
    records.forEach((row, idx) => {
      const quantity = parseFloat(row.Quantity) || 0;
      const cost = parseFloat(row.Cost) || 0;
      const salesAmount = parseFloat(row.SalesAmount) || 0;
      const costAmount = quantity * cost;

      const barcodeCleaned = cleanBarcode(row.Barcode);
      const barcodeNum = /^\d+$/.test(barcodeCleaned) ? parseInt(barcodeCleaned, 10) : barcodeCleaned;

      const dataRow = sheet.addRow({
        slNo: idx + 1,
        Barcode: barcodeNum,
        ItemName: row.ItemName?.trim() || '—',
        SizeName: row.SizeName?.trim() || '—',
        Quantity: quantity,
        CostAmount: costAmount,
        SalesAmount: salesAmount
      });

      dataRow.height = 20;

      dataRow.eachCell((cell, colIndex) => {
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF334155' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };

        if (colIndex === 2) {
          // Barcode (Col 2) (Centered, formatted as plain numbers without commas)
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0';
        } else if (colIndex === 3) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colIndex === 6 || colIndex === 7) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
          if (colIndex === 7) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF059669' } };
        } else if (colIndex === 5) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '#,##0';
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    // Add Totals Row
    const lastRowIndex = records.length + 3;
    const totalsRowIndex = lastRowIndex + 1;
    sheet.mergeCells(`A${totalsRowIndex}:D${totalsRowIndex}`);
    
    const totalsLabelCell = sheet.getCell(`A${totalsRowIndex}`);
    totalsLabelCell.value = 'TOTAL';
    totalsLabelCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF1E293B' } };
    totalsLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };

    const qtyTotalCell = sheet.getCell(`E${totalsRowIndex}`);
    qtyTotalCell.value = { formula: `SUM(E4:E${lastRowIndex})` };
    qtyTotalCell.numFmt = '#,##0';
    qtyTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF1E293B' } };
    qtyTotalCell.alignment = { horizontal: 'center', vertical: 'middle' };

    const costTotalCell = sheet.getCell(`F${totalsRowIndex}`);
    costTotalCell.value = { formula: `SUM(F4:F${lastRowIndex})` };
    costTotalCell.numFmt = '#,##0.00';
    costTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF1E293B' } };
    costTotalCell.alignment = { horizontal: 'right', vertical: 'middle' };

    const salesTotalCell = sheet.getCell(`G${totalsRowIndex}`);
    salesTotalCell.value = { formula: `SUM(G4:G${lastRowIndex})` };
    salesTotalCell.numFmt = '#,##0.00';
    salesTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF059669' } };
    salesTotalCell.alignment = { horizontal: 'right', vertical: 'middle' };

    // Border and background for Totals Row
    sheet.getRow(totalsRowIndex).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sales_report_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel Sales Report error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate Excel sales report' });
  }
};

// GET /api/export/sales-pdf
const exportSalesPDF = async (req, res) => {
  try {
    const pool = await getPool();
    const { fromDate, toDate, groupCode, categoryCode } = req.query;

    const to = toDate || new Date().toISOString().slice(0, 10);
    const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const getInnerFilters = (detailAlias) => {
      let clause = '';
      if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
        const parsedGroup = parseInt(groupCode);
        if (!isNaN(parsedGroup)) {
          clause += ` AND ${detailAlias}.GroupCode = ${parsedGroup}`;
        }
      }
      if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
        const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
        if (catCodes.length > 0) {
          clause += ` AND ${detailAlias}.CategoryCode IN (${catCodes.join(',')})`;
        }
      }
      return clause;
    };

    const filters1 = getInnerFilters('md');
    const filters2 = getInnerFilters('md2');

    const result = await pool.request()
      .input('fromDate', sql.VarChar(10), from)
      .input('toDate', sql.VarChar(10), to)
      .query(`
        SELECT
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          SUM(ABS(combined.Quantity)) AS Quantity,
          ISNULL(d.BaseCost, 0) AS Cost,
          SUM(ABS(combined.NetAmountDC) - ISNULL(combined.TaxAmountDC, 0)) AS SalesAmount
        FROM (
          SELECT sl.ItemCode, sl.Quantity, sl.NetAmountDC, sl.TaxAmountDC
          FROM stmStockLedger sl
          INNER JOIN mstitem mi ON sl.ItemCode = mi.code
          INNER JOIN mstitemdetail md ON mi.code = md.code
          WHERE sl.Quantity < 0 AND sl.VoucherTypeCode = 503 AND sl.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters1}
          UNION ALL
          SELECT sl2.ItemCode, sl2.Quantity, sl2.NetAmountDC, sl2.TaxAmountDC
          FROM ${OLD_DB}.dbo.stmStockLedger sl2
          INNER JOIN mstitem mi2 ON sl2.ItemCode = mi2.code
          INNER JOIN mstitemdetail md2 ON mi2.code = md2.code
          WHERE sl2.Quantity < 0 AND sl2.VoucherTypeCode = 503 AND sl2.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters2}
        ) combined
        INNER JOIN mstitem i ON combined.ItemCode = i.code
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        GROUP BY combined.ItemCode, i.UPCCode, i.Name, s.name, d.BaseCost
        HAVING SUM(ABS(combined.Quantity)) > 0
        ORDER BY i.Name
      `);

    const records = result.recordset;

    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=sales_report_${Date.now()}.pdf`);
    doc.pipe(res);

    const leftMargin = 30;
    const tableWidth = 782;
    const rowHeight = 22;

    const colWidths = [
      30,  // SL NO
      110, // BARCODE
      250, // ITEM NAME
      80,  // SIZE NAME
      70,  // QUANTITY
      110, // COST AMOUNT
      132  // SALES AMOUNT
    ];

    const aligns = ['center', 'center', 'left', 'center', 'center', 'right', 'right'];

    const headers = [
      'SL', 'BARCODE', 'ITEM NAME', 'SIZE NAME', 'QUANTITY', 'COST AMOUNT', 'SALES AMOUNT'
    ];

    const formatDateStr = (ymd) => {
      const parts = ymd.split('-');
      return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : ymd;
    };

    const drawHeader = (y) => {
      doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('INDIA SILK HOUSE', leftMargin, y - 40, { align: 'center', width: tableWidth });
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text(`SALES REPORT (${formatDateStr(from)} TO ${formatDateStr(to)})`, leftMargin, y - 24, { align: 'center', width: tableWidth });

      const headerHeight = 20;
      doc.rect(leftMargin, y, tableWidth, headerHeight).fill('#F1F5F9');

      let currentX = leftMargin;
      headers.forEach((h, idx) => {
        const w = colWidths[idx];
        doc.rect(currentX, y, w, headerHeight).stroke('#CBD5E1');
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(h, currentX + 2, y + 6, {
          width: w - 4,
          align: aligns[idx]
        });
        currentX += w;
      });
    };

    let startY = 80;
    drawHeader(startY);

    let currentY = startY + 20;
    let totalQty = 0;
    let totalCostAmt = 0;
    let totalSalesAmt = 0;

    records.forEach((row, index) => {
      const quantity = parseFloat(row.Quantity) || 0;
      const cost = parseFloat(row.Cost) || 0;
      const salesAmount = parseFloat(row.SalesAmount) || 0;
      const costAmount = quantity * cost;

      totalQty += quantity;
      totalCostAmt += costAmount;
      totalSalesAmt += salesAmount;

      const cells = [
        (index + 1).toString(),
        cleanBarcode(row.Barcode),
        row.ItemName?.trim() || '—',
        row.SizeName?.trim() || '—',
        Math.round(quantity).toString(),
        `${costAmount.toFixed(2)}`,
        `${salesAmount.toFixed(2)}`
      ];

      // Measure dynamic row height
      let dynamicRowHeight = 15;
      const cellHeights = [];
      cells.forEach((text, i) => {
        const w = colWidths[i];
        doc.font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const textHeight = doc.heightOfString(String(text), { width: w - 6 });
        cellHeights.push(textHeight);
        if (textHeight + 6 > dynamicRowHeight) {
          dynamicRowHeight = textHeight + 6;
        }
      });

      // Page break check
      if (currentY + dynamicRowHeight > 510) {
        doc.addPage();
        currentY = startY + 20;
        drawHeader(startY);
      }

      doc.rect(leftMargin, currentY, tableWidth, dynamicRowHeight).fill(index % 2 === 0 ? '#FFFFFF' : '#F8FAFC');

      let currentX = leftMargin;
      cells.forEach((text, i) => {
        const w = colWidths[i];
        const textHeight = cellHeights[i];

        doc.rect(currentX, currentY, w, dynamicRowHeight).stroke('#E2E8F0');

        doc.font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        if (i === 6) {
          doc.fillColor('#059669'); // green for sales amount
        } else {
          doc.fillColor('#0F172A');
        }

        const textY = currentY + (dynamicRowHeight - textHeight) / 2;
        doc.text(String(text), currentX + 3, textY, {
          width: w - 6,
          align: aligns[i],
          lineBreak: true
        });

        currentX += w;
      });

      currentY += dynamicRowHeight;
    });

    // Add Totals Row
    const totalsRowHeight = 22;
    if (currentY + totalsRowHeight > 520) {
      doc.addPage();
      currentY = startY + 20;
      drawHeader(startY);
    }

    doc.rect(leftMargin, currentY, tableWidth, totalsRowHeight).fill('#F8FAFC');
    doc.rect(leftMargin, currentY, tableWidth, totalsRowHeight).stroke('#94A3B8');

    // Merge SL, Barcode, Item Name, Size columns for Total label
    const mergedLeftWidth = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', leftMargin + 2, currentY + 7, {
      width: mergedLeftWidth - 6,
      align: 'right'
    });

    let currentX = leftMargin + mergedLeftWidth;

    // Quantity Total
    doc.rect(currentX, currentY, colWidths[4], totalsRowHeight).stroke('#E2E8F0');
    doc.text(Math.round(totalQty).toString(), currentX + 2, currentY + 7, {
      width: colWidths[4] - 4,
      align: 'center'
    });
    currentX += colWidths[4];

    // Cost Amount Total
    doc.rect(currentX, currentY, colWidths[5], totalsRowHeight).stroke('#E2E8F0');
    doc.text(`${totalCostAmt.toFixed(2)}`, currentX + 2, currentY + 7, {
      width: colWidths[5] - 4,
      align: 'right'
    });
    currentX += colWidths[5];

    // Sales Amount Total
    doc.rect(currentX, currentY, colWidths[6], totalsRowHeight).stroke('#E2E8F0');
    doc.fillColor('#059669').text(`${totalSalesAmt.toFixed(2)}`, currentX + 2, currentY + 7, {
      width: colWidths[6] - 4,
      align: 'right'
    });

    doc.end();
  } catch (err) {
    console.error('PDF Sales Report error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate PDF sales report' });
  }
};

// GET /api/export/sales-data (JSON response for Excel preview)
const getSalesData = async (req, res) => {
  try {
    const pool = await getPool();
    const { fromDate, toDate, groupCode, categoryCode } = req.query;

    const to = toDate || new Date().toISOString().slice(0, 10);
    const from = fromDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const getInnerFilters = (detailAlias) => {
      let clause = '';
      if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
        const parsedGroup = parseInt(groupCode);
        if (!isNaN(parsedGroup)) {
          clause += ` AND ${detailAlias}.GroupCode = ${parsedGroup}`;
        }
      }
      if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
        const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
        if (catCodes.length > 0) {
          clause += ` AND ${detailAlias}.CategoryCode IN (${catCodes.join(',')})`;
        }
      }
      return clause;
    };

    const filters1 = getInnerFilters('md');
    const filters2 = getInnerFilters('md2');

    const result = await pool.request()
      .input('fromDate', sql.VarChar(10), from)
      .input('toDate', sql.VarChar(10), to)
      .query(`
        SELECT
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          SUM(ABS(combined.Quantity)) AS Quantity,
          ISNULL(d.BaseCost, 0) AS Cost,
          SUM(ABS(combined.NetAmountDC) - ISNULL(combined.TaxAmountDC, 0)) AS SalesAmount
        FROM (
          SELECT sl.ItemCode, sl.Quantity, sl.NetAmountDC, sl.TaxAmountDC
          FROM stmStockLedger sl
          INNER JOIN mstitem mi ON sl.ItemCode = mi.code
          INNER JOIN mstitemdetail md ON mi.code = md.code
          WHERE sl.Quantity < 0 AND sl.VoucherTypeCode = 503 AND sl.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters1}
          UNION ALL
          SELECT sl2.ItemCode, sl2.Quantity, sl2.NetAmountDC, sl2.TaxAmountDC
          FROM ${OLD_DB}.dbo.stmStockLedger sl2
          INNER JOIN mstitem mi2 ON sl2.ItemCode = mi2.code
          INNER JOIN mstitemdetail md2 ON mi2.code = md2.code
          WHERE sl2.Quantity < 0 AND sl2.VoucherTypeCode = 503 AND sl2.DocumentDate BETWEEN @fromDate AND @toDate
          ${filters2}
        ) combined
        INNER JOIN mstitem i ON combined.ItemCode = i.code
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        GROUP BY combined.ItemCode, i.UPCCode, i.Name, s.name, d.BaseCost
        HAVING SUM(ABS(combined.Quantity)) > 0
        ORDER BY i.Name
      `);

    const cleanedData = (result.recordset || []).map(r => ({
      ...r,
      Barcode: cleanBarcode(r.Barcode)
    }));
    return res.status(200).json({ success: true, data: cleanedData });
  } catch (err) {
    console.error('Get sales data error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve sales data' });
  }
};

// ─── GET /api/export/stock-valuation/groups ───────────────────────────────
// Returns all product groups with their nested categories in one call
const getStockValuationGroups = async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        g.code  AS GroupCode,
        g.name  AS GroupName,
        c.code  AS CategoryCode,
        c.name  AS CategoryName
      FROM mstproductgroup g
      LEFT JOIN mstproductcategory c ON c.productgroupcode = g.code
      WHERE g.name IS NOT NULL AND g.name <> ''
      ORDER BY g.name, c.name
    `);

    // Group into hierarchical structure by GroupName to merge duplicate groups
    const groupMap = new Map();
    for (const row of result.recordset) {
      if (!row.GroupName) continue;
      const groupNameClean = row.GroupName.trim();
      const groupKey = groupNameClean.toUpperCase();

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          groupCode: String(row.GroupCode),
          groupName: groupNameClean,
          // We will group categories internally by CategoryName to merge duplicates within the same group
          categoryMap: new Map()
        });
      }

      if (row.CategoryCode && row.CategoryName) {
        const catNameClean = row.CategoryName.trim();
        const catKey = catNameClean.toUpperCase();
        const categoryMap = groupMap.get(groupKey).categoryMap;

        if (!categoryMap.has(catKey)) {
          categoryMap.set(catKey, {
            categoryName: catNameClean,
            codes: []
          });
        }
        categoryMap.get(catKey).codes.push(row.CategoryCode);
      }
    }

    // Convert Map structures back to JSON-friendly format
    const groups = [];
    for (const g of groupMap.values()) {
      const categories = [];
      for (const c of g.categoryMap.values()) {
        categories.push({
          // comma-separated list of categoryCodes to fetch aggregated stats
          categoryCode: c.codes.join(','),
          categoryName: c.categoryName
        });
      }
      if (categories.length > 0) {
        groups.push({
          groupCode: g.groupCode,
          groupName: g.groupName,
          categories: categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName))
        });
      }
    }

    // Sort groups by group name alphabetically
    groups.sort((a, b) => a.groupName.localeCompare(b.groupName));

    return res.status(200).json({ success: true, data: groups });
  } catch (err) {
    console.error('Get stock valuation groups error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve groups' });
  }
};

const getCategoryStats = async (req, res) => {
  try {
    const pool = await getPool();
    const { categoryCode, fromDate, toDate, categoryName } = req.query;

    if (!categoryCode) {
      return res.status(400).json({ success: false, message: 'categoryCode is required' });
    }

    const targetDate = toDate || fromDate || new Date().toISOString().slice(0, 10);

    // Split categoryCode parameter by comma to handle merged categories
    const codes = String(categoryCode).split(',').map(Number).filter(Boolean);
    if (codes.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid categoryCode value' });
    }

    const result = await pool.request()
      .input('targetDate', sql.VarChar(10), targetDate)
      .query(`
        SELECT 
          ISNULL(SUM(stock.Qty), 0) AS TotalQty,
          ISNULL(SUM(stock.Qty * stock.Cost), 0) AS TotalValue
        FROM (
          SELECT 
            i.code AS ItemCode,
            SUM(sl.Quantity) AS Qty,
            ISNULL(ledger_avg.RunningAvgRateBC, 
              ISNULL(upc_price.BaseCost, 
                ISNULL(d.BaseCost, 
                  ISNULL(last_purchase.Rate, 0)
                )
              )
            ) AS Cost
          FROM mstitem i
          LEFT JOIN mstitemdetail d ON i.code = d.code
          INNER JOIN stmStockLedger sl ON i.code = sl.ItemCode
          LEFT JOIN (
            SELECT ItemCode, RunningAvgRateBC
            FROM (
              SELECT ItemCode, RunningAvgRateBC,
                     ROW_NUMBER() OVER (PARTITION BY ItemCode ORDER BY DocumentDate DESC, Code DESC) as rn
              FROM stmStockLedger
              WHERE RunningAvgRateBC > 0 AND DocumentDate <= @targetDate AND StockPointCode = 2
            ) l
            WHERE l.rn = 1
          ) ledger_avg ON i.code = ledger_avg.ItemCode
          LEFT JOIN (
            SELECT itemcode, BaseCost
            FROM (
              SELECT itemcode, BaseCost,
                     ROW_NUMBER() OVER (PARTITION BY itemcode ORDER BY code DESC) as rn
              FROM mstUPCPrice
              WHERE PricingCode = 1 AND BaseCost > 0
            ) u
            WHERE u.rn = 1
          ) upc_price ON i.code = upc_price.itemcode
          LEFT JOIN (
            SELECT p.ItemCode, p.Rate
            FROM (
              SELECT pd.ItemCode, pd.Rate, ph.DocumentDate,
                     ROW_NUMBER() OVER (PARTITION BY pd.ItemCode ORDER BY ph.DocumentDate DESC) as rn
              FROM (
                SELECT ItemCode, Rate, HeaderCode, 'NEW' AS src
                FROM tranPurchaseDetail
                WHERE Rate > 0
                UNION ALL
                SELECT ItemCode, Rate, HeaderCode, 'OLD' AS src
                FROM ${OLD_DB}.dbo.tranPurchaseDetail
                WHERE Rate > 0
              ) pd
              INNER JOIN (
                SELECT Code, DocumentDate, 'NEW' AS src FROM tranPurchaseHeader
                UNION ALL
                SELECT Code, DocumentDate, 'OLD' AS src FROM ${OLD_DB}.dbo.tranPurchaseHeader
              ) ph ON pd.HeaderCode = ph.Code AND pd.src = ph.src
              WHERE ph.DocumentDate <= @targetDate
            ) p
            WHERE p.rn = 1
          ) last_purchase ON i.code = last_purchase.ItemCode
          WHERE sl.StockPointCode = 2 AND sl.DocumentDate <= @targetDate
          GROUP BY i.code, ledger_avg.RunningAvgRateBC, upc_price.BaseCost, d.BaseCost, last_purchase.Rate, d.CategoryCode
          HAVING d.CategoryCode IN (${codes.join(',')})
        ) stock
      `);

    const row = result.recordset[0] || {};
    return res.status(200).json({
      success: true,
      data: {
        categoryCode: categoryCode, // Return categoryCode as string to preserve the merged list
        categoryName: categoryName || '',
        qty:   parseFloat(row.TotalQty   || 0),
        value: parseFloat(row.TotalValue || 0)
      }
    });
  } catch (err) {
    console.error('Get category stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve category statistics' });
  }
};

// ─── GET /api/export/stock-valuation/excel ───────────────────────────────
// Generates an Excel file from the stock valuation rows sent by the client
const exportStockValuationExcel = async (req, res) => {
  try {
    const { rows, fromDate, toDate } = req.query;
    if (!rows) return res.status(400).json({ success: false, message: 'rows param required' });

    const parsedRows = JSON.parse(rows);
    const todayFormatted = new Date().toLocaleDateString('en-GB');
    const from = fromDate ? new Date(fromDate).toLocaleDateString('en-GB') : '—';
    const to   = toDate   ? new Date(toDate).toLocaleDateString('en-GB')   : '—';
    const dateRangeStr = from === to ? from : `${from} – ${to}`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'India Silk House Stock Valuation';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Stock Valuation', {
      views: [{ showGridLines: true }]
    });

    // ── Title rows
    sheet.mergeCells('A1:C1');
    const t1 = sheet.getCell('A1');
    t1.value = 'INDIA SILK HOUSE';
    t1.font  = { name: 'Arial', bold: true, size: 13, color: { argb: 'FF1E293B' } };
    t1.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 24;

    sheet.mergeCells('A2:C2');
    const t2 = sheet.getCell('A2');
    t2.value = `STOCK VALUATION REPORT  |  ${dateRangeStr}  |  Generated: ${todayFormatted}`;
    t2.font  = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF334155' } };
    t2.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 18;

    // ── Column widths + header row
    sheet.columns = [
      { key: 'category', width: 32 },
      { key: 'qty',      width: 14 },
      { key: 'value',    width: 18 }
    ];

    const headerRow = sheet.addRow({ category: 'CATEGORY', qty: 'QTY', value: 'VALUE' });
    headerRow.height = 22;
    headerRow.eachCell(cell => {
      cell.font      = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF1E293B' } };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border    = {
        top:    { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
        left:   { style: 'thin',   color: { argb: 'FF94A3B8' } },
        right:  { style: 'thin',   color: { argb: 'FF94A3B8' } }
      };
    });

    // ── Data rows
    let totalQty = 0, totalValue = 0;
    parsedRows.forEach(r => {
      const qty   = parseFloat(r.qty   || 0);
      const value = parseFloat(r.value || 0);
      totalQty   += qty;
      totalValue += value;

      const dataRow = sheet.addRow({ category: r.categoryName, qty, value });
      dataRow.height = 20;
      dataRow.eachCell((cell, colIdx) => {
        cell.font   = { name: 'Arial', size: 9, color: { argb: 'FF334155' } };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left:   { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right:  { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
        if (colIdx === 1) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colIdx === 2) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt    = '#,##0';
        } else if (colIdx === 3) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt    = '#,##0.00';
        }
      });
    });

    // ── Totals row
    const totRow = sheet.addRow({ category: 'TOTAL', qty: totalQty, value: totalValue });
    totRow.height = 22;
    totRow.eachCell((cell, colIdx) => {
      cell.font   = { name: 'Arial', bold: true, size: 10, color: { argb: 'FF1E293B' } };
      cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      cell.border = {
        top:    { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF1E293B' } },
        left:   { style: 'thin',   color: { argb: 'FF94A3B8' } },
        right:  { style: 'thin',   color: { argb: 'FF94A3B8' } }
      };
      if (colIdx === 1) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; }
      else if (colIdx === 2) { cell.alignment = { horizontal: 'center', vertical: 'middle' }; cell.numFmt = '#,##0'; }
      else if (colIdx === 3) { cell.alignment = { horizontal: 'right',  vertical: 'middle' }; cell.numFmt = '#,##0.00'; }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=stock_valuation_${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Stock valuation Excel export error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate stock valuation Excel' });
  }
};

// ─── GET /api/export/stock-valuation/pdf ──────────────────────────────────
// Generates a PDF of the stock valuation table
const exportStockValuationPDF = async (req, res) => {
  try {
    const { rows, fromDate, toDate } = req.query;
    if (!rows) return res.status(400).json({ success: false, message: 'rows param required' });

    const parsedRows = JSON.parse(rows);
    const todayStr = new Date().toLocaleDateString('en-GB');
    const from = fromDate ? new Date(fromDate).toLocaleDateString('en-GB') : '—';
    const to   = toDate   ? new Date(toDate).toLocaleDateString('en-GB')   : '—';
    const dateRangeStr = from === to ? from : `${from} – ${to}`;

    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'portrait' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=stock_valuation_${Date.now()}.pdf`);
    doc.pipe(res);

    const pageWidth  = 515;  // A4 portrait usable width (595 - 2*40)
    const rowH = 22;
    const colW = [pageWidth * 0.55, pageWidth * 0.20, pageWidth * 0.25];
    const startX = 40;
    let y = 40;

    // ── Header banner
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#0F172A')
       .text('INDIA SILK HOUSE', startX, y, { align: 'center', width: pageWidth });
    y += 18;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#334155')
       .text(`STOCK VALUATION REPORT  |  ${dateRangeStr}  |  Generated: ${todayStr}`, startX, y, { align: 'center', width: pageWidth });
    y += 24;

    // ── Column header row
    const drawCell = (text, x, cy, w, opts = {}) => {
      const { bg, bold, align = 'center', color = '#1E293B' } = opts;
      if (bg) doc.rect(x, cy, w, rowH).fill(bg);
      doc.rect(x, cy, w, rowH).stroke('#CBD5E1');
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color);
      doc.text(text, x + 4, cy + 6, { width: w - 8, align });
    };

    drawCell('CATEGORY', startX,               y, colW[0], { bg: '#F1F5F9', bold: true });
    drawCell('QTY',      startX + colW[0],     y, colW[1], { bg: '#F1F5F9', bold: true });
    drawCell('VALUE', startX + colW[0] + colW[1], y, colW[2], { bg: '#F1F5F9', bold: true });
    y += rowH;

    // ── Data rows
    let totalQty = 0, totalValue = 0;
    const fmtNum = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const fmtCur = (n) => parseFloat(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    parsedRows.forEach((r, i) => {
      const qty   = parseFloat(r.qty   || 0);
      const value = parseFloat(r.value || 0);
      totalQty   += qty;
      totalValue += value;
      const bg = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';

      drawCell(r.categoryName, startX,               y, colW[0], { bg, align: 'left' });
      drawCell(fmtNum(qty),    startX + colW[0],     y, colW[1], { bg });
      drawCell(`${fmtCur(value)}`, startX + colW[0] + colW[1], y, colW[2], { bg });
      y += rowH;
    });

    // ── Totals row
    drawCell('TOTAL', startX,               y, colW[0], { bg: '#DBEAFE', bold: true, align: 'right' });
    drawCell(fmtNum(totalQty), startX + colW[0], y, colW[1], { bg: '#DBEAFE', bold: true });
    drawCell(`${fmtCur(totalValue)}`, startX + colW[0] + colW[1], y, colW[2], { bg: '#DBEAFE', bold: true });

    doc.end();
  } catch (err) {
    console.error('Stock valuation PDF export error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate stock valuation PDF' });
  }
};

// GET /api/export/overall-stock-data
const getOverallStockData = async (req, res) => {
  try {
    const pool = await getPool();
    const { date, groupCode, categoryCode, includeZero } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const isZeroEnabled = includeZero === 'true' || includeZero === true;

    let whereFilter = '';
    if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
      const parsedGroup = parseInt(groupCode);
      if (!isNaN(parsedGroup)) {
        whereFilter += ` AND d.GroupCode = ${parsedGroup}`;
      }
    }
    if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
      const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
      if (catCodes.length > 0) {
        whereFilter += ` AND d.CategoryCode IN (${catCodes.join(',')})`;
      }
    }
    if (!isZeroEnabled) {
      whereFilter += ` AND ISNULL(stock.Qty, 0) <> 0`;
    }

    const result = await pool.request()
      .input('targetDate', sql.VarChar(10), targetDate)
      .query(`
        SELECT 
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          ISNULL(stock.Qty, 0) AS Qty,
          ISNULL(d.RetailPrice1, 0) AS Retail,
          ISNULL(ledger_avg.RunningAvgRateBC, 
            ISNULL(upc_price.BaseCost, 
              ISNULL(d.BaseCost, 
                ISNULL(last_purchase.Rate, 0)
              )
            )
          ) AS Cost
        FROM mstitem i
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        LEFT JOIN (
          SELECT ItemCode, SUM(Quantity) AS Qty
          FROM stmStockLedger
          WHERE DocumentDate <= @targetDate AND StockPointCode = 2
          GROUP BY ItemCode
        ) stock ON i.code = stock.ItemCode
        LEFT JOIN (
          SELECT ItemCode, RunningAvgRateBC
          FROM (
            SELECT ItemCode, RunningAvgRateBC,
                   ROW_NUMBER() OVER (PARTITION BY ItemCode ORDER BY DocumentDate DESC, Code DESC) as rn
            FROM stmStockLedger
            WHERE RunningAvgRateBC > 0 AND DocumentDate <= @targetDate AND StockPointCode = 2
          ) l
          WHERE l.rn = 1
        ) ledger_avg ON i.code = ledger_avg.ItemCode
        LEFT JOIN (
          SELECT itemcode, BaseCost
          FROM (
            SELECT itemcode, BaseCost,
                   ROW_NUMBER() OVER (PARTITION BY itemcode ORDER BY code DESC) as rn
            FROM mstUPCPrice
            WHERE PricingCode = 1 AND BaseCost > 0
          ) u
          WHERE u.rn = 1
        ) upc_price ON i.code = upc_price.itemcode
        LEFT JOIN (
          SELECT p.ItemCode, p.Rate
          FROM (
            SELECT pd.ItemCode, pd.Rate, ph.DocumentDate,
                   ROW_NUMBER() OVER (PARTITION BY pd.ItemCode ORDER BY ph.DocumentDate DESC) as rn
            FROM (
              SELECT ItemCode, Rate, HeaderCode, 'NEW' AS src
              FROM tranPurchaseDetail
              WHERE Rate > 0
              UNION ALL
              SELECT ItemCode, Rate, HeaderCode, 'OLD' AS src
              FROM ${OLD_DB}.dbo.tranPurchaseDetail
              WHERE Rate > 0
            ) pd
            INNER JOIN (
              SELECT Code, DocumentDate, 'NEW' AS src FROM tranPurchaseHeader
              UNION ALL
              SELECT Code, DocumentDate, 'OLD' AS src FROM ${OLD_DB}.dbo.tranPurchaseHeader
            ) ph ON pd.HeaderCode = ph.Code AND pd.src = ph.src
            WHERE ph.DocumentDate <= @targetDate
          ) p
          WHERE p.rn = 1
        ) last_purchase ON i.code = last_purchase.ItemCode
        WHERE 1 = 1 ${whereFilter}
        ORDER BY i.Name
      `);

    const cleanedData = (result.recordset || []).map(r => ({
      ...r,
      Barcode: cleanBarcode(r.Barcode)
    }));

    return res.status(200).json({ success: true, data: cleanedData });
  } catch (err) {
    console.error('Get overall stock data error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve stock data' });
  }
};

// GET /api/export/overall-stock-excel
const exportOverallStockExcel = async (req, res) => {
  try {
    const pool = await getPool();
    const { date, groupCode, categoryCode, includeZero } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const isZeroEnabled = includeZero === 'true' || includeZero === true;

    let whereFilter = '';
    if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
      const parsedGroup = parseInt(groupCode);
      if (!isNaN(parsedGroup)) {
        whereFilter += ` AND d.GroupCode = ${parsedGroup}`;
      }
    }
    if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
      const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
      if (catCodes.length > 0) {
        whereFilter += ` AND d.CategoryCode IN (${catCodes.join(',')})`;
      }
    }
    if (!isZeroEnabled) {
      whereFilter += ` AND ISNULL(stock.Qty, 0) <> 0`;
    }

    const result = await pool.request()
      .input('targetDate', sql.VarChar(10), targetDate)
      .query(`
        SELECT 
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          ISNULL(stock.Qty, 0) AS Qty,
          ISNULL(d.RetailPrice1, 0) AS Retail,
          ISNULL(ledger_avg.RunningAvgRateBC, 
            ISNULL(upc_price.BaseCost, 
              ISNULL(d.BaseCost, 
                ISNULL(last_purchase.Rate, 0)
              )
            )
          ) AS Cost
        FROM mstitem i
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        LEFT JOIN (
          SELECT ItemCode, SUM(Quantity) AS Qty
          FROM stmStockLedger
          WHERE DocumentDate <= @targetDate AND StockPointCode = 2
          GROUP BY ItemCode
        ) stock ON i.code = stock.ItemCode
        LEFT JOIN (
          SELECT ItemCode, RunningAvgRateBC
          FROM (
            SELECT ItemCode, RunningAvgRateBC,
                   ROW_NUMBER() OVER (PARTITION BY ItemCode ORDER BY DocumentDate DESC, Code DESC) as rn
            FROM stmStockLedger
            WHERE RunningAvgRateBC > 0 AND DocumentDate <= @targetDate AND StockPointCode = 2
          ) l
          WHERE l.rn = 1
        ) ledger_avg ON i.code = ledger_avg.ItemCode
        LEFT JOIN (
          SELECT itemcode, BaseCost
          FROM (
            SELECT itemcode, BaseCost,
                   ROW_NUMBER() OVER (PARTITION BY itemcode ORDER BY code DESC) as rn
            FROM mstUPCPrice
            WHERE PricingCode = 1 AND BaseCost > 0
          ) u
          WHERE u.rn = 1
        ) upc_price ON i.code = upc_price.itemcode
        LEFT JOIN (
          SELECT p.ItemCode, p.Rate
          FROM (
            SELECT pd.ItemCode, pd.Rate, ph.DocumentDate,
                   ROW_NUMBER() OVER (PARTITION BY pd.ItemCode ORDER BY ph.DocumentDate DESC) as rn
            FROM (
              SELECT ItemCode, Rate, HeaderCode, 'NEW' AS src
              FROM tranPurchaseDetail
              WHERE Rate > 0
              UNION ALL
              SELECT ItemCode, Rate, HeaderCode, 'OLD' AS src
              FROM ${OLD_DB}.dbo.tranPurchaseDetail
              WHERE Rate > 0
            ) pd
            INNER JOIN (
              SELECT Code, DocumentDate, 'NEW' AS src FROM tranPurchaseHeader
              UNION ALL
              SELECT Code, DocumentDate, 'OLD' AS src FROM ${OLD_DB}.dbo.tranPurchaseHeader
            ) ph ON pd.HeaderCode = ph.Code AND pd.src = ph.src
            WHERE ph.DocumentDate <= @targetDate
          ) p
          WHERE p.rn = 1
        ) last_purchase ON i.code = last_purchase.ItemCode
        WHERE 1 = 1 ${whereFilter}
        ORDER BY i.Name
      `);

    const records = result.recordset;
    const todayFormatted = new Date().toLocaleDateString('en-GB');
    const targetFormatted = new Date(targetDate).toLocaleDateString('en-GB');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'India Silk House Overall Stock Report';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Stock Report', {
      views: [{ showGridLines: true, state: 'frozen', ySplit: 3 }]
    });

    // Company Banner
    sheet.mergeCells('A1:G1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'INDIA SILK HOUSE';
    titleCell.font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FF1E293B' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 25;

    // Subtitle
    sheet.mergeCells('A2:G2');
    const subCell = sheet.getCell('A2');
    subCell.value = `OVERALL STOCK REPORT  |  As of: ${targetFormatted}  |  Generated: ${todayFormatted}`;
    subCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF475569' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    const headers = [
      { header: 'SL NO', key: 'slNo', width: 8 },
      { header: 'BARCODE', key: 'Barcode', width: 18 },
      { header: 'ITEM NAME', key: 'ItemName', width: 35 },
      { header: 'SIZE NAME', key: 'SizeName', width: 14 },
      { header: 'QUANTITY', key: 'Qty', width: 12 },
      { header: 'RETAIL', key: 'Retail', width: 16 },
      { header: 'COST', key: 'Cost', width: 16 }
    ];

    sheet.columns = headers.map(h => ({ key: h.key, width: h.width }));

    const headerRow = sheet.getRow(3);
    headerRow.height = 24;
    headerRow.values = headers.map(h => h.header);

    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FF1E293B' }, name: 'Arial', size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FF94A3B8' } }
      };
    });

    records.forEach((row, idx) => {
      const qty = parseFloat(row.Qty) || 0;
      const retail = parseFloat(row.Retail) || 0;
      const cost = parseFloat(row.Cost) || 0;

      const barcodeCleaned = cleanBarcode(row.Barcode);
      const barcodeNum = /^\d+$/.test(barcodeCleaned) ? parseInt(barcodeCleaned, 10) : barcodeCleaned;

      const dataRow = sheet.addRow({
        slNo: idx + 1,
        Barcode: barcodeNum,
        ItemName: row.ItemName?.trim() || '—',
        SizeName: row.SizeName?.trim() || '—',
        Qty: qty,
        Retail: retail,
        Cost: cost
      });

      dataRow.height = 20;

      dataRow.eachCell((cell, colIndex) => {
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF334155' } };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        if (colIndex === 2) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '0';
        } else if (colIndex === 3) {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        } else if (colIndex === 5) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.numFmt = '#,##0';
        } else if (colIndex === 6 || colIndex === 7) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          cell.numFmt = '#,##0.00';
          if (colIndex === 7) cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF991B1B' } }; // cost in red
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    const lastRowIndex = records.length + 3;
    const totalsRowIndex = lastRowIndex + 1;
    sheet.mergeCells(`A${totalsRowIndex}:D${totalsRowIndex}`);

    const totalsLabelCell = sheet.getCell(`A${totalsRowIndex}`);
    totalsLabelCell.value = 'TOTAL';
    totalsLabelCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF1E293B' } };
    totalsLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };

    const qtyTotalCell = sheet.getCell(`E${totalsRowIndex}`);
    qtyTotalCell.value = { formula: `SUM(E4:E${lastRowIndex})` };
    qtyTotalCell.numFmt = '#,##0';
    qtyTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF1E293B' } };
    qtyTotalCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Calculate sum of retail value (retail * qty)
    const retailTotalCell = sheet.getCell(`F${totalsRowIndex}`);
    retailTotalCell.value = { formula: `SUMPRODUCT(E4:E${lastRowIndex},F4:F${lastRowIndex})` };
    retailTotalCell.numFmt = '#,##0.00';
    retailTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF059669' } };
    retailTotalCell.alignment = { horizontal: 'right', vertical: 'middle' };

    // Calculate sum of cost value (cost * qty)
    const costTotalCell = sheet.getCell(`G${totalsRowIndex}`);
    costTotalCell.value = { formula: `SUMPRODUCT(E4:E${lastRowIndex},G4:G${lastRowIndex})` };
    costTotalCell.numFmt = '#,##0.00';
    costTotalCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: 'FF991B1B' } };
    costTotalCell.alignment = { horizontal: 'right', vertical: 'middle' };

    sheet.getRow(totalsRowIndex).eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF94A3B8' } },
        bottom: { style: 'double', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=overall_stock_${Date.now()}.xlsx`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel overall stock report error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate Excel overall stock report' });
  }
};

// GET /api/export/overall-stock-pdf
const exportOverallStockPDF = async (req, res) => {
  try {
    const pool = await getPool();
    const { date, groupCode, categoryCode, includeZero } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const isZeroEnabled = includeZero === 'true' || includeZero === true;

    let whereFilter = '';
    if (groupCode && groupCode !== 'undefined' && groupCode !== 'null' && String(groupCode).trim() !== '') {
      const parsedGroup = parseInt(groupCode);
      if (!isNaN(parsedGroup)) {
        whereFilter += ` AND d.GroupCode = ${parsedGroup}`;
      }
    }
    if (categoryCode && categoryCode !== 'undefined' && categoryCode !== 'null' && String(categoryCode).trim() !== '') {
      const catCodes = String(categoryCode).split(',').map(Number).filter(Boolean);
      if (catCodes.length > 0) {
        whereFilter += ` AND d.CategoryCode IN (${catCodes.join(',')})`;
      }
    }
    if (!isZeroEnabled) {
      whereFilter += ` AND ISNULL(stock.Qty, 0) <> 0`;
    }

    const result = await pool.request()
      .input('targetDate', sql.VarChar(10), targetDate)
      .query(`
        SELECT 
          i.UPCCode AS Barcode,
          i.Name AS ItemName,
          s.name AS SizeName,
          ISNULL(stock.Qty, 0) AS Qty,
          ISNULL(d.RetailPrice1, 0) AS Retail,
          ISNULL(ledger_avg.RunningAvgRateBC, 
            ISNULL(upc_price.BaseCost, 
              ISNULL(d.BaseCost, 
                ISNULL(last_purchase.Rate, 0)
              )
            )
          ) AS Cost
        FROM mstitem i
        LEFT JOIN mstsize s ON i.SizeCode = s.code
        LEFT JOIN mstitemdetail d ON i.code = d.code
        LEFT JOIN (
          SELECT ItemCode, SUM(Quantity) AS Qty
          FROM stmStockLedger
          WHERE DocumentDate <= @targetDate AND StockPointCode = 2
          GROUP BY ItemCode
        ) stock ON i.code = stock.ItemCode
        LEFT JOIN (
          SELECT ItemCode, RunningAvgRateBC
          FROM (
            SELECT ItemCode, RunningAvgRateBC,
                   ROW_NUMBER() OVER (PARTITION BY ItemCode ORDER BY DocumentDate DESC, Code DESC) as rn
            FROM stmStockLedger
            WHERE RunningAvgRateBC > 0 AND DocumentDate <= @targetDate AND StockPointCode = 2
          ) l
          WHERE l.rn = 1
        ) ledger_avg ON i.code = ledger_avg.ItemCode
        LEFT JOIN (
          SELECT itemcode, BaseCost
          FROM (
            SELECT itemcode, BaseCost,
                   ROW_NUMBER() OVER (PARTITION BY itemcode ORDER BY code DESC) as rn
            FROM mstUPCPrice
            WHERE PricingCode = 1 AND BaseCost > 0
          ) u
          WHERE u.rn = 1
        ) upc_price ON i.code = upc_price.itemcode
        LEFT JOIN (
          SELECT p.ItemCode, p.Rate
          FROM (
            SELECT pd.ItemCode, pd.Rate, ph.DocumentDate,
                   ROW_NUMBER() OVER (PARTITION BY pd.ItemCode ORDER BY ph.DocumentDate DESC) as rn
            FROM (
              SELECT ItemCode, Rate, HeaderCode, 'NEW' AS src
              FROM tranPurchaseDetail
              WHERE Rate > 0
              UNION ALL
              SELECT ItemCode, Rate, HeaderCode, 'OLD' AS src
              FROM ${OLD_DB}.dbo.tranPurchaseDetail
              WHERE Rate > 0
            ) pd
            INNER JOIN (
              SELECT Code, DocumentDate, 'NEW' AS src FROM tranPurchaseHeader
              UNION ALL
              SELECT Code, DocumentDate, 'OLD' AS src FROM ${OLD_DB}.dbo.tranPurchaseHeader
            ) ph ON pd.HeaderCode = ph.Code AND pd.src = ph.src
            WHERE ph.DocumentDate <= @targetDate
          ) p
          WHERE p.rn = 1
        ) last_purchase ON i.code = last_purchase.ItemCode
        WHERE 1 = 1 ${whereFilter}
        ORDER BY i.Name
      `);

    const records = result.recordset;
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=overall_stock_${Date.now()}.pdf`);
    doc.pipe(res);

    const leftMargin = 30;
    const tableWidth = 782;
    const rowHeight = 22;

    const colWidths = [30, 110, 282, 80, 70, 100, 110];
    const aligns = ['center', 'center', 'left', 'center', 'center', 'right', 'right'];
    const headers = ['SL', 'BARCODE', 'ITEM NAME', 'SIZE NAME', 'QUANTITY', 'RETAIL', 'COST'];

    const targetFormatted = new Date(targetDate).toLocaleDateString('en-GB');
    const todayStr = new Date().toLocaleDateString('en-GB');

    const drawHeader = (y) => {
      doc.fillColor('#0F172A').fontSize(12).font('Helvetica-Bold').text('INDIA SILK HOUSE', leftMargin, y - 40, { align: 'center', width: tableWidth });
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text(`OVERALL STOCK REPORT  |  As of: ${targetFormatted}  |  Generated: ${todayStr}`, leftMargin, y - 24, { align: 'center', width: tableWidth });

      const headerHeight = 20;
      doc.rect(leftMargin, y, tableWidth, headerHeight).fill('#F1F5F9');

      let currentX = leftMargin;
      headers.forEach((h, idx) => {
        const w = colWidths[idx];
        doc.rect(currentX, y, w, headerHeight).stroke('#CBD5E1');
        doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
        doc.text(h, currentX + 2, y + 6, {
          width: w - 4,
          align: aligns[idx]
        });
        currentX += w;
      });
    };

    let startY = 80;
    drawHeader(startY);

    let currentY = startY + 20;
    let totalQty = 0;
    let totalRetailVal = 0;
    let totalCostVal = 0;

    records.forEach((row, index) => {
      const qty = parseFloat(row.Qty) || 0;
      const retail = parseFloat(row.Retail) || 0;
      const cost = parseFloat(row.Cost) || 0;

      totalQty += qty;
      totalRetailVal += (qty * retail);
      totalCostVal += (qty * cost);

      const cells = [
        (index + 1).toString(),
        cleanBarcode(row.Barcode),
        row.ItemName?.trim() || '—',
        row.SizeName?.trim() || '—',
        Math.round(qty).toString(),
        `${retail.toFixed(2)}`,
        `${cost.toFixed(2)}`
      ];

      let dynamicRowHeight = 15;
      const cellHeights = [];
      cells.forEach((text, i) => {
        const w = colWidths[i];
        doc.font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
        const textHeight = doc.heightOfString(String(text), { width: w - 6 });
        cellHeights.push(textHeight);
        if (textHeight + 6 > dynamicRowHeight) {
          dynamicRowHeight = textHeight + 6;
        }
      });

      if (currentY + dynamicRowHeight > 510) {
        doc.addPage();
        currentY = startY + 20;
        drawHeader(startY);
      }

      doc.rect(leftMargin, currentY, tableWidth, dynamicRowHeight).fill(index % 2 === 0 ? '#FFFFFF' : '#F8FAFC');

      let currentX = leftMargin;
      cells.forEach((text, i) => {
        const w = colWidths[i];
        const textHeight = cellHeights[i];

        doc.rect(currentX, currentY, w, dynamicRowHeight).stroke('#E2E8F0');
        doc.font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);

        if (i === 6) {
          doc.fillColor('#991B1B'); // red for cost
        } else if (i === 5) {
          doc.fillColor('#059669'); // green for retail
        } else {
          doc.fillColor('#0F172A');
        }

        const textY = currentY + (dynamicRowHeight - textHeight) / 2;
        doc.text(String(text), currentX + 3, textY, {
          width: w - 6,
          align: aligns[i],
          lineBreak: true
        });

        currentX += w;
      });

      currentY += dynamicRowHeight;
    });

    const totalsRowHeight = 22;
    if (currentY + totalsRowHeight > 520) {
      doc.addPage();
      currentY = startY + 20;
      drawHeader(startY);
    }

    doc.rect(leftMargin, currentY, tableWidth, totalsRowHeight).fill('#F8FAFC');
    doc.rect(leftMargin, currentY, tableWidth, totalsRowHeight).stroke('#94A3B8');

    const mergedLeftWidth = colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8);
    doc.text('TOTAL', leftMargin + 2, currentY + 7, {
      width: mergedLeftWidth - 6,
      align: 'right'
    });

    let currentX = leftMargin + mergedLeftWidth;

    // Quantity Total
    doc.rect(currentX, currentY, colWidths[4], totalsRowHeight).stroke('#E2E8F0');
    doc.text(Math.round(totalQty).toString(), currentX + 2, currentY + 7, {
      width: colWidths[4] - 4,
      align: 'center'
    });
    currentX += colWidths[4];

    // Retail Total
    doc.rect(currentX, currentY, colWidths[5], totalsRowHeight).stroke('#E2E8F0');
    doc.fillColor('#059669').text(`${totalRetailVal.toFixed(2)}`, currentX + 2, currentY + 7, {
      width: colWidths[5] - 4,
      align: 'right'
    });
    currentX += colWidths[5];

    // Cost Total
    doc.rect(currentX, currentY, colWidths[6], totalsRowHeight).stroke('#E2E8F0');
    doc.fillColor('#991B1B').text(`${totalCostVal.toFixed(2)}`, currentX + 2, currentY + 7, {
      width: colWidths[6] - 4,
      align: 'right'
    });

    doc.end();
  } catch (err) {
    console.error('PDF overall stock report error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate PDF overall stock report' });
  }
};

module.exports = {
  exportExcel, exportPDF, exportSalesExcel, exportSalesPDF, getSalesData,
  getStockValuationGroups, getCategoryStats, exportStockValuationExcel, exportStockValuationPDF,
  getOverallStockData, exportOverallStockExcel, exportOverallStockPDF
};
