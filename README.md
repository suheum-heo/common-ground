# Common Ground

A classroom tool that finds genuine agreement across different perspectives — even across divides.

A teacher creates a session and shares a QR code. Students scan it on their own phones, type their view on the topic, and submit. The teacher then runs an AI analysis that surfaces what everyone actually shares, what's a genuine values-level tension, and which students align most closely — so they can physically find each other in the room.

## How it works

1. **Host** enters a discussion topic and clicks "Start Session"
2. A **session code + QR code** appears — share it with the room
3. **Students** scan the QR code on their phones and submit their view
4. **Host** clicks "Analyze Responses" when everyone has submitted
5. Results appear on the host screen **and** on every student's phone automatically

## What the analysis shows

- **Common ground** — genuine concerns or values most people share
- **The factual question** — one empirical question where evidence could shift positions
- **The values tension** — the real underlying disagreement, named without judgment
- **Evidence for each person** — sourced facts supporting each participant's view
- **Who to find** — pairings of students whose underlying values overlap most

## Setup

### Prerequisites

- Node.js 18+
- A [Neon](https://neon.tech) PostgreSQL database
- An [Anthropic](https://console.anthropic.com) API key

### Database

Run these two statements in your Neon console:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  results JSONB
);

CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  person_name TEXT NOT NULL,
  view TEXT NOT NULL,
  submitted_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Installation

```bash
git clone https://github.com/suheum-heo/common-ground.git
cd common-ground
npm install
```

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```
NEON_URL=postgresql://user:password@host/dbname?sslmode=require
CLAUDE_KEY=sk-ant-api03-...
```

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The terminal will also print the local network URL to share with students on the same Wi-Fi.

## Tech stack

- **Frontend** — vanilla HTML/CSS/JS, single file, no build step
- **Backend** — Node.js + Express
- **Database** — Neon (serverless PostgreSQL)
- **AI** — Claude (`claude-sonnet-4-6`) via Anthropic API
- **QR codes** — [goqr.me](https://goqr.me) API (no library needed)
