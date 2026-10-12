# Deployment

For the current **Supabase database + private document storage + Vercel API and
website** setup, follow [supabase/README.md](supabase/README.md). The committed
`vercel.json` supports this setup. Configure the private environment variables and
run `npm run setup:supabase` before deploying.

The instructions below are the optional legacy SQLite backend deployment.

## Legacy client trial deployment

The app needs Node 24 and persistent storage for SQLite and demo documents. Vercel serves the frontend and proxies `/api/*` to that backend. Do not deploy the SQLite server as a Vercel Function: local writes will not persist.

## Backend

Use `Dockerfile` on your existing server, with a persistent volume mounted at `/app/storage`. `render.yaml` is an alternative deployment blueprint; its Starter plan and disk are paid resources and have not been provisioned.

Set these environment variables on the backend:

- `APP_ORIGIN=https://your-trial.vercel.app` (the frontend URL, no trailing slash)
- `SESSION_SECRET` to a long random private value
- `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD` (at least 10 characters) for a fresh production database
- `DATABASE_PATH=/app/storage/success-online.sqlite`
- `STORAGE_PATH=/app/storage/documents`
- `PAYMENT_MODE=demo`, `DRIVE_MODE=demo`, `SHEETS_MODE=demo` for trial mode

Expose HTTPS and verify `https://your-api.example.com/api/health` returns `{"ok":true}`. Keep the persistent volume backed up. Use one server instance with this SQLite deployment.

## Vercel frontend

After the backend HTTPS URL is available:

```powershell
$env:BACKEND_ORIGIN='https://your-api.example.com'
node scripts/configure-vercel.js
vercel.cmd --prod
```

The generated `vercel.json` serves only `public/` and proxies the authenticated API. Deploy from this project root. Set the backend `APP_ORIGIN` to the final Vercel production URL before clients log in. The API uses origin checks and secure cookies under HTTPS.

## Google reconnection

The saved Google refresh token was rejected as expired or revoked during verification. In Google Cloud OAuth settings, add `https://your-trial.vercel.app/api/google/oauth/callback` as an authorized redirect URI. Configure OAuth client ID, client secret, Drive root folder ID, and operations spreadsheet ID privately on the backend. Connect Google Drive from the admin portal, then activate Google Sheets. The new OAuth request includes Drive and Sheets scopes.

The backend persists refreshed OAuth credentials and integration modes in its private SQLite database. Protect that persistent volume and its backups. Existing initial credentials can be loaded from environment variables or a private local `.env`. Keep credentials out of the frontend and source repository.

Paste [google-apps-script/script.js](google-apps-script/script.js) into Apps Script (or use the identical `Code.gs`), then run `setupSuccessOnlineWorkbook`. Setup preserves existing case and payment rows. `rebuildDailyReport` refreshes only the derived Daily Report tab. The backend creates the reporting schema itself when Sheets is activated.

## Trial acceptance

1. Sign in as sales, choose each service, and confirm required/conditional checklist items.
2. Continue stays disabled until all required files are selected. Invalid formats and files over 10 MB are rejected. Pending upload failures leave a recoverable case and retry does not create another case.
3. On a phone, use the single Upload document picker. The device/browser determines which file, photo library and camera sources are available.
4. Payment and forward status changes fail while documents are missing. Complete uploads unlock payment; verified trial payment unlocks assignment.
5. Back office opens a case and chooses Download all files. Supporting browsers show a save-location picker; other browsers follow their download settings. Extracting the ZIP creates the named folder with a subfolder per document type.
6. Process through Document Received, upload the final document, and submit it. Sales can then download the final document.
7. After Google reconnection, confirm new service tabs, Required Documents / Uploaded Required Documents / Missing Documents / Drive Folder columns, and the Documents register. Verify a Drive-backed individual download and ZIP from the hosted domain.

Local development seeds demo users. A fresh production database creates the configured administrator; create staff accounts from Employees. Use synthetic client data for the trial. Live payments remain blocked until a real gateway adapter is implemented.

## Verification completed

`npm run build` checks JavaScript syntax, generates both paste-ready Apps Script files and `public/script.js`, and runs real HTTP API integration tests with isolated temporary SQLite and storage. Browser/mobile camera verification and public-host checks require the deployment described above; neither has been completed in this session.
