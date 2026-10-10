import { Router } from 'express';
import { campaignLink, naira } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, iso, pretty } from '../views-ops.js';
import { requireCan, record } from '../auth.js';
import { Campaign } from '../models.js';
import { PLATFORMS, campaignStats, freeCode, normalizeCampaignCode } from '../campaigns.js';

const router = Router();

router.get('/ops/campaigns', requireCan('reports.view'), async (req, res) => {
  const rows = await campaignStats();
  const suggested = await freeCode();

  const total = rows.reduce(
    (a, r) => ({
      spend: a.spend + (r.spend || 0),
      counted: a.counted + r.counted,
      hits: a.hits + r.hits,
      bookings: a.bookings + r.bookings,
      revenue: a.revenue + r.revenue
    }),
    { spend: 0, counted: 0, hits: 0, bookings: 0, revenue: 0 }
  );

  const table = rows.length
    ? rows
        .map(
          (c) => `<tr${c.active ? '' : ' style="opacity:0.5;"'}>
      <td data-h="Campaign"><strong>${esc(c.name)}</strong>${c.active ? '' : ' <span class="muted">(ended)</span>'}<br/>
        <span class="muted" style="font-size:11px;">${esc(c.platform)}</span><br/>
        <span class="mono" style="font-size:11px;">${esc(campaignLink(c.code))}</span>
        <button type="button" class="ghost copy" data-copy="${esc(campaignLink(c.code))}"
                style="margin-top:5px;">Copy link</button></td>
      <td data-h="Clicks" class="num"><strong>${c.counted}</strong>
        <br/><span class="muted" style="font-size:11px;">${c.hits} hits · ${c.bots} bots · ${c.repeats} repeat</span></td>
      <td data-h="Enquiries">
        <form method="post" action="/ops/campaigns/${c._id}/enquiries" style="display:flex;gap:6px;align-items:center;">
          <input class="num" name="enquiries" type="number" min="0" value="${c.enquiries}"/>
          <button type="submit">Save</button>
        </form></td>
      <td data-h="Bookings" class="num">${c.bookings}${c.nights ? `<br/><span class="muted" style="font-size:11px;">${c.nights} nights</span>` : ''}</td>
      <td data-h="Spend" class="num">${naira(c.spend)}${c.budget ? `<br/><span class="muted" style="font-size:11px;">of ${naira(c.budget)}</span>` : ''}</td>
      <td data-h="Cost per" class="num">
        ${c.costPerBooking !== null ? `<strong>${naira(c.costPerBooking)}</strong> / booking<br/>` : ''}
        ${c.costPerEnquiry !== null ? `<span class="muted" style="font-size:11px;">${naira(c.costPerEnquiry)} / enquiry</span><br/>` : ''}
        ${c.costPerClick !== null ? `<span class="muted" style="font-size:11px;">${naira(c.costPerClick)} / click</span>` : ''}
        ${c.costPerBooking === null && c.costPerClick === null ? '<span class="muted">—</span>' : ''}</td>
      <td><a href="/ops/campaigns/${c._id}"><button type="button" class="ghost">Edit</button></a></td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="muted" style="padding:24px 10px;">No campaigns yet.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Campaigns',
      active: '/ops/campaigns',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Campaigns', null]],
      body: `
  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${naira(total.spend)}</div><div class="stat-label">Spent</div></div>
      <div><div class="stat-number">${total.counted}</div><div class="stat-label">Clicks</div></div>
      <div><div class="stat-number">${total.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${naira(total.revenue)}</div><div class="stat-label">Collected</div></div>
      <div><div class="stat-number">${total.bookings ? naira(Math.round(total.spend / total.bookings)) : '—'}</div>
        <div class="stat-label">Cost per booking</div></div>
    </div>
    <p class="muted" style="font-size:13px;margin-top:18px;">
      Clicks here exclude bots and count one device once a day, so this number will read lower than
      Instagram or Facebook report. Theirs counts taps; this counts arrivals.
    </p>
  </div>

  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Campaign</th><th class="num">Clicks</th><th>Enquiries</th><th class="num">Bookings</th>
      <th class="num">Spend</th><th class="num">Cost per</th><th></th>
    </tr></thead><tbody>${table}</tbody></table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">New campaign</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      One code per thing you want to measure separately. Three creatives you want to compare means
      three campaigns.
    </p>
    <form method="post" action="/ops/campaigns" class="grid">
      <div><label>Name</label><input name="name" required maxlength="60" placeholder="October Instagram — Reel A"/></div>
      <div><label>Platform</label><select name="platform">
        ${PLATFORMS.map((p) => `<option value="${p}">${esc(p)}</option>`).join('')}
      </select></div>
      <div><label>Public code</label><input name="code" value="${suggested}" maxlength="8" inputmode="numeric"/>
        <div class="muted" style="font-size:11px;margin-top:4px;">Numbers only — the guest sees this</div></div>
      <div><label>Budget</label><input name="budget" type="number" min="0" inputmode="numeric"/></div>
      <div><label>Starts</label><input name="startsOn" type="date"/></div>
      <div><label>Ends</label><input name="endsOn" type="date"/></div>
      <div><button type="submit">Create</button></div>
    </form>
  </div>

  <script>
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('.copy');
      if (!button) return;
      await navigator.clipboard.writeText(button.dataset.copy);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1400);
    });
  </script>`
    })
  );
});

router.post('/ops/campaigns', requireCan('reports.view'), async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) return back(res, '/ops/campaigns', { err: 'A campaign needs a name.' });

  let code = normalizeCampaignCode(b.code);
  if (code.length < 3) code = await freeCode();
  if (await Campaign.exists({ code })) {
    return back(res, '/ops/campaigns', { err: `Code ${code} is already in use.` });
  }

  const campaign = await Campaign.create({
    name,
    code,
    platform: PLATFORMS.includes(b.platform) ? b.platform : 'other',
    budget: Math.max(0, Math.trunc(Number(b.budget) || 0)),
    startsOn: b.startsOn || undefined,
    endsOn: b.endsOn || undefined
  });

  await record(req, 'campaign.created', `${campaign.name} (${campaign.code})`);
  back(res, '/ops/campaigns', { msg: `${name} is live at /c/${code}.` });
});

router.post('/ops/campaigns/:id/enquiries', requireCan('reports.view'), async (req, res) => {
  await Campaign.updateOne(
    { _id: req.params.id },
    { $set: { enquiries: Math.max(0, Math.trunc(Number(req.body?.enquiries) || 0)) } }
  );
  back(res, '/ops/campaigns', { msg: 'Enquiries updated.' });
});

router.get('/ops/campaigns/:id', requireCan('reports.view'), async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).lean();
  if (!campaign) return back(res, '/ops/campaigns', { err: 'No such campaign.' });
  const stats = (await campaignStats()).find((c) => String(c._id) === String(campaign._id));

  res.type('html').send(
    page({
      title: campaign.name,
      active: '/ops/campaigns',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Campaigns', '/ops/campaigns'], [campaign.name, null]],
      body: `
  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${stats.counted}</div><div class="stat-label">Clicks counted</div></div>
      <div><div class="stat-number">${stats.hits}</div><div class="stat-label">Raw hits</div></div>
      <div><div class="stat-number">${stats.bots}</div><div class="stat-label">Bots</div></div>
      <div><div class="stat-number">${stats.repeats}</div><div class="stat-label">Repeat visits</div></div>
      <div><div class="stat-number">${stats.bookings}</div><div class="stat-label">Bookings</div></div>
    </div>
    <p class="muted" style="font-size:13px;margin-top:18px;">
      Link: <span class="mono">${esc(campaignLink(campaign.code))}</span><br/>
      Guests see <span class="mono">Hi Atlas House - ${esc(campaign.code)}, I'd like to book your apartment.</span>
      ${stats.lastAt ? `<br/>Last click ${pretty(stats.lastAt)}.` : ''}
    </p>
  </div>

  <div class="card">
    <form method="post" action="/ops/campaigns/${campaign._id}">
      <div class="grid">
        <div><label>Name</label><input name="name" required maxlength="60" value="${esc(campaign.name)}"/></div>
        <div><label>Platform</label><select name="platform">
          ${PLATFORMS.map((p) => `<option value="${p}"${p === campaign.platform ? ' selected' : ''}>${esc(p)}</option>`).join('')}
        </select></div>
        <div><label>Budget</label><input name="budget" type="number" min="0" value="${campaign.budget || 0}"/></div>
        <div><label>Spent so far</label><input name="spend" type="number" min="0" value="${campaign.spend || 0}"/></div>
        <div><label>Starts</label><input name="startsOn" type="date" value="${iso(campaign.startsOn)}"/></div>
        <div><label>Ends</label><input name="endsOn" type="date" value="${iso(campaign.endsOn)}"/></div>
        <div><label>Running</label><select name="active">
          <option value="1"${campaign.active ? ' selected' : ''}>Yes</option>
          <option value=""${campaign.active ? '' : ' selected'}>Ended</option>
        </select></div>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Notes</label>
        <input name="notes" maxlength="300" style="width:100%;" value="${esc(campaign.notes || '')}"/>
      </div>
      <button type="submit" style="margin-top:16px;">Save</button>
    </form>
    <p class="muted" style="font-size:12px;margin-top:14px;">
      The code cannot be changed — links are already out in the world.
      Ending a campaign stops it counting as live spend; the link keeps working.
    </p>
  </div>

  <p class="muted" style="font-size:13px;"><a href="/ops/campaigns">← All campaigns</a></p>`
    })
  );
});

router.post('/ops/campaigns/:id', requireCan('reports.view'), async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return back(res, '/ops/campaigns', { err: 'No such campaign.' });

  const b = req.body || {};
  campaign.name = String(b.name || campaign.name).trim().slice(0, 60);
  if (PLATFORMS.includes(b.platform)) campaign.platform = b.platform;
  campaign.budget = Math.max(0, Math.trunc(Number(b.budget) || 0));
  campaign.spend = Math.max(0, Math.trunc(Number(b.spend) || 0));
  campaign.startsOn = b.startsOn || undefined;
  campaign.endsOn = b.endsOn || undefined;
  campaign.active = Boolean(b.active);
  campaign.notes = String(b.notes || '').slice(0, 300);
  await campaign.save();

  await record(req, 'campaign.updated', campaign.name, `spend ${campaign.spend}`);
  back(res, `/ops/campaigns/${campaign._id}`, { msg: 'Saved.' });
});

export default router;
