# PayMongo online registration setup

RacePulse uses **PayMongo Hosted Checkout v2**. The app never receives a
PayMongo secret key. A runner gets a bib only after PayMongo sends the signed
`checkout_session.payment.paid` webhook to the Firebase backend.

## Before deploying

1. In the Firebase Console for `racepulseph`, upgrade the project to the
   **Blaze** plan. Cloud Functions requires a billing account. This is separate
   from PayMongo's account verification.
2. In the PayMongo dashboard, finish business verification and make sure the
   channels you want are enabled: GCash, Maya, QRPh, cards, etc.
3. Start in PayMongo **test mode**. Use test keys and a test payment before
   switching to live keys.

## Add the keys securely

Run these from the RacePulse project folder. Paste values only into your own
terminal prompt; never put them in `src/`, `.env`, Git, or chat.

```bash
firebase functions:secrets:set PAYMONGO_SECRET_KEY --project racepulseph
firebase functions:secrets:set PAYMONGO_WEBHOOK_SECRET --project racepulseph
```

For the first command use the PayMongo **test secret key** (`sk_test_...`).
After the webhook is created in the next step, PayMongo will show a signing
secret; use that for `PAYMONGO_WEBHOOK_SECRET`.

## Deploy

```bash
npm install --prefix functions
npm run build
firebase deploy --only functions,firestore:rules,hosting --project racepulseph
```

The payment endpoint will be:

```text
https://asia-southeast1-racepulseph.cloudfunctions.net/paymentsApi
```

## Create the PayMongo webhook

In the PayMongo dashboard, add this webhook URL:

```text
https://asia-southeast1-racepulseph.cloudfunctions.net/paymentsApi/webhooks/paymongo
```

Subscribe to this event:

```text
checkout_session.payment.paid
```

PayMongo test and live modes use separate webhook/signing-secret setups. Test
the complete flow first, then replace both Firebase secrets with the live
secret key and the live webhook signing secret before enabling a real race.

## Enable it for a race

1. Open **Organizer Dashboard → Race Setup**.
2. Set prices for the paid distance(s).
3. Turn on **Online payment**.
4. Choose whether the organizer absorbs PayMongo fees or the checkout passes
   the fees on to the runner.
5. Save the race.

Free distances continue using the normal registration flow. A paid runner is
sent to PayMongo Checkout, then RacePulse waits for the verified webhook before
showing the registration under **My Races**.

## Important operational notes

- Do not mark a runner paid manually in Firestore. Payment fields are locked
  from the browser by the Firestore rules.
- PayMongo's success page is not payment proof. If the webhook is late, the
  runner sees a short “verifying payment” status and can refresh safely.
- A pending Checkout is reusable for 30 minutes, avoiding duplicate sessions
  when a runner taps payment twice.
- Keep PayMongo dashboard access limited to the finance/admin team.
