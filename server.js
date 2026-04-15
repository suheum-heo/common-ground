import express from 'express';
import { neon } from '@neondatabase/serverless';
import { networkInterfaces } from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFileSync } from 'fs';

// Load .env manually (no extra dependency needed)
try {
  const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
} catch {}

// ── Config ──────────────────────────────────────────────────────────
const NEON_URL      = process.env.NEON_URL;
const CLAUDE_KEY    = process.env.CLAUDE_KEY;
const MODEL         = 'claude-sonnet-4-6';
const PORT          = 3000;
// ───────────────────────────────────────────────────────────────────

const sql = neon(NEON_URL);
const app = express();
app.use(express.json());
app.use(express.static(dirname(fileURLToPath(import.meta.url))));

// ── Helpers ─────────────────────────────────────────────────────────
function getLocalIP() {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function makeId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Routes ───────────────────────────────────────────────────────────

// Host info — local IP so the browser can build the QR code URL
app.get('/api/host-info', (_req, res) => {
  res.json({ ip: getLocalIP(), port: PORT });
});

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const { topic } = req.body;
    if (!topic?.trim()) return res.status(400).json({ error: 'topic required' });
    const id = makeId();
    await sql`INSERT INTO sessions (id, topic) VALUES (${id}, ${topic.trim()})`;
    res.json({ id, topic: topic.trim() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get session
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM sessions WHERE id = ${req.params.id.toUpperCase()}`;
    if (!rows.length) return res.status(404).json({ error: 'Session not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Submit a view
app.post('/api/sessions/:id/submissions', async (req, res) => {
  try {
    const { name, view } = req.body;
    if (!name?.trim() || !view?.trim()) return res.status(400).json({ error: 'name and view required' });
    const sid = req.params.id.toUpperCase();
    const sess = await sql`SELECT id FROM sessions WHERE id = ${sid}`;
    if (!sess.length) return res.status(404).json({ error: 'Session not found' });
    await sql`INSERT INTO submissions (session_id, person_name, view) VALUES (${sid}, ${name.trim()}, ${view.trim()})`;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List submissions
app.get('/api/sessions/:id/submissions', async (req, res) => {
  try {
    const rows = await sql`
      SELECT id, person_name, view, submitted_at
      FROM submissions
      WHERE session_id = ${req.params.id.toUpperCase()}
      ORDER BY submitted_at ASC`;
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analyze — calls Claude, saves results to DB, returns structured JSON
app.post('/api/sessions/:id/analyze', async (req, res) => {
  try {
    const sessionId = req.params.id.toUpperCase();
    const { topic, submissions } = req.body;
    if (!submissions?.length) return res.status(400).json({ error: 'No submissions' });

    const n         = submissions.length;
    const viewLines = submissions
      .map((s, i) => `Person ${i + 1} (${s.person_name}): ${s.view}`)
      .join('\n\n');

    const system = `You are a thoughtful facilitator AND knowledgeable research assistant \
analyzing ${n} people's perspectives on a topic.

Be intellectually honest: no invented agreement, no moralizing, no preachy tone. \
Treat everyone as an adult.

Return ONLY valid JSON, no markdown, no preamble:
{
  "shared": ["2–3 genuine concerns, fears, or values that most or all share"],
  "factual": "One specific empirical question where evidence could shift someone's position",
  "values": "One genuine values-level tension across the group — name it directly without judgment",
  "stats": [
    [{"stat": "real fact supporting person 1's view", "source": "source name"}],
    [{"stat": "real fact supporting person 2's view", "source": "source name"}]
  ],
  "matches": [
    {"persons": [1, 2], "reason": "one sentence on why these two align most closely"}
  ]
}

Rules:
- "stats" must be an array of exactly ${n} inner arrays (one per person, same order). \
  Each inner array: 1–2 real, sourced facts from your training knowledge.
- "matches" must list the 1–3 most meaningful pairings (or small groups) in the room — \
  people whose underlying concerns or values overlap most, even if their stated positions differ. \
  This helps students physically find each other. Be specific about WHY they match.`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 1024 + n * 300,
        system,
        messages: [{ role: 'user', content: `Topic: ${topic}\n\n${viewLines}` }],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}));
      return res.status(apiRes.status).json({ error: err?.error?.message || 'Claude API error' });
    }

    const data    = await apiRes.json();
    const raw     = data.content?.find(b => b.type === 'text')?.text?.trim() ?? '';
    console.log('Claude raw response:', raw.substring(0, 500));
    // Strip markdown fences, then extract the first {...} block
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON: ' + stripped.substring(0, 200));
    const parsed  = JSON.parse(jsonMatch[0]);

    // Save results + submission snapshot so students can view them
    const payload = { ...parsed, submissions: submissions.map(s => ({ person_name: s.person_name, view: s.view })) };
    await sql`UPDATE sessions SET results = ${JSON.stringify(payload)}::jsonb WHERE id = ${sessionId}`;
    console.log(`Results saved for session ${sessionId}`);

    res.json(parsed);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Start ────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\nCommon Ground is running.\n');
  console.log(`  Open in your browser:  http://localhost:${PORT}`);
  console.log(`  Share with students:   http://${ip}:${PORT}\n`);
});
