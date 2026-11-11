# Success Online

Internal web app for Success Online, a private Indian e-Seva assistance business. It includes sales intake, back-office queues, admin oversight, employee performance reviews, role checks, Supabase PostgreSQL and private Storage support, optional Google Sheets reporting, and isolated integration tests. Direct UPI payments use manual receiving-account verification; services without an individual salesperson price use INR 1 test pricing when enabled, except services configured to retain their standard price. Saved individual salesperson prices apply at checkout even during test pricing.

For Vercel hosting with Supabase, follow [supabase/README.md](supabase/README.md).

When upgrading an existing cloud database to salesperson pricing, run
`npm.cmd run migrate:pricing` against the target database before deploying.
This creates the pricing table and restricts direct access without changing existing records.

The mobile workspace uses a fixed header with a profile menu, bottom navigation,
case cards, larger form controls and labeled employee metrics. The profile menu
supports account details, switching accounts and sign-out. Phone and tablet layouts
are used through 900 px; wider screens retain the desktop sidebar and tables.
Run `npm.cmd run test:mobile` to check synthetic fixtures at 320, 390, 430, 768 and
1280 px for all three roles. Screenshots are saved in the ignored
`deliverables/mobile-preview/` folder. The browser test uses installed Windows
Chrome/Edge, `BROWSER_EXECUTABLE`, or Playwright's installed Chromium.

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
- Back office and admin can download current case files in one ZIP, with a named root folder and document-type subfolders. Private documents are served through authenticated API routes.
- `public/script.js` is the generated browser entry point. `google-apps-script/script.js` is the complete paste-ready Apps Script, identical to `Code.gs`.
- The service catalog includes all 15 services listed in the client PDF, with conditional requirements for income, age, caste, and ration-card cases.
- PF password entry is not collected or stored by the case intake; the customer is directed to enter it in the official portal during an assisted session.
- Every service costs INR 1 while TEST_PRICING_MODE is enabled. These are real UPI transfers. An administrator must confirm the receiver before checkout opens, and verify each claimed transfer before processing.
- Sales users only see their own cases.
- Back office users see operational queues, claim ready cases atomically, and post status updates with notes.
- Admin users see all cases, business metrics, employee performance over custom dates, and can create sales/back-office accounts with credentials.
- Case references are readable (`SO-2026-000001`) while internal IDs are non-guessable UUIDs.
- Local development writes private files under `demo-integrations/documents`.
- Demo Sheets writes/upserts case summaries into `demo-integrations/Success Online Operations.json` keyed by case ID.
- Direct UPI orders have server-controlled amounts, UTR claims, admin verification and database uniqueness controls.
- Apps Script source is in `google-apps-script/` for workbook setup and report maintenance.

The checklists reproduce the client-provided PDF. Confirm current official requirements, document formats, and fee amounts before production submissions.

## Integration setup

### Google Sheets

Use the existing spreadsheet, copy `google-apps-script/script.js` into Extensions > Apps Script, and run `setupSuccessOnlineWorkbook`. The backend syncs only **All Workings** and **Cash Flow**. Set `GOOGLE_OPERATIONS_SPREADSHEET_ID` to the same spreadsheet. All Workings keeps one current row per case; Cash Flow keeps verified receipts and separate negative refund entries. Stable references prevent duplicate rows. The database remains authoritative; private document files stay in storage.

### Payments

See [PAYMENTS.md](PAYMENTS.md) for migration, receiver confirmation, prices, verification, reporting and device acceptance tests. No payment gateway is used. Opening a UPI app or submitting a UTR never marks an order paid.

## Security notes

The local build hashes passwords, uses HTTP-only cookies, validates uploads, masks phone numbers in reports, blocks sales cross-access on API routes, logs important actions, and avoids storing Aadhaar/PAN values in folder or report names. Production should add HTTPS, a managed database, stronger admin MFA, rate limiting at the edge, encrypted backups, retention automation, and invitation-based staff onboarding.

## Backups and retention

