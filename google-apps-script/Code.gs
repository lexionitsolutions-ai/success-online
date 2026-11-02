// Success Online: two-tab workbook setup.
// Paste into Extensions > Apps Script, save, and run setupSuccessOnlineWorkbook.
// This script formats the workbook. The Success Online backend syncs the records.
const SHEET_HEADERS = {
  "All Workings": [
    "SORO Number",
    "Date",
    "Client Name",
    "Mobile Number",
    "Work / Service",
    "Salesperson",
    "Document Status",
    "Work Person",
    "Total Amount (INR)",
    "Amount Paid (INR)",
    "Balance (INR)",
    "Payment Mode",
    "Payment Status",
    "Work Status",
    "Last Updated"
  ],
  "Cash Flow": [
    "Date",
    "Payment Description",
    "Amount (INR)",
    "Payment Mode",
    "SORO Number",
    "Client Name",
    "Work / Service",
    "Payment Reference",
    "Payment Status"
  ]
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Success Online')
    .addItem('Set up / format workbook', 'setupSuccessOnlineWorkbook')
    .addToUi();
}

function setupSuccessOnlineWorkbook() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.setSpreadsheetTimeZone('Asia/Kolkata');
    // Validate first so rerunning setup cannot overwrite a different table.
    Object.keys(SHEET_HEADERS).forEach(function(name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet || sheet.getLastRow() < 2) return;
      const expected = SHEET_HEADERS[name];
      const actual = sheet.getRange(1, 1, 1, expected.length).getValues()[0];
      if (expected.some(function(header, index) { return actual[index] !== header; })) {
        throw new Error(name + ' already contains a different table. Rename it before running setup.');
      }
    });
    Object.keys(SHEET_HEADERS).forEach(function(name) {
      const headers = SHEET_HEADERS[name];
      const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
      if (sheet.getMaxColumns() < headers.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
      }
      if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(sheet.getMaxRows(), 2 - sheet.getMaxRows());
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setFontWeight('bold').setBackground('#123039').setFontColor('#ffffff')
        .setWrap(true).setVerticalAlignment('middle');
      sheet.setRowHeight(1, 44);
      sheet.setFrozenRows(1);
      sheet.setFrozenColumns(name === 'All Workings' ? 1 : 0);
      const body = sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length);
      body.setNumberFormat('@').setFontFamily('Arial').setFontSize(10).setVerticalAlignment('middle');
      if (name === 'All Workings') {
        sheet.getRange(2, 9, sheet.getMaxRows() - 1, 3).setNumberFormat('#,##0.00;[Red]-#,##0.00');
        sheet.setColumnWidths(1, headers.length, 150);
        sheet.setColumnWidth(5, 240);
        sheet.setColumnWidth(15, 210);
      } else {
        sheet.getRange(2, 3, sheet.getMaxRows() - 1, 1).setNumberFormat('#,##0.00;[Red]-#,##0.00');
        sheet.setColumnWidths(1, headers.length, 160);
        sheet.setColumnWidth(2, 330);
        sheet.setColumnWidth(8, 340);
      }
      const filter = sheet.getFilter();
      if (filter) filter.remove();
      sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter();
    });
    SpreadsheetApp.flush();
    ss.toast('All Workings and Cash Flow are ready.', 'Success Online', 8);
  } finally {
    lock.releaseLock();
  }
}
