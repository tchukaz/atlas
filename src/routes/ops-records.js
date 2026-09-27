import fs from 'node:fs';
import { Router } from 'express';
import { naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, pretty, todayIso } from '../views-ops.js';
import { requireAdmin } from '../auth.js';
import { Attachment, Booking, Property } from '../models.js';
import { calendarStrip, day, nightsBetween } from '../availability.js';
import { UploadRejected, diskUsage, filePath, remove, store, upload } from '../uploads.js';

const router = Router();
router.use('/ops', requireAdmin);

/* ── Today's board ─────────────────────────────────────────────────────── */

router.get('/ops/calendar', async (req, res) => {
  const on = req.query.on || todayIso();
  const target = day(on);
  const next = new Date(target.getTime() + 86_400_000);

  const [arrivals, departures, inHouse] = await Promise.all([
    Booking.find({
      checkIn: { $gte: target, $lt: next },
      status: { $in: ['confirmed', 'checked_in'] }
    })
      .populate({ path: 'rooms', populate: { path: 'property' } })
      .lean(),
    Booking.find({
      checkOut: { $gte: target, $lt: next },
      status: { $in: ['checked_in', 'checked_out', 'confirmed'] }
    })
      .populate({ path: 'rooms', populate: { path: 'property' } })
      .lean(),
    Booking.find({
      checkIn: { $lte: target },
      checkOut: { $gt: target },
      status: 'checked_in'
    })
      .populate({ path: 'rooms', populate: { path: 'property' } })
      .lean()
  ]);

  const where = (b) =>
    (b.rooms || []).map((r) => `${r.property?.name || '?'} · ${r.name}`).join(', ');

  const list = (rows, empty) =>
    rows.length
      ? rows
          .map((b) => {
            const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
            const due = Math.max(0, (b.quotedAmount || 0) - paid);
            return `<tr>
        <td data-h="Guest"><a href="/ops/bookings/${b._id}"><strong>${esc(b.guestName)}</strong></a><br/>
            <span class="muted" style="font-size:11px;">${esc(b.guestPhone || '')}</span></td>
        <td data-h="Where">${esc(where(b))}</td>
        <td data-h="Tier"><span class="pill ${b.tier === 'premium' ? 'on' : ''}">${b.tier}</span></td>
        <td data-h="Balance" class="num">${due ? `<span class="busy">${naira(due)} due</span>` : '<span class="free">settled</span>'}</td>
      </tr>`;
          })
          .join('')
      : `<tr><td colspan="4" class="muted" style="padding:18px 10px;">${empty}</td></tr>`;

  const table = (heading, rows, empty) => `
    <h2>${heading}</h2>
    <div class="card scroll">
      <table class="stack"><thead><tr><th>Guest</th><th>Where</th><th>Tier</th><th class="num">Balance</th></tr></thead>
      <tbody>${list(rows, empty)}</tbody></table>
    </div>`;

  const strip = await calendarStrip(target, 30);
  const dayCell = (d) =>
    `<div class="dcell"><span>${new Date(d).getUTCDate()}</span></div>`;

  const stripHtml = strip.rows.length
    ? `<div class="stripwrap">
      <table class="strip">
        <thead><tr><th class="rname"></th>${strip.days.map((d) => `<th>${dayCell(d)}</th>`).join('')}</tr></thead>
        <tbody>
          ${strip.rows
            .map(
              (row) => `<tr>
            <th class="rname">${esc(row.room.property?.name || '')}<br/>
              <span class="muted" style="font-weight:400;">${esc(row.room.name)}</span></th>
            ${row.cells
              .map(
                (c) =>
                  `<td class="${c.booking ? 'busy-cell' : 'free-cell'}"${
                    c.booking ? ` title="${esc(c.booking.guestName)} · ${c.booking.tier}"` : ''
                  }></td>`
              )
              .join('')}
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`
    : '<p class="muted">No bedrooms set up yet.</p>';

  res.type('html').send(
    page({
      title: 'Today',
      active: '/ops/calendar',
      ...flashOf(req),
      extraCss: `
        .stripwrap { overflow-x:auto; }
        .strip { border-collapse:collapse; font-size:11px; }
        .strip th, .strip td { border:1px solid rgba(245,240,232,0.08); padding:0; }
        .strip th.rname { text-align:left; padding:6px 10px; white-space:nowrap;
                          position:sticky; left:0; background:var(--dark); z-index:1;
                          font-size:11px; letter-spacing:0; text-transform:none; color:var(--cream); }
        .strip thead th { color:var(--muted); }
        .dcell { width:20px; text-align:center; padding:4px 0; }
        .free-cell { background:rgba(127,168,107,0.18); height:26px; min-width:20px; }
        .busy-cell { background:rgba(201,168,76,0.55); height:26px; min-width:20px; }
      `,
      body: `
  <div class="card">
    <form method="get" action="/ops/calendar" class="grid">
      <div><label>Date</label><input name="on" type="date" value="${esc(on)}"/></div>
      <div><button type="submit" class="ghost">Show</button></div>
    </form>
  </div>
  ${table(`Arriving · ${pretty(target)}`, arrivals, 'No arrivals.')}
  ${table('Departing', departures, 'No departures.')}
  ${table('In house', inHouse, 'Nobody in house.')}

  <h2 id="strip">Next 30 nights</h2>
  <div class="card">
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Gold is booked, green is free. Gaps between stays are the nights worth selling —
      hover a cell to see who is in it.
    </p>
    ${stripHtml}
  </div>

  <p class="muted" style="font-size:13px;">
    Premium means the generator runs through an outage. Standard runs the inverter, which does not
    power AC — worth knowing before the grid drops.
  </p>`
    })
  );
});

/* ── Records portal ────────────────────────────────────────────────────── */

router.get('/ops/records', async (req, res) => {
  const filter = {};
  if (req.query.booking) filter.booking = req.query.booking;
  if (req.query.property) filter.property = req.query.property;
  if (req.query.tag) filter.tags = String(req.query.tag);

  const [items, bookings, properties, usage] = await Promise.all([
    Attachment.find(filter).sort('-uploadedAt').limit(200).populate('booking').populate('property').lean(),
    Booking.find().sort({ checkIn: -1 }).limit(100).lean(),
    Property.find().sort('name').lean(),
    diskUsage()
  ]);

  const tiles = items.length
    ? items
        .map(
          (a) => `<figure>
      ${
        a.kind === 'image'
          ? `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener">
               <img src="/ops/records/file/${esc(a.thumbname || a.filename)}" alt="${esc(a.title || 'record')}" loading="lazy"/>
             </a>`
          : `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener"
                style="display:block;height:130px;display:flex;align-items:center;justify-content:center;">PDF</a>`
      }
      <figcaption>
        ${a.title ? `<strong style="color:#F5F0E8;">${esc(a.title)}</strong><br/>` : ''}
        ${a.booking ? `<a href="/ops/bookings/${a.booking._id}">${esc(a.booking.guestName)}</a><br/>` : ''}
        ${a.property ? `${esc(a.property.name)}<br/>` : ''}
        ${a.note ? `${esc(a.note)}<br/>` : ''}
        ${(a.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}
        ${a.sensitive ? '<span class="pill warn">sensitive</span>' : ''}
        <div style="margin-top:6px;font-size:11px;">${pretty(a.uploadedAt)} · ${Math.round((a.bytes || 0) / 1024)}KB</div>
        <form method="post" action="/ops/records/delete" style="margin-top:6px;"
              onsubmit="return confirm('Delete this record permanently?');">
          <input type="hidden" name="id" value="${a._id}"/>
          <button class="ghost" type="submit">Delete</button>
        </form>
      </figcaption>
    </figure>`
        )
        .join('')
    : '<p class="muted">Nothing stored yet.</p>';

  res.type('html').send(
    page({
      title: 'Records',
      active: '/ops/records',
      ...flashOf(req),
      body: `
  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Upload</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Photos, documents, receipts, reviews. Images are compressed on upload — phone photos arrive at
      several megabytes each and would otherwise fill the disk. Files are never public; they are
      served only to a signed-in admin.
    </p>
    <form method="post" action="/ops/records" enctype="multipart/form-data">
      <div class="grid">
        <div><label>Files</label><input type="file" name="files" multiple required
             accept="image/*,.heic,.heif,application/pdf"/></div>
        <div><label>Tags</label><input name="tags" placeholder="id, damage, review"/></div>
      </div>
      <div class="grid" style="margin-top:12px;">
        <div><label>Attach to booking</label><select name="booking">
          <option value="">— none —</option>
          ${bookings.map((b) => `<option value="${b._id}"${String(req.query.booking) === String(b._id) ? ' selected' : ''}>${esc(b.guestName)} · ${pretty(b.checkIn)}</option>`).join('')}
        </select></div>
        <div><label>Or apartment</label><select name="property">
          <option value="">— none —</option>
          ${properties.map((p) => `<option value="${p._id}">${esc(p.name)}</option>`).join('')}
        </select></div>
        <div><label>Note</label><input name="note" maxlength="200"/></div>
        <div><label style="text-transform:none;letter-spacing:normal;color:var(--muted);font-size:12px;">
          <input type="checkbox" name="sensitive" style="width:auto;"/> Contains identity details
        </label></div>
        <div><button type="submit">Upload</button></div>
      </div>
    </form>
  </div>

  <div class="card">
    <p class="muted" style="font-size:13px;margin:0;">
      ${usage.files} file(s) · ${(usage.bytes / 1048576).toFixed(1)} MB on disk.
      ${req.query.booking || req.query.property || req.query.tag ? '<a href="/ops/records">Clear filter</a>' : ''}
    </p>
  </div>

  <div class="card"><div class="thumbs">${tiles}</div></div>`
    })
  );
});

router.post('/ops/records', upload.array('files', 10), async (req, res) => {
  const files = req.files || [];
  const returnTo = String(req.body?.returnTo || '').startsWith('/ops/')
    ? String(req.body.returnTo)
    : '/ops/records';

  if (!files.length) return back(res, returnTo, { err: 'Choose at least one file.' });

  const tags = String(req.body?.tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8);

  // Uploading from a booking already says what the file belongs to, so the name
  // is derived rather than typed — one less field, and nothing lands misfiled.
  const booking = req.body?.booking ? await Booking.findById(req.body.booking).lean() : null;
  const property = req.body?.property ? await Property.findById(req.body.property).lean() : null;
  const existing = booking ? await Attachment.countDocuments({ booking: booking._id }) : 0;

  const autoTitle = (index) => {
    if (booking) return `${booking.guestName} · ${pretty(booking.checkIn)} · ${existing + index + 1}`;
    if (property) return `${property.name} · ${pretty(new Date())} · ${index + 1}`;
    return `Record · ${pretty(new Date())} · ${index + 1}`;
  };

  const saved = [];
  const rejected = [];
  let before = 0;
  let after = 0;

  for (const [index, file] of files.entries()) {
    try {
      const stored = await store(file);
      before += stored.originalBytes || stored.bytes;
      after += stored.bytes;
      await Attachment.create({
        ...stored,
        title: autoTitle(index),
        note: String(req.body?.note || '').slice(0, 200),
        tags,
        booking: booking?._id,
        property: property?._id,
        sensitive: Boolean(req.body?.sensitive)
      });
      saved.push(file.originalname);
    } catch (err) {
      if (err instanceof UploadRejected) rejected.push(err.message);
      else throw err;
    }
  }

  const shrunk =
    saved.length && before > after
      ? ` — ${(before / 1048576).toFixed(1)}MB down to ${(after / 1048576).toFixed(1)}MB`
      : '';

  back(res, returnTo, {
    msg: saved.length ? `${saved.length} file(s) stored${shrunk}.` : undefined,
    err: rejected.length ? rejected.join(' ') : undefined
  });
});

// Served through this authenticated route, never as static files: the upload
// directory holds guest identity documents whatever the stated purpose.
router.get('/ops/records/file/:name', (req, res) => {
  const name = String(req.params.name);
  if (!/^[a-f0-9]{24}(_t)?\.(jpg|pdf)$/.test(name)) return res.status(400).end();
  const target = filePath(name);
  if (!fs.existsSync(target)) return res.status(404).end();
  // Not cached: these are guest identity documents as often as apartment photos,
  // and a shared office browser should not keep serving them after sign-out.
  res.set('Cache-Control', 'no-store, private').sendFile(target);
});

router.post('/ops/records/delete', async (req, res) => {
  const attachment = await Attachment.findById(req.body?.id);
  if (attachment) {
    await remove(attachment);
    await attachment.deleteOne();
  }
  back(res, '/ops/records', { msg: 'Record deleted.' });
});

/* ── Reports ───────────────────────────────────────────────────────────── */

router.get('/ops/reports', async (req, res) => {
  const from = day(req.query.from || new Date(Date.now() - 29 * 86_400_000));
  const to = day(req.query.to || new Date());
  const toEnd = new Date(to.getTime() + 86_400_000);

  const bookings = await Booking.find({
    checkIn: { $lt: toEnd },
    checkOut: { $gt: from },
    status: { $in: ['confirmed', 'checked_in', 'checked_out'] }
  })
    .populate({ path: 'rooms', populate: { path: 'property' } })
    .lean();

  const stats = {
    bookings: bookings.length,
    nights: 0,
    revenue: 0,
    quoted: 0,
    depositsHeld: 0,
    premium: 0,
    standard: 0,
    whole: 0,
    split: 0,
    referred: 0,
    comped: 0
  };

  for (const b of bookings) {
    const nights = nightsBetween(b.checkIn, b.checkOut);
    const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
    stats.nights += nights * (b.rooms?.length || 1);
    stats.revenue += paid;
    stats.quoted += b.quotedAmount || 0;
    if (b.deposit?.amount && !b.deposit?.refund?.processedOn) stats.depositsHeld += b.deposit.amount;
    stats[b.tier] += 1;
    const propertyBeds = b.rooms?.[0]?.property?.bedrooms || 1;
    if ((b.rooms?.length || 0) >= propertyBeds) stats.whole += 1;
    else stats.split += 1;
    if (b.referralCode) stats.referred += 1;
    if (paid === 0) stats.comped += 1;
  }

  const discount = stats.quoted - stats.revenue;

  const byProperty = new Map();
  for (const b of bookings) {
    for (const room of b.rooms || []) {
      const key = room.property?.name || 'Unknown';
      byProperty.set(key, (byProperty.get(key) || 0) + nightsBetween(b.checkIn, b.checkOut));
    }
  }

  const propertyRows = [...byProperty.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, nights]) => `<tr><td>${esc(name)}</td><td class="num">${nights}</td></tr>`)
    .join('') || `<tr><td colspan="2" class="muted" style="padding:18px 10px;">No nights sold.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Reports',
      active: '/ops/reports',
      ...flashOf(req),
      body: `
  <div class="card">
    <form method="get" action="/ops/reports" class="grid">
      <div><label>From</label><input name="from" type="date" value="${from.toISOString().slice(0, 10)}"/></div>
      <div><label>To</label><input name="to" type="date" value="${to.toISOString().slice(0, 10)}"/></div>
      <div><button type="submit" class="ghost">Run</button></div>
    </form>
  </div>

  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${naira(stats.revenue)}</div><div class="stat-label">Collected</div></div>
      <div><div class="stat-number">${stats.nights}</div><div class="stat-label">Room-nights</div></div>
      <div><div class="stat-number">${stats.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${naira(stats.depositsHeld)}</div><div class="stat-label">Deposits held</div></div>
    </div>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Mix</h2>
    <table>
      <tr><td>Whole apartment</td><td class="num">${stats.whole}</td></tr>
      <tr><td>Single bedroom in a shared apartment</td><td class="num">${stats.split}</td></tr>
      <tr><td>Premium — generator backup</td><td class="num">${stats.premium}</td></tr>
      <tr><td>Standard — inverter backup</td><td class="num">${stats.standard}</td></tr>
      <tr><td>Came through a referral link</td><td class="num">${stats.referred}</td></tr>
      <tr><td>Free stays (₦0 collected)</td><td class="num">${stats.comped}</td></tr>
    </table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Against reference rates</h2>
    <table>
      <tr><td>Would have charged</td><td class="num">${naira(stats.quoted)}</td></tr>
      <tr><td>Actually collected</td><td class="num">${naira(stats.revenue)}</td></tr>
      <tr><td><strong>Given away</strong></td>
          <td class="num"><strong>${discount > 0 ? naira(discount) : naira(0)}</strong></td></tr>
    </table>
    <p class="muted" style="font-size:12px;margin-top:10px;">
      Quoted amounts are optional, so this only reflects bookings where one was entered.
    </p>
  </div>

  <div class="card scroll">
    <h2 style="font-size:20px;margin-top:0;">Room-nights by apartment</h2>
    <table><thead><tr><th>Apartment</th><th class="num">Nights</th></tr></thead>
    <tbody>${propertyRows}</tbody></table>
  </div>`
    })
  );
});

export default router;
