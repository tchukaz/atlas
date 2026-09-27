import crypto from 'node:crypto';
import { Router } from 'express';
import { naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, iso, pretty, todayIso } from '../views-ops.js';
import { requireAdmin } from '../auth.js';
import { formatPhone, normalizePhone } from '../phone.js';
import { Attachment, BOOKING_STATUSES, Booking, Enquiry, Participant, Product, Room } from '../models.js';
import {
  BookingConflict,
  availabilityDetail,
  busyRoomIds,
  day,
  extensionLimit,
  nightsBetween,
  reserve,
  tierConflict
} from '../availability.js';

const router = Router();
router.use('/ops', requireAdmin);

// Offered in the order they actually get used, rather than an order someone
// guessed at up front.
async function frequentMethods() {
  const rows = await Booking.aggregate([
    { $unwind: '$payments' },
    { $match: { 'payments.method': { $nin: [null, ''] } } },
    { $group: { _id: '$payments.method', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 8 }
  ]);
  const seen = rows.map((r) => r._id);
  return [...new Set([...seen, 'Transfer', 'Cash', 'POS'])].slice(0, 8);
}

const reference = () => `AH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const STATUS_STYLE = {
  enquiry: '',
  confirmed: 'on',
  checked_in: 'good',
  checked_out: '',
  cancelled: 'warn',
  no_show: 'warn'
};

const label = (status) => status.replace('_', ' ');

/* ── List and create ───────────────────────────────────────────────────── */

router.get('/ops/bookings', async (req, res) => {
  const checkIn = req.query.in || todayIso();
  const checkOut = req.query.out || iso(new Date(Date.now() + 86_400_000));

  const [bookings, products, detail, methods] = await Promise.all([
    Booking.find().sort({ checkIn: -1 }).limit(100).populate('rooms').lean(),
    Product.find({ active: true }).sort('name').lean(),
    availabilityDetail(checkIn, checkOut),
    frequentMethods()
  ]);

  const roomsBy = new Map();
  for (const property of detail.properties) {
    for (const room of property.rooms || []) {
      roomsBy.set(String(room._id), `${property.name} · ${room.name}`);
    }
  }

  const span = (s) => `${pretty(s.from)}–${pretty(s.to)}`;

  // Split into what covers the whole stay and what covers part of it, so a
  // partial match reads as a counter-offer instead of a refusal.
  const fullyFree = detail.properties.filter((p) => p.wholeAvailable || p.freeRooms.length);
  const partialOnly = detail.properties.filter(
    (p) => !p.wholeAvailable && !p.freeRooms.length && p.partialRooms.length
  );

  const availableBlock = fullyFree.length
    ? fullyFree
        .map(
          (p) => `<div style="margin-bottom:12px;">
      <strong>${esc(p.name)}</strong>
      ${p.wholeAvailable ? '<span class="pill good">Whole apartment free</span>' : ''}
      ${p.splittable ? '' : '<span class="pill">whole only</span>'}
      <div style="margin-top:6px;">
        ${p.rooms
          .map((r) =>
            r.free
              ? `<span class="pill good">${esc(r.name)} — free</span>`
              : r.partial
                ? `<span class="pill">${esc(r.name)} — part only: ${r.stretches.map(span).join(', ')}</span>`
                : `<span class="pill warn">${esc(r.name)} — booked</span>`
          )
          .join(' ')}
      </div>
    </div>`
        )
        .join('')
    : `<p class="muted" style="margin:0 0 12px;">Nothing covers all ${detail.wanted} night(s).</p>`;

  const partialBlock = partialOnly.length
    ? `<div style="border-left:2px solid var(--gold);padding-left:14px;margin-top:6px;">
      <div class="stat-label" style="margin-bottom:8px;">Could still offer</div>
      ${partialOnly
        .map(
          (p) => `<div style="margin-bottom:8px;"><strong>${esc(p.name)}</strong><br/>
        ${p.partialRooms
          .map(
            (r) =>
              `<span class="muted" style="font-size:13px;">${esc(r.name)}: free ${r.stretches
                .map((s) => `${span(s)} (${s.nights}n)`)
                .join(', ')} of your ${detail.wanted}</span>`
          )
          .join('<br/>')}</div>`
        )
        .join('')}
    </div>`
    : '';

  const nothingAtAll = !fullyFree.length && !partialOnly.length;

  const roomChecks = detail.properties
    .map(
      (p) => `<fieldset style="border:1px solid var(--line);border-radius:3px;padding:10px 12px;margin-bottom:10px;">
      <legend class="stat-label" style="padding:0 6px;">${esc(p.name)}</legend>
      ${p.rooms
        .map(
          (r) => `<label class="roomopt">
        <input type="checkbox" name="rooms" value="${r._id}"${r.free ? '' : ' disabled'}/>
        <span>${esc(r.name)}${r.free ? '' : r.partial ? ` — part only (${r.stretches.map(span).join(', ')})` : ' — booked'}</span>
      </label>`
        )
        .join('')}
    </fieldset>`
    )
    .join('');

  const rows = bookings.length
    ? bookings
        .map((b) => {
          const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
          const balance = Math.max(0, (b.quotedAmount || 0) - paid);
          const depositHeld = b.deposit?.amount && !b.deposit?.refund?.processedOn;
          return `<tr>
        <td data-h="Guest"><a href="/ops/bookings/${b._id}"><strong>${esc(b.guestName)}</strong></a><br/>
            <span class="mono" style="font-size:11px;">${esc(b.reference)}</span>
            ${b.referralCode ? `<br/><span class="muted" style="font-size:11px;">ref: ${esc(b.referralCode)}</span>` : ''}
            ${b.flagged ? `<br/><span class="pill warn">${esc(b.flagged)}</span>` : ''}</td>
        <td data-h="Rooms">${(b.rooms || []).map((r) => esc(roomsBy.get(String(r._id)) || r.name)).join('<br/>')}</td>
        <td data-h="Dates">${pretty(b.checkIn)} → ${pretty(b.checkOut)}<br/>
            <span class="muted" style="font-size:11px;">${nightsBetween(b.checkIn, b.checkOut)} night(s)</span></td>
        <td data-h="Tier"><span class="pill ${b.tier === 'premium' ? 'on' : ''}">${b.tier}</span></td>
        <td data-h="Paid" class="num">${naira(paid)}${
          balance ? `<br/><span class="busy" style="font-size:11px;">${naira(balance)} due</span>` : ''
        }${depositHeld ? `<br/><span class="pill">dep ${naira(b.deposit.amount)}</span>` : ''}</td>
        <td data-h="Status"><span class="pill ${STATUS_STYLE[b.status]}">${esc(label(b.status))}</span></td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted" style="padding:24px 10px;">No bookings yet.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Bookings',
      active: '/ops/bookings',
      ...flashOf(req),
      body: `
  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Availability</h2>
    <form method="get" action="/ops/bookings" class="grid" style="margin-bottom:18px;">
      <div><label>Check in</label><input name="in" type="date" value="${esc(checkIn)}"/></div>
      <div><label>Check out</label><input name="out" type="date" value="${esc(checkOut)}"/></div>
      <div><button type="submit" class="ghost">Show</button></div>
    </form>
    ${availableBlock}
    ${partialBlock}
    <p class="muted" style="font-size:13px;margin-top:14px;">
      <a href="/ops/calendar#strip">See the month at a glance</a>
    </p>
  </div>

  ${
    detail.properties.length
      ? `<details class="card"${nothingAtAll ? ' open' : ''}>
    <summary style="cursor:pointer;font-family:'Cormorant Garamond',serif;font-size:20px;color:var(--gold-light);">
      Log this enquiry
    </summary>
    <p class="muted" style="font-size:13px;margin:12px 0 14px;">
      ${
        nothingAtAll
          ? 'Nothing is free for these dates.'
          : 'If the guest turns down what is available — wrong apartment, wrong dates — record it anyway.'
      }
      Turned-away enquiries are the only measure of what being full actually costs.
    </p>
    <form method="post" action="/ops/enquiries" class="grid">
      <input type="hidden" name="checkIn" value="${esc(checkIn)}"/>
      <input type="hidden" name="checkOut" value="${esc(checkOut)}"/>
      <div><label>Guest name</label><input name="guestName" maxlength="80"/></div>
      <div><label>Phone</label><input name="guestPhone" maxlength="20" inputmode="tel"/></div>
      <div><label>Wanted</label><input name="wanted" maxlength="60" placeholder="entire 2-bed"/></div>
      <div><label>What you offered</label><input name="offered" maxlength="80" placeholder="optional"/></div>
      <div><button type="submit" class="ghost">Save enquiry</button></div>
    </form>
  </details>`
      : ''
  }

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">New booking</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Tick every bedroom the guest is taking — one for a private room, all of them for a whole
      apartment. Amount paid is whatever they actually paid, including nothing.
    </p>
    <form method="post" action="/ops/bookings">
      <div class="grid">
        <div><label>Guest phone</label>
          <input name="guestPhone" id="phone" maxlength="20" inputmode="tel" placeholder="0802…"/>
          <div class="muted" id="known" style="font-size:12px;margin-top:5px;"></div></div>
        <div><label>Guest name</label><input name="guestName" id="gname" required maxlength="80"/></div>
        <div><label>Email</label><input name="guestEmail" id="gmail" type="email" maxlength="120"/></div>
        <div><label>Check in</label><input name="checkIn" type="date" required value="${esc(checkIn)}"/></div>
        <div><label>Check out</label><input name="checkOut" type="date" required value="${esc(checkOut)}"/></div>
      </div>
      <div class="grid" style="margin-top:12px;">
        <div><label>Product</label><select name="product">
          <option value="">— none —</option>
          ${products.map((p) => `<option value="${p._id}" data-tier="${p.tier}" data-rate="${p.referenceRate}">${esc(p.name)}</option>`).join('')}
        </select></div>
        <div><label>Tier</label><select name="tier" id="tier">
          <option value="standard">Standard</option><option value="premium">Premium</option>
        </select></div>
        <div><label>Quoted</label><input name="quotedAmount" type="number" min="0" id="quoted" inputmode="numeric"/></div>
        <div><label>Amount paid now</label><input name="paidNow" type="number" min="0" inputmode="numeric"/></div>
        <div><label>Refundable deposit</label><input name="depositAmount" type="number" min="0" inputmode="numeric"/></div>
        <div><label>Referral code</label><input name="referralCode" maxlength="20" placeholder="optional"/></div>
      </div>
      <div style="margin-top:16px;">
        <label class="stat-label" style="display:block;margin-bottom:8px;color:var(--gold);">Bedrooms</label>
        ${roomChecks}
      </div>
      <div style="margin-top:6px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Note</label>
        <input name="notes" maxlength="300" style="width:100%;"/>
      </div>
      <button type="submit" style="margin-top:16px;">Create booking</button>
    </form>
  </div>

  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Guest</th><th>Rooms</th><th>Dates</th><th>Tier</th><th class="num">Paid</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>

  <datalist id="methods">${methods.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>

  <script>
    const productSelect = document.querySelector('select[name=product]');
    productSelect?.addEventListener('change', () => {
      const opt = productSelect.selectedOptions[0];
      if (!opt || !opt.dataset.tier) return;
      document.getElementById('tier').value = opt.dataset.tier;
      const quoted = document.getElementById('quoted');
      if (!quoted.value && opt.dataset.rate && opt.dataset.rate !== '0') quoted.value = opt.dataset.rate;
    });

    // Returning guests are common, and the phone number is the one thing typed
    // first. Fill the rest rather than asking for it again.
    const phone = document.getElementById('phone');
    let lookupTimer;
    phone?.addEventListener('input', () => {
      clearTimeout(lookupTimer);
      lookupTimer = setTimeout(async () => {
        const value = phone.value.replace(/\\D/g, '');
        const note = document.getElementById('known');
        if (value.length < 10) { note.textContent = ''; return; }
        const res = await fetch('/ops/guest-lookup?phone=' + encodeURIComponent(phone.value));
        const data = await res.json();
        if (!data.found) { note.textContent = 'New guest.'; return; }
        note.innerHTML = '<span style="color:#C9A84C;">' + data.name + ' — ' + data.stays +
          ' previous stay(s), last ' + data.last + '</span>';
        const name = document.getElementById('gname');
        const mail = document.getElementById('gmail');
        if (!name.value) name.value = data.name;
        if (!mail.value && data.email) mail.value = data.email;
      }, 350);
    });
  </script>`
    })
  );
});

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

