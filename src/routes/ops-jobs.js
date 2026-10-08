import { Router } from 'express';
import { SITE_URL } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, iso, pretty, todayIso } from '../views-ops.js';
import { requireCan, record } from '../auth.js';
import { formatPhone } from '../phone.js';
import { Application, Job } from '../models.js';
import { open as openObject } from '../storage.js';

const router = Router();

const slugify = (title) =>
  String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

// One per line in a textarea is the least fiddly way to edit a list on a phone.
const lines = (value) =>
  String(value || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40);

const pairs = (value) =>
  lines(value)
    .map((l) => {
      const i = l.indexOf(':');
      return i === -1 ? null : { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
    })
    .filter(Boolean);

const STATUS_PILL = { draft: '', open: 'good', closed: 'warn' };

/* ── Listings ──────────────────────────────────────────────────────────── */

router.get('/ops/jobs', requireCan('jobs.manage'), async (req, res) => {
  const [jobs, counts] = await Promise.all([
    Job.find().sort('-createdAt').lean(),
    Application.aggregate([{ $group: { _id: '$job', n: { $sum: 1 }, fresh: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } } } }])
  ]);
  const byJob = new Map(counts.map((c) => [String(c._id), c]));

  const rows = jobs.length
    ? jobs
        .map((j) => {
          const c = byJob.get(String(j._id));
          const expired = j.closesOn && new Date(j.closesOn) < new Date();
          return `<tr>
      <td data-h="Role"><strong>${esc(j.title)}</strong><br/>
        <span class="mono" style="font-size:11px;">/careers/${esc(j.slug)}</span></td>
      <td data-h="Status"><span class="pill ${STATUS_PILL[j.status]}">${esc(j.status)}</span>
        ${expired && j.status === 'open' ? '<br/><span class="pill warn">past closing date</span>' : ''}</td>
      <td data-h="Closes">${j.closesOn ? pretty(j.closesOn) : '<span class="muted">no date</span>'}</td>
      <td data-h="Applications" class="num">
        ${c?.n || 0}${c?.fresh ? `<br/><span class="pill good">${c.fresh} new</span>` : ''}</td>
      <td>
        <a href="/ops/jobs/${j._id}"><button type="button" class="ghost">Edit</button></a>
        <a href="/ops/jobs/${j._id}/applications"><button type="button" class="ghost">Applicants</button></a>
        <form method="post" action="/ops/jobs/${j._id}/status" style="display:inline;">
          <input type="hidden" name="status" value="${j.status === 'open' ? 'closed' : 'open'}"/>
          <button type="submit" class="ghost">${j.status === 'open' ? 'Close' : 'Publish'}</button>
        </form>
      </td>
    </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:24px 10px;">No roles yet.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Hiring',
      active: '/ops/jobs',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Hiring', null]],
      body: `
  <div class="card">
    <p class="muted" style="font-size:13px;margin:0;">
      Open roles appear at <a href="/careers">${esc(SITE_URL)}/careers</a> and are eligible for Google
      Jobs. Closing one keeps its page but marks it filled, so a shared link still makes sense.
    </p>
  </div>

  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Role</th><th>Status</th><th>Closes</th><th class="num">Applications</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Post a role</h2>
    <form method="post" action="/ops/jobs">
      <div class="grid">
        <div><label>Title</label><input name="title" required maxlength="80" placeholder="Security Guard"/></div>
        <div><label>Closes on</label><input name="closesOn" type="date"/></div>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Summary</label>
        <textarea name="summary" rows="2" maxlength="400" style="width:100%;"
          placeholder="One or two lines about the role."></textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Responsibilities</label>
        <textarea name="responsibilities" rows="6" style="width:100%;" placeholder="One per line"></textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Requirements and conduct</label>
        <textarea name="requirements" rows="6" style="width:100%;" placeholder="One per line"></textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Role details</label>
        <textarea name="details" rows="4" style="width:100%;"
          placeholder="Shift pattern: 2 off days weekly&#10;Reports to: Manager&#10;Uniform: Provided"></textarea>
        <p class="muted" style="font-size:12px;margin-top:6px;">One per line, as <span class="mono">Label: value</span>.</p>
      </div>
      <button type="submit" style="margin-top:16px;">Save as draft</button>
    </form>
  </div>`
    })
  );
});

router.post('/ops/jobs', requireCan('jobs.manage'), async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim().slice(0, 80);
  if (!title) return back(res, '/ops/jobs', { err: 'A role needs a title.' });

  let slug = slugify(title);
  if (await Job.exists({ slug })) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const job = await Job.create({
    title,
    slug,
    summary: String(b.summary || '').trim().slice(0, 400),
    responsibilities: lines(b.responsibilities),
    requirements: lines(b.requirements),
    details: pairs(b.details),
    closesOn: b.closesOn || undefined
  });

  await record(req, 'job.created', job.title);
  back(res, `/ops/jobs/${job._id}`, { msg: `${title} saved as a draft. Review it, then publish.` });
});

/* ── Edit one ──────────────────────────────────────────────────────────── */

router.get('/ops/jobs/:id', requireCan('jobs.manage'), async (req, res) => {
  const job = await Job.findById(req.params.id).lean();
  if (!job) return back(res, '/ops/jobs', { err: 'No such role.' });

  res.type('html').send(
    page({
      title: job.title,
      active: '/ops/jobs',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Hiring', '/ops/jobs'], [job.title, null]],
      body: `
  <div class="card">
    <p class="muted" style="font-size:13px;margin:0;">
      <span class="pill ${STATUS_PILL[job.status]}">${esc(job.status)}</span>
      ${job.status === 'draft' ? 'Not visible to anyone yet.' : `<a href="/careers/${esc(job.slug)}">View the public page</a>`}
      · <a href="/ops/jobs/${job._id}/applications">Applicants</a>
    </p>
  </div>

  <div class="card">
    <form method="post" action="/ops/jobs/${job._id}">
      <div class="grid">
        <div><label>Title</label><input name="title" required maxlength="80" value="${esc(job.title)}"/></div>
        <div><label>Closes on</label><input name="closesOn" type="date" value="${iso(job.closesOn)}"/></div>
        <div><label>Status</label><select name="status">
          ${['draft', 'open', 'closed'].map((s) => `<option value="${s}"${s === job.status ? ' selected' : ''}>${s}</option>`).join('')}
        </select></div>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Summary</label>
        <textarea name="summary" rows="2" maxlength="400" style="width:100%;">${esc(job.summary || '')}</textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Responsibilities</label>
        <textarea name="responsibilities" rows="8" style="width:100%;">${esc((job.responsibilities || []).join('\n'))}</textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Requirements and conduct</label>
        <textarea name="requirements" rows="8" style="width:100%;">${esc((job.requirements || []).join('\n'))}</textarea>
      </div>
      <div style="margin-top:14px;">
        <label class="stat-label" style="display:block;margin-bottom:6px;color:var(--gold);">Role details</label>
        <textarea name="details" rows="4" style="width:100%;">${esc((job.details || []).map((d) => `${d.label}: ${d.value}`).join('\n'))}</textarea>
      </div>
      <button type="submit" style="margin-top:16px;">Save</button>
    </form>
  </div>

  <p class="muted" style="font-size:13px;"><a href="/ops/jobs">← All roles</a></p>`
    })
  );
});

router.post('/ops/jobs/:id', requireCan('jobs.manage'), async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) return back(res, '/ops/jobs', { err: 'No such role.' });

  const b = req.body || {};
  job.title = String(b.title || job.title).trim().slice(0, 80);
  job.summary = String(b.summary || '').trim().slice(0, 400);
  job.responsibilities = lines(b.responsibilities);
  job.requirements = lines(b.requirements);
  job.details = pairs(b.details);
  job.closesOn = b.closesOn || undefined;
  if (['draft', 'open', 'closed'].includes(b.status)) job.status = b.status;
  await job.save();

  await record(req, 'job.updated', job.title, job.status);
  back(res, `/ops/jobs/${job._id}`, { msg: 'Saved.' });
});

router.post('/ops/jobs/:id/status', requireCan('jobs.manage'), async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) return back(res, '/ops/jobs', { err: 'No such role.' });
  job.status = req.body?.status === 'open' ? 'open' : 'closed';
  if (job.status === 'open' && !job.postedOn) job.postedOn = new Date();
  await job.save();
  await record(req, 'job.' + job.status, job.title);
  back(res, '/ops/jobs', { msg: `${job.title} is now ${job.status}.` });
});

/* ── Applicants ────────────────────────────────────────────────────────── */

router.get('/ops/jobs/:id/applications', requireCan('applications.view'), async (req, res) => {
  const job = await Job.findById(req.params.id).lean();
  if (!job) return back(res, '/ops/jobs', { err: 'No such role.' });

  const apps = await Application.find({ job: job._id }).sort('-createdAt').lean();

  const rows = apps.length
    ? apps
        .map(
          (a) => `<tr>
      <td data-h="Applicant"><strong>${esc(a.name)}</strong><br/>
        <span class="muted" style="font-size:11px;">${esc(formatPhone(a.phone) || '')}</span></td>
      <td data-h="CV">${
        a.cvFilename
          ? `<a href="/ops/applications/${a._id}/cv" target="_blank" rel="noopener">Open CV</a>
             <br/><span class="muted" style="font-size:11px;">${Math.round((a.cvBytes || 0) / 1024)}KB</span>`
          : '<span class="muted">none</span>'
      }</td>
      <td data-h="Checks">
        <span class="pill ${a.hasGuarantors ? 'good' : 'warn'}">guarantors ${a.hasGuarantors ? 'yes' : 'no'}</span>
        <span class="pill ${a.hasPoliceCert ? 'good' : 'warn'}">police cert ${a.hasPoliceCert ? 'yes' : 'no'}</span></td>
      <td data-h="Applied">${pretty(a.createdAt)}</td>
      <td data-h="Status">
        <form method="post" action="/ops/applications/${a._id}" style="display:flex;gap:6px;align-items:center;">
          <select name="status">
            ${['new', 'shortlisted', 'rejected', 'hired']
              .map((s) => `<option value="${s}"${s === a.status ? ' selected' : ''}>${s}</option>`)
              .join('')}
          </select>
          <button type="submit">Save</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:24px 10px;">
         Nobody has applied through the form yet. WhatsApp applications arrive in the usual inbox.
       </td></tr>`;

  res.type('html').send(
    page({
      title: `${job.title} — applicants`,
      active: '/ops/jobs',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Hiring', '/ops/jobs'], [job.title, `/ops/jobs/${job._id}`], ['Applicants', null]],
      body: `
  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${apps.length}</div><div class="stat-label">Applications</div></div>
      <div><div class="stat-number">${apps.filter((a) => a.status === 'new').length}</div><div class="stat-label">Unreviewed</div></div>
      <div><div class="stat-number">${apps.filter((a) => a.status === 'shortlisted').length}</div><div class="stat-label">Shortlisted</div></div>
    </div>
  </div>

  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Applicant</th><th>CV</th><th>Checks</th><th>Applied</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>

  <p class="muted" style="font-size:13px;"><a href="/ops/jobs">← All roles</a></p>`
    })
  );
});

// Served through here rather than as a public URL: a CV carries a name, a
// number and an address history.
router.get('/ops/applications/:id/cv', requireCan('applications.view'), async (req, res) => {
  const app = await Application.findById(req.params.id).lean();
  if (!app?.cvFilename) return res.status(404).end();

  const found = await openObject(app.cvFilename);
  if (!found) return res.status(404).type('html').send('That file is no longer stored.');

  await record(req, 'application.cv_viewed', app.name);
  res.set('Cache-Control', 'no-store, private');
  if (found.kind === 'path') return res.sendFile(found.path);

  res.set('Content-Type', found.contentType || 'application/octet-stream');
  if (found.length) res.set('Content-Length', found.length);
  const { Readable } = await import('node:stream');
  Readable.fromWeb(found.stream).pipe(res);
});

router.post('/ops/applications/:id', requireCan('applications.view'), async (req, res) => {
  const app = await Application.findById(req.params.id);
  if (!app) return back(res, '/ops/jobs', { err: 'No such application.' });
  if (['new', 'shortlisted', 'rejected', 'hired'].includes(req.body?.status)) {
    app.status = req.body.status;
    await app.save();
    await record(req, 'application.' + app.status, app.name);
  }
  back(res, `/ops/jobs/${app.job}/applications`, { msg: `${app.name} marked ${app.status}.` });
});

export default router;
