# Direct UPI payments

The existing Node HTTP API and plain JavaScript staff interface collect direct UPI payments, without a gateway. SQLite is supported locally; Supabase PostgreSQL remains the Vercel primary database. Existing customers, cases, uploads, employee roles and Google integrations are retained.

## Receiver and release requirements

`payments.js:paymentConfig()` centralizes the receiver: SUCCESS ONLINE SERVICES, `7558548187-3@ybl`, mobile `+91 7558548187`, INR. The displayed payee name does not establish bank ownership. Checkout is disabled until an administrator attests to the actual receiving account.

1. Back up the existing database. Run `npm run build` and `npm run migrate` with the intended database configured privately. `migrate` adds the new tables, seeds the existing service catalog and preserves pricing; it does not change staff credentials. Avoid `setup:supabase` solely for this upgrade: that broader command also configures initial staff accounts and storage buckets.
2. Run the new application against that database in a controlled environment. Sign in as an administrator and open Payments → Receiver & service pricing.
3. Confirm that the configured UPI account belongs to the business, then click **Enable UPI checkout**. A setup test payment, received test UTR and receiving-account evidence are no longer mandatory. Activation records the administrator, time and owner declaration; it does not claim that a bank transfer was tested or received. Existing confirmations from the optional test-transfer procedure remain valid.
4. Run `npm run check:payments-release`. It accepts owner-authorized activation or a recorded test-transfer confirmation for this exact receiver. Changing the receiver in server configuration invalidates the activation.
5. Deploy through the existing Vercel workflow. Customer transfers still require individual receiving-account verification. App launches and actual money transfers must not be inferred from successful setup or automated checks.

`TEST_PRICING_MODE=true` is the default. It is **not a bank sandbox**: customer transfers move real money. Legacy `PAYMENT_MODE=demo` and gateway placeholder variables are ignored. Old simulated payment records remain stored but cannot unlock processing or count as actual revenue. The business owner's request to start payments replaces the earlier mandatory setup-transfer requirement.

## Prices

Every active service and newly created service resolves to exactly 100 paise while test pricing is enabled, including official-fee and tax components in the total. The repository currently configures 15 services; services such as GST or Aadhaar that are not in this catalog have not been added or invented.

Admins can save standard service charges in Payments → Receiver & service pricing. Form prices are rupees; database/API amounts are integer paise. Disable test pricing to use those charges plus the saved original official fees and tax rates. The original service charge and fee/tax snapshot remain in `service_prices.original_price` and `original_config`. To restore an original service charge, enter that displayed original value; zero-priced services require a positive standard price before creating a payable order. No individual frontend price is trusted.

All new orders fetch the service price from the database. An order permanently retains its amount. Changing pricing settings does not reprice existing orders or receipts. New variants added by migrations should be registered with `preserveServicePrices()` (called during normal setup).

## Staff workflow and security

Intake creates a pending payment order linked to the case; successful document uploads open checkout. Reopening an active order reuses it. Reopening after expiry/cancellation/rejection creates another order, preserving the previous record and all attempt events. The first-party order ID and UTR are separate.

App initiation changes only `PENDING` to `INITIATED`. A format-valid 12-digit UTR changes the order to `AWAITING_VERIFICATION`. A sales employee cannot verify it. Admin verification requires all five receiving-account checks and notes; only then does the server store `PAID`, a verifier and timestamp, and allow a verified receipt. The old demo verification endpoint always rejects requests.

Database transactions, PostgreSQL case locks, unique UTR reservations and a unique paid-order-per-case index protect concurrent verification. Repeating verification of the same paid order is idempotent. Refunded UTR reservations remain assigned and cannot be recycled. Verification, rejection, pricing, receiver confirmation, expiry and processing exceptions are audited. Attempt events preserve historical UTR submissions even if the current claim changes.

Cases stay visible while awaiting payment. Every forward processing action checks the actual payment records rather than trusting cached case state. Administrators may record an exception reason in the case drawer; the exception authorizes work but never counts as payment or revenue. Required documents remain mandatory.

The supported payment statuses are `PENDING`, `INITIATED`, `AWAITING_VERIFICATION`, `PAID`, `FAILED`, `CANCELLED`, `EXPIRED`, `REFUNDED`. Rejection establishes a failed claim with an admin reason. A refund API action requires an admin to confirm a completed refund and record its reference; it does not send money. Expiry is 30 minutes and checked on order access/initiation. Cancelled and expired orders accept late UTR claims for reconciliation. Website expiry/cancellation cannot stop an already-issued UPI transfer.

