# Atlas House

Marketing site for atlashouseng.com plus the referral-challenge tracking that sits on top of it.

## What it does

Each participant gets a link like `atlashouseng.com/go/ada`. Opening it logs the click and
forwards to WhatsApp with the message pre-filled as `Hi Atlas House! (ref: ADA)`, so an enquiry
is attributed to whoever sent it without anyone having to remember a name.

| Route | Who it's for |
| --- | --- |
| `/` | The public site |
| `/go/<code>` | Participants' shareable links |
| `/leaderboard` | Public standings, safe to post anywhere |
| `/admin` | Ops: roster, per-person messages, logging enquiries and bookings |

Clicks are counted by the server. Enquiries, bookings and nights are typed in by the ops manager
on `/admin`, because only a human can confirm that a stay was paid for and checked in.
Ranking is by bookings, then unique clicks as the tiebreak.

## Running it

```bash
npm install
cp .env.example .env   # then fill in ADMIN_PASSWORD, IP_SALT and the challenge dates
npm start
```

`npm run dev` restarts on file changes.

## Deploying

The site currently publishes through GitHub Pages, which serves static files only and **cannot run
this server**. To go live with tracking, deploy to a Node host (Render, Railway, Fly) and point the
`atlashouseng.com` DNS record there instead of at GitHub Pages.

Set the same variables from `.env.example` in the host's environment. Two that matter:

- `SITE_URL` must be the live origin, since every tracking link is built from it.
- `IP_SALT` must be set once and kept. It is what lets repeat clicks from one phone collapse into a
  single unique click; change it and everyone looks new again.

Attach a persistent disk mounted at `data/` — the roster, the click log and the ops ledger live
there as files, so an ephemeral filesystem loses them on every redeploy.

## Adding participants

Paste the contact list into the box on `/admin`, one name per line. The code defaults to the first
name, lowercased; write `Ada Obi, adaobi` to set it yourself. Codes are the thing people read
aloud, so keep them short and without numbers.

Each row then gives you a **Copy link** and a **Copy message** button. The message is the
announcement text with that person's own link already in it — send it individually, not as a
broadcast.

## During the week

The ops manager updates enquiries and bookings daily from the WhatsApp inbox. Response time is the
thing that decides whether any of this works: a tagged enquiry left for two hours is a lost booking,
and no amount of clicks makes up for it.

`/admin/export.csv` dumps the current standings if you want them in a spreadsheet or Notion.

## A note on the pre-filled message

WhatsApp lets the sender edit the pre-filled text before sending, so a few people will delete the
`(ref: CODE)` line. The click is still logged against them, so match those enquiries by hand when
the counts disagree.
