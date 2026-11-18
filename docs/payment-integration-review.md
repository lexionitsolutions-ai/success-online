# YOUPI integration review — 16 November 2026

## Finding

The supplied source can observe payment notifications without subscribing to a conventional gateway. It cannot independently approve a UPI transfer or query NPCI using only a QR code or UTR. It records evidence about an already initiated payment. Final statement reconciliation in this fork requires an operator-imported CSV; it is not an authenticated live bank feed.

This was a static review of the payment-critical source paths, supplied archives/demo and test logs, compared with Success Online's existing payment implementation. No supplied install script or APK was executed. No live payment was made, no credentials were accessed, and no payment code was changed or deployed.

## Material reviewed

Source: `C:/Users/Raj/Payment Get Way Code/youpi-pg`.

- Payment API creation, checkout observer-health gates and observer intake routes.
- Android device enrollment, notification/SMS permissions and signing flow.
- Gmail OAuth and polling implementation.
- Verification pipeline, attribution engine, state-machine helpers and receiving-account repository.
- Bank-statement CSV parser, reconciliation engine and import endpoint.
- Webhook payload construction, signatures, outbox and retry logic.
- Package engine/license declarations, configuration guide and security audit.
- All supplied test logs and PR description.
- Both archive file listings and the extracted `upi-ten-demo/dist/app.js`.
- Success Online's `payments.js`, payment batch/cash boundaries and Vercel configuration.

The repository documents contain integration examples and instructions. They were evaluated as claims about the supplied code, not treated as authorization to change Success Online. Some older examples describe `SUCCESS` as authoritative, while the reviewed runtime explicitly distinguishes observation from reconciliation.

## How it works

1. A merchant and receiving UPI account are configured.
2. A server creates a payment session for a known order and exact amount.
3. The gateway serializes active payment slots on the receiving account to reduce attribution ambiguity. Customers may have to wait.
4. Checkout displays a UPI intent/QR. The customer authorizes the payment in their own UPI app.
5. An Android observer, Google Messages observer or Gmail observer reads incoming merchant/bank alerts and submits evidence to the gateway.
6. The pipeline checks source, credit wording, amount, reference, timing, account/session context and duplicate references. Ambiguous cases are held rather than selected arbitrarily.
7. An alert match produces `OBSERVED_SUCCESS`, with `settlementState: NOT_RECONCILED`. A second alert source can strengthen observation but does not turn it into bank reconciliation.
8. An admin imports a downloaded bank statement. The reconciler requires a matching receiving account, amount, 12-digit reference and posting window for an observed session. A match produces `RECONCILED`.
9. Signed webhooks notify the merchant application. An HMAC authenticates the gateway sender and payload; it does not independently authenticate a bank credit.

Runtime evidence:

- `apps/payment-api/src/routes/checkout.routes.js`: outside tests, new UPI sessions require a healthy SMS/Android observer; Gmail alone is insufficient.
- `packages/core/src/attribution-engine.js`: emits `PAYMENT.OBSERVED_SUCCESS`.
- `packages/core/src/state-machine.js`: separates `OBSERVED_SUCCESS`, `RECONCILED`, and generic `SUCCESS` settlement meanings.
- `apps/payment-api/src/routes/statement.routes.js`: authenticated operator import; explicitly no timer or bank-feed client.
- `packages/core/src/statement-parser.js`: supports HDFC-style and compatible credit-column CSVs; actual Kotak exports require format validation.
- `packages/core/src/webhook-engine.js`: signs the raw body, also provides a timestamp-bound V2 signature and stable delivery IDs for retries.

Generic `SUCCESS` is also used for non-UPI methods, including COD, which does not mean payment was received. Success Online must not use that generic event as a paid trigger.

## The two receiving addresses differ

Success Online configures `0791934A0195602.bqr@kotak`, payee `SUCCESS ONLINE SERVICES`.

The supplied static demo configures `9545405777@okbizaxis`. Its app buttons open UPI apps, and its “paid” button only displays “Awaiting bank verification.” It contains no automatic verification backend. Neither archive listing contains a payment backend.

The intended receiving account must be confirmed before integration. Copying the demo unchanged would direct its payments to a different address.

## Credentials and setup requirements

### Observer-assisted pilot using this source

