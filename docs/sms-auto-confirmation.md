# Owner-authorized automatic SMS confirmation

Enabled on 17 November 2026 at the owner's explicit request. Set `SMS_AUTO_CONFIRM=true` to enable; set it to `false` and redeploy to restore manual-only confirmation. This accepts authenticated merchant-phone SMS as the business's confirmation evidence. It does not provide a bank-status API or bank-statement reconciliation.

## Customer flow

1. Open the website checkout and pay to its existing Kotak receiver.
2. Enter the actual 12-digit RRN from the payment. The SMS does not include a website case number, so the reference is required to identify the right checkout; amount alone is never enough.
3. The merchant phone forwards the Worldline SMS. If the SMS came first, reference submission can use it immediately. If it arrives afterward, the authenticated intake reconciles it automatically.
4. Checkout checks status every 2.5 seconds while the reference is pending. On `PAID`, it displays the green success tick and receipt without an admin click.
5. The server immediately recalculates the case. Complete documents move it to `Ready for Assignment`; missing documents keep it at `Awaiting Documents` with payment paid.

The polling `/check` endpoint can reconcile an already-received alert, but a browser callback, request body claiming success, or checkout button cannot itself approve a payment.

## Required match

- Detector enabled, configured receiver activated, and valid merchant-phone signature.
- Exact Worldline sender/credit format and configured receiver. Supported BQR references are the configured fixed token, ICI + 32 lowercase hex, and T + 22 digits; reference tokens and payer handles are metadata.
- Exact RRN and integer-paise amount.
- A submitted reference with no conflicting pending/paid/refunded claim or previously assigned verified RRN.
- Credit timestamp within the order window (one minute of start tolerance and five minutes of late-arrival tolerance).
- Case not deleted, cancelled, rejected, closed or delivered.
- For a combined checkout: one batch identity, exact total, every allocation present/pending, correct receiver, and no conflicting case payments. The one RRN is reserved against one leader payment, with all allocations committed atomically.
- For balance UPI: the amount must still fit the remaining cash-plan balance. Physical cash retains its existing admin receipt confirmation.

Ambiguous claims, wrong amounts, wrong receiver, stale alerts and unavailable evidence remain pending. No automatic amount-only attribution is attempted.

## Ledger and recovery

Approval reserves `verified_upi_refs`, sets payment/batch statuses and verified timestamps, writes `auto_verify_sms` attempts and audit events under `system:worldline-sms`, and recomputes case states in the same transaction. Payment mutations use the existing PostgreSQL transaction advisory lock; SMS intake takes it before the SMS-specific lock to keep lock order consistent. Retried SMS cannot double-count receipts or approvals. Sheets work is queued after the financial commit.

The original admin verification API remains a recovery path for exceptions, while the normal automatic UPI checkout hides the admin-confirm step. This setting does not automatically approve cash receipts or bulk-mark historical payments paid.

## Validation

`tests/sms-auto-confirm.test.js` uses isolated synthetic databases to cover reference-before-SMS and SMS-before-reference, signature tampering, amount-only alerts, wrong amount, duplicate RRN claims, replay, old transactions, cancelled cases, missing-document gating, batch totals, receipts and cross-sales access.

`tests/automatic-payment-preview.mjs` checks mobile/desktop status polling, the success tick, receipt display and removal of the normal admin-confirm UI. No live synthetic payment is inserted into the production database for this verification.

Merchant app `0.4-pilot` understands both confirmation modes. Updating it over the installed app preserves its encrypted pairing. Existing `0.3` upload packets remain compatible, but its old connection-status wording may be inaccurate; use the updated APK for clear status messages. Do not uninstall/re-enroll an already-paired phone.
