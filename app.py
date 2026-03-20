#!/usr/bin/env python3
"""
Grid Signal Academy — Self-Contained Service
=============================================
A standalone Flask application that provides:

1. GESL API Proxy   — Forwards browser requests to gesl.ornl.gov (bypasses CORS)
2. SQLite Database   — Persistent storage for users, scores, leaderboard, annotations
3. Static Frontend   — Serves the React app and all assets
4. REST API          — Leaderboard, user profiles, progress tracking, future annotation endpoints

No external infrastructure required. Just: python3 app.py

Dependencies (all stdlib or pre-installed):
  - flask
  - requests  
  - sqlite3 (stdlib)
  - json, uuid, datetime, hashlib, os (stdlib)

GESL API: POST https://gesl.ornl.gov/api/apps/gesl
Auth: email + apikey (UUID)
"""

import json
import os
import re
import uuid
import io
import csv
import zipfile
import datetime
import hashlib
import sqlite3
from collections import defaultdict
from functools import wraps

from flask import (
    Flask, request, jsonify, send_from_directory,
    g, abort, Response
)

try:
    import requests as http_requests
except ImportError:
    http_requests = None
    print("WARNING: 'requests' not installed. GESL proxy will be disabled.")
    print("Install with: pip install requests")

# ═══════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "gsa.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
GESL_API_URL = "https://gesl.ornl.gov/api/apps/gesl"
HOST = os.environ.get("GSA_HOST", "0.0.0.0")
PORT = int(os.environ.get("GSA_PORT", "5000"))
DEBUG = os.environ.get("GSA_DEBUG", "false").lower() == "true"

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")
app.config["JSON_SORT_KEYS"] = False


# ═══════════════════════════════════════════════════════════════
# Database
# ═══════════════════════════════════════════════════════════════

