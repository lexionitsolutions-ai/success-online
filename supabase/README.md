# Supabase + Vercel setup

The website and API run on Vercel. Supabase PostgreSQL stores employee accounts,
customers, cases, payments, audit records, upload authorizations and settings.
Supabase Storage holds private documents and temporary download ZIPs. Google Drive
can remain enabled as a document mirror; Google Sheets remains a reporting mirror.
Staff sign in through the application's existing accounts, not Supabase Auth.

## 1. Create the Supabase project

Create a project in your Supabase dashboard, choose a region close to your users,
and save its database password privately. Wait for provisioning to finish.

From **Connect**, copy the **Transaction pooler** PostgreSQL URI, using port 6543.
Replace its password placeholder with your database password. URL-encode special
characters in that password. Do not use the public project URL as DATABASE_URL.

From project settings, copy the project URL and a **server secret API key**
(`sb_secret_...`, or a legacy `service_role` key). Never place this key in browser
code, a NEXT_PUBLIC variable, a screenshot or a Git commit.

Official reference: https://supabase.com/docs/guides/database/connecting-to-postgres

## 2. Configure private local environment variables

Copy `.env.example` to `.env`. Keep the existing Google settings if you need them.
Set:

```dotenv
DATABASE_URL=postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@YOUR_POOLER_HOST:6543/postgres
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=case-documents
SUPABASE_DOWNLOAD_BUCKET=case-downloads
SUPABASE_DOWNLOAD_MAX_BYTES=50000000
INITIAL_ADMIN_USERNAME=owner
INITIAL_ADMIN_PASSWORD=YOUR_UNIQUE_PASSWORD_AT_LEAST_10_CHARACTERS
INITIAL_ADMIN_NAME=Administrator
INITIAL_SALES_USERNAME=
INITIAL_SALES_PASSWORD=
INITIAL_BACKOFFICE_USERNAME=
INITIAL_BACKOFFICE_PASSWORD=
SESSION_SECRET=YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
PAYMENT_MODE=demo
DRIVE_MODE=demo
SHEETS_MODE=demo
```

The app verifies TLS for PostgreSQL connections. Use the pooler hostname exactly
as shown in Supabase's Connect dialog. If Node reports a self-signed certificate
chain, open Supabase **Database → Settings** and download the **SSL root
certificate**. Save it as `supabase-ca.crt` in your project folder and add
`DATABASE_CA_CERT_PATH=./supabase-ca.crt` to `.env`. The app accepts PEM and DER
certificate downloads. On Vercel, set `DATABASE_CA_CERT` to the certificate's PEM
contents, including the BEGIN/END lines, instead of using a local file path.
Certificate files are excluded from Git. Verification remains enabled.

## 3. Initialize a fresh database

From the project folder, run:

```powershell
npm.cmd ci
npm.cmd run setup:supabase
```

The command creates the schema, indexes, 15-service catalog, your initial
administrator, and two private Storage buckets. It can be rerun without deleting
application records. Explicit setup creates or updates the credentials for the
accounts configured in INITIAL_ADMIN_*, INITIAL_SALES_* and INITIAL_BACKOFFICE_*.
Passwords must be at least 10 characters. A phone number can be used as a username.
Leave the optional staff pairs empty if you want to create staff accounts from
the admin Employees tab instead. Ordinary app startup never resets passwords.

Row Level Security is enabled on every application table. Browser `anon` and
Supabase `authenticated` roles have no table access. The backend connects with
the privileged PostgreSQL pooler connection, validates the staff session and
applies the application's role checks. Do not add public RLS policies.

The document bucket is limited to 10 MB PDF/JPG/PNG files. The separate download
bucket supports generated ZIPs up to 50 MB by default, compatible with Supabase's
Free plan limit. Larger bundles return a message to download documents individually.
If your project's global Storage limit differs, set SUPABASE_DOWNLOAD_MAX_BYTES
to a supported limit in both local setup and Vercel, then rerun setup. Bucket
limits cannot exceed the project's global limit. Uploads use short-lived signed authorizations;
the backend validates the stored bytes before completing a document record.
Downloads pass the application's access checks and redirect to a signed URL
valid for two minutes. The server key never goes to the browser.

## 4. Optional: preserve the existing SQLite data

Skip this section if you want to start with an empty customer/case database.

Use a new Supabase project with empty application tables. Before importing, create
the two **private** Storage buckets in the Supabase dashboard with the names and
limits above. Set `SQLITE_IMPORT_PATH` to the SQLite file to preserve. Keep the
local documents in their existing paths. Set the initial administrator variables.
Then run:

```powershell
npm.cmd run import:supabase
npm.cmd run setup:supabase
```

The importer creates the SQL schema, copies records, uploads local document bytes
to private Storage, preserves Drive document references, and initializes case
number counters. It refuses to overwrite nonempty application tables. Record
imports are transactional; if an import fails after files were uploaded, those
unreferenced Storage objects may need cleanup before retrying.

