# Atlas House

Marketing site for atlashouseng.com, the referral challenge, and the internal booking system.

Node · Express · MongoDB.

## The two halves

**Public** — the marketing site plus the referral challenge. People sign themselves up, get their own
tracking link, and share it.

**Internal** (`/admin`, `/ops`) — bookings, inventory, guest records and reports. One password, no
guest logins. Guest self-booking is deliberately not built.

| Route | |
| --- | --- |
| `/` | The public site |
| `/join` · `/go/<code>` · `/me/<token>` | Referral signup, tracking links, referrer dashboards |
| `/leaderboard` · `/kit` · `/rules` | Public standings, share kit, terms |
| `/ops/bookings` | Availability, new bookings, payments, deposits |
| `/ops/calendar` | Today's arrivals, departures and in-house |
| `/ops/inventory` | Apartments, bedrooms, products |
| `/ops/records` | Photos and documents |
| `/ops/reports` | Occupancy, revenue, mix |
| `/admin` | Referral roster and nudges |

## How inventory works

**The bedroom is the unit of inventory**, not the apartment. Two counters — "N one-beds, M two-beds" —
cannot express a two-bed sold by the room, because the apartment and its bedrooms are the same
inventory counted twice.

So a booking holds specific bedrooms. Sell one bedroom of a two-bed and the system already knows the
other is still free and the whole apartment is not available, without any rule saying so. Apartments
have a `splittable` toggle: off means the whole place goes to one booking or not at all.

## Standard and Premium

Same apartments, different promise about backup power:

- **Standard** — inverter backup. AC does not run when the grid is down.
- **Premium** — generator backup. AC keeps running through an outage.

Because backup power is wired per apartment rather than per bedroom, selling one bedroom Premium and
the other Standard for the same nights is not physically possible. The system allows it but warns,
naming the other guest — you either run the generator for both or change the tier. It warns rather
than blocks so a deliberate special arrangement stays possible.

## Money

Type whatever the guest actually paid, including nothing. Part-payments are recorded individually and
the balance is derived. Products carry an optional reference rate — what you would normally charge —
which constrains nothing but lets reports show what was discounted.

Refundable deposits are tracked apart from the stay money so they never appear as revenue. A refund
is confirmed with an amount and a date, and refunding less than was held records the difference as
withheld.

## Records

Photos, documents, receipts and reviews, attached to a booking or an apartment.

Images are re-encoded on upload — a phone photo at 11MB lands as roughly 0.4MB, which is the
difference between a disk that lasts and one that does not. Re-encoding also strips EXIF, including
the GPS coordinates phones attach to photos.

Files live outside the web root and are served only through an authenticated route with `no-store`,
because guest IDs end up in here whatever the stated purpose, and a shared office browser should not
keep serving them after sign-out.

## Referral credit comes from real bookings

Log a booking with the referrer's code and credit follows automatically once the guest is marked
checked in. Nothing is entered twice. A booking whose guest phone matches a registered participant is
flagged as a possible self-referral — the payout would otherwise be a discount on their own bill.

## Running it

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI, ADMIN_PASSWORD, IP_SALT
npm start
```

You need a MongoDB instance. A free Atlas cluster is the easiest, and it gives you a replica set —
which matters, because overlap checks run in a transaction and a standalone `mongod` cannot do
transactions. Without one the server still books, but two people entering bookings at the same moment
could double-book a bedroom.

Preview the daily referral nudge without sending anything:

```bash
node src/reminders.js --dry-run
```

## Deploying

GitHub Pages cannot run this. It needs a Node host with:

- **A persistent disk for `UPLOAD_DIR`.** The database is remote; the photos are not.
- **An always-on instance.** Free tiers idle out, and an idle process never fires the reminder cron.
- **`IP_SALT` set once and kept.** Change it and every past visitor looks new.

Resend needs `atlashouseng.com` verified with DKIM/SPF before it will send.

## Data protection

Guest names, phone numbers, emails and any uploaded identity documents are personal data under
Nigeria's NDPA. The referral form takes explicit consent, the public leaderboard shows a first name
and an initial only, and everything else sits behind the admin password. Uploads marked sensitive are
flagged in the gallery. A retention policy for identity documents is still an open decision — scans
kept indefinitely are liability with no upside.

## Later

Customer communications — receipts, welcome and house rules, thank-you notes — are a deliberate next
phase, not an oversight.
