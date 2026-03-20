<p align="center">
  <img src="https://img.shields.io/badge/python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/flask-2.3+-000000?style=flat-square&logo=flask&logoColor=white" alt="Flask">
  <img src="https://img.shields.io/badge/react-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18">
  <img src="https://img.shields.io/badge/sqlite-3-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/badge/DOE-Office%20of%20Electricity-blue?style=flat-square" alt="DOE OE">
</p>

<h1 align="center">⚡ Grid Signal Academy</h1>

<p align="center">
  <strong>An adaptive training platform for identifying electric grid event signatures</strong><br>
  Powered by the DOE <a href="https://gesl.ornl.gov">Grid Event Signature Library (GESL)</a> and an AI tutor
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## Why This Exists

The electric grid is undergoing massive transformation. Distributed energy resources, extreme weather, aging infrastructure, and evolving threats create signatures in voltage, current, and frequency data that operators, engineers, and researchers need to recognize quickly and accurately.

The [Grid Event Signature Library (GESL)](https://gesl.ornl.gov) at Oak Ridge National Laboratory houses **5,500+ labeled event signatures** from 12 anonymized providers — but the data is only useful if people can interpret it.

**Grid Signal Academy turns signature identification into a skill you can practice**, with adaptive difficulty, real GESL waveform data, and an AI tutor that meets you at your level — whether you're a student seeing a waveform for the first time or an operator with decades of field experience.

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/grid-signal-academy.git
cd grid-signal-academy

# Create the required directories
mkdir -p static data

# Move the frontend into place (if not already in static/)
# mv index.html static/index.html

# Install dependencies
pip install flask requests

# Run the service
python app.py
```

Open **http://localhost:5000** in your browser. The database is created automatically on first run.

### Optional: Configure API Keys

| Service | Purpose | How to Configure |
|---------|---------|-----------------|
| **GESL API** | Fetch real grid event signatures from ORNL | Config tab → enter email + UUID token from [gesl.ornl.gov](https://gesl.ornl.gov) |
| **Anthropic API** | Power the Grid Mentor AI tutor | Config tab → enter `sk-ant-...` key, or set `ANTHROPIC_API_KEY` env var |

The app works without either key — game modes use built-in synthetic waveforms, and the Mentor gracefully reports when unconfigured.

---

## Features

### 🎮 Adaptive Training Game

Four game modes with a 5-level adaptive difficulty engine that adjusts based on your accuracy and response speed:

| Mode | Description |
|------|-------------|
| **Standard** | 10 questions, difficulty adapts to your level |
| **Timed Challenge** | 15 questions in 90 seconds |
| **Daily Drill** | Same 10 questions for everyone worldwide each day |
| **Normal vs Fault** | Binary classification — is this normal operation or an anomalous event? |

**Difficulty Levels:**

| Level | Rank | Task | Timer | XP Multiplier |
|-------|------|------|-------|---------------|
| 1 | Apprentice | Identify primary category | None | 1× |
| 2 | Technician | Primary category | 30s | 1.5× |
| 3 | Analyst | Secondary category (fault type, sag type) | 25s | 2× |
| 4 | Engineer | Specific tertiary signature | 20s | 3× |
| 5 | Grid Master | Tertiary with 5 choices | 15s | 5× |

### 🔬 Real GESL Waveform Data

Connect your GESL API credentials and the platform fetches actual signature data from Oak Ridge National Laboratory:

- Downloads waveform ZIP files via server-side proxy (bypasses CORS)
- Extracts and parses CSV data (handles multiple GESL formats)
- Renders multi-channel waveforms: Va, Vb, Vc (voltage), Ia, Ib, Ic, In (current), F (frequency)
- 24-hour intelligent caching in SQLite to minimize GESL API load
- Live Signature Viewer in the Learn tab for browsing real signatures

### 🧑‍🏫 Grid Mentor (AI Tutor)

A context-aware AI tutor powered by Claude that adapts to your skill level:

- **Knows your stats** — current rank, accuracy per category, weak areas
- **Understands context** — which signature you're looking at, what you got wrong
- **Adapts depth** — analogies for students, IEEE standard references for engineers
- **Copilot-style UI** — slides in from the right so you can still see the content
- **Wrong-answer coaching** — auto-triggers with the specific question context after game rounds

The Mentor's knowledge base includes the complete GESL taxonomy, IEEE standard references (C37.011, C37.118, 1159, C57.12, etc.), waveform identification tips, and plain-English analogies for every major power systems concept.

### 📊 Multi-Channel Waveform Viewer

Renders waveforms matching the GESL dashboard layout with color-coded channels:

| Channel | Color | Type |
|---------|-------|------|
| Va | Blue | Voltage Phase A |
| Vb | Yellow | Voltage Phase B |
| Vc | Red | Voltage Phase C |
| Ia | Pink | Current Phase A |
| Ib | Cyan | Current Phase B |
| Ic | Purple | Current Phase C |
| In | Green | Neutral Current |
| F | Orange | Frequency |

### 🏆 Gamification

- **21 Badges** — First Light, Hot Streak, Unstoppable, Centurion, Grid Sage, Flawless, Speed Demon, Fault Finder, GESL Explorer, Grid Master, and more
- **XP System** — Time bonuses + streak bonuses (up to +20 XP per streak) with level multipliers
- **Shared Leaderboard** — Persistent rankings across sessions
- **Progress Sharing** — Copy-to-clipboard progress cards for social sharing

### 📖 Signature Library

A complete reference covering the GESL 3-level hierarchical taxonomy:

| Primary | Categories |
|---------|-----------|
| **Events** | Power Quality, Fault (SLG/LL/DLG/3Φ), Generation Event, Oscillation, Switching |
| **State** | Voltage Sag, Voltage Swell, Interruption, Frequency Excursion |
| **Equipment** | Interrupting Device (CB/Recloser/Fuse), Transformer, Rotating Machine |
| **Conditions** | Weather (Lightning/Wind/Ice), Vegetation, Equipment Failure |
| **Phase** | Single Phase (A/B/C), Multi-Phase (AB/BC/3Φ) |
| **Normal** | Steady State (Clean/Load Variation/Noise), Expected Transient |

Each signature includes a synthetic waveform visualization, IEEE standard reference, sensor type, and detailed description.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (React SPA)                      │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │  Game     │ │ Library  │ │Waveform  │ │ Grid Mentor   │  │
│  │  Engine   │ │ Browser  │ │ Viewer   │ │ (side panel)  │  │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │
│       └─────────────┴────────────┴──────────────┘            │
│                          │ HTTP                              │
└──────────────────────────┼───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│              Flask Application (app.py)                       │
│                          │                                   │
│  ┌───────────────┐ ┌────┴────────┐ ┌──────────────────────┐ │
│  │  REST API     │ │ GESL Proxy  │ │  Mentor Proxy        │ │
│  │  /api/*       │ │ /api/gesl/* │ │  /api/mentor/chat    │ │
│  └───────┬───────┘ └──────┬──────┘ └──────────┬───────────┘ │
│          │                │                    │             │
│          ▼                ▼                    ▼             │
│  ┌──────────────┐ ┌──────────────┐  ┌──────────────────┐   │
│  │   SQLite     │ │ gesl.ornl.gov│  │ api.anthropic.com│   │
│  │   gsa.db     │ │ (GESL API)   │  │ (Claude API)     │   │
│  └──────────────┘ └──────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Self-contained** — Single Python process, no external databases or services required
- **Zero build step** — React app loads via CDN + Babel standalone, no npm/webpack needed
- **Server-side proxies** — GESL and Anthropic APIs are called from Flask, not the browser, solving CORS restrictions
- **Intelligent caching** — GESL API responses cached 1hr (metadata) and 24hr (waveforms) in SQLite
- **Graceful degradation** — Works without GESL key (synthetic waveforms), without Anthropic key (no Mentor), and without network (localStorage fallback)

---

## Project Structure

```
grid-signal-academy/
├── app.py                  # Flask backend — API, proxies, database (1,349 lines)
├── static/
│   └── index.html          # Complete React frontend (777 lines, zero build step)
├── data/
│   └── gsa.db              # SQLite database (auto-created on first run)
├── requirements.txt        # Python dependencies (flask, requests)
├── Dockerfile              # Container deployment
└── README.md               # This file
```

---

## API Reference

### GESL Proxy & Waveform Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/gesl/proxy` | Forward any request to GESL API (1hr cache) |
| `POST` | `/api/gesl/test` | Validate GESL credentials and preview event tags |
| `POST` | `/api/gesl/waveform/<sig_id>` | Full pipeline: download ZIP → extract CSV → parse → JSON (24hr cache) |
| `POST` | `/api/gesl/waveform/<sig_id>/summary` | Lightweight channel summary without full data |
| `POST` | `/api/gesl/signatures` | Fetch signature IDs + metadata for game question pools |

**GESL Proxy Example:**

```bash
curl -X POST http://localhost:5000/api/gesl/proxy \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "apikey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "output": "eventtags"
  }'
```

**Waveform Pipeline Example:**

```bash
curl -X POST http://localhost:5000/api/gesl/waveform/179 \
  -H "Content-Type: application/json" \
  -d '{"email": "your@email.com", "apikey": "your-uuid-key"}'
```

Returns structured JSON with per-channel timestamp and value arrays ready for rendering.

### Grid Mentor

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/mentor/chat` | Proxy to Anthropic Claude API with system prompt |

Accepts `api_key` in request body or reads `ANTHROPIC_API_KEY` environment variable.

### Users & Game Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/users` | Create or retrieve user by callsign |
| `GET` | `/api/users/<id>/stats` | Get user statistics (XP, level, streaks, badges) |
| `PUT` | `/api/users/<id>/stats` | Update user statistics |
| `PUT` | `/api/users/<id>/gesl` | Save GESL API credentials for a user |
| `POST` | `/api/sessions` | Record a completed game session with per-question answers |
| `GET` | `/api/leaderboard` | Get ranked leaderboard (optional `?mode=` filter) |
| `POST` | `/api/leaderboard` | Submit a leaderboard entry |

### Annotations & Anecdotes (Phase 2 — Endpoints Ready)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/anecdotes` | Submit operator field experience for a signature |
| `GET` | `/api/anecdotes` | Retrieve anecdotes (optional `?signature_id=` filter) |
| `POST` | `/api/annotations` | Submit waveform time-region annotation with taxonomy labels |
| `GET` | `/api/annotations/export` | Export all annotations as JSON for ML research |

### Platform Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Service health check with database statistics |
| `GET` | `/api/stats` | Aggregate platform metrics (users, sessions, accuracy, roles) |

---

## Database Schema

SQLite database at `data/gsa.db` with WAL mode enabled. Auto-created on first run.

| Table | Purpose | Phase |
|-------|---------|-------|
| `users` | Callsigns, roles (student/operator/engineer/researcher), org, PE license, GESL credentials | 1 |
| `user_stats` | XP, level, streaks, badges (JSON), accuracy tracking, primary category breakdown | 1 |
| `sessions` | Game round records — mode, score, accuracy, avg response time | 1 |
| `answers` | Per-question data within sessions — signature ID, event tags, correct/given answer, time | 1 |
| `leaderboard` | Ranked score entries with callsign, mode, level, badge count | 1 |
| `gesl_cache` | Cached GESL API responses with TTL (1hr metadata, 24hr waveforms) | 1 |
| `anecdotes` | Operator field stories — narrative, location, utility, voltage level, cost impact | 2 |
| `annotations` | Waveform time-region labels — start/end time, taxonomy labels, confidence, annotator | 2 |

---

## Deployment

### Local Development

```bash
pip install flask requests
python app.py
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GSA_HOST` | `0.0.0.0` | Bind address |
| `GSA_PORT` | `5000` | Port number |
| `GSA_DEBUG` | `false` | Flask debug mode |
| `ANTHROPIC_API_KEY` | — | Claude API key for Grid Mentor (optional) |

### Docker

```bash
docker build -t grid-signal-academy .
docker run -p 5000:5000 -v gsa-data:/app/data grid-signal-academy
```

### Production (Gunicorn)

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### Systemd Service

```ini
[Unit]
Description=Grid Signal Academy
After=network.target

[Service]
User=gsa
WorkingDirectory=/opt/grid-signal-academy
Environment=ANTHROPIC_API_KEY=sk-ant-your-key
ExecStart=/usr/bin/gunicorn -w 4 -b 0.0.0.0:5000 app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

---

## Roadmap

### Phase 1: Live Signatures ✅ Complete

- [x] Self-contained Flask service (single process, no external infra)
- [x] GESL API proxy with CORS bypass
- [x] Real waveform CSV pipeline (download → parse → render)
- [x] Multi-channel viewer (Va/Vb/Vc/Ia/Ib/Ic matching GESL layout)
- [x] 4 game modes with adaptive difficulty
- [x] Normal vs Fault identification mode
- [x] Grid Mentor AI tutor (Claude API, copilot-style side panel)
- [x] Context-aware wrong-answer coaching
- [x] 21 badges, XP system, shared leaderboard
- [x] GESL + Anthropic API key configuration UI
- [x] SQLite persistent storage (8 tables)
- [x] Team progress dashboard with copy-to-clipboard status

### Phase 2: Expert Layer 🔧 Planned

Backend endpoints are deployed. Frontend UI is the remaining work.

- [x] Anecdote API endpoints (ready)
- [x] Annotation API endpoints (ready)
- [x] Annotation export for ML research (ready)
- [ ] User role enforcement (student/operator/engineer/researcher)
- [ ] Licensed Professional Engineer credential verification
- [ ] Operator anecdote submission UI per signature
- [ ] Waveform annotation tool (time-region selection + taxonomy labels)
- [ ] ROI value-capture form (operational savings stories)
- [ ] Wikipedia-style knowledge base per signature type
- [ ] Mentor-guided adaptive learning paths

### Phase 3: Community Platform 🌐 Future

- [ ] User profiles with organizational affiliation
- [ ] Discussion threads per signature and event type
- [ ] Mentorship matching (experienced operators ↔ students)
- [ ] Organization pages (NERC, IEEE, EPRI, NRECA, EEI, EISAC, RTOs, national labs)
- [ ] Challenge events (Kaggle-style signature identification competitions)
- [ ] LinkedIn-style professional sharing and networking
- [ ] Exportable labeled datasets with full provenance for ML research
- [ ] Vendor and laboratory partnership portal

---

## GESL Integration Details

This platform integrates with the [Grid Event Signature Library](https://gesl.ornl.gov) via its REST API.

**API Endpoint:** `POST https://gesl.ornl.gov/api/apps/gesl`

**Authentication:** Email address + UUID API key (register at gesl.ornl.gov for a free 7-day token).

**Available operations:**

| Output Parameter | Function | Description |
|-----------------|----------|-------------|
| `eventtags` | `get_event_tags()` | Full hierarchical event tag taxonomy |
| `sigids` | `get_event_ids()` | Signature IDs filtered by tags, source, sensor, date range |
| `metadata` | `get_event_metadata()` | Complete metadata for filtered signatures |
| `data` | `get_event_data()` | Waveform CSV download (ZIP archive) |

**CSV Format (per GESL User Guide):**

Each line contains four comma-separated fields:

```
timestamp_epoch_ns, measurement_type, channel_name, measured_value
1149789600000000000, Voltage, Va, 7862.345
1149789600000000000, Current, Ia, 12345.6
```

The waveform pipeline also handles multi-column CSV formats and flat numeric streams.

**GESL Statistics:**

- 5,500+ labeled signatures from 12 anonymized providers
- 550+ registered users worldwide
- Sensor types: PMU (synchrophasor), Point-on-Wave, FDR, GridSweep
- Voltage levels: Low (LV), Medium (MV), High (HV)
- Measurement types: Voltage, Current, Frequency, Phase Angle, Acoustic

---

## Contributing

This project is in active development. Contributions welcome in these areas:

- **Waveform rendering** — Improving visualization fidelity to match the GESL dashboard
- **Game content** — Additional signature types, difficulty calibration, educational content
- **Phase 2 UI** — Annotation tools, anecdote forms, knowledge base articles
- **Testing** — Automated tests for the API endpoints and CSV parser
- **Documentation** — IEEE standard references, training materials

---

## Acknowledgments

Built on the [Grid Event Signature Library (GESL)](https://gesl.ornl.gov), a Department of Energy funded project managed by:

- **[Oak Ridge National Laboratory (ORNL)](https://www.ornl.gov)** — Library hosting and management
- **[Lawrence Livermore National Laboratory (LLNL)](https://www.llnl.gov)** — Signature matching tool development
- **[Pacific Northwest National Laboratory (PNNL)](https://www.pnnl.gov)** — Data analysis and contributions

Funded by the **[DOE Office of Electricity](https://www.energy.gov/oe/office-electricity)**.

Grid Mentor AI tutor powered by [Claude](https://www.anthropic.com) (Anthropic).

**Reference:** Wilson, A.J., et al. "The Grid Event Signature Library: An Open-Access Repository of Power System Measurement Signatures." *IEEE Access*, 2024. [DOI: 10.1109/ACCESS.2024.3404886](https://doi.org/10.1109/ACCESS.2024.3404886)

---

## License

MIT License. See [LICENSE](LICENSE) for details.

The GESL data is provided under DOE public access terms. See [gesl.ornl.gov](https://gesl.ornl.gov) for data usage policies.