## App linking and QR

The QR and generic link encode the identical server-generated `upi://pay` URI. They include the configured recipient, amount, INR, service description and order ID in `tn`. `tr` is deliberately omitted because support for this receiving account has not been confirmed. QR images use the `qrcode` library, black on white, four-module margins, and no logos or external QR service.

The owner confirmed that this receiver is a **personal PhonePe UPI ID**. `paymentConfig().accountType` records that configuration. App selection therefore shows direct-payment instructions, records only a manual initiation and does not launch merchant-style payment links. Copy the configured UPI ID, open the selected app yourself, enter the exact amount and submit the actual UTR afterwards. The dynamic QR remains available; its bank acceptance still needs physical testing. The generic URI is available to copy, but acceptance is not guaranteed. No merchant category, signed intent or merchant registration is fabricated.

Google Pay's [official integration prerequisites](https://developers.google.com/pay/india/api/android/overview) require a verified merchant and bank-provided integration details. Registering a merchant account and supplying its authorized details is necessary before adding a validated merchant-intent flow. Merely changing `accountType` does not complete that integration. Returning to the site never verifies a payment.

App-specific launches, merchant acceptance, account resolution, bank transfers and QR scanning in actual UPI apps **have not been tested on physical devices**. The QR was decoded programmatically to verify its full URI, which is not evidence of bank acceptance.

If Google Pay opens with the correct recipient and amount but rejects the website-linked payment, compare a direct in-app payment to the same UPI ID. A working direct transfer does not establish that the account accepts merchant intents. Google's [merchant request requirements](https://developers.google.com/pay/india/api/web/create-payment-method) include bank-issued merchant category information and a unique transaction reference; those details must not be invented. The checkout includes **Pay directly in my UPI app** as a fallback: copy the configured ID, enter the exact order amount inside the app, then submit the actual UTR. This records only a manual initiation and never automatically verifies payment. A working fallback is not proof that the rejected app-specific link has been fixed.

## Google Sheets and reports

The existing server Google OAuth integration mirrors records into Payments, Payment History, All Cases and Cashflow. No additional connector authorization is needed. Payment and event rows use immutable internal IDs. Cashflow uses the payment ID for new UPI entries; legacy references are preserved. Only verified collections count as revenue. Refunds update the same cashflow row to `REFUNDED`, which daily reports exclude. The Payments tab lists unverified claims separately. Existing case/service/employee collection reports use `PAID` records and exclude demo payments.

Copy the regenerated `google-apps-script/Code.gs` into the existing workbook and run setup. `rebuildDailyReport` counts verified cashflow rows and excludes demo/refunded rows; it does not verify money. Sync failures retain database records and failed jobs. Use the admin Payments retry control after reconnection, or POST `/api/payments-sync`, to retry pending/failed jobs without changing payment status. On Vercel, retry requires an explicit invocation; no durable background scheduler has been provisioned. Keep the spreadsheet access restricted because it contains customer data.

## Validation

`npm run build` checks source syntax, regenerates deployment schema/client/Apps Script, and runs the test suite. Tests use isolated SQLite and PostgreSQL fixtures with synthetic customer and receiving-account data, never the production database or actual transfers. Coverage includes pricing for all 15 catalog services, URI/QR identity, authentication and ownership, invalid UTRs, missing admin checks, duplicate/concurrent verification, order retries, cancelled/expired late claims, receipts, refunds, report totals, document gates and Google failure/recovery.

Run `node tests/payments-preview.mjs` for browser acceptance at desktop and mobile widths. Screenshots are saved under `deliverables/payments-preview`.

Before customer use, complete these physical checks after receiver confirmation: pay ₹1 for each active service; open Google Pay, PhonePe, Paytm, BHIM and the generic chooser on supported Android browsers; test supported iOS linking and the QR fallback; test absent apps, denied permissions, cancellations and app closure; scan the QR on mobile and desktop with multiple UPI apps; confirm amount and actual account each time. Submit the UTR, verify against receiving records, and check that sales/back-office state, admin totals, receipts and Sheets agree. Reject missing/wrong-amount/wrong-recipient claims. Do not classify a launch or test fixture as a successful bank payment.