router.post('/ops/bookings', async (req, res) => {
  const b = req.body || {};
  const roomIds = asArray(b.rooms).filter(Boolean);
  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);

  if (!roomIds.length) return back(res, '/ops/bookings', { err: 'Pick at least one bedroom.' });
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    return back(res, '/ops/bookings', { err: 'Check-out must be after check-in.' });
  }

  const tier = b.tier === 'premium' ? 'premium' : 'standard';
  const guestPhone = normalizePhone(b.guestPhone);

  // A guest booking through their own referral link turns the payout into a
  // discount on their own bill, so surface it rather than paying it out quietly.
  let flagged = null;
  if (guestPhone) {
    const match = await Participant.findOne({ phone: guestPhone }).lean();
    if (match) {
      flagged =
        match.code === String(b.referralCode || '').toLowerCase()
          ? 'Guest phone matches the referrer'
          : `Guest phone matches participant ${match.name}`;
    }
  }

  const warning = await tierConflict({ roomIds, checkIn, checkOut, tier });

  try {
    const created = await reserve({
      roomIds,
      checkIn,
      checkOut,
      build: async (session) => {
        const payments = [];
        const paidNow = Math.max(0, Math.trunc(Number(b.paidNow) || 0));
        if (paidNow > 0) payments.push({ amount: paidNow, paidOn: new Date(), note: 'On creation' });

        const depositAmount = Math.max(0, Math.trunc(Number(b.depositAmount) || 0));

        const [doc] = await Booking.create(
          [
            {
              reference: reference(),
              guestName: String(b.guestName || '').trim().slice(0, 80),
              guestPhone: guestPhone || String(b.guestPhone || '').slice(0, 20),
              guestEmail: String(b.guestEmail || '').trim().toLowerCase().slice(0, 120),
              product: b.product || undefined,
              rooms: roomIds,
              tier,
              checkIn,
              checkOut,
              quotedAmount: Math.max(0, Math.trunc(Number(b.quotedAmount) || 0)),
              payments,
              deposit: depositAmount
                ? { amount: depositAmount, takenOn: new Date() }
                : { amount: 0 },
              referralCode: String(b.referralCode || '').toLowerCase().replace(/[^a-z0-9]/g, '') || undefined,
              flagged,
              notes: String(b.notes || '').slice(0, 300)
            }
          ],
          session ? { session } : {}
        );
        return doc;
      }
    });

    const notes = [`Booking ${created.reference} created.`];
    if (warning) notes.push(warning);
    if (flagged) notes.push(flagged);
    back(res, '/ops/bookings', { msg: notes.join(' ') });
  } catch (err) {
    if (err instanceof BookingConflict) return back(res, '/ops/bookings', { err: err.message });
    throw err;
  }
});