Back up the SQLite database and the private document storage daily. Keep document retention aligned with Success Online's privacy notice and delete case documents when the lawful retention period ends.


### Combined case payments and uploads

In case review, **Save & create another** starts the next intake and **Save & pay later** opens Payments. Select 2?50 unpaid cases for one salesperson and click **Pay selected cases together**. The combined checkout lists each case and its amount, generates one UPI link/QR for the total, and accepts one UTR. An administrator verifies it once; each case receives its own payment allocation, and collections sum those allocations without duplicating the total. Opening any included case payment returns the combined checkout. Cancelled or expired combined checkouts can be reopened. Refunds apply to the entire combined transfer.

Run the database migration before deploying this feature: `payment_batches` and `payment_batch_items` use the same private RLS policy as the other server-only tables.

Cloud intake uploads at most three documents concurrently. Signed uploads are validated and retained in their original private object rather than copied again. Intake schedules Google Sheets reporting after all files finish; the response does not wait for Google. Pending/failed reporting jobs remain in `sync_jobs` and can be retried from Payments settings. Storage cleanup preserves objects referenced by document records, including completed signed uploads.


### Back-office case pricing and service options

Passport, PF Working and Ration Card now use **Case Review & Quotes**. Sales uploads documents and chooses **Submit to back office**. Back office reviews the files, requests corrections if necessary, and sends a final total with a pricing explanation. Sales receives an in-app notification and a payment link for that exact amount. Verified payment unlocks normal assignment and processing. Sent quotes are immutable, including when checkout expires; existing cases and payment orders keep their original flow and amounts.

Pricing contains five Food License durations (1?5 years) and three Caste Validity purposes (Job, Education, Election), each with its own salesperson price. Select the corresponding request type at intake. Set the prices under **Pricing** before accepting these requests. The existing global test-pricing setting still applies unless a salesperson price is configured; approved case quotes always use the actual quoted total.

Run `npm run migrate:case-pricing` once against an existing cloud database before deploying this version. This adds options without changing legacy case IDs, payments, or existing prices. Set `MAIN_BRANCH_PASSWORD` only when applying the one-time Mahalaxmi account rename to Success Online Main Branch and login 7447707277. The migration hashes the supplied password, checks login conflicts, and uses a completion marker so reruns do not reset credentials. Deploy/restart the application code to activate the new screens and workflow.


### Staff administration and saved uploads

Admins can edit staff names, login numbers/usernames and passwords from Employees, deactivate/reactivate accounts, or delete a sales/back-office account. Account changes invalidate existing sessions. Deletion disables login and removes the staff member from account management while preserving case ownership, payments and audit history. Admin accounts cannot be changed through these staff controls.

Incomplete quote intakes remain visible to their salesperson under Case Review & Quotes, with saved-file counts and controls to reselect missing files. Back office receives the case only after all selected uploads are confirmed and sales submits it for review. Back-office remarks and mandatory pricing remarks are visible to sales alongside the quoted payment request. Ordinary unpaid cases and their document previews/downloads are unavailable to back office until payment is confirmed (the existing main-branch recorded cash workflow is preserved).


### Repeatable release verification

`node --test tests/service-lifecycle.test.js` creates an isolated database and completes every service and pricing variant, including simulated receiving-account verification, correction/reupload, final document return and ZIP download.

After deployment, maintainers can run `node scripts/verify-live-workflows.js https://success-online.vercel.app --create-test --simulate-payments` using the private configured database, server signing secret and staff logins. The script creates signed, clearly labelled synthetic Caste Validity, PF and Ration Card cases, checks staff administration, and completes the workflows using temporary `acceptance_test` receipts. No bank reference is invented and no money is transferred. These receipts are excluded from financial reports and payment collections, and the signed cases never sync to Sheets. The script removes its temporary receipts and active test cases and writes a JSON report in `deliverables/`. No public endpoint grants a payment bypass, and ordinary clients cannot authorize a synthetic case.

Deleting a back-office employee releases unfinished cases for another employee to claim while preserving their current work stage and history.
