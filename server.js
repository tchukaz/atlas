import express from 'express';
import path from 'node:path';
import { PORT } from './src/config.js';
import goRoutes from './src/routes/go.js';
import leaderboardRoutes from './src/routes/leaderboard.js';
import adminRoutes from './src/routes/admin.js';

const ROOT = process.cwd();
const app = express();

// Hosts like Render and Fly terminate TLS upstream; without this req.ip is the
// proxy and every click looks like the same visitor.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use(goRoutes);
app.use(leaderboardRoutes);
app.use(adminRoutes);

// Served by allowlist, not by mounting the repo root: .env, data/ and src/ sit
// in the same directory as the marketing site.
app.use(
  '/assets',
  express.static(path.join(ROOT, 'assets'), {
    maxAge: '1d',
    redirect: false
  })
);

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.use((_req, res) => res.status(302).redirect('/'));

app.listen(PORT, () => {
  console.log(`Atlas House running on http://localhost:${PORT}`);
});
