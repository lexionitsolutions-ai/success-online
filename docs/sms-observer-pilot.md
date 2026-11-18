# Success Online merchant-phone SMS confirmation

Prepared update (17 November 2026, APK 0.6; production rollout still required)

Automatic confirmation is enabled on the hosted app. A credit must arrive from an authenticated enrolled merchant phone, match the submitted 12-digit RRN and exact paise amount, configured receiver and checkout time window. Duplicate references cannot credit twice. Ambiguous claims, unsupported alerts and amount mismatches stay pending. Complete documents allow a confirmed case to move to Ready for Assignment. Combined batches require an exact batch-total match. Cash remains manual. SMS confirmation authenticates the reporting phone; it is not a bank API or settlement reconciliation.

The original implementation incorrectly assumed the BQR-UPI token was a fixed merchant terminal. The actual Rs100 alert uses ICI followed by 32 lowercase hexadecimal characters. The original 2695306A token, ICI followed by 32 lowercase hexadecimal characters, and the newly observed T followed by exactly 22 digits are accepted; the token is retained in the historical terminal_id column as metadata and is never used as proof of merchant identity. The VPA in the SMS is also metadata, not a replacement for the configured Kotak QR. Sender header root WLITXS-S is required; carrier prefixes may vary.

APK 0.5 adds explicit recovery of received Worldline SMS from the last 24 hours. The operator must tap Recover, accept the explanation and grant READ_SMS. Only matching credit alerts are queued; other messages stay on the phone. New alerts use RECEIVE_SMS. Queues and device credentials are encrypted using Android Keystore. Recovery and Send pending alerts now flush the queue while the screen is open, with persisted network jobs for retry. Authenticated upload, receipt validation and server-side replay protection remain required.

For Sandesh SO-2026-000055 the submitted RRN is 632149985208, amount Rs100, credit timestamp 17 November 2026 14:37:32 IST. At diagnosis the phone had permission but had uploaded zero observations. Do not manually inject a copied SMS or mark paid based solely on text. Install the update over the existing merchant-phone app, preserve its encrypted pairing and recover the original SMS. Do not request another payment. A separate duplicate transfer has a separate RRN and requires reconciliation.

## Installation and recovery

1. Share only deliverables/Success-Online-Kotak-Phone/Success-Online-Kotak-SMS.apk to the already-paired merchant phone.
2. Choose Update. Do not uninstall or clear data: the single-use pairing was already consumed.
3. Open Version 0.6, check the server connection, tap Recover Worldline SMS ? last 24 hours, and allow SMS access.
4. Check Server response 200 and Pending alerts 0; then open the existing website payment.
5. Leave incoming SMS permission and background activity allowed, and keep the phone online.

Keys, APK build artifacts and merchant pairing files are private and Git-ignored under deliverables. Never share signing-key text files, enrollment JSON or APK signing material. Keep Play Protect enabled; installation restrictions require an approved distribution or supervised developer route. The OPPO test phone is not the merchant device and its legacy credentials are revoked.

## Validation

The Node build passes 141 tests, including signed SMS ingestion, the exact new alert format, automatic confirmation for the variable ICI reference, duplicate protection, amount mismatches, conflicting claims, timing and batch totals. A pure Java filter regression harness covers both observed formats and rejected unrelated senders/debits/malformed references. The version 0.6 APK includes the updated filter and verifies its signature. Merchant-phone installation, inbox recovery and actual credit confirmation require the operator to run the update; they are not established by compilation or test fixtures.

## QR and app references (0.6)

The owner supplied two Rs100.18 credits on 17 November 2026: QR at 16:31:19 IST (RRN 437047702379, reference T2611171631153817279676, handle @axl), and PhonePe at 16:28:09 IST (RRN 655189709258, reference T2611171628050335728295, handle @ybl). Both previous phone and server filters rejected the T reference. Version 0.6 accepts it in incoming capture, inbox recovery and server ingestion. Deploy the updated server and update the already-paired phone, then recover the original alerts. Pasted text is only a regression fixture and has not approved these actual payments.

App names and VPA handles are not proof of payment. QR, PhonePe, Google Pay, Paytm, BHIM, Other UPI App and Manual UPI all require the same authenticated Worldline credit evidence. Valid new VPA handles do not need a new allowlist entry. Unsupported SMS formats/senders still require investigation with the original received alert.

| Scenario | Condition / result |
| --- | --- |
| Exact submitted RRN | Exact expected paise, receiver and checkout window; only one eligible claim approves |
| No submitted RRN | Unique-amount mode must be enabled; exactly one reserved payable amount within its reservation window may be claimed |
| Paise adjustment | Match the shown payable amount including adjustment; retain the base service price in accounting |
| Different UPI app or handle | Same evidence and matching rules; no app callback can approve |
| Second transfer for a paid checkout | Original RRN stays assigned; extra credit needs separate reconciliation |
| Duplicate SMS / inbox recovery | Same RRN is idempotent; conflicting data is rejected |
| Same amount, ambiguous checkouts or claims | No automatic approval |
| Wrong amount, old/future alert, expired window | No automatic approval |
| Pending, failed, debit, refund or unsupported alert | Rejected by credit format filter |
| Missing documents | Payment may confirm; case stays Awaiting Documents |
| Cancelled/deleted/closed case | No automatic approval |
| Batch or balance UPI | Existing exact-total, allocation and remaining-balance checks apply |

Trailing ordinary/nonbreaking whitespace and encoded space entities are normalized in both filters. Unknown reference shapes remain unsupported. Regression tests exercise both exact owner messages, supported methods, representative bank handles, malformed references, replay and mismatches; actual merchant-device operation still requires installation and recovery.