def get_db():
    """Get thread-local database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create all tables if they don't exist."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript("""
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            callsign        TEXT NOT NULL UNIQUE,
            email           TEXT,
            role            TEXT DEFAULT 'student',
            -- roles: student, operator, engineer, researcher, admin
            organization    TEXT,
            pe_license      TEXT,
            created_at      TEXT DEFAULT (datetime('now')),
            last_active     TEXT DEFAULT (datetime('now')),
            -- GESL credentials (encrypted in production)
            gesl_email      TEXT,
            gesl_apikey     TEXT
        );

        -- Game sessions
        CREATE TABLE IF NOT EXISTS sessions (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER REFERENCES users(id),
            mode            TEXT NOT NULL,
            -- modes: standard, timed, daily, normalfault
            score           INTEGER DEFAULT 0,
            total           INTEGER DEFAULT 0,
            xp_earned       INTEGER DEFAULT 0,
            accuracy        REAL DEFAULT 0,
            avg_time        REAL DEFAULT 0,
            level           INTEGER DEFAULT 1,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        -- Individual answers within sessions
        CREATE TABLE IF NOT EXISTS answers (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id      INTEGER REFERENCES sessions(id),
            question_index  INTEGER,
            signature_id    TEXT,
            -- GESL signature ID if from real data
            event_primary   TEXT,
            event_secondary TEXT,
            event_tertiary  TEXT,
            correct_answer  TEXT,
            given_answer    TEXT,
            is_correct      INTEGER DEFAULT 0,
            response_time   REAL DEFAULT 0,
            xp_earned       INTEGER DEFAULT 0
        );

        -- Leaderboard (aggregated view, but we store raw for flexibility)
        CREATE TABLE IF NOT EXISTS leaderboard (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER REFERENCES users(id),
            callsign        TEXT NOT NULL,
            score           INTEGER DEFAULT 0,
            mode            TEXT,
            accuracy        REAL DEFAULT 0,
            level           INTEGER DEFAULT 1,
            badges          INTEGER DEFAULT 0,
            total_xp        INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        -- User stats (persistent across sessions)
        CREATE TABLE IF NOT EXISTS user_stats (
            user_id         INTEGER PRIMARY KEY REFERENCES users(id),
            xp              INTEGER DEFAULT 0,
            level           INTEGER DEFAULT 1,
            total_correct   INTEGER DEFAULT 0,
            total_answered  INTEGER DEFAULT 0,
            best_streak     INTEGER DEFAULT 0,
            current_streak  INTEGER DEFAULT 0,
            perfect_rounds  INTEGER DEFAULT 0,
            fastest_correct REAL DEFAULT 999,
            rounds_played   INTEGER DEFAULT 0,
            daily_drills    INTEGER DEFAULT 0,
            timed_best      INTEGER DEFAULT 0,
            normal_fault_correct INTEGER DEFAULT 0,
            signatures_studied INTEGER DEFAULT 0,
            badges          TEXT DEFAULT '[]',
            -- JSON array of badge IDs
            primary_correct TEXT DEFAULT '{}',
            -- JSON object {primary: count}
            updated_at      TEXT DEFAULT (datetime('now'))
        );

        -- Operator anecdotes (Phase 2 stub)
        CREATE TABLE IF NOT EXISTS anecdotes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER REFERENCES users(id),
            signature_id    TEXT,
            gesl_sig_id     INTEGER,
            event_type      TEXT,
            narrative       TEXT,
            location        TEXT,
            utility         TEXT,
            voltage_level   TEXT,
            cost_impact     TEXT,
            lessons_learned TEXT,
            verified        INTEGER DEFAULT 0,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        -- Waveform annotations (Phase 2 stub)
        CREATE TABLE IF NOT EXISTS annotations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER REFERENCES users(id),
            gesl_sig_id     INTEGER,
            start_time      REAL,
            end_time        REAL,
            label_primary   TEXT,
            label_secondary TEXT,
            label_tertiary  TEXT,
            confidence      REAL DEFAULT 1.0,
            notes           TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        );

        -- GESL cached data (avoid repeated API calls)
        CREATE TABLE IF NOT EXISTS gesl_cache (
            cache_key       TEXT PRIMARY KEY,
            data            TEXT,
            fetched_at      TEXT DEFAULT (datetime('now')),
            expires_at      TEXT
        );

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(score DESC);
        CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
        CREATE INDEX IF NOT EXISTS idx_anecdotes_sig ON anecdotes(signature_id);
        CREATE INDEX IF NOT EXISTS idx_annotations_sig ON annotations(gesl_sig_id);
    """)
    conn.commit()
    conn.close()
    print(f"Database initialized at {DB_PATH}")


# ═══════════════════════════════════════════════════════════════
# GESL API Proxy
# ═══════════════════════════════════════════════════════════════

def validate_gesl_input(email, api_key):
    """Validate email and UUID API key per GESL spec."""
    email_regex = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b'
    if not re.fullmatch(email_regex, email):
        return "Invalid email format"
    try:
        uuid.UUID(api_key)
    except (ValueError, AttributeError):
        return "Invalid API key (must be UUID format)"
    return None


@app.route("/api/gesl/proxy", methods=["POST"])
def gesl_proxy():
    """
    Forward requests to the GESL API.
    
    This is the core CORS bypass — the browser calls our proxy,
    which calls gesl.ornl.gov and returns the response.
    
    Expected JSON body:
    {
        "email": "user@example.com",
        "apikey": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "output": "eventtags" | "sigids" | "metadata" | "data",
        ... (any additional GESL params)
    }
    """
    if http_requests is None:
        return jsonify({"error": "requests library not available"}), 500

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    email = data.get("email", "")
    api_key = data.get("apikey", "")

    validation_error = validate_gesl_input(email, api_key)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    output = data.get("output", "")
    if output not in ("eventtags", "sigids", "metadata", "data"):
        return jsonify({"error": "Invalid output type. Must be: eventtags, sigids, metadata, data"}), 400

    # Check cache for non-data requests
    if output != "data":
        cache_key = hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()
        db = get_db()
        cached = db.execute(
            "SELECT data FROM gesl_cache WHERE cache_key = ? AND expires_at > datetime('now')",
            (cache_key,)
        ).fetchone()
        if cached:
            try:
                return jsonify({"source": "cache", "data": json.loads(cached["data"])})
            except json.JSONDecodeError:
                return jsonify({"source": "cache", "data": cached["data"]})

    # Forward to GESL
    try:
        resp = http_requests.post(
            GESL_API_URL,
            data=json.dumps(data, indent=4, default=str),
            headers={"Content-type": "application/json"},
            timeout=30
        )

        # For data downloads (ZIP files), return as binary
        if output == "data":
            return Response(
                resp.content,
                content_type=resp.headers.get("Content-Type", "application/octet-stream"),
                headers={"Content-Disposition": f"attachment; filename=gesl-data.zip"}
            )

        # For JSON responses, cache and return
        response_text = resp.text

        # Cache for 1 hour
        if output != "data":
            expires = (datetime.datetime.now() + datetime.timedelta(hours=1)).isoformat()
            db = get_db()
            db.execute(
                "INSERT OR REPLACE INTO gesl_cache (cache_key, data, expires_at) VALUES (?, ?, ?)",
                (cache_key, response_text, expires)
            )
            db.commit()

        try:
            return jsonify({"source": "live", "data": json.loads(response_text)})
        except json.JSONDecodeError:
            return jsonify({"source": "live", "data": response_text})

    except http_requests.exceptions.Timeout:
        return jsonify({"error": "GESL API timeout (30s). The server may be busy."}), 504
    except http_requests.exceptions.ConnectionError as e:
        return jsonify({"error": f"Cannot reach gesl.ornl.gov: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": f"Proxy error: {str(e)}"}), 500


@app.route("/api/gesl/test", methods=["POST"])
def gesl_test():
    """Quick connection test — fetches event tags and returns status."""
    data = request.get_json(silent=True) or {}
    email = data.get("email", "")
    api_key = data.get("apikey", "")

    validation_error = validate_gesl_input(email, api_key)
    if validation_error:
        return jsonify({"status": "error", "message": validation_error}), 400

    if http_requests is None:
        return jsonify({"status": "error", "message": "requests library not available"}), 500

    try:
        resp = http_requests.post(
            GESL_API_URL,
            data=json.dumps({"email": email, "apikey": api_key, "output": "eventtags"}),
            headers={"Content-type": "application/json"},
            timeout=15
        )
        if resp.status_code == 200:
            return jsonify({
                "status": "ok",
                "message": "Connected to GESL API successfully",
                "data_preview": resp.text[:500]
            })
        else:
            return jsonify({
                "status": "error",
                "message": f"GESL returned HTTP {resp.status_code}"
            }), resp.status_code

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 502


# ═══════════════════════════════════════════════════════════════
# Grid Mentor Proxy (Anthropic Claude API)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/mentor/chat", methods=["POST"])
def mentor_chat():
    """
    Proxy for Anthropic Claude API calls from the Grid Mentor.
    Browser cannot call api.anthropic.com directly (CORS),
    so we relay through our backend.
    
    POST body: {
        "system": "system prompt...",
        "messages": [{"role":"user","content":"..."}],
        "max_tokens": 1000
    }
    """
    if http_requests is None:
        return jsonify({"error": "requests library not available"}), 500

    data = request.get_json(silent=True) or {}
    system_prompt = data.get("system", "")
    messages = data.get("messages", [])
    max_tokens = data.get("max_tokens", 1000)

    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # API key: check request body first, then environment variable
    anthropic_key = data.get("api_key", "") or os.environ.get("ANTHROPIC_API_KEY", "")
    if not anthropic_key:
        return jsonify({"ok": False, "error": "No Anthropic API key. Set it in the Config tab or as ANTHROPIC_API_KEY environment variable."}), 400

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "Content-Type": "application/json",
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01"
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": max_tokens,
                "system": system_prompt,
                "messages": messages
            },
            timeout=30
        )

        if resp.status_code == 200:
            result = resp.json()
            text = ""
            for block in result.get("content", []):
                if block.get("type") == "text":
                    text += block.get("text", "")
            return jsonify({"ok": True, "text": text})
        else:
            error_text = resp.text[:300]
            return jsonify({"ok": False, "error": f"Claude API returned {resp.status_code}: {error_text}"}), resp.status_code

    except http_requests.exceptions.Timeout:
        return jsonify({"ok": False, "error": "Claude API timeout (30s)"}), 504
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502
#
# GESL CSV format (per user guide):
#   Each line: timestamp_epoch_ns, measurement_type, channel_name, value
#   Example:   1149789600000000000, Voltage, Va, 7862.345
#   Channels:  Va, Vb, Vc (voltage), Ia, Ib, Ic, In (current), F (frequency), PA (phase angle)
#
# The get_event_data API returns a ZIP file containing one or more CSVs.
# We download, extract, parse, and serve as structured JSON for the frontend.

import io
import csv
import zipfile
import tempfile
from collections import defaultdict


def parse_gesl_csv(csv_text):
    """
    Parse GESL waveform data into structured channel data.
    
    Handles multiple GESL formats:
    
    Format A (Download CSV - per user guide):
      epoch_ns, measurement_type, channel_name, value
      1149789600000000000, Voltage, Va, 7862.345
    
    Format B (API response - flat numeric):
      Could be JSON with nested arrays, or CSV with header row
      
    Format C (Multi-column CSV):
      timestamp, Va, Vb, Vc, Ia, Ib, Ic, ...
    """
    if not csv_text or len(csv_text.strip()) < 10:
        return None

    channels = defaultdict(lambda: {"timestamps": [], "values": [], "type": "", "unit": ""})
    
    # Try to detect format
    lines = csv_text.strip().split('\n')
    
    # --- Try Format A: 4-column (timestamp, type, channel, value) ---
    if len(lines) > 1:
        first_data = lines[1] if lines[0].lower().startswith(('timestamp','time','epoch','#')) else lines[0]
        parts = [p.strip() for p in first_data.split(',')]
        
        if len(parts) == 4:
            try:
                float(parts[0])
                float(parts[3])
                # Looks like Format A
                for line in lines:
                    row = [p.strip() for p in line.split(',')]
                    if len(row) < 4:
                        continue
                    try:
                        ts_raw = float(row[0])
                        mtype = row[1]
                        chname = row[2]
                        val = float(row[3])
                    except (ValueError, IndexError):
                        continue
                    
                    ts_sec = ts_raw / 1e9 if ts_raw > 1e15 else ts_raw / 1e6 if ts_raw > 1e12 else ts_raw
                    ch = channels[chname]
                    ch["timestamps"].append(ts_sec)
                    ch["values"].append(val)
                    ch["type"] = mtype
                    mt = mtype.lower()
                    ch["unit"] = "V" if "volt" in mt else "A" if ("current" in mt or "amp" in mt) else "Hz" if "freq" in mt else "deg" if ("angle" in mt or "phase" in mt) else ""
                
                if channels:
                    return _finalize_channels(channels)
            except:
                pass
    
    # --- Try Format C: Multi-column with header ---
    if len(lines) > 2:
        header = [h.strip() for h in lines[0].split(',')]
        # Check if header looks like channel names
        known = {'va','vb','vc','ia','ib','ic','in','f','pa','freq','frequency','time','timestamp','t'}
        header_lower = [h.lower().replace('(','').replace(')','').strip() for h in header]
        matches = sum(1 for h in header_lower if any(k in h for k in known))
        
        if matches >= 2:
            # Parse as multi-column
            ts_col = None
            for i, h in enumerate(header_lower):
                if any(k in h for k in ['time','timestamp','t','epoch','sec']):
                    ts_col = i
                    break
            if ts_col is None:
                ts_col = 0  # Assume first column is time
            
            for line in lines[1:]:
                row = [p.strip() for p in line.split(',')]
                if len(row) < len(header):
                    continue
                try:
                    ts_raw = float(row[ts_col])
                    ts_sec = ts_raw / 1e9 if ts_raw > 1e15 else ts_raw / 1e6 if ts_raw > 1e12 else ts_raw
                except (ValueError, IndexError):
                    continue
                
                for i, h in enumerate(header):
                    if i == ts_col:
                        continue
                    try:
                        val = float(row[i])
                    except (ValueError, IndexError):
                        continue
                    ch = channels[h]
                    ch["timestamps"].append(ts_sec)
                    ch["values"].append(val)
                    hl = h.lower()
                    ch["type"] = "Voltage" if 'v' == hl[0] else "Current" if ('i' == hl[0] or 'a' in hl) else "Frequency" if 'f' in hl else ""
                    ch["unit"] = "V" if ch["type"] == "Voltage" else "A" if ch["type"] == "Current" else "Hz" if ch["type"] == "Frequency" else ""
            
            if channels:
                return _finalize_channels(channels)
    
    # --- Try: All numbers on possibly fewer lines (flat format) ---
    # Try to parse everything as a flat numeric stream
    all_nums = []
    for line in lines:
        for part in line.split(','):
            p = part.strip()
            if p:
                try:
                    all_nums.append(float(p))
                except ValueError:
                    pass
    
    if len(all_nums) > 20:
        # Heuristic: try to detect channels by looking at value ranges
        # PMU data at 60Hz: voltage typically 100-15000V range, current 0-15000A
        # Try splitting into equal-sized channels
        # Common: 7 channels (Va,Vb,Vc,Ia,Ib,Ic,In) or 8 (+ Frequency)
        n = len(all_nums)
        
        # Try to figure out if there's a pattern
        # Look at first few values to detect timestamp vs data
        # If first values are very large (>1e9), they might be timestamps
        
        best_channels = None
        for num_ch in [8, 7, 6, 4, 3]:
            if n % num_ch == 0:
                pts_per_ch = n // num_ch
                if pts_per_ch >= 5:
                    ch_names = ["Va","Vb","Vc","Ia","Ib","Ic","In","F"][:num_ch]
                    result_channels = {}
                    for ci in range(num_ch):
                        vals = all_nums[ci * pts_per_ch : (ci + 1) * pts_per_ch]
                        name = ch_names[ci]
                        result_channels[name] = {
                            "timestamps": [i / max(pts_per_ch - 1, 1) * 0.1667 for i in range(pts_per_ch)],
                            "values": vals,
                            "type": "Voltage" if name.startswith("V") else "Current" if name.startswith("I") else "Frequency",
                            "unit": "V" if name.startswith("V") else "A" if name.startswith("I") else "Hz",
                        }
                    best_channels = result_channels
                    break
        
        # Also try interleaved: row = [t, Va, Vb, Vc, Ia, Ib, Ic, ...]
        for num_cols in [8, 7, 4]:
            if n % num_cols == 0 and n // num_cols >= 5:
                rows = n // num_cols
                ch_names = ["t","Va","Vb","Vc","Ia","Ib","Ic"][:num_cols]
                interleaved = {}
                ts_list = []
                for r in range(rows):
                    base = r * num_cols
                    ts_val = all_nums[base]
                    ts_sec = ts_val / 1e9 if ts_val > 1e15 else ts_val / 1e6 if ts_val > 1e12 else ts_val
                    ts_list.append(ts_sec)
                    for ci in range(1, num_cols):
                        name = ch_names[ci] if ci < len(ch_names) else f"Ch{ci}"
                        if name not in interleaved:
                            interleaved[name] = {"timestamps": [], "values": [], "type": "", "unit": ""}
                        interleaved[name]["timestamps"].append(ts_sec)
                        interleaved[name]["values"].append(all_nums[base + ci])
                        interleaved[name]["type"] = "Voltage" if name.startswith("V") else "Current" if name.startswith("I") else ""
                        interleaved[name]["unit"] = "V" if name.startswith("V") else "A" if name.startswith("I") else ""
                
                # Check if timestamps are monotonically increasing
                if len(ts_list) >= 2 and ts_list[1] > ts_list[0]:
                    for ch in interleaved.values():
                        start = ch["timestamps"][0]
                        ch["timestamps"] = [t - start for t in ch["timestamps"]]
                    
                    return {
                        "channels": interleaved,
                        "start_time": ts_list[0],
                        "end_time": ts_list[-1],
                        "duration_sec": ts_list[-1] - ts_list[0],
                        "sample_count": sum(len(c["values"]) for c in interleaved.values()),
                        "measurement_types": list(set(c["type"] for c in interleaved.values() if c["type"])),
                        "channel_names": sorted(interleaved.keys()),
                    }
        
        if best_channels:
            return {
                "channels": best_channels,
                "start_time": 0,
                "end_time": best_channels[list(best_channels.keys())[0]]["timestamps"][-1],
                "duration_sec": best_channels[list(best_channels.keys())[0]]["timestamps"][-1],
                "sample_count": sum(len(c["values"]) for c in best_channels.values()),
                "measurement_types": list(set(c["type"] for c in best_channels.values())),
                "channel_names": sorted(best_channels.keys()),
            }
    
    return None


def _finalize_channels(channels):
    """Normalize timestamps and downsample for rendering."""
    if not channels:
        return None
    
    all_ts = []
    for ch_data in channels.values():
        all_ts.extend(ch_data["timestamps"])
    
    start_time = min(all_ts) if all_ts else 0
    end_time = max(all_ts) if all_ts else 0
    
    for ch_data in channels.values():
        ch_data["timestamps"] = [t - start_time for t in ch_data["timestamps"]]
    
    MAX_POINTS = 500
    for ch_data in channels.values():
        n = len(ch_data["values"])
        if n > MAX_POINTS:
            step = max(1, n // MAX_POINTS)
            ch_data["timestamps"] = ch_data["timestamps"][::step][:MAX_POINTS]
            ch_data["values"] = ch_data["values"][::step][:MAX_POINTS]
    
    return {
        "channels": dict(channels),
        "start_time": start_time,
        "end_time": end_time,
        "duration_sec": end_time - start_time,
        "sample_count": sum(len(c["values"]) for c in channels.values()),
        "measurement_types": list(set(c["type"] for c in channels.values() if c["type"])),
        "channel_names": sorted(channels.keys()),
    }


def fetch_and_parse_gesl_waveform(email, api_key, sig_id, file_type=None):
    """
    Full pipeline: call GESL API -> download ZIP -> extract CSV -> parse -> return JSON.
    """
    if http_requests is None:
        return None, "requests library not available"
    
    params = {
        "email": email,
        "apikey": api_key,
        "sigid": sig_id,
        "output": "data"
    }
    if file_type:
        params["file_type"] = file_type
    
    try:
        resp = http_requests.post(
            GESL_API_URL,
            data=json.dumps(params, indent=4, default=str),
            headers={"Content-type": "application/json"},
            timeout=60,
            stream=True
        )
        
        if resp.status_code != 200:
            return None, f"GESL returned HTTP {resp.status_code}"
        
        # Read the ZIP content
        content = resp.content
        
        if len(content) < 100:
            # Might be an error message, not a ZIP
            try:
                text = content.decode("utf-8", errors="replace")
                return None, f"GESL response: {text[:200]}"
            except:
                return None, "Empty or invalid response from GESL"
        
        # Extract CSV from ZIP
        try:
            zf = zipfile.ZipFile(io.BytesIO(content))
        except zipfile.BadZipFile:
            # Maybe it's raw CSV, not zipped
            try:
                csv_text = content.decode("utf-8", errors="replace")
                parsed = parse_gesl_csv(csv_text)
                if parsed:
                    return parsed, None
            except:
                pass
            return None, "Invalid ZIP file received from GESL"
        
        # Find CSV files in the ZIP
        csv_files = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        
        if not csv_files:
            # Try any file
            csv_files = zf.namelist()
        
        if not csv_files:
            return None, "No data files found in GESL download"
        
        # Parse the first (or largest) CSV
        best_file = max(csv_files, key=lambda n: zf.getinfo(n).file_size)
        csv_text = zf.read(best_file).decode("utf-8", errors="replace")
        
        parsed = parse_gesl_csv(csv_text)
        if not parsed:
            return None, f"Could not parse CSV data from {best_file}"
        
        parsed["source_file"] = best_file
        parsed["zip_files"] = csv_files
        
        return parsed, None
        
    except http_requests.exceptions.Timeout:
        return None, "GESL download timeout (60s)"
    except Exception as e:
        return None, f"Download error: {str(e)}"


@app.route("/api/gesl/waveform/<int:sig_id>", methods=["POST"])
def get_waveform(sig_id):
    """
    Fetch, parse, and return waveform data for a GESL signature ID.
    
    POST body: { "email": "...", "apikey": "..." }
    Optional query params: ?file_type=raw,scrubbed
    
    Returns JSON with channel data ready for frontend SVG rendering:
    {
        "sig_id": 179,
        "channels": {
            "Va": { "type": "Voltage", "unit": "V", "timestamps": [...], "values": [...] },
            "Vb": { ... },
            "Ia": { ... },
            ...
        },
        "duration_sec": 0.165,
        "sample_count": 12345,
        "channel_names": ["Ia", "Ib", "Ic", "Va", "Vb", "Vc"],
        "source": "live" | "cache"
    }
    """
    data = request.get_json(silent=True) or {}
    email = data.get("email", "")
    api_key = data.get("apikey", "")
    
    validation_error = validate_gesl_input(email, api_key)
    if validation_error:
        return jsonify({"error": validation_error}), 400
    
    file_type = request.args.get("file_type", None)
    if file_type:
        file_type = [ft.strip() for ft in file_type.split(",")]
    
    # Check cache first
    cache_key = f"waveform:{sig_id}:{file_type}"
    db = get_db()
    cached = db.execute(
        "SELECT data FROM gesl_cache WHERE cache_key = ? AND expires_at > datetime('now')",
        (cache_key,)
    ).fetchone()
    
    if cached:
        try:
            cached_data = json.loads(cached["data"])
            cached_data["source"] = "cache"
            cached_data["sig_id"] = sig_id
            return jsonify(cached_data)
        except:
            pass
    
    # Fetch from GESL
    parsed, error = fetch_and_parse_gesl_waveform(email, api_key, sig_id, file_type)
    
    if error:
        return jsonify({"error": error, "sig_id": sig_id}), 502
    
    # Cache for 24 hours (waveform data doesn't change)
    expires = (datetime.datetime.now() + datetime.timedelta(hours=24)).isoformat()
    try:
        db.execute(
            "INSERT OR REPLACE INTO gesl_cache (cache_key, data, expires_at) VALUES (?, ?, ?)",
            (cache_key, json.dumps(parsed), expires)
        )
        db.commit()
    except Exception:
        pass  # Cache failures shouldn't break the response
    
    parsed["source"] = "live"
    parsed["sig_id"] = sig_id
    return jsonify(parsed)


@app.route("/api/gesl/waveform/<int:sig_id>/summary", methods=["POST"])
def get_waveform_summary(sig_id):
    """
    Return a lightweight summary of a waveform (channel list, duration, sample rate)
    without the full data arrays. Useful for building game question pools.
    """
    data = request.get_json(silent=True) or {}
    email = data.get("email", "")
    api_key = data.get("apikey", "")
    
    validation_error = validate_gesl_input(email, api_key)
    if validation_error:
        return jsonify({"error": validation_error}), 400
    
    # Check if we already have this cached
    cache_key = f"waveform:{sig_id}:None"
    db = get_db()
    cached = db.execute(
        "SELECT data FROM gesl_cache WHERE cache_key = ?",
        (cache_key,)
    ).fetchone()
    
    if cached:
        try:
            d = json.loads(cached["data"])
            return jsonify({
                "sig_id": sig_id,
                "channel_names": d.get("channel_names", []),
                "measurement_types": d.get("measurement_types", []),
                "duration_sec": d.get("duration_sec", 0),
                "sample_count": d.get("sample_count", 0),
                "cached": True
            })
        except:
            pass
    
    return jsonify({"sig_id": sig_id, "cached": False, "message": "Fetch full waveform first"})


@app.route("/api/gesl/signatures", methods=["POST"])
def get_signatures_for_game():
    """
    Fetch signature IDs and metadata for a set of event tags.
    Used to build game question pools from real GESL data.
    
    POST body: {
        "email": "...",
        "apikey": "...",
        "event_tag_ids": [1, 2, 3],  // optional
        "limit": 20
    }
    """
    data = request.get_json(silent=True) or {}
    email = data.get("email", "")
    api_key = data.get("apikey", "")
    
    validation_error = validate_gesl_input(email, api_key)
    if validation_error:
        return jsonify({"error": validation_error}), 400
    
    if http_requests is None:
        return jsonify({"error": "requests library not available"}), 500
    
    # Step 1: Get signature IDs matching the filter
    params = {
        "email": email,
        "apikey": api_key,
        "output": "sigids"
    }
    
    tag_ids = data.get("event_tag_ids")
    if tag_ids:
        params["eventtagid"] = tag_ids
    
    data_source = data.get("data_source")
    if data_source:
        params["datasource"] = data_source
    
    try:
        resp = http_requests.post(
            GESL_API_URL,
            data=json.dumps(params, indent=4, default=str),
            headers={"Content-type": "application/json"},
            timeout=20
        )
        
        sig_ids_raw = resp.text
        try:
            sig_ids_data = json.loads(sig_ids_raw)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid response from GESL", "raw": sig_ids_raw[:200]}), 502
        
        # Step 2: Get metadata for those signatures
        limit = min(data.get("limit", 20), 50)
        
        # sig_ids_data format may vary — handle both list and dict responses
        if isinstance(sig_ids_data, list):
            selected_ids = sig_ids_data[:limit]
        elif isinstance(sig_ids_data, dict):
            selected_ids = list(sig_ids_data.keys())[:limit] if sig_ids_data else []
        else:
            selected_ids = []
        
        if not selected_ids:
            return jsonify({"signatures": [], "total": 0})
        
        # Fetch metadata
        meta_params = {
            "email": email,
            "apikey": api_key,
            "output": "metadata",
            "sigids": selected_ids
        }
        
        meta_resp = http_requests.post(
            GESL_API_URL,
            data=json.dumps(meta_params, indent=4, default=str),
            headers={"Content-type": "application/json"},
            timeout=20
        )
        
        try:
            metadata = json.loads(meta_resp.text)
        except json.JSONDecodeError:
            metadata = meta_resp.text
        
        return jsonify({
            "signatures": metadata,
            "sig_ids": selected_ids,
            "total": len(selected_ids)
        })
        
    except http_requests.exceptions.Timeout:
        return jsonify({"error": "GESL timeout"}), 504
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ═══════════════════════════════════════════════════════════════
# User Management
# ═══════════════════════════════════════════════════════════════

@app.route("/api/users", methods=["POST"])
def create_user():
    """Create or get a user by callsign."""
    data = request.get_json(silent=True) or {}
    callsign = data.get("callsign", "").strip()
    if not callsign or len(callsign) < 2:
        return jsonify({"error": "Callsign must be at least 2 characters"}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE callsign = ?", (callsign,)).fetchone()

    if existing:
        user_id = existing["id"]
        db.execute("UPDATE users SET last_active = datetime('now') WHERE id = ?", (user_id,))
        db.commit()
    else:
        role = data.get("role", "student")
        email = data.get("email", "")
        org = data.get("organization", "")
        cur = db.execute(
            "INSERT INTO users (callsign, email, role, organization) VALUES (?, ?, ?, ?)",
            (callsign, email, role, org)
        )
        user_id = cur.lastrowid
        db.execute(
            "INSERT INTO user_stats (user_id) VALUES (?)",
            (user_id,)
        )
        db.commit()

    return jsonify({"user_id": user_id, "callsign": callsign})


@app.route("/api/users/<int:user_id>/stats", methods=["GET"])
def get_user_stats(user_id):
    """Get user stats."""
    db = get_db()
    stats = db.execute("SELECT * FROM user_stats WHERE user_id = ?", (user_id,)).fetchone()
    if not stats:
        return jsonify({"error": "User not found"}), 404
    return jsonify(dict(stats))


@app.route("/api/users/<int:user_id>/stats", methods=["PUT"])
def update_user_stats(user_id):
    """Update user stats after a game session."""
    data = request.get_json(silent=True) or {}
    db = get_db()

    # Build SET clause from provided fields
    allowed = [
        "xp", "level", "total_correct", "total_answered", "best_streak",
        "current_streak", "perfect_rounds", "fastest_correct", "rounds_played",
        "daily_drills", "timed_best", "normal_fault_correct", "signatures_studied",
        "badges", "primary_correct"
    ]
    sets = []
    vals = []
    for key in allowed:
        if key in data:
            val = data[key]
            if key in ("badges", "primary_correct"):
                val = json.dumps(val) if isinstance(val, (list, dict)) else val
            sets.append(f"{key} = ?")
            vals.append(val)

    if sets:
        sets.append("updated_at = datetime('now')")
        vals.append(user_id)
        db.execute(f"UPDATE user_stats SET {', '.join(sets)} WHERE user_id = ?", vals)
        db.commit()

    return jsonify({"status": "ok"})


@app.route("/api/users/<int:user_id>/gesl", methods=["PUT"])
def save_gesl_credentials(user_id):
    """Save GESL API credentials for a user."""
    data = request.get_json(silent=True) or {}
    email = data.get("gesl_email", "")
    apikey = data.get("gesl_apikey", "")

    validation_error = validate_gesl_input(email, apikey)
    if validation_error:
        return jsonify({"error": validation_error}), 400

    db = get_db()
    db.execute(
        "UPDATE users SET gesl_email = ?, gesl_apikey = ? WHERE id = ?",
        (email, apikey, user_id)
    )
    db.commit()
    return jsonify({"status": "ok"})


# ═══════════════════════════════════════════════════════════════
# Game Sessions & Leaderboard
# ═══════════════════════════════════════════════════════════════

@app.route("/api/sessions", methods=["POST"])
def create_session():
    """Record a completed game session."""
    data = request.get_json(silent=True) or {}
    db = get_db()

    user_id = data.get("user_id")
    mode = data.get("mode", "standard")
    score = data.get("score", 0)
    total = data.get("total", 0)
    xp = data.get("xp_earned", 0)
    accuracy = data.get("accuracy", 0)
    avg_time = data.get("avg_time", 0)
    level = data.get("level", 1)

    cur = db.execute(
        """INSERT INTO sessions (user_id, mode, score, total, xp_earned, accuracy, avg_time, level)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, mode, score, total, xp, accuracy, avg_time, level)
    )
    session_id = cur.lastrowid

    # Record individual answers
    for ans in data.get("answers", []):
        db.execute(
            """INSERT INTO answers 
               (session_id, question_index, signature_id, event_primary, event_secondary,
                event_tertiary, correct_answer, given_answer, is_correct, response_time, xp_earned)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (session_id, ans.get("index", 0), ans.get("sig_id", ""),
             ans.get("primary", ""), ans.get("secondary", ""), ans.get("tertiary", ""),
             ans.get("correct", ""), ans.get("given", ""),
             1 if ans.get("is_correct") else 0,
             ans.get("time", 0), ans.get("xp", 0))
        )

    db.commit()
    return jsonify({"session_id": session_id})


@app.route("/api/leaderboard", methods=["GET"])
def get_leaderboard():
    """Get top leaderboard entries."""
    limit = request.args.get("limit", 50, type=int)
    mode = request.args.get("mode", None)
    db = get_db()

    if mode:
        rows = db.execute(
            "SELECT * FROM leaderboard WHERE mode = ? ORDER BY score DESC LIMIT ?",
            (mode, limit)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM leaderboard ORDER BY score DESC LIMIT ?",
            (limit,)
        ).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route("/api/leaderboard", methods=["POST"])
def post_leaderboard():
    """Submit a leaderboard entry."""
    data = request.get_json(silent=True) or {}
    db = get_db()

    db.execute(
        """INSERT INTO leaderboard 
           (user_id, callsign, score, mode, accuracy, level, badges, total_xp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.get("user_id"), data.get("callsign", "Anonymous"),
         data.get("score", 0), data.get("mode", "standard"),
         data.get("accuracy", 0), data.get("level", 1),
         data.get("badges", 0), data.get("total_xp", 0))
    )
    db.commit()
    return jsonify({"status": "ok"})


