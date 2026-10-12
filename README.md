# Success Online

Internal web app for Success Online, a private Indian e-Seva assistance business. It includes sales intake, back-office queues, admin oversight, employee performance reviews, role checks, Supabase PostgreSQL and private Storage support, optional Google Drive/Sheets integrations, and isolated integration tests. Payments currently run in demo mode.

For Vercel hosting with Supabase, follow [supabase/README.md](supabase/README.md).

## Stack

Node 24, an asynchronous Node API, static HTML/CSS/JS, PostgreSQL through Supabase's transaction pooler, and private Supabase Storage. Local development can use built-in SQLite when DATABASE_URL is unset. The cloud deployment uses the committed Vercel API entry point and configuration.

## Run locally

For the Vercel client trial and persistent backend setup, see [DEPLOYMENT.md](DEPLOYMENT.md).

```powershell
copy .env.example .env
npm.cmd start
```

Open `http://localhost:3000`.

Demo accounts use password `Demo@12345`:

- `sales01` to `sales05`
- `backoffice01` to `backoffice02`
- `admin01` to `admin02`

Run checks:

```powershell
npm.cmd test
npm.cmd run build
```

`npm.cmd run package` creates `deliverables/Success-Online-Handoff.zip` with the verified source and setup instructions, excluding credentials, databases, and client documents.

## What works now

- Sales can create service-specific cases, collect application information, and upload JPG/PNG/PDF checklist documents.
- Required documents and pending uploads gate progression. A single native document picker offers the device's supported sources. Loaders show case creation and upload progress.
- Back office and admin can download current case files in one ZIP, with a named root folder and document-type subfolders. Live Drive downloads are served through authenticated API routes.
- `public/script.js` is the generated browser entry point. `google-apps-script/script.js` is the complete paste-ready Apps Script, identical to `Code.gs`.
- The service catalog includes all 15 services listed in the client PDF, with conditional requirements for income, age, caste, and ration-card cases.
- PF password entry is not collected or stored by the case intake; the customer is directed to enter it in the official portal during an assisted session.
- The client PDF does not list service or government fees. Trial mode provides a clearly labelled no-charge simulated payment after documents are complete so clients can test assignment and delivery. Live collections require confirmed fees and a configured gateway.
- Sales users only see their own cases.
- Back office users see operational queues, claim ready cases atomically, and post status updates with notes.
- Admin users see all cases, business metrics, employee performance over custom dates, and can create sales/back-office accounts with credentials.
- Case references are readable (`SO-2026-000001`) while internal IDs are non-guessable UUIDs.
- Demo Drive writes private local files under `demo-integrations/Success Online Customers`.
- Demo Sheets writes/upserts case summaries into `demo-integrations/Success Online Operations.json` keyed by case ID.
- Payment orders and verification are server-side and idempotent in demo mode.
- Apps Script source is in `google-apps-script/` for workbook setup and report maintenance.

The checklists reproduce the client-provided PDF. Confirm current official requirements, document formats, and fee amounts before production submissions.

## Integration setup

### Google Drive

Set `DRIVE_MODE=live` only after choosing one production mode:

- Google Workspace Shared Drive: create a Google Cloud project, enable Drive API and Sheets API, create a service account, add it to the Shared Drive with appropriate permissions, set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `GOOGLE_SHARED_DRIVE_ID`, and `GOOGLE_ROOT_FOLDER_ID`.
- Dedicated business My Drive: create OAuth credentials, complete OAuth consent, store refresh credentials privately, and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, and `GOOGLE_ROOT_FOLDER_ID`.

Service accounts cannot own files in an ordinary consumer My Drive unless the Drive is shared with them through supported access. Keep all files private and serve authorized access through the app.

### Google Sheets

Create `Success Online Operations`, copy `google-apps-script/Code.gs` into Extensions > Apps Script, run `setupSuccessOnlineWorkbook`, and set `GOOGLE_OPERATIONS_SPREADSHEET_ID`. The database stays authoritative; Sheets is a mirror and reporting surface.

### Payments

The app is in `PAYMENT_MODE=demo`. For production, create a merchant account with a UPI-capable gateway such as Razorpay or Cashfree, then set gateway key, secret, and webhook secret privately in environment variables. Do not treat screenshots or typed UPI IDs as verified payment.

## Security notes

The local build hashes passwords, uses HTTP-only cookies, validates uploads, masks phone numbers in reports, blocks sales cross-access on API routes, logs important actions, and avoids storing Aadhaar/PAN values in folder or report names. Production should add HTTPS, a managed database, stronger admin MFA, rate limiting at the edge, encrypted backups, retention automation, and invitation-based staff onboarding.

## Backups and retention

Back up the SQLite database and the business-controlled Drive root daily. Keep document retention aligned with Success Online's privacy notice and delete case documents when the lawful retention period ends.
