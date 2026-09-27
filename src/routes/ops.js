import { Router } from 'express';
import { naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back } from '../views-ops.js';
import { requireAdmin } from '../auth.js';
import { Product, Property, Room, SHAPES, TIERS } from '../models.js';

const router = Router();
router.use('/ops', requireAdmin);


/* ── Inventory ─────────────────────────────────────────────────────────── */

router.get('/ops/inventory', async (req, res) => {
  const [properties, rooms, products] = await Promise.all([
    Property.find().sort('name').lean(),
    Room.find().lean(),
    Product.find().sort('name').lean()
  ]);

  const roomsBy = new Map();
  for (const room of rooms) {
    const key = String(room.property);
    if (!roomsBy.has(key)) roomsBy.set(key, []);
    roomsBy.get(key).push(room);
  }

  const propertyRows = properties.length
    ? properties
        .map((p) => {
          const own = roomsBy.get(String(p._id)) || [];
          return `<tr${p.active ? '' : ' style="opacity:0.45;"'}>
        <td><strong>${esc(p.name)}</strong>${p.active ? '' : ' <span class="muted">(inactive)</span>'}
            ${p.notes ? `<br/><span class="muted" style="font-size:11px;">${esc(p.notes)}</span>` : ''}</td>
        <td class="num">${p.bedrooms}</td>
        <td>${own.map((r) => `<span class="pill">${esc(r.name)}</span>`).join(' ') || '<span class="muted">none</span>'}</td>
        <td><span class="pill ${p.splittable ? 'on' : ''}">${p.splittable ? 'Splittable' : 'Whole only'}</span></td>
        <td>
          <form method="post" action="/ops/inventory/toggle-split" style="display:inline;">
            <input type="hidden" name="id" value="${p._id}"/>
            <button type="submit" class="ghost">${p.splittable ? 'Lock whole' : 'Allow split'}</button>
          </form>
          <form method="post" action="/ops/inventory/toggle-active" style="display:inline;">
            <input type="hidden" name="id" value="${p._id}"/>
            <button type="submit" class="ghost">${p.active ? 'Deactivate' : 'Reactivate'}</button>
          </form>
        </td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:24px 10px;">No apartments yet. Add one below.</td></tr>`;

  const productRows = products.length
    ? products
        .map(
          (p) => `<tr${p.active ? '' : ' style="opacity:0.45;"'}>
        <td><strong>${esc(p.name)}</strong></td>
        <td>${esc(SHAPES[p.shape])}</td>
        <td><span class="pill ${p.tier === 'premium' ? 'on' : ''}">${p.tier}</span></td>
        <td class="num">${p.referenceRate ? naira(p.referenceRate) : '<span class="muted">—</span>'}</td>
        <td>
          <form method="post" action="/ops/products/toggle">
            <input type="hidden" name="id" value="${p._id}"/>
            <button type="submit" class="ghost">${p.active ? 'Deactivate' : 'Reactivate'}</button>
          </form>
        </td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:24px 10px;">No products yet.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Inventory',
      active: '/ops/inventory',
      ...flashOf(req),
      body: `
  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Apartment</th><th class="num">Beds</th><th>Bedrooms</th><th>Sold as</th><th></th>
    </tr></thead><tbody>${propertyRows}</tbody></table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Add an apartment</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Bedrooms are created automatically and are what bookings actually hold. Allow splitting only
      where you are willing to put unrelated guests in the same apartment.
    </p>
    <form method="post" action="/ops/inventory" class="grid">
      <div><label>Name</label><input name="name" required placeholder="Apartment A"/></div>
      <div><label>Bedrooms</label><input name="bedrooms" type="number" min="1" max="6" value="2"/></div>
      <div><label>Sold as</label>
        <select name="splittable">
          <option value="">Whole apartment only</option>
          <option value="1">Whole or by the bedroom</option>
        </select></div>
      <div><label>Note</label><input name="notes" placeholder="optional"/></div>
      <div><button type="submit">Add</button></div>
    </form>
  </div>

  <h2>Products</h2>
  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Name</th><th>Shape</th><th>Tier</th><th class="num">Reference rate</th><th></th>
    </tr></thead><tbody>${productRows}</tbody></table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Add a product</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Tier is a promise about backup power, not a different apartment.
      <strong style="color:#F5F0E8;">Premium</strong> runs the generator so AC survives an outage;
      <strong style="color:#F5F0E8;">Standard</strong> runs the inverter, which does not power AC.
      The reference rate is what you would normally charge — you still type the actual amount on each
      booking.
    </p>
    <form method="post" action="/ops/products" class="grid">
      <div><label>Name</label><input name="name" required placeholder="Entire 2-bed · Premium"/></div>
      <div><label>Shape</label><select name="shape">
        ${Object.entries(SHAPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select></div>
      <div><label>Tier</label><select name="tier">
        <option value="standard">Standard</option><option value="premium">Premium</option>
      </select></div>
      <div><label>Bedrooms</label><input name="bedrooms" type="number" min="1" max="6" value="1"/></div>
      <div><label>Reference rate</label><input name="referenceRate" type="number" min="0" placeholder="0"/></div>
      <div><button type="submit">Add</button></div>
    </form>
  </div>`
    })
  );
});

router.post('/ops/inventory', async (req, res) => {
  const { name, bedrooms, splittable, notes } = req.body || {};
  const count = Math.max(1, Math.min(6, Math.trunc(Number(bedrooms) || 1)));
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) return back(res, '/ops/inventory', { err: 'An apartment needs a name.' });

  const property = await Property.create({
    name: clean,
    bedrooms: count,
    splittable: Boolean(splittable),
    notes: String(notes || '').trim().slice(0, 200)
  });

  await Room.insertMany(
    Array.from({ length: count }, (_, i) => ({
      property: property._id,
      name: count === 1 ? 'Bedroom' : `Bedroom ${i + 1}`
    }))
  );

  back(res, '/ops/inventory', { msg: `${clean} added with ${count} bedroom(s).` });
});

router.post('/ops/inventory/toggle-split', async (req, res) => {
  const property = await Property.findById(req.body?.id);
  if (property) {
    property.splittable = !property.splittable;
    await property.save();
  }
  back(res, '/ops/inventory', { msg: 'Updated.' });
});

router.post('/ops/inventory/toggle-active', async (req, res) => {
  const property = await Property.findById(req.body?.id);
  if (property) {
    property.active = !property.active;
    await property.save();
    // Deactivating hides it from new bookings; past bookings keep their history,
    // which is why nothing here deletes.
    await Room.updateMany({ property: property._id }, { $set: { active: property.active } });
  }
  back(res, '/ops/inventory', { msg: 'Updated.' });
});

router.post('/ops/products', async (req, res) => {
  const { name, shape, tier, bedrooms, referenceRate } = req.body || {};
  const clean = String(name || '').trim().slice(0, 80);
  if (!clean) return back(res, '/ops/inventory', { err: 'A product needs a name.' });
  await Product.create({
    name: clean,
    shape: SHAPES[shape] ? shape : 'entire',
    tier: TIERS[tier] ? tier : 'standard',
    bedrooms: Math.max(1, Math.trunc(Number(bedrooms) || 1)),
    referenceRate: Math.max(0, Math.trunc(Number(referenceRate) || 0))
  });
  back(res, '/ops/inventory', { msg: `${clean} added.` });
});

router.post('/ops/products/toggle', async (req, res) => {
  const product = await Product.findById(req.body?.id);
  if (product) {
    product.active = !product.active;
    await product.save();
  }
  back(res, '/ops/inventory', { msg: 'Updated.' });
});

export default router;
