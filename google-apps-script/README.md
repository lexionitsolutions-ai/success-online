# Success Online: two-tab workbook

1. Open your existing spreadsheet, then Extensions > Apps Script.
2. Replace the old script with the entire contents of `script.js` (or identical `Code.gs`).
3. Save, select `setupSuccessOnlineWorkbook`, click Run, and authorize it.
4. Keep **All Workings** and **Cash Flow**. Delete unwanted older tabs yourself after saving any records you need. Setup never deletes tabs or data rows.
5. Share the same spreadsheet link to connect the updated backend. Activation syncs existing database cases and verified cash receipts into the two tabs.

All Workings has one row per application: SORO number (the application's existing case reference), date in India, client name, mobile, service, salesperson, document status, assigned work person, total amount, paid amount, balance, payment mode, payment status, work status, and last updated.

Cash Flow includes date, payment description, amount in rupees, payment mode, SORO number, client, service, payment reference, and status. Only confirmed receipts enter cash flow. Refunds add separate negative entries, preserving receipt history. Stable references prevent duplicate entries when sync is retried.

The Apps Script prepares the workbook only. The authenticated application backend writes and updates records through the Sheets API. No web-app deployment or Apps Script time trigger is needed. Remove old Daily Report triggers if you previously installed them. Spreadsheet rows are an operations fallback; document files remain in private storage.

Run `npm.cmd run build` to regenerate both script files after changing the reporting schema.
