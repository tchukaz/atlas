import { Router } from 'express';
import { SITE_URL } from '../config.js';
import { esc, layout } from '../views.js';
import { normalizePhone } from '../phone.js';
import { Application, Job } from '../models.js';
import { UploadRejected, store, upload } from '../uploads.js';

const router = Router();

const CAREERS_CSS = `
  .role { border:1px solid var(--line); border-radius:4px; padding:22px 24px; margin-bottom:16px;
          background: var(--dark); }
  .role h2 { margin:0 0 6px; font-size:26px; }
  .role a.more { font-size:11px; letter-spacing:0.16em; text-transform:uppercase;
                 text-decoration:none; color:var(--gold); }
  .posting h2 { margin-top:30px; }
  .posting ul { margin:10px 0 0 20px; }
  .posting li { color:#B9B2A6; font-size:15px; margin-bottom:8px; }
  .posting p { color:#B9B2A6; font-size:15px; }
  .field { margin-bottom:16px; }
  .field label { display:block; font-size:10px; letter-spacing:0.18em; text-transform:uppercase;
                 color:var(--gold); margin-bottom:7px; }
  .field input, .field textarea { width:100%; font-family:inherit; }
  .field .hint { font-size:12px; color:var(--muted); margin-top:5px; }
  .check { display:flex; gap:10px; align-items:flex-start; font-size:14px; color:var(--cream);
           margin-bottom:12px; }
  .check input { width:auto; margin-top:3px; flex-shrink:0; }
  .closed { border-left:2px solid var(--muted); padding:12px 16px; background:rgba(245,240,232,0.04);
            margin-bottom:22px; }
`;

/** Google will list an open role in Google Jobs if this is present and valid. */
function jobPostingSchema(job) {
  const lines = [
    job.summary,
    job.responsibilities?.length ? `Responsibilities: ${job.responsibilities.join('; ')}` : '',
    job.requirements?.length ? `Requirements: ${job.requirements.join('; ')}` : ''
  ].filter(Boolean);

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: `<p>${lines.join('</p><p>')}</p>`,
    datePosted: new Date(job.postedOn).toISOString().slice(0, 10),
    ...(job.closesOn ? { validThrough: new Date(job.closesOn).toISOString().slice(0, 10) } : {}),
    employmentType: job.employmentType,
    directApply: true,
    hiringOrganization: {
      '@type': 'Organization',
      name: 'Atlas House',
      sameAs: SITE_URL,
      logo: `${SITE_URL}/assets/logo.png`
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Iwofe',
        addressLocality: 'Port Harcourt',
        addressRegion: 'Rivers State',
        addressCountry: 'NG'
      }
    }
  });
}

/* ── The list ──────────────────────────────────────────────────────────── */

router.get('/careers', async (_req, res) => {
  const jobs = await Job.find({ status: 'open' }).sort('-postedOn').lean();

  const list = jobs.length
    ? jobs
        .map(
          (job) => `<div class="role">
      <h2 class="serif">${esc(job.title)}</h2>
      <p class="muted" style="font-size:13px;margin-bottom:10px;">${esc(job.location)}</p>
      ${job.summary ? `<p style="color:#B9B2A6;font-size:15px;">${esc(job.summary)}</p>` : ''}
      <p style="margin-top:14px;"><a class="more" href="/careers/${esc(job.slug)}">Read the role &rarr;</a></p>
    </div>`
        )
        .join('')
    : `<div class="role"><p class="muted" style="margin:0;">
         No openings at the moment. Worth checking back.
       </p></div>`;

  res.type('html').send(
    layout({
      title: 'Atlas House — Careers',
      extraCss: CAREERS_CSS,
      indexable: true,
      body: `
  <p class="eyebrow">Atlas House · Iwofe, Port Harcourt</p>
  <h1>Work with us</h1>
  <p class="muted" style="margin-top:12px;max-width:56ch;">
    We run a small, well-kept property and we look after the people who keep it that way.
  </p>
  <div style="margin-top:30px;">${list}</div>
  <p class="muted" style="font-size:13px;"><a href="/">Back to Atlas House</a></p>`
    })
  );
});

/* ── One role ──────────────────────────────────────────────────────────── */