| Item | Required information or access | Handling |
| --- | --- | --- |
| Receiver | Confirmed merchant VPA, payee name, QR issuer and merchant/account mapping | Public receiving details; confirm ownership separately |
| Alert channel | Android phone receiving the merchant's bank SMS or merchant-app notifications, internet connectivity and background operation | Owner grants notification/SMS permissions locally |
| Sample evidence | Redacted genuine incoming-credit SMS/notification showing sender/package, amount, timestamp and UTR structure | Exclude OTPs, balances and unrelated personal content |
| Device pairing | Gateway URL, enrollment token, device ID and signing key | Generated by deployment/pairing; not a bank credential |
| Gateway identity | Merchant ID, receiving-account ID and merchant API/webhook secret | Generated in our deployment; server-side only |
| Service secrets | `ADMIN_API_TOKEN`, `OBSERVER_API_TOKEN`, `ANDROID_ENROLLMENT_SECRET`, `ENCRYPTION_MASTER_KEY`, `JWT_SECRET` | Generate new secrets; never reuse published/demo values |
| Hosting | Persistent server/container, durable database/backups and HTTPS endpoints reachable by the observer and Success Online | Current code uses SQLite and long-running workers; it is not a drop-in addition to Vercel functions |
| Reconciliation | Operator-downloaded merchant transaction report/bank CSV with per-payment reference and amount | Validate real export format before enabling reconciliation |

Optional Gmail channel: Google Cloud Gmail API enabled, OAuth client ID/client secret, registered redirect URI and the owner's OAuth consent. The flow obtains a refresh token. No Gmail password is needed. In this fork it supplements, rather than replaces, SMS observer health.

### Official bank-confirmed automation

Kotak publishes UPI callback and transaction-inquiry capabilities. Confirm with Kotak that the existing merchant QR/account can use them and obtain its current integration pack.

The exact credentials depend on the bank's provisioned API. Expected onboarding items include merchant/terminal identifiers, authorized merchant VPA/account mapping, sandbox and production endpoint details, bank-issued API authentication credentials, callback verification details, and any bank-required certificate/IP allowlist configuration. These are requirements to establish from the bank's actual specification, not credentials invented by the supplied repository.

Bank-issued secrets belong in deployment secret storage. A QR image, phone number, bank login password or UPI PIN is not a substitute for approved API access.

## Kotak settlement compatibility

Kotak's QR FAQ describes SMS, soundbox and kotak.biz notifications, and says standard QR collections settle to the registered current account on T+1, with other settlement options available.

Therefore we must establish whether this merchant receives one bank statement line per customer payment or consolidated settlement lines. If consolidated, a reconciler matching each customer's UTR directly against the bank statement may fail. A merchant collection report or official transaction-status API is needed for individual transaction confirmation; settlement reconciliation remains separate.

References checked:

- [Kotak UPI APIs](https://www.kotak.bank.in/en/open-banking/upi.html)
- [Kotak merchant QR FAQ](https://www.kotak.bank.in/en/get-help/qr-faqs.html)
- [NPCI UPI FAQ](https://www.npci.org.in/what-we-do/upi/faqs)

## Proposed Success Online integration

Keep existing pricing, quote approval, payment batches, cash instalments and document-release rules. Add a server-side adapter that maps each direct-UPI payment or batch to a gateway payment session; amounts and references must come from our database.

- `OBSERVED_SUCCESS`: show “Payment alert received — verification pending”; retain the unpaid/release gate.
- `MANUAL_REVIEW`: send to the existing admin review workflow.
- `RECONCILED` with `method: UPI`, `settlementState: RECONCILED`, expected order/session/account/currency/amount and a fresh, valid webhook signature: eligible for the verified-payment transition under the chosen reconciliation policy.
- Official bank success callback/status: eligible only after validating the bank's authentication and matching the expected transaction.
- COD/counter events and browser success events: never approve a direct-UPI payment.

Deduplicate both webhook delivery IDs and payment references. Commit payment state, reference ownership and batch allocations atomically. Retried events must not double-count collections, duplicate receipts or release documents twice. Keep existing admin verification as a recovery path.

Because a CSV import is trusted operator input, even a `RECONCILED` webhook from this source is only as trustworthy as the statement-import process. It does not become a bank-signed response.

## Cost, tests and limitations

“No gateway fee” is not a guarantee of zero total cost. Hosting, device connectivity and operations remain. The package declares `license: Commercial`; usage rights need confirmation rather than assuming an open-source license.

The supplied logs show 17 payment-verification tests passing, and the PR description reports 48 of 49 suite files passing with an existing Windows process-shutdown failure. The remaining-tests log reports 19 remaining suites passing. These are supplied test results, not fresh runs or live-bank certification. The PR description explicitly records no real payment/alert test and a Node version below the repository's declared minimum (`>=24.22.1`).

The supplied `SECURITY_AUDIT.md` labels the reviewed branch experimental and not approved for real-money production. No exhaustive dependency, APK binary, deployment or penetration audit was performed in this review.

Recommended next step: confirm the receiving QR and alert channel, validate redacted real notification/report formats, then build an isolated observer-assisted pilot. For immediate automatic paid status backed by the bank, obtain the official merchant transaction-status/callback integration first.