Accounts still using the published demo password are disabled. The configured
administrator is created or updated with your chosen password. Google secrets
are not copied from the old settings table; configure them through environment
variables and reconnect Google after hosting. Back up SQLite and local documents
before starting, and keep that backup until hosted verification is complete.

## 5. Deploy the GitHub repository on Vercel

The production deployment is available at https://success-online.vercel.app.
API functions are pinned to Sydney (`syd1`), matching the current Supabase
project's Sydney (`ap-southeast-2`) region to reduce database round-trip latency.
The Vercel project is connected to the GitHub repository. For CLI maintenance,
link the folder with `vercel link`, then use
`node scripts/configure-vercel-env.js https://success-online.vercel.app` to
transfer the private local server settings to Production. Secret values are sent
through stdin and not printed. The local certificate is converted to PEM for
the Vercel environment. The script does not transfer initial login passwords.
Use `node scripts/verify-hosted.js https://success-online.vercel.app` to check
the hosted API and configured staff logins without displaying credentials.
The `.vercelignore` file excludes local credentials, certificates and client data.

1. Import `lexionitsolutions-ai/success-online` into Vercel.
2. Use **Other** as the framework, **Node.js 24**, build command `npm run build`,
   and output directory `public`. The committed `vercel.json` routes `/api/*` to
   the Node API. Do not run the legacy `configure-vercel.js` proxy generator for
   this setup.
3. In Vercel **Settings → Environment Variables**, add DATABASE_URL, SUPABASE_URL,
   SUPABASE_SECRET_KEY, both bucket names, SESSION_SECRET, PAYMENT_MODE,
   DRIVE_MODE and SHEETS_MODE. Put them in the Production environment. Do not
   expose database credentials to the frontend.
4. Set `APP_ORIGIN` to the exact production website URL, including `https://` and
   no trailing slash. If needed, deploy once to get the URL, add APP_ORIGIN, then
   redeploy. Do not point Preview deployments at production data; use a separate
   test Supabase project for previews.
5. Deploy/redeploy. Initial admin credentials are only needed for the local setup
   command and do not need to be added to Vercel.
6. Open `/api/health`, then sign in with your configured administrator.

The build runs isolated SQLite and PostgreSQL tests; it does not connect to or
initialize the production database. Runtime initialization reads existing settings
and does not seed demo accounts or rewrite the production service catalog.

## 6. Connect Google services if required

If Google reports `redirect_uri_mismatch`, open the OAuth client used by this app
in Google Cloud and add this exact Authorized redirect URI (no trailing slash):

`https://success-online.vercel.app/api/google/oauth/callback`

Save, then return to Business analytics and click Connect/Reconnect Google Drive.
The admin page displays the callback URL and a link to the configured OAuth
client. `node scripts/check-google-connection.js https://success-online.vercel.app`
can inspect the requested callback without printing secrets or authorization state.
When Supabase Storage is enabled, expired Google authorization does not block
case intake or document uploads. Google copy failures are recorded as sync failures;
the primary document remains stored privately in Supabase.

On Vercel configure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
GOOGLE_ROOT_FOLDER_ID and GOOGLE_OPERATIONS_SPREADSHEET_ID privately. Add
`https://YOUR_SITE/api/google/oauth/callback` as an authorized redirect URI in
Google Cloud. Use Business analytics to connect Drive, then the existing Sheets
activation endpoint/setup flow to activate Sheets. The backend saves refreshed
OAuth settings in PostgreSQL and reloads them on subsequent requests.

Copy `google-apps-script/Code.gs` into Apps Script and run
`setupSuccessOnlineWorkbook` if setting up the report workbook manually.
Supabase works without Google integration: documents remain private in Storage.

## 7. Hosted acceptance checks

- Create one sales and one back-office employee and test each login.
- Create a synthetic case, upload all required documents, and check the loaders.
- Test a file larger than 4.5 MB: file bytes go directly to Storage, not through
  a Vercel Function request body.
- Test a failed upload and retry; required documents and pending uploads gate
  payment/progression. Finalization retries do not duplicate documents.
- Check that another sales employee cannot read or download the case.
- Download an individual file and all files as a ZIP to a chosen save location.
- Complete the back-office flow, upload the received document, and submit it.
- Review employee performance over preset and custom periods.
- Redeploy Vercel and verify that employee accounts, cases and documents persist.

Payments remain simulated until a real payment gateway adapter is implemented.

## Maintenance

Run `npm.cmd run cleanup:storage` from a trusted environment with the server-only
variables to remove expired staging uploads and download bundles older than a
day. Schedule this command daily using a trusted external runner; normal case
documents are never deleted by this cleanup. Keep database and document backups
appropriate to your business retention policy.

No real Supabase project credentials are included in the repository. Hosted
connection and Google OAuth verification must be completed with your project.