/* ── Single booking ────────────────────────────────────────────────────── */

router.get('/ops/bookings/:id', async (req, res) => {
  const booking = await Booking.findById(req.params.id)
    .populate({ path: 'rooms', populate: { path: 'property' } })
    .populate('product');
  if (!booking) return back(res, '/ops/bookings', { err: 'Booking not found.' });

  const [limit, records, tagRows, methods] = await Promise.all([
    extensionLimit(booking),
    Attachment.find({ booking: booking._id }).sort('-uploadedAt').lean(),
    Attachment.aggregate([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 12 }
    ]),
    frequentMethods()
  ]);
  const tagOptions = tagRows.map((t) => t._id);

  const paid = booking.totalPaid;
  const balance = booking.balance;
  const refund = booking.deposit?.refund;

  const paymentRows = (booking.payments || []).length
    ? booking.payments
        .map(
          (p) => `<tr>
        <td class="num">${naira(p.amount)}</td>
        <td>${esc(p.method || '—')}</td>
        <td>${pretty(p.paidOn)}</td>
        <td class="muted">${esc(p.note || '')}</td>
        <td><form method="post" action="/ops/bookings/${booking._id}/payment/delete">
          <input type="hidden" name="paymentId" value="${p._id}"/>
          <button class="ghost" type="submit">Remove</button></form></td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:16px 10px;">Nothing paid yet.</td></tr>`;

  res.type('html').send(
    page({
      title: booking.guestName,
      active: '/ops/bookings',
      ...flashOf(req),
      body: `
  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${naira(paid)}</div><div class="stat-label">Paid</div></div>
      <div><div class="stat-number">${naira(balance)}</div><div class="stat-label">Balance</div></div>
      <div><div class="stat-number">${nightsBetween(booking.checkIn, booking.checkOut)}</div><div class="stat-label">Nights</div></div>
      <div><div class="stat-number">${booking.rooms.length}</div><div class="stat-label">Bedrooms</div></div>
    </div>
    <p class="muted" style="margin-top:20px;font-size:14px;">
      <span class="mono">${esc(booking.reference)}</span> ·
      ${pretty(booking.checkIn)} → ${pretty(booking.checkOut)} ·
      <span class="pill ${booking.tier === 'premium' ? 'on' : ''}">${booking.tier}</span>
      <span class="pill ${STATUS_STYLE[booking.status]}">${esc(label(booking.status))}</span><br/>
      ${booking.rooms.map((r) => esc(`${r.property?.name || '?'} · ${r.name}`)).join(', ')}<br/>
      ${esc(formatPhone(booking.guestPhone) || '')} ${booking.guestEmail ? `· ${esc(booking.guestEmail)}` : ''}
      ${booking.referralCode ? `<br/>Referred by <span class="mono">${esc(booking.referralCode)}</span>` : ''}
    </p>
    ${booking.flagged ? `<div class="notice bad">${esc(booking.flagged)}</div>` : ''}
    ${booking.notes ? `<p class="muted" style="font-size:14px;">${esc(booking.notes)}</p>` : ''}
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Status</h2>
    <form method="post" action="/ops/bookings/${booking._id}/status" class="grid">
      <div><label>Set status</label><select name="status">
        ${BOOKING_STATUSES.map(
          (s) => `<option value="${s}"${s === booking.status ? ' selected' : ''}>${esc(label(s))}</option>`
        ).join('')}
      </select></div>
      <div><button type="submit">Update</button></div>
    </form>
    <p class="muted" style="font-size:12px;margin-top:10px;">
      Cancelling frees the bedrooms immediately. Referral credit counts only once a guest has
      checked in.
    </p>
  </div>

  <div class="card scroll">
    <h2 style="font-size:20px;margin-top:0;">Payments</h2>
    <table><thead><tr>
      <th class="num">Amount</th><th>Method</th><th>Date</th><th>Note</th><th></th>
    </tr></thead><tbody>${paymentRows}</tbody></table>
    <form method="post" action="/ops/bookings/${booking._id}/payment" class="grid" style="margin-top:16px;">
      <div><label>Amount</label><input name="amount" type="number" min="1" required/></div>
      <div><label>Method</label><input name="method" list="methods" placeholder="transfer, cash…"/></div>
      <div><label>Date</label><input name="paidOn" type="date" value="${todayIso()}"/></div>
      <div><label>Note</label><input name="note" maxlength="120"/></div>
      <div><button type="submit">Add payment</button></div>
    </form>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Refundable deposit</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Held against damage and returned afterwards. Kept apart from the stay money so it never counts
      as revenue.
    </p>
    <form method="post" action="/ops/bookings/${booking._id}/deposit" class="grid">
      <div><label>Amount held</label>
        <input name="amount" type="number" min="0" value="${booking.deposit?.amount || 0}"/></div>
      <div><label>Note</label><input name="note" maxlength="120" value="${esc(booking.deposit?.note || '')}"/></div>
      <div><button type="submit" class="ghost">Save</button></div>
    </form>

    ${
      refund?.processedOn
        ? `<div class="notice" style="margin-top:16px;">
             Refunded ${naira(refund.amount)} on ${pretty(refund.processedOn)}.
             ${refund.note ? esc(refund.note) : ''}
             ${
               refund.amount < (booking.deposit?.amount || 0)
                 ? `<br/><strong>${naira((booking.deposit.amount || 0) - refund.amount)} withheld.</strong>`
                 : ''
             }
           </div>`
        : booking.deposit?.amount
          ? `<form method="post" action="/ops/bookings/${booking._id}/refund" class="grid" style="margin-top:16px;">
               <div><label>Refund amount</label>
                 <input name="amount" type="number" min="0" max="${booking.deposit.amount}"
                        value="${booking.deposit.amount}" required/></div>
               <div><label>Processed on</label><input name="processedOn" type="date" value="${todayIso()}"/></div>
               <div><label>Note</label><input name="note" maxlength="120" placeholder="e.g. ₦5,000 withheld for damage"/></div>
               <div><button type="submit">Confirm refund</button></div>
             </form>`
          : '<p class="muted" style="font-size:13px;margin-top:12px;">No deposit held.</p>'
    }
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Change the dates</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      A guest staying on keeps one booking rather than gaining a second one.
      ${
        limit.until
          ? `These rooms are free until <strong style="color:#F5F0E8;">${pretty(limit.until)}</strong>${
              limit.blockedBy ? `, when ${esc(limit.blockedBy)} arrives` : ''
            }.`
          : 'Nothing is booked after this stay, so it can run on.'
      }
    </p>
    <form method="post" action="/ops/bookings/${booking._id}/dates" class="grid">
      <div><label>New check-out</label>
        <input name="checkOut" type="date" value="${iso(booking.checkOut)}" required/></div>
      <div><label>Extra charge</label>
        <input name="extraCharge" type="number" min="0" inputmode="numeric" placeholder="0"/></div>
      <div><button type="submit">Update dates</button></div>
    </form>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Records</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Anything uploaded here is filed against this booking automatically.
    </p>
    <form method="post" action="/ops/records" enctype="multipart/form-data">
      <input type="hidden" name="booking" value="${booking._id}"/>
      <input type="hidden" name="returnTo" value="/ops/bookings/${booking._id}"/>
      <div class="grid">
        <div><label>Files</label>
          <input type="file" name="files" multiple required accept="image/*,.heic,.heif,application/pdf"/></div>
        <div><label>Tags</label><input name="tags" list="tagsuggest" placeholder="id, damage"/></div>
        <div><label>Note</label><input name="note" maxlength="200"/></div>
        <div><label class="plain"><input type="checkbox" name="sensitive"/> Identity details</label></div>
        <div><button type="submit">Upload</button></div>
      </div>
    </form>
    <datalist id="tagsuggest">${tagOptions.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>

    ${
      records.length
        ? `<div class="thumbs" style="margin-top:18px;">${records
            .map(
              (a) => `<figure>
        ${
          a.kind === 'image'
            ? `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener">
                 <img src="/ops/records/file/${esc(a.thumbname || a.filename)}" alt="${esc(a.title || 'record')}" loading="lazy"/></a>`
            : `<a href="/ops/records/file/${esc(a.filename)}" target="_blank" rel="noopener"
                  style="height:130px;display:flex;align-items:center;justify-content:center;">PDF</a>`
        }
        <figcaption>
          ${a.note ? `${esc(a.note)}<br/>` : ''}
          ${(a.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join(' ')}
          ${a.sensitive ? '<span class="pill warn">sensitive</span>' : ''}
          <div style="margin-top:6px;font-size:11px;">${pretty(a.uploadedAt)} · ${Math.round((a.bytes || 0) / 1024)}KB</div>
        </figcaption>
      </figure>`
            )
            .join('')}</div>`
        : '<p class="muted" style="font-size:13px;margin-top:14px;">Nothing filed against this booking yet.</p>'
    }
  </div>

  ${
    (booking.history || []).length
      ? `<div class="card">
    <h2 style="font-size:20px;margin-top:0;">History</h2>
    ${booking.history
      .map(
        (h) =>
          `<div class="muted" style="font-size:13px;">${pretty(h.at)} — ${esc(h.what)}</div>`
      )
      .join('')}
  </div>`
      : ''
  }

  <datalist id="methods">${methods.map((m) => `<option value="${esc(m)}"></option>`).join('')}</datalist>
  <p class="muted" style="font-size:13px;"><a href="/ops/bookings">← All bookings</a></p>`
    })
  );
});