# ═══════════════════════════════════════════════════════════════
# Anecdotes (Phase 2 — endpoints ready)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/anecdotes", methods=["POST"])
def create_anecdote():
    """Submit an operator anecdote for a signature."""
    data = request.get_json(silent=True) or {}
    db = get_db()

    db.execute(
        """INSERT INTO anecdotes 
           (user_id, signature_id, gesl_sig_id, event_type, narrative,
            location, utility, voltage_level, cost_impact, lessons_learned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.get("user_id"), data.get("signature_id", ""),
         data.get("gesl_sig_id"), data.get("event_type", ""),
         data.get("narrative", ""), data.get("location", ""),
         data.get("utility", ""), data.get("voltage_level", ""),
         data.get("cost_impact", ""), data.get("lessons_learned", ""))
    )
    db.commit()
    return jsonify({"status": "ok"})


@app.route("/api/anecdotes", methods=["GET"])
def get_anecdotes():
    """Get anecdotes, optionally filtered by signature."""
    sig_id = request.args.get("signature_id", None)
    db = get_db()

    if sig_id:
        rows = db.execute(
            "SELECT * FROM anecdotes WHERE signature_id = ? ORDER BY created_at DESC",
            (sig_id,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM anecdotes ORDER BY created_at DESC LIMIT 50"
        ).fetchall()

    return jsonify([dict(r) for r in rows])


# ═══════════════════════════════════════════════════════════════
# Annotations (Phase 2 — endpoints ready)
# ═══════════════════════════════════════════════════════════════

@app.route("/api/annotations", methods=["POST"])
def create_annotation():
    """Submit a waveform annotation."""
    data = request.get_json(silent=True) or {}
    db = get_db()

    db.execute(
        """INSERT INTO annotations
           (user_id, gesl_sig_id, start_time, end_time,
            label_primary, label_secondary, label_tertiary,
            confidence, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.get("user_id"), data.get("gesl_sig_id"),
         data.get("start_time"), data.get("end_time"),
         data.get("label_primary", ""), data.get("label_secondary", ""),
         data.get("label_tertiary", ""),
         data.get("confidence", 1.0), data.get("notes", ""))
    )
    db.commit()
    return jsonify({"status": "ok"})


