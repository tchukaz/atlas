import express from 'express';
import path from 'node:path';
import { PORT } from './src/config.js';
import { connect, mongoose } from './src/db.js';
import { ensureOwner, loadUser } from './src/auth.js';
import { startRetentionSchedule } from './src/retention.js';
import { startReminderSchedule } from './src/reminders.js';
import goRoutes from './src/routes/go.js';
import joinRoutes from './src/routes/join.js';
import meRoutes from './src/routes/me.js';
import pageRoutes from './src/routes/pages.js';
import leaderboardRoutes from './src/routes/leaderboard.js';
import authRoutes from './src/routes/auth-routes.js';
import adminRoutes from './src/routes/admin.js';
import opsUserRoutes from './src/routes/ops-users.js';
import opsRoutes from './src/routes/ops.js';
import opsBookingRoutes from './src/routes/ops-bookings.js';
import opsRecordRoutes from './src/routes/ops-records.js';
import opsCalendarRoutes from './src/routes/ops-calendar.js';

const ROOT = process.cwd();
const app = express();

// Hosts like Render and Fly terminate TLS upstream; without this req.ip is the
// proxy and every click looks like the same visitor.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Resolves the signed-in staff member before any route decides what to show.
app.use(loadUser);

app.use(goRoutes);
app.use(joinRoutes);
app.use(meRoutes);
app.use(pageRoutes);
app.use(leaderboardRoutes);
app.use(authRoutes);
app.use(adminRoutes);
app.use(opsUserRoutes);
app.use(opsRoutes);
app.use(opsBookingRoutes);
app.use(opsCalendarRoutes);
app.use(opsRecordRoutes);

// Served by allowlist rather than by mounting the repo root: .env, src/ and the
// whole of data/ — which now holds guest records and uploads — sit beside the
// marketing site on disk.
app.use('/assets', express.static(path.join(ROOT, 'assets'), { maxAge: '1d', redirect: false }));

// Fly restarts the machine when this stops answering. It reports the database
// too: a process that is up but cannot reach Mongo serves nothing useful.
app.get('/healthz', (_req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ ok: ready, db: ready ? 'connected' : 'unavailable' });
});

// Paths that moved when the dashboard was reorganised.
app.get('/ops', (_req, res) => res.redirect(302, '/ops/today'));
app.get('/ops/inventory', (_req, res) => res.redirect(301, '/ops/setup'));

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((_req, res) => res.status(302).redirect('/'));

app.use((err, _req, res, _next) => {
  console.error(err);
  const tooBig = err?.code === 'LIMIT_FILE_SIZE';
  res
    .status(tooBig ? 413 : 500)
    .type('html')
    .send(
      `<p style="font-family:sans-serif;padding:24px;">${
        tooBig ? 'That file is too large.' : 'Something went wrong.'
      } <a href="javascript:history.back()">Go back</a></p>`
    );
});

const server = await connect()
  .then(() => {
    console.log('MongoDB connected.');
    return ensureOwner();
  })
  .then(() => {
    return app.listen(PORT, () => {
      console.log(`Atlas House running on http://localhost:${PORT}`);
      startReminderSchedule();
      startRetentionSchedule();
    });
  })
  .catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });

export default server;
