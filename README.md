# Atlas House

Marketing site for atlashouseng.com plus the referral challenge that runs on top of it.

## How it works

You share one invite link. People sign up themselves and each gets their own tracking link, so you
never set anyone up by hand.

```
/join  →  they fill in name, email, WhatsApp  →  they get atlashouseng.com/go/<their-handle>
       →  someone opens it  →  lands in your WhatsApp, tagged "(ref: THEIR-CODE)"
       →  you log the booking  →  leaderboard moves  →  daily email nudges everyone
```

| Route | Who it's for |
| --- | --- |
| `/` | The public site |
| `/join` | The invite link you share |
| `/go/<code>` | Participants' shareable links |
| `/me/<token>` | A participant's own stats, emailed to them |
| `/leaderboard` | Public standings, safe to post anywhere |
| `/kit` | Caption and photos for participants to share |
| `/rules` | The terms, stated publicly |
| `/admin` | Roster, bookings, payouts, reminders |

## Why clicks don't decide the winner

Click fraud can't be beaten technically — anyone can toggle airplane mode for a fresh IP, and click
farms are cheap. So the leaderboard ranks on **confirmed bookings**, which only exist because your
ops manager saw a guest pay and check in. Clicks are shown for credit but carry no ranking weight,
and saying so publicly removes most of the reason to fake them.

What the system does guard automatically:

- Repeat clicks from one device collapse into one per day
- Bot and link-preview traffic is logged but never counted
- A referrer's own device stops counting once they open their dashboard
- Signing up twice returns the original link instead of issuing a second code
- A booking whose guest phone matches a registered participant is flagged for review

## Running it

```bash
npm install
cp .env.example .env   # fill in ADMIN_PASSWORD, IP_SALT, dates, Resend key
npm start
```

`npm run dev` restarts on changes. Without `RESEND_API_KEY` the server still runs and logs the
emails it would have sent, which is what you want locally.

Preview the daily nudge without sending anything:

```bash
node src/reminders.js --dry-run
```

## Deploying

The site currently publishes through GitHub Pages, which serves static files only and **cannot run
this server**. Going live means deploying to a Node host (Render, Railway, Fly) and pointing
`atlashouseng.com` there instead.

Three things that will bite otherwise:

- **`DATA_DIR` must point at a persistent disk.** The SQLite database holds your participants. Left
  on the default path it is wiped on every redeploy.
- **Don't use a sleeping instance.** Free tiers idle out, and an idle process never fires the daily
  reminder cron. This needs an always-on instance.
- **`IP_SALT` is set once and kept.** It is what lets repeat clicks collapse; change it and every
  visitor looks new again.

Resend needs `atlashouseng.com` verified with its DKIM/SPF records before it will send anything.
Start that early — it doesn't conflict with your current DNS.

## During the week

Your ops manager works from `/admin`: log each booking once the guest has **paid and checked in**,
update enquiry counts, and mark payouts as they go out. Bookings carrying a red flag mean the guest's
number matches someone on the roster — worth a look before paying.

Response time on WhatsApp is what decides whether any of this works. A tagged enquiry left sitting
for two hours is a lost booking, and no volume of clicks makes up for it.

## A note on the pre-filled message

WhatsApp lets the sender edit the pre-filled text before sending, so some people will delete the
`(ref: CODE)` line. The click is still logged against them, so match those enquiries by hand when
the numbers disagree.

## Data

Names, emails and phone numbers are personal data under Nigeria's NDPA. The signup form takes
explicit consent, the public leaderboard shows first names and an initial only, and contact details
are visible only behind the admin password. Delete a record on request.