@app.route("/api/annotations/export", methods=["GET"])
def export_annotations():
    """Export all annotations as JSON (for ML research datasets)."""
    db = get_db()
    rows = db.execute("""
        SELECT a.*, u.callsign, u.role, u.organization
        FROM annotations a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.gesl_sig_id, a.start_time
    """).fetchall()
    return jsonify({
        "export_date": datetime.datetime.now().isoformat(),
        "total_annotations": len(rows),
        "annotations": [dict(r) for r in rows]
    })


# ═══════════════════════════════════════════════════════════════
# Health & Status
# ═══════════════════════════════════════════════════════════════

@app.route("/api/health", methods=["GET"])
def health():
    """Service health check."""
    db = get_db()
    user_count = db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
    session_count = db.execute("SELECT COUNT(*) as c FROM sessions").fetchone()["c"]
    lb_count = db.execute("SELECT COUNT(*) as c FROM leaderboard").fetchone()["c"]

    return jsonify({
        "status": "ok",
        "service": "Grid Signal Academy",
        "version": "3.0.0-phase1",
        "database": DB_PATH,
        "users": user_count,
        "sessions": session_count,
        "leaderboard_entries": lb_count,
        "gesl_proxy": http_requests is not None,
        "timestamp": datetime.datetime.now().isoformat()
    })