router.get('/careers/:slug', async (req, res) => {
  const job = await Job.findOne({ slug: String(req.params.slug).toLowerCase() }).lean();

  if (!job || job.status === 'draft') {
    return res.status(404).type('html').send(
      layout({
        title: 'Atlas House — Careers',
        body: `<h1>No such role</h1>
        <p class="muted" style="margin-top:12px;">
          That opening does not exist. <a href="/careers">See what else is open</a>.
        </p>`
      })
    );
  }

  // Closed roles keep their page rather than vanishing: the link will have been
  // shared around, and "filled" is a better answer than a dead end.
  const closed = job.status === 'closed';
  const flash = typeof req.query.msg === 'string' ? req.query.msg.slice(0, 200) : '';
  const error = typeof req.query.err === 'string' ? req.query.err.slice(0, 200) : '';

  const section = (heading, items) =>
    items?.length
      ? `<h2 class="serif">${esc(heading)}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
      : '';

  const detailRows = job.details?.length
    ? `<h2 class="serif">The role</h2>
       <table style="margin-top:10px;">${job.details
         .map((d) => `<tr><td style="color:var(--gold);width:40%;">${esc(d.label)}</td><td>${esc(d.value)}</td></tr>`)
         .join('')}</table>`
    : '';

  res.type('html').send(
    layout({
      title: `${job.title} — Atlas House`,
      extraCss: CAREERS_CSS,
      indexable: !closed,
      head: closed ? '' : `<script type="application/ld+json">${jobPostingSchema(job)}</script>`,
      body: `
  <p class="eyebrow">Atlas House · Careers</p>
  <h1>${esc(job.title)}</h1>
  <p class="muted" style="margin-top:10px;">${esc(job.location)}</p>

  ${closed ? '<div class="closed" style="margin-top:22px;">This role has been filled. Thank you to everyone who applied.</div>' : ''}
  ${flash ? `<div class="notice" style="margin-top:22px;">${esc(flash)}</div>` : ''}
  ${error ? `<div class="notice bad" style="margin-top:22px;">${esc(error)}</div>` : ''}

  <div class="card posting" style="margin-top:24px;">
    ${job.summary ? `<p>${esc(job.summary)}</p>` : ''}
    ${section('Responsibilities', job.responsibilities)}
    ${section('Requirements and conduct', job.requirements)}
    ${detailRows}
  </div>

  ${
    closed
      ? '<p class="muted" style="font-size:13px;"><a href="/careers">See other openings</a></p>'
      : `<div class="card">
    <h2 class="serif" style="margin-top:0;">Apply</h2>
    <p class="muted" style="font-size:14px;">Fill this in and attach your CV. We review every one.</p>

    <form method="post" action="/careers/${esc(job.slug)}/apply" enctype="multipart/form-data"
          style="margin-top:22px;max-width:520px;">
      <div class="field">
        <label for="name">Your full name</label>
        <input id="name" name="name" required maxlength="80"/>
      </div>
      <div class="field">
        <label for="phone">Phone number</label>
        <input id="phone" name="phone" required maxlength="20" inputmode="tel" placeholder="08026883536"/>
        <div class="hint">We will call or message this number.</div>
      </div>
      <div class="field">
        <label for="cv">Your CV</label>
        <input id="cv" name="cv" type="file" required accept=".pdf,.doc,.docx,image/*"/>
        <div class="hint">PDF, Word document, or a clear photo. Up to 2MB.</div>
      </div>
      <label class="check"><input type="checkbox" name="hasGuarantors" value="1"/>
        <span>I can provide two guarantors with their contact details</span></label>
      <label class="check"><input type="checkbox" name="hasPoliceCert" value="1"/>
        <span>I can provide a police character certificate</span></label>
      <input name="website" tabindex="-1" autocomplete="off"
             style="position:absolute;left:-9999px;" aria-hidden="true"/>
      <button type="submit" style="margin-top:8px;">Send application</button>
      <p class="muted" style="font-size:12px;margin-top:14px;">
        We use your details only to consider you for this role.
      </p>
    </form>
  </div>`
  }

  <p class="muted" style="font-size:13px;">
    <a href="/careers">All openings</a> · <a href="/">Atlas House</a>
  </p>`
    })
  );
});

const attempts = new Map();

router.post('/careers/:slug/apply', upload.single('cv'), async (req, res) => {
  const slug = String(req.params.slug).toLowerCase();
  const to = `/careers/${slug}`;
  const back = (params) => res.redirect(302, `${to}?${new URLSearchParams(params)}`);

  const job = await Job.findOne({ slug, status: 'open' }).lean();
  if (!job) return back({ err: 'That role is no longer open.' });

  const b = req.body || {};
  if (b.website) return back({ err: 'Something went wrong.' });

  const ip = req.ip || 'unknown';
  const seen = (attempts.get(ip) || 0) + 1;
  attempts.set(ip, seen);
  if (seen > 5) return back({ err: 'Too many attempts. Please try again later.' });

  const name = String(b.name || '').trim().slice(0, 80);
  if (name.length < 2) return back({ err: 'Please give your name.' });

  const phone = normalizePhone(b.phone);
  if (!phone) return back({ err: 'That does not look like a Nigerian mobile number.' });

  if (!req.file) return back({ err: 'Please attach your CV.' });

  let cv;
  try {
    cv = await store(req.file);
  } catch (err) {
    if (err instanceof UploadRejected) return back({ err: err.message });
    throw err;
  }

  await Application.create({
    job: job._id,
    name,
    phone,
    cvFilename: cv.filename,
    cvKind: cv.kind,
    cvBytes: cv.bytes,
    hasGuarantors: Boolean(b.hasGuarantors),
    hasPoliceCert: Boolean(b.hasPoliceCert)
  });

  back({ msg: `Thank you, ${name.split(/\s+/)[0]}. We have your application and will be in touch.` });
});

export default router;