router.get('/ops/guest-lookup', async (req, res) => {
  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.json({ found: false });

  const stays = await Booking.find({ guestPhone: phone }).sort({ checkIn: -1 }).lean();
  if (!stays.length) return res.json({ found: false });

  res.json({
    found: true,
    name: stays[0].guestName,
    email: stays[0].guestEmail || '',
    stays: stays.length,
    last: new Date(stays[0].checkIn).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
  });
});

/**
 * Extending in place keeps one guest as one booking. A second booking beside it
 * would split the payments, double the count in reports, and credit a referrer
 * twice for the same stay.
 */
router.post('/ops/bookings/:id/dates', async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return back(res, '/ops/bookings', { err: 'Booking not found.' });

  const to = `/ops/bookings/${booking._id}`;
  const newOut = day(req.body?.checkOut);
  if (!newOut) return back(res, to, { err: 'Give a new check-out date.' });
  if (newOut <= day(booking.checkIn)) {
    return back(res, to, { err: 'Check-out must be after check-in.' });
  }

  const oldOut = day(booking.checkOut);
  if (newOut.getTime() === oldOut.getTime()) return back(res, to, { msg: 'Dates unchanged.' });

  const extending = newOut > oldOut;

  if (extending) {
    // Only the added nights need checking — the booking already holds the rest.
    const busy = await busyRoomIds(oldOut, newOut, { excludeId: booking._id });
    const clash = booking.rooms.find((id) => busy.has(String(id)));
    if (clash) {
      const { until, blockedBy } = await extensionLimit(booking);
      const suggestion = until
        ? ` The room is free until ${new Date(until).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}${
            blockedBy ? `, when ${blockedBy} arrives` : ''
          } — you could extend to there instead.`
        : '';
      return back(res, to, { err: `Cannot extend that far.${suggestion}` });
    }
  }

  const label = extending ? 'Extended' : 'Shortened';
  booking.history.push({
    what: `${label} from ${oldOut.toISOString().slice(0, 10)} to ${newOut.toISOString().slice(0, 10)}`
  });
  booking.checkOut = newOut;

  const extra = Math.max(0, Math.trunc(Number(req.body?.extraCharge) || 0));
  if (extra) {
    booking.quotedAmount = (booking.quotedAmount || 0) + extra;
    booking.history.push({ what: `Quote increased by ${naira(extra)}` });
  }

  await booking.save();
  back(res, to, {
    msg: `${label} to ${newOut.toISOString().slice(0, 10)} — now ${nightsBetween(booking.checkIn, newOut)} night(s).${
      extra ? ` Quote increased by ${naira(extra)}.` : ''
    }`
  });
});