@app.route("/api/stats", methods=["GET"])
def platform_stats():
    """Aggregate platform statistics for the roadmap dashboard."""
    db = get_db()

    stats = {
        "users": db.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"],
        "sessions": db.execute("SELECT COUNT(*) as c FROM sessions").fetchone()["c"],
        "total_answers": db.execute("SELECT COUNT(*) as c FROM answers").fetchone()["c"],
        "correct_answers": db.execute("SELECT SUM(is_correct) as c FROM answers").fetchone()["c"] or 0,
        "leaderboard_entries": db.execute("SELECT COUNT(*) as c FROM leaderboard").fetchone()["c"],
        "anecdotes": db.execute("SELECT COUNT(*) as c FROM anecdotes").fetchone()["c"],
        "annotations": db.execute("SELECT COUNT(*) as c FROM annotations").fetchone()["c"],
        "top_scores": [dict(r) for r in db.execute(
            "SELECT callsign, score, mode, accuracy FROM leaderboard ORDER BY score DESC LIMIT 5"
        ).fetchall()],
        "roles": {r["role"]: r["c"] for r in db.execute(
            "SELECT role, COUNT(*) as c FROM users GROUP BY role"
        ).fetchall()},
    }

    total = stats["total_answers"]
    stats["global_accuracy"] = round((stats["correct_answers"] / total * 100), 1) if total > 0 else 0

    return jsonify(stats)


# ═══════════════════════════════════════════════════════════════
# Static File Serving
# ═══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    """Serve the main application."""
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    """Serve static files, fallback to index.html for SPA routing."""
    if os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")


# ═══════════════════════════════════════════════════════════════
# CORS Headers (allow browser frontend to call API)
# ═══════════════════════════════════════════════════════════════

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    if request.method == "OPTIONS":
        response.status_code = 204
    return response


# ═══════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    init_db()
    print(f"""
╔══════════════════════════════════════════════════════╗
║       Grid Signal Academy — Service Started          ║
╠══════════════════════════════════════════════════════╣
║  Frontend:    http://{HOST}:{PORT}/                       ║
║  API:         http://{HOST}:{PORT}/api/                   ║
║  GESL Proxy:  http://{HOST}:{PORT}/api/gesl/proxy        ║
║  Health:      http://{HOST}:{PORT}/api/health             ║
║  Database:    {DB_PATH:<40s} ║
╚══════════════════════════════════════════════════════╝
    """)
    app.run(host=HOST, port=PORT, debug=DEBUG)
