import crypto from 'node:crypto';
import { Router } from 'express';
import { naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, iso, pretty, todayIso } from '../views-ops.js';
import { requireAdmin } from '../auth.js';
import { formatPhone, normalizePhone } from '../phone.js';
import { BOOKING_STATUSES, Booking, Participant, Product, Room } from '../models.js';
import {
  BookingConflict,
  availability,
  day,
  nightsBetween,
  reserve,
  tierConflict
} from '../availability.js';

const router = Router();
router.use('/ops', requireAdmin);

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

  const [bookings, products, slots] = await Promise.all([
    Booking.find().sort({ checkIn: -1 }).limit(100).populate('rooms').lean(),
    Product.find({ active: true }).sort('name').lean(),
    availability(checkIn, checkOut)
  ]);

  const roomsBy = new Map();
  for (const property of slots) {
    for (const room of property.rooms || []) {
      roomsBy.set(String(room._id), `${property.name} · ${room.name}`);
    }
  }

  const availabilityCards = slots.length
    ? slots
        .map(
          (p) => `<div style="margin-bottom:14px;">
      <strong>${esc(p.name)}</strong>
      ${
        p.wholeAvailable
          ? '<span class="pill good">Whole apartment free</span>'
          : '<span class="pill warn">Whole apartment unavailable</span>'
      }
      ${p.splittable ? '' : '<span class="pill">whole only</span>'}
      <div style="margin-top:6px;">
        ${p.rooms
          .map(
            (r) =>
              `<span class="pill ${r.free ? 'good' : 'warn'}">${esc(r.name)} — ${r.free ? 'free' : 'booked'}</span>`
          )
          .join(' ')}
      </div>
    </div>`
        )
        .join('')
    : '<p class="muted">No apartments set up yet — add them under Inventory.</p>';

  const roomOptions = slots
    .flatMap((p) =>
      (p.rooms || []).map(
        (r) =>
          `<option value="${r._id}"${r.free ? '' : ' disabled'}>${esc(p.name)} · ${esc(r.name)}${
            r.free ? '' : ' (booked)'
          }</option>`
      )
    )
    .join('');

  const rows = bookings.length
    ? bookings
        .map((b) => {
          const paid = (b.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
          const balance = Math.max(0, (b.quotedAmount || 0) - paid);
          const depositHeld = b.deposit?.amount && !b.deposit?.refund?.processedOn;
          return `<tr>
        <td><a href="/ops/bookings/${b._id}"><strong>${esc(b.guestName)}</strong></a><br/>
            <span class="mono" style="font-size:11px;">${esc(b.reference)}</span>
            ${b.referralCode ? `<br/><span class="muted" style="font-size:11px;">ref: ${esc(b.referralCode)}</span>` : ''}
            ${b.flagged ? `<br/><span class="pill warn">${esc(b.flagged)}</span>` : ''}</td>
        <td>${(b.rooms || []).map((r) => esc(roomsBy.get(String(r._id)) || r.name)).join('<br/>')}</td>
        <td>${pretty(b.checkIn)} → ${pretty(b.checkOut)}<br/>
            <span class="muted" style="font-size:11px;">${nightsBetween(b.checkIn, b.checkOut)} night(s)</span></td>
        <td><span class="pill ${b.tier === 'premium' ? 'on' : ''}">${b.tier}</span></td>
        <td class="num">${naira(paid)}${
          balance ? `<br/><span class="busy" style="font-size:11px;">${naira(balance)} due</span>` : ''
        }${depositHeld ? `<br/><span class="pill">dep ${naira(b.deposit.amount)}</span>` : ''}</td>
        <td><span class="pill ${STATUS_STYLE[b.status]}">${esc(label(b.status))}</span></td>
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
    <h2 style="font-size:20px;margin-top:0;">Check availability</h2>
    <form method="get" action="/ops/bookings" class="grid" style="margin-bottom:18px;">
      <div><label>Check in</label><input name="in" type="date" value="${esc(checkIn)}"/></div>
      <div><label>Check out</label><input name="out" type="date" value="${esc(checkOut)}"/></div>
      <div><button type="submit" class="ghost">Show</button></div>
    </form>
    ${availabilityCards}
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">New booking</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Pick every bedroom the guest is taking — one for a private room, all of them for a whole
      apartment. Amount paid is whatever they actually paid, including nothing.
    </p>
    <form method="post" action="/ops/bookings">
      <div class="grid">
        <div><label>Guest name</label><input name="guestName" required maxlength="80"/></div>
        <div><label>Phone</label><input name="guestPhone" maxlength="20" placeholder="0802…"/></div>
        <div><label>Email</label><input name="guestEmail" type="email" maxlength="120"/></div>
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
        <div><label>Quoted</label><input name="quotedAmount" type="number" min="0" id="quoted"/></div>
        <div><label>Amount paid now</label><input name="paidNow" type="number" min="0"/></div>
        <div><label>Refundable deposit</label><input name="depositAmount" type="number" min="0"/></div>
        <div><label>Referral code</label><input name="referralCode" maxlength="20" placeholder="optional"/></div>
      </div>
      <div style="margin-top:14px;">
        <label style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);
                      display:block;margin-bottom:6px;">Bedrooms</label>
        <select name="rooms" multiple size="6" required style="width:100%;max-width:420px;">${roomOptions}</select>
        <p class="muted" style="font-size:12px;margin-top:6px;">Ctrl/Cmd-click to select more than one.</p>
      </div>
      <div style="margin-top:14px;">
        <label style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);
                      display:block;margin-bottom:6px;">Note</label>
        <input name="notes" maxlength="300" style="width:100%;"/>
      </div>
      <button type="submit" style="margin-top:16px;">Create booking</button>
    </form>
  </div>

  <div class="card scroll">
    <table><thead><tr>
      <th>Guest</th><th>Rooms</th><th>Dates</th><th>Tier</th><th class="num">Paid</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>

  <script>
    const productSelect = document.querySelector('select[name=product]');
    productSelect?.addEventListener('change', () => {
      const opt = productSelect.selectedOptions[0];
      if (!opt || !opt.dataset.tier) return;
      document.getElementById('tier').value = opt.dataset.tier;
      const quoted = document.getElementById('quoted');
      if (!quoted.value && opt.dataset.rate && opt.dataset.rate !== '0') quoted.value = opt.dataset.rate;
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
      <div><label>Method</label><input name="method" placeholder="transfer, cash…"/></div>
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
    <h2 style="font-size:20px;margin-top:0;">Records</h2>
    <p class="muted" style="font-size:13px;">
      <a href="/ops/records?booking=${booking._id}">Photos and documents for this booking</a>
    </p>
  </div>

  <p class="muted" style="font-size:13px;"><a href="/ops/bookings">← All bookings</a></p>`
    })
  );
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
