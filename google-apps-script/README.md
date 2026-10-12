# Success Online Operations Apps Script

1. Create or open the `Success Online Operations` spreadsheet.
2. Open Extensions > Apps Script.
3. Paste `Code.gs` or the identical `script.js`, save, and run `setupSuccessOnlineWorkbook`. Setup preserves existing rows.
4. Authorize the script with the business Google account.
5. Keep authoritative writes in the backend API. This script prepares reporting tabs and scheduled reports only.

Do not deploy an unauthenticated `doPost` web app for identity documents, payments, or case updates.

The generated schema includes all 15 service tabs, required/uploaded/missing document counts, Drive folder links, and a document-version register. Run `rebuildDailyReport` to rebuild daily creation, collection, completion, pending, and overdue totals. Pending and overdue counts are current snapshots on today's row.

Run `npm run build` after changing the backend reporting schema to regenerate both paste-ready files.