/* ── Turned-away enquiries ─────────────────────────────────────────────── */

router.post('/ops/enquiries', async (req, res) => {
  const b = req.body || {};
  const checkIn = day(b.checkIn);
  const checkOut = day(b.checkOut);
  if (!checkIn || !checkOut) return back(res, '/ops/bookings', { err: 'Enquiry needs dates.' });

  await Enquiry.create({
    guestName: String(b.guestName || '').trim().slice(0, 80),
    guestPhone: normalizePhone(b.guestPhone) || String(b.guestPhone || '').slice(0, 20),
    checkIn,
    checkOut,
    wanted: String(b.wanted || '').slice(0, 60),
    offered: String(b.offered || '').slice(0, 80)
  });

  back(res, '/ops/enquiries', { msg: 'Enquiry saved.' });
});

router.get('/ops/enquiries', async (req, res) => {
  const enquiries = await Enquiry.find().sort('-createdAt').limit(200).lean();
  const lost = enquiries.filter((e) => e.outcome !== 'converted');
  const nightsMissed = lost.reduce((n, e) => n + nightsBetween(e.checkIn, e.checkOut), 0);

  const rows = enquiries.length
    ? enquiries
        .map(
          (e) => `<tr>
      <td data-h="Guest"><strong>${esc(e.guestName || 'Unnamed')}</strong><br/>
        <span class="muted" style="font-size:11px;">${esc(formatPhone(e.guestPhone) || '')}</span></td>
      <td data-h="Dates">${pretty(e.checkIn)} → ${pretty(e.checkOut)}<br/>
        <span class="muted" style="font-size:11px;">${nightsBetween(e.checkIn, e.checkOut)} night(s)</span></td>
      <td data-h="Wanted">${esc(e.wanted || '—')}${e.offered ? `<br/><span class="muted" style="font-size:11px;">offered: ${esc(e.offered)}</span>` : ''}</td>
      <td data-h="Logged">${pretty(e.createdAt)}</td>
      <td data-h="Outcome"><span class="pill ${e.outcome === 'converted' ? 'good' : e.outcome === 'lost' ? 'warn' : ''}">${esc(e.outcome)}</span></td>
      <td>
        <form method="post" action="/ops/enquiries/outcome" style="display:flex;gap:6px;flex-wrap:wrap;">
          <input type="hidden" name="id" value="${e._id}"/>
          <button class="ghost" name="outcome" value="converted" type="submit">Booked</button>
          <button class="ghost" name="outcome" value="lost" type="submit">Lost</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="muted" style="padding:24px 10px;">
         Nothing logged yet. When you cannot take a booking, save it from the
         <a href="/ops/bookings">availability screen</a>.
       </td></tr>`;

  res.type('html').send(
    page({
      title: 'Enquiries',
      active: '/ops/enquiries',
      ...flashOf(req),
      body: `
  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${enquiries.length}</div><div class="stat-label">Logged</div></div>
      <div><div class="stat-number">${lost.length}</div><div class="stat-label">Not converted</div></div>
      <div><div class="stat-number">${nightsMissed}</div><div class="stat-label">Nights missed</div></div>
    </div>
    <p class="muted" style="font-size:13px;margin-top:18px;">
      Nights you were asked for and could not sell. If this number stays high while occupancy is
      full, it is the argument for another apartment.
    </p>
  </div>

  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Guest</th><th>Dates</th><th>Wanted</th><th>Logged</th><th>Outcome</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`
    })
  );
});

router.post('/ops/enquiries/outcome', async (req, res) => {
  const outcome = ['converted', 'lost', 'open'].includes(req.body?.outcome) ? req.body.outcome : 'open';
  await Enquiry.updateOne({ _id: req.body?.id }, { $set: { outcome } });
  back(res, '/ops/enquiries', { msg: `Marked ${outcome}.` });
});

router.post('/ops/bookings/:id/status', async (req, res) => {
  const status = BOOKING_STATUSES.includes(req.body?.status) ? req.body.status : null;
  if (!status) return back(res, `/ops/bookings/${req.params.id}`, { err: 'Unknown status.' });
  await Booking.updateOne({ _id: req.params.id }, { $set: { status } });
  back(res, `/ops/bookings/${req.params.id}`, { msg: `Status set to ${label(status)}.` });
});

router.post('/ops/bookings/:id/payment', async (req, res) => {
  const amount = Math.max(0, Math.trunc(Number(req.body?.amount) || 0));
  if (!amount) return back(res, `/ops/bookings/${req.params.id}`, { err: 'Enter an amount.' });
  await Booking.updateOne(
    { _id: req.params.id },
    {
      $push: {
        payments: {
          amount,
          method: String(req.body?.method || '').slice(0, 40),
          paidOn: req.body?.paidOn ? day(req.body.paidOn) : new Date(),
          note: String(req.body?.note || '').slice(0, 120)
        }
      }
    }
  );
  back(res, `/ops/bookings/${req.params.id}`, { msg: `${naira(amount)} recorded.` });
});

router.post('/ops/bookings/:id/payment/delete', async (req, res) => {
  await Booking.updateOne(
    { _id: req.params.id },
    { $pull: { payments: { _id: req.body?.paymentId } } }
  );
  back(res, `/ops/bookings/${req.params.id}`, { msg: 'Payment removed.' });
});

router.post('/ops/bookings/:id/deposit', async (req, res) => {
  const amount = Math.max(0, Math.trunc(Number(req.body?.amount) || 0));
  await Booking.updateOne(
    { _id: req.params.id },
    {
      $set: {
        'deposit.amount': amount,
        'deposit.note': String(req.body?.note || '').slice(0, 120),
        ...(amount ? { 'deposit.takenOn': new Date() } : {})
      }
    }
  );
  back(res, `/ops/bookings/${req.params.id}`, { msg: 'Deposit updated.' });
});

router.post('/ops/bookings/:id/refund', async (req, res) => {
  const booking = await Booking.findById(req.params.id);
  if (!booking) return back(res, '/ops/bookings', { err: 'Booking not found.' });

  const held = booking.deposit?.amount || 0;
  const amount = Math.min(held, Math.max(0, Math.trunc(Number(req.body?.amount) || 0)));

  booking.deposit.refund = {
    amount,
    processedOn: req.body?.processedOn ? day(req.body.processedOn) : new Date(),
    note: String(req.body?.note || '').slice(0, 120)
  };
  await booking.save();

  const withheld = held - amount;
  back(res, `/ops/bookings/${booking._id}`, {
    msg: `Refund of ${naira(amount)} confirmed${withheld ? `, ${naira(withheld)} withheld` : ''}.`
  });
});

export default router;
