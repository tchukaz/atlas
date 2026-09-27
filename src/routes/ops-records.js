import { Router } from 'express';
import { naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, pretty, todayIso } from '../views-ops.js';
import { requireAuth, requireCan, record } from '../auth.js';
import { can, money } from '../permissions.js';
import { Attachment, Booking, Property } from '../models.js';
import { day, nightsBetween } from '../availability.js';
import { UploadRejected, findOrphans, remove, store, upload } from '../uploads.js';
import { open as openObject, usage as storageUsage } from '../storage.js';
import { createReadStream } from 'node:fs';

const router = Router();
router.use('/ops', requireAuth);

/* ── Today's board ─────────────────────────────────────────────────────── */

router.get('/ops/today', requireCan('bookings.view'), async (req, res) => {
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
        <td data-h="Balance" class="num">${
          can(req.user, 'money.view')
            ? due ? `<span class="busy">${naira(due)} due</span>` : '<span class="free">settled</span>'
            : '—'
        }</td>
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

  res.type('html').send(
    page({
      title: 'Today',
      active: '/ops/today',
      user: req.user,
      breadcrumb: [['Today', null]],
      ...flashOf(req),
      body: `
  <div class="card">
    <form method="get" action="/ops/today" class="grid">
      <div><label>Date</label><input name="on" type="date" value="${esc(on)}"/></div>
      <div><button type="submit" class="ghost">Show</button></div>
    </form>
  </div>
  ${table(`Arriving · ${pretty(target)}`, arrivals, 'No arrivals.')}
  ${table('Departing', departures, 'No departures.')}
  ${table('In house', inHouse, 'Nobody in house.')}

  <p class="muted" style="font-size:13px;">
    Premium means the generator runs through an outage. Standard runs the inverter, which does not
    power AC — worth knowing before the grid drops.
    <a href="/ops/calendar">See the whole month</a>.
  </p>`
    })
  );
});

/* ── Records portal ────────────────────────────────────────────────────── */

router.get('/ops/records', requireCan('records.view'), async (req, res) => {
  const filter = {};
  if (req.query.booking) filter.booking = req.query.booking;
  if (req.query.property) filter.property = req.query.property;
  if (req.query.tag) filter.tags = String(req.query.tag);

  const [items, bookings, properties, usage] = await Promise.all([
    Attachment.find(filter).sort('-uploadedAt').limit(200).populate('booking').populate('property').lean(),
    Booking.find().sort({ checkIn: -1 }).limit(100).lean(),
    Property.find().sort('name').lean(),
    storageUsage()
  ]);

  const visible = can(req.user, 'records.sensitive') ? items : items.filter((a) => !a.sensitive);
  const hiddenCount = items.length - visible.length;
  const orphans = await findOrphans(visible);
  const missing = new Set(orphans.map((o) => String(o._id)));

  const tiles = visible.length
    ? visible
        .map(
          (a) => `<figure>
      ${
        missing.has(String(a._id))
          ? `<div style="height:130px;display:flex;align-items:center;justify-content:center;
                         color:#C4553D;font-size:12px;text-align:center;padding:0 10px;">File missing</div>`
          : a.kind === 'image'
            ? `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener">
                 <img src="/ops/records/file/${esc(a.thumbname || a.filename)}" alt="${esc(a.title || 'record')}" loading="lazy"/>
               </a>`
            : `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener"
                  style="height:130px;display:flex;align-items:center;justify-content:center;">PDF</a>`
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
      user: req.user,
      breadcrumb: [['More', '#more'], ['Records', null]],
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
      Stored on ${esc(usage.where)}${
        usage.files === null
          ? ` (bucket ${esc(usage.bucket)})`
          : ` — ${usage.files} file(s), ${(usage.bytes / 1048576).toFixed(1)} MB`
      }.
      ${
        hiddenCount
          ? `<br/><span class="muted">${hiddenCount} record(s) marked as identity details are hidden from your role.</span>`
          : ''
      }
      ${
        orphans.length
          ? `<br/><span style="color:#C4553D;">${orphans.length} record(s) point at a file that is
             no longer there.</span>
             <form method="post" action="/ops/records/prune" style="display:inline;margin-left:8px;"
                   onsubmit="return confirm('Remove ${orphans.length} record(s) whose file is missing?');">
               <button type="submit" class="ghost">Clear them</button>
             </form>`
          : ''
      }
      ${req.query.booking || req.query.property || req.query.tag ? '<a href="/ops/records">Clear filter</a>' : ''}
    </p>
  </div>

  <div class="card"><div class="thumbs">${tiles}</div></div>`
    })
  );
});

router.post('/ops/records', requireCan('records.upload'), upload.array('files', 10), async (req, res) => {
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
router.get('/ops/records/file/:name', requireCan('records.view'), async (req, res) => {
  const name = String(req.params.name);
  if (!/^[a-f0-9]{24}(_t)?\.(jpg|pdf)$/.test(name)) return res.status(400).end();

  // Identity documents are gated separately and every view is recorded — that
  // is the part that matters if one ever leaks.
  const attachment = await Attachment.findOne({
    $or: [{ filename: name }, { thumbname: name }]
  }).lean();

  if (attachment?.sensitive) {
    if (!can(req.user, 'records.sensitive')) return res.status(403).end();
    if (!name.includes('_t')) {
      await record(req, 'record.sensitive_viewed', attachment.title || name);
    }
  }

  const found = await openObject(name);
  if (!found) return res.status(404).end();

  // Proxied rather than handed out as a public URL, and never cached: these are
  // guest identity documents as often as apartment photos, and a shared office
  // browser should not keep serving them after sign-out.
  res.set('Cache-Control', 'no-store, private');
  if (found.kind === 'path') return res.sendFile(found.path);

  res.set('Content-Type', found.contentType || 'application/octet-stream');
  if (found.length) res.set('Content-Length', found.length);
  const { Readable } = await import('node:stream');
  Readable.fromWeb(found.stream).pipe(res);
});

router.post('/ops/records/prune', requireCan('records.delete'), async (req, res) => {
  const all = await Attachment.find().lean();
  const orphans = await findOrphans(all);
  if (orphans.length) {
    await Attachment.deleteMany({ _id: { $in: orphans.map((o) => o._id) } });
  }
  back(res, '/ops/records', { msg: `Cleared ${orphans.length} record(s) with no file.` });
});

router.post('/ops/records/delete', requireCan('records.delete'), async (req, res) => {
  const attachment = await Attachment.findById(req.body?.id);
  if (attachment) {
    await remove(attachment);
    await attachment.deleteOne();
  }
  back(res, '/ops/records', { msg: 'Record deleted.' });
});

/* ── Reports ───────────────────────────────────────────────────────────── */

router.get('/ops/reports', requireCan('reports.view'), async (req, res) => {
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
      user: req.user,
      breadcrumb: [['More', '#more'], ['Reports', null]],
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
