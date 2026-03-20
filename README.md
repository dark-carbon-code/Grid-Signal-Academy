# Grid Signal Academy — Self-Contained Service

A standalone training platform for identifying electric grid event signatures, powered by the DOE Grid Event Signature Library (GESL) and an AI tutor (Grid Mentor).

**No external infrastructure required.** One Python process serves everything.

## Quick Start

```bash
pip install flask requests
python3 app.py
# Open http://localhost:5000
```

## Features

- **4 Game Modes** — Standard, Timed Challenge, Daily Drill, Normal vs Fault
- **Adaptive Difficulty** — 5 levels auto-adjusting on accuracy and speed
- **Grid Mentor** — AI-powered tutor (Claude API) that explains signatures, coaches wrong answers, and adapts to user skill level
- **GESL API Proxy** — Server-side relay bypasses CORS for live signature data
- **Real Waveform Pipeline** — Downloads GESL ZIPs, extracts CSVs, parses multi-channel data, renders as SVG
- **Multi-Channel Viewer** — Va/Vb/Vc/Ia/Ib/Ic/In/F matching GESL dashboard layout
- **21 Badges** — Including GESL Explorer, Fault Finder, Mentored, Connected
- **Shared Leaderboard** — Persistent SQLite storage
- **Normal Signatures** — Distinguishing normal operation from anomalous events

## Grid Mentor (AI Tutor)

The Grid Mentor is a context-aware LLM chat powered by Claude. It receives:
- User's current level, accuracy, and weak categories
- The specific signature context (when triggered from a wrong answer)
- Role-appropriate explanation depth (student → analogies, engineer → IEEE standards)

Access via the Mentor tab or "Ask Mentor about wrong answers" button after game rounds.

Uses the Anthropic Messages API — works automatically in Claude artifacts and in standalone deployment.

## Architecture

```
Browser → Flask (app.py) → gesl.ornl.gov (GESL API)
  │            │
  │            └→ SQLite (gsa.db, 8 tables)
  │
  └→ Anthropic API (Grid Mentor chat)
```

## API Endpoints (17)

### GESL Proxy & Waveforms
- `POST /api/gesl/proxy` — Forward any GESL request
- `POST /api/gesl/test` — Test connection
- `POST /api/gesl/waveform/<sig_id>` — Full CSV pipeline
- `POST /api/gesl/waveform/<sig_id>/summary` — Channel summary
- `POST /api/gesl/signatures` — Fetch IDs + metadata

### Users & Game
- `POST /api/users` — Create/get user
- `GET/PUT /api/users/<id>/stats` — Statistics
- `PUT /api/users/<id>/gesl` — Save GESL credentials
- `POST /api/sessions` — Record game session
- `GET/POST /api/leaderboard` — Rankings

### Phase 2 Ready
- `POST/GET /api/anecdotes` — Operator field stories
- `POST /api/annotations` — Waveform labels
- `GET /api/annotations/export` — ML dataset export

### Status
- `GET /api/health` — Service health
- `GET /api/stats` — Platform metrics

## Deployment

| Method | Command |
|--------|---------|
| Local | `python3 app.py` |
| Docker | `docker build -t gsa . && docker run -p 5000:5000 gsa` |
| Production | `gunicorn -w 4 app:app` |

## Database

SQLite at `data/gsa.db` (auto-created on first run):
users, user_stats, sessions, answers, leaderboard, gesl_cache, anecdotes, annotations

---

Built on DOE GESL (gesl.ornl.gov) • ORNL + LLNL + PNNL • Grid Mentor powered by Claude (Anthropic)
