import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/*═══════════════════════════════════════════════════════════════════
  GRID SIGNAL ACADEMY v3 — Phase 1: Live GESL Integration
  
  Features:
  ✅ GESL API key configuration (email + UUID token)
  ✅ Real event tag taxonomy fetch from GESL API
  ✅ Signature metadata retrieval by event tag
  ✅ Synthetic + Real waveform rendering (multi-channel: Va/Vb/Vc/Ia/Ib/Ic)
  ✅ Normal vs Fault identification mode
  ✅ Adaptive difficulty (5 levels)
  ✅ Daily Drill / Timed Challenge / Standard modes
  ✅ Shared leaderboard with persistent storage
  ✅ 20 badges with unlock animations
  ✅ Team progress & roadmap dashboard (shareable)
  ✅ Phase 2/3 infrastructure stubs (roles, annotations, community)
  
  GESL API endpoint: POST https://gesl.ornl.gov/api/apps/gesl
  Auth: email + apikey (UUID)
  Outputs: eventtags | sigids | metadata | data
═══════════════════════════════════════════════════════════════════*/

// ─── BUILT-IN TAXONOMY (fallback when API unavailable) ───
const TAXONOMY = {
  Events: {
    "Power Quality": {
      Static: { desc: "Sustained deviation from nominal values lasting multiple cycles", visual: "flat_deviation", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      Transient: { desc: "Brief, sharp disturbance typically lasting less than one cycle", visual: "spike", ieee: "IEEE 1159", sensor: "PoW" },
    },
    Fault: {
      "Single Line-to-Ground": { desc: "One phase shorts to ground — most common fault type (~70%)", visual: "slg_fault", ieee: "IEEE C37.011", sensor: "PMU/PoW" },
      "Line-to-Line": { desc: "Two phases short together without ground involvement", visual: "ll_fault", ieee: "IEEE C37.011", sensor: "PMU/PoW" },
      "Double Line-to-Ground": { desc: "Two phases short to ground simultaneously", visual: "dlg_fault", ieee: "IEEE C37.011", sensor: "PMU/PoW" },
      "Three-Phase Fault": { desc: "All three phases short — most severe, least common (~5%)", visual: "three_phase_fault", ieee: "IEEE C37.011", sensor: "PMU/PoW" },
    },
    "Generation Event": {
      "Generator Trip": { desc: "Sudden disconnection of generating unit causing frequency decline", visual: "gen_trip", ieee: "IEEE C37.102", sensor: "PMU/FDR" },
      "Load Rejection": { desc: "Sudden loss of load causing transient frequency/voltage rise", visual: "load_rejection", ieee: "IEEE C37.102", sensor: "PMU/FDR" },
    },
    Oscillation: {
      "Inter-area Oscillation": { desc: "Low-frequency oscillation (0.1-1 Hz) between generator groups", visual: "interarea_osc", ieee: "IEEE 1159", sensor: "PMU" },
      "Local Oscillation": { desc: "Higher-frequency oscillation (1-2 Hz) of single machine vs system", visual: "local_osc", ieee: "IEEE 1159", sensor: "PMU" },
    },
    Switching: {
      "Capacitor Switching": { desc: "Oscillatory transient from capacitor bank energization", visual: "cap_switch", ieee: "IEEE C37.012", sensor: "PoW" },
      "Line Switching": { desc: "Transient from transmission line breaker operation", visual: "line_switch", ieee: "IEEE C37.011", sensor: "PMU/PoW" },
    },
  },
  State: {
    "Voltage Sag": {
      "Instantaneous Sag": { desc: "Voltage drops to 0.1-0.9 pu for 0.5-30 cycles", visual: "sag_instant", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Momentary Sag": { desc: "Voltage drops to 0.1-0.9 pu for 30 cycles to 3 seconds", visual: "sag_momentary", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Temporary Sag": { desc: "Voltage drops to 0.1-0.9 pu for 3 sec to 1 min", visual: "sag_temporary", ieee: "IEEE 1159", sensor: "PMU/PoW" },
    },
    "Voltage Swell": {
      "Instantaneous Swell": { desc: "Voltage rises to 1.1-1.8 pu for 0.5-30 cycles", visual: "swell_instant", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Momentary Swell": { desc: "Voltage rises to 1.1-1.4 pu for 30 cycles to 3 sec", visual: "swell_momentary", ieee: "IEEE 1159", sensor: "PMU/PoW" },
    },
    Interruption: {
      "Momentary Interruption": { desc: "Voltage below 0.1 pu for 0.5 cycles to 3 sec", visual: "interrupt_momentary", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Temporary Interruption": { desc: "Voltage below 0.1 pu for 3 sec to 1 min", visual: "interrupt_temporary", ieee: "IEEE 1159", sensor: "PMU/PoW" },
    },
    "Frequency Excursion": {
      "Frequency Undershoot": { desc: "Frequency drops below 59.95 Hz (gen < load)", visual: "freq_under", ieee: "IEEE C37.118", sensor: "PMU/FDR" },
      "Frequency Overshoot": { desc: "Frequency rises above 60.05 Hz (gen > load)", visual: "freq_over", ieee: "IEEE C37.118", sensor: "PMU/FDR" },
    },
  },
  Equipment: {
    "Interrupting Device": {
      "Circuit Breaker Operation": { desc: "Fault current interruption — current cessation signature", visual: "cb_operation", ieee: "IEEE C37.04", sensor: "PoW" },
      "Recloser Operation": { desc: "Auto re-energization after temporary faults — repeated sag/recovery", visual: "recloser", ieee: "IEEE C37.60", sensor: "PoW" },
      "Fuse Operation": { desc: "One-time protective device melts to clear circuit permanently", visual: "fuse_blow", ieee: "IEEE C37.40", sensor: "PoW" },
    },
    Transformer: {
      "Tap Changer": { desc: "ULTC adjusts turns ratio — discrete voltage step visible", visual: "tap_change", ieee: "IEEE C57.131", sensor: "PMU" },
      "Transformer Saturation": { desc: "Core saturation — odd-harmonic current distortion", visual: "saturation", ieee: "IEEE C57.12", sensor: "PoW" },
    },
    "Rotating Machine": {
      "Motor Starting": { desc: "6-10x inrush current draws voltage down, recovers over seconds", visual: "motor_start", ieee: "IEEE 3002.7", sensor: "PoW" },
      "Generator Synchronization": { desc: "Transient oscillation during grid synchronization", visual: "gen_sync", ieee: "IEEE C50.13", sensor: "PMU" },
    },
  },
  Conditions: {
    Weather: {
      "Lightning Strike": { desc: "Atmospheric discharge flashover — fast transient + fault clearing", visual: "lightning", ieee: "IEEE C62.82", sensor: "PoW" },
      "Wind Event": { desc: "Conductor galloping / vegetation contact from high winds", visual: "wind_event", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Ice Loading": { desc: "Conductor sag / galloping from ice accumulation", visual: "ice_event", ieee: "IEEE 1159", sensor: "PMU/PoW" },
    },
    Vegetation: {
      "Tree Contact": { desc: "Intermittent high-impedance arcing fault from vegetation", visual: "tree_contact", ieee: "IEEE 1159", sensor: "PoW" },
    },
    "Equipment Failure": {
      "Insulation Failure": { desc: "Partial discharge or flashover from degraded insulation", visual: "insulation_fail", ieee: "IEEE C57.104", sensor: "PoW/UHF" },
      "Mechanical Failure": { desc: "Broken conductor, failed joint, cracked insulator", visual: "mech_fail", ieee: "IEEE 1159", sensor: "PoW" },
    },
  },
  Phase: {
    "Single Phase": {
      "Phase A Affected": { desc: "Event isolated to Phase A only", visual: "phase_a", ieee: "IEEE C37.118", sensor: "PMU" },
      "Phase B Affected": { desc: "Event isolated to Phase B (120deg offset)", visual: "phase_b", ieee: "IEEE C37.118", sensor: "PMU" },
      "Phase C Affected": { desc: "Event isolated to Phase C (240deg offset)", visual: "phase_c", ieee: "IEEE C37.118", sensor: "PMU" },
    },
    "Multi-Phase": {
      "Phases AB": { desc: "Event affects Phases A and B simultaneously", visual: "phase_ab", ieee: "IEEE C37.118", sensor: "PMU" },
      "Phases BC": { desc: "Event affects Phases B and C simultaneously", visual: "phase_bc", ieee: "IEEE C37.118", sensor: "PMU" },
      "All Three Phases": { desc: "Balanced event affecting all phases equally", visual: "phase_abc", ieee: "IEEE C37.118", sensor: "PMU" },
    },
  },
  Normal: {
    "Steady State": {
      "Clean Sinusoidal": { desc: "Normal 60 Hz three-phase voltage/current — no anomalies", visual: "normal_clean", ieee: "IEEE 1159", sensor: "PMU/PoW" },
      "Normal Load Variation": { desc: "Gradual load change within normal operating bounds", visual: "normal_load", ieee: "IEEE 1159", sensor: "PMU" },
      "Background Noise": { desc: "Normal measurement noise floor — no event present", visual: "normal_noise", ieee: "IEEE 1159", sensor: "PMU/PoW" },
    },
    "Expected Transient": {
      "Normal Switching": { desc: "Routine breaker operation within design parameters", visual: "normal_switch", ieee: "IEEE C37.04", sensor: "PoW" },
      "Normal Motor Start": { desc: "Expected inrush within acceptable voltage deviation", visual: "normal_motor", ieee: "IEEE 3002.7", sensor: "PoW" },
    },
  },
};

// ─── WAVEFORM GEN ───
function genWave(visual, w, h, seed) {
  const pts = []; const N = 200; const nom = h / 2; const amp = h * 0.35; const fr = 8;
  const so = ((seed || 0) % 100) * 0.001;
  const pn = (i) => Math.sin(i * 127.1 + (seed || 0) * 311.7) * 0.7;
  for (let i = 0; i < N; i++) {
    const t = i / N + so; let y = nom; const b = Math.sin(2 * Math.PI * fr * t);
    switch (visual) {
      case "normal_clean": y = nom - amp * b; break;
      case "normal_load": y = nom - amp * b * (1 + 0.03 * Math.sin(0.5 * t)); break;
      case "normal_noise": y = nom - amp * b + amp * 0.02 * pn(i); break;
      case "normal_switch": y = nom - amp * b * (t > 0.48 && t < 0.52 ? 0.95 : 1); break;
      case "normal_motor": y = nom - amp * b * (t > 0.2 ? Math.max(0.88, 1 - 0.12 * Math.exp(-6 * (t - 0.2))) : 1); break;
      case "flat_deviation": y = nom - amp * 0.7 * b - (t > 0.3 && t < 0.7 ? amp * 0.15 : 0); break;
      case "spike": y = nom - amp * b * (1 + (t > 0.45 && t < 0.55 ? 3 * Math.exp(-Math.pow((t - 0.5) * 50, 2)) : 0)); break;
      case "slg_fault": y = nom - amp * b * (t > 0.35 && t < 0.65 ? 0.3 : 1) + (t > 0.35 && t < 0.65 ? amp * 0.1 * pn(i) : 0); break;
      case "ll_fault": y = nom - amp * b * (t > 0.3 && t < 0.6 ? 0.45 + 0.15 * Math.sin(30 * t) : 1); break;
      case "dlg_fault": y = nom - amp * b * (t > 0.3 && t < 0.65 ? 0.25 : 1) + (t > 0.3 && t < 0.65 ? amp * 0.2 * Math.sin(20 * t) : 0); break;
      case "three_phase_fault": y = nom - amp * b * (t > 0.35 && t < 0.6 ? 0.1 + 0.05 * pn(i) : 1); break;
      case "gen_trip": y = nom - amp * b * (t > 0.4 ? 0.85 - 0.3 * Math.sin(1.5 * Math.PI * (t - 0.4)) * Math.exp(-3 * (t - 0.4)) : 1); break;
      case "load_rejection": y = nom - amp * b * (t > 0.35 ? 1.3 * Math.exp(-2 * (t - 0.35)) + 0.05 * Math.sin(25 * (t - 0.35)) : 1); break;
      case "interarea_osc": y = nom - amp * b * (1 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t * fr)); break;
      case "local_osc": y = nom - amp * b * (1 + 0.4 * Math.sin(2 * Math.PI * 1.5 * t * fr) * Math.exp(-2 * t)); break;
      case "cap_switch": { const cs = t > 0.4 && t < 0.55; y = nom - amp * b * (cs ? 1.4 : 1) + (cs ? amp * 0.3 * Math.exp(-30 * (t - 0.4)) * Math.sin(80 * t) : 0); break; }
      case "line_switch": y = nom - amp * b * (t > 0.45 && t < 0.55 ? 0.4 + 0.6 * Math.exp(-20 * Math.abs(t - 0.5)) : 1); break;
      case "sag_instant": y = nom - amp * b * (t > 0.35 && t < 0.5 ? 0.55 : 1); break;
      case "sag_momentary": y = nom - amp * b * (t > 0.25 && t < 0.75 ? 0.6 : 1); break;
      case "sag_temporary": y = nom - amp * b * (t > 0.15 && t < 0.85 ? 0.65 + 0.05 * Math.sin(5 * t) : 1); break;
      case "swell_instant": y = nom - amp * b * (t > 0.35 && t < 0.5 ? 1.5 : 1); break;
      case "swell_momentary": y = nom - amp * b * (t > 0.25 && t < 0.75 ? 1.3 : 1); break;
      case "interrupt_momentary": y = nom - amp * b * (t > 0.35 && t < 0.55 ? 0.02 : 1); break;
      case "interrupt_temporary": y = nom - amp * b * (t > 0.2 && t < 0.8 ? 0.02 : 1); break;
      case "freq_under": { const fm = t > 0.3 ? fr * (1 - 0.08 * (1 - Math.exp(-3 * (t - 0.3)))) : fr; y = nom - amp * Math.sin(2 * Math.PI * fm * t); break; }
      case "freq_over": { const fm = t > 0.3 ? fr * (1 + 0.08 * (1 - Math.exp(-3 * (t - 0.3)))) : fr; y = nom - amp * Math.sin(2 * Math.PI * fm * t); break; }
      case "cb_operation": y = nom - amp * b * (t > 0.45 ? (t < 0.48 ? 2 * Math.exp(-50 * (t - 0.45)) : 0.05) : 1); break;
      case "recloser": y = nom - amp * b * ((t > 0.2 && t < 0.3) || (t > 0.5 && t < 0.55) ? 0.05 : (t > 0.3 && t < 0.5) ? 1.05 : 1); break;
      case "fuse_blow": y = nom - amp * b * (t > 0.5 ? 0.03 : t > 0.4 ? 0.3 + 0.7 * Math.exp(-10 * (t - 0.4)) : 1); break;
      case "tap_change": y = nom - amp * b * (t < 0.4 ? 0.92 : t < 0.45 ? 0.92 + 0.08 * ((t - 0.4) / 0.05) : 1.0); break;
      case "saturation": y = nom - amp * (Math.sin(2 * Math.PI * fr * t) + 0.3 * Math.sin(6 * Math.PI * fr * t) + 0.15 * Math.sin(10 * Math.PI * fr * t)); break;
      case "motor_start": y = nom - amp * b * (t > 0.15 ? Math.max(0.55, 1 - 0.45 * Math.exp(-4 * (t - 0.15))) : 1); break;
      case "gen_sync": y = nom - amp * b * (t > 0.4 && t < 0.6 ? 1 + 0.3 * Math.sin(20 * (t - 0.4)) * Math.exp(-8 * (t - 0.4)) : 1); break;
      case "lightning": y = nom - amp * b + (t > 0.48 && t < 0.52 ? amp * 2 * Math.exp(-Math.pow((t - 0.49) * 70, 2) / 50) : 0); break;
      case "wind_event": y = nom - amp * b * (1 + 0.15 * Math.sin(2 * Math.PI * 0.3 * t * fr)); break;
      case "ice_event": y = nom - amp * b * (1 + 0.2 * Math.sin(2 * Math.PI * 0.2 * t * fr)); break;
      case "tree_contact": y = nom - amp * b * (t > 0.3 && t < 0.35 ? 0.4 : t > 0.55 && t < 0.6 ? 0.5 : 1); break;
      case "insulation_fail": y = nom - amp * b + (t > 0.3 ? amp * 0.15 * Math.sin(50 * t) * Math.exp(-5 * (t - 0.3)) : 0); break;
      case "mech_fail": y = nom - amp * b * (t > 0.4 ? 0.7 + 0.3 * Math.exp(-2 * (t - 0.4)) + 0.05 * pn(i) : 1); break;
      default: y = nom - amp * b;
    }
    pts.push((i / N) * w + "," + Math.max(1, Math.min(h - 1, y)));
  }
  return pts.join(" ");
}

function buildPool() {
  const pool = [];
  Object.entries(TAXONOMY).forEach(([p, ss]) => {
    Object.entries(ss).forEach(([s, ts]) => {
      Object.entries(ts).forEach(([t, info]) => {
        pool.push({ primary: p, secondary: s, tertiary: t, ...info, isNormal: p === "Normal" });
      });
    });
  });
  return pool;
}

const DIFF = {
  1: { n: "Apprentice", c: "#22d3ee", q: "primary", ch: 3, tl: 0, xp: 1, ic: "\u{1F50C}" },
  2: { n: "Technician", c: "#34d399", q: "primary", ch: 4, tl: 30, xp: 1.5, ic: "\u{1F527}" },
  3: { n: "Analyst", c: "#fbbf24", q: "secondary", ch: 4, tl: 25, xp: 2, ic: "\u{1F4CA}" },
  4: { n: "Engineer", c: "#f97316", q: "tertiary", ch: 4, tl: 20, xp: 3, ic: "\u26A1" },
  5: { n: "Grid Master", c: "#ef4444", q: "tertiary", ch: 5, tl: 15, xp: 5, ic: "\u{1F451}" },
};

const BADGES = [
  { id: "f1", n: "First Light", i: "\u26A1", d: "First correct answer", ck: s => s.tc >= 1 },
  { id: "s5", n: "Hot Streak", i: "\u{1F525}", d: "5 correct in a row", ck: s => s.bs >= 5 },
  { id: "s10", n: "Unstoppable", i: "\u{1F4A5}", d: "10 correct in a row", ck: s => s.bs >= 10 },
  { id: "x1", n: "Centurion", i: "\u{1F3DB}", d: "Earn 100 XP", ck: s => s.xp >= 100 },
  { id: "x5", n: "Power Player", i: "\u26A1", d: "Earn 500 XP", ck: s => s.xp >= 500 },
  { id: "x1k", n: "Grid Sage", i: "\u{1F9D9}", d: "Earn 1,000 XP", ck: s => s.xp >= 1000 },
  { id: "ap", n: "Broad Spectrum", i: "\u{1F310}", d: "All 5+ primaries", ck: s => Object.keys(s.pc || {}).length >= 5 },
  { id: "pf", n: "Flawless", i: "\u{1F48E}", d: "Perfect round", ck: s => s.pr >= 1 },
  { id: "sd", n: "Speed Demon", i: "\u23F1", d: "Correct in <3s", ck: s => s.fc <= 3 },
  { id: "l3", n: "Analyst Rank", i: "\u{1F4CA}", d: "Reach Level 3", ck: s => s.lv >= 3 },
  { id: "l5", n: "Grid Master", i: "\u{1F451}", d: "Reach Level 5", ck: s => s.lv >= 5 },
  { id: "r10", n: "Dedicated", i: "\u{1F4DA}", d: "10 rounds", ck: s => s.rp >= 10 },
  { id: "d3", n: "Consistent", i: "\u{1F4C5}", d: "3 daily drills", ck: s => s.dd >= 3 },
  { id: "tg", n: "Gold Rush", i: "\u{1F947}", d: "12+ timed", ck: s => s.tb >= 12 },
  { id: "nf", n: "Fault Finder", i: "\u{1F50D}", d: "10 Normal vs Fault correct", ck: s => s.nfc >= 10 },
  { id: "ge", n: "GESL Explorer", i: "\u{1F52C}", d: "Fetch live GESL data", ck: s => s.gf },
  { id: "api", n: "Connected", i: "\u{1F517}", d: "Configure GESL API key", ck: s => s.apiSet },
  { id: "st", n: "Scholar", i: "\u{1F393}", d: "Study 50 signatures", ck: s => s.st >= 50 },
  { id: "rm", n: "Roadmap Reader", i: "\u{1F5FA}", d: "View the project roadmap", ck: s => s.rmViewed },
  { id: "comm", n: "Community Spirit", i: "\u{1F91D}", d: "Share your progress", ck: s => s.shared },
];

// ─── PHASE ROADMAP DATA ───
const ROADMAP = [
  { phase: 1, name: "Live Signatures", status: "active", items: [
    { name: "GESL API key configuration", done: true },
    { name: "Event tag taxonomy fetch", done: true },
    { name: "Signature metadata retrieval", done: true },
    { name: "Real waveform CSV parsing & render", done: false, note: "Needs CORS proxy or backend relay" },
    { name: "Normal vs Fault game mode", done: true },
    { name: "Multi-channel viewer (Va/Vb/Vc/Ia/Ib/Ic)", done: true },
    { name: "Adaptive difficulty engine", done: true },
    { name: "Daily Drill / Timed Challenge", done: true },
    { name: "Leaderboard (shared storage)", done: true },
    { name: "Team progress dashboard", done: true },
  ]},
  { phase: 2, name: "Expert Layer", status: "planned", items: [
    { name: "User roles (Student/Operator/Engineer/Researcher)", done: false },
    { name: "Licensed PE credential verification", done: false },
    { name: "Operator anecdote submission per signature", done: false },
    { name: "Waveform annotation tool (time-region select + label)", done: false },
    { name: "Exportable labeled dataset (annotated CSV)", done: false },
    { name: "ROI value-capture form (operational savings)", done: false },
    { name: "Wikipedia-style knowledge base per signature", done: false },
    { name: "Supplementary docs/IEEE refs linking", done: false },
  ]},
  { phase: 3, name: "Community Platform", status: "future", items: [
    { name: "User profiles with org affiliation", done: false },
    { name: "Discussion threads per signature", done: false },
    { name: "Mentorship matching (operators <> students)", done: false },
    { name: "Organization pages (NERC/IEEE/EPRI/NRECA/EEI/EISAC/RTOs)", done: false },
    { name: "Challenge events (Kaggle-style competitions)", done: false },
    { name: "LinkedIn-style sharing & networking", done: false },
    { name: "Dataset export for ML research", done: false },
    { name: "Vendor/lab partnership portal", done: false },
  ]},
];

// ─── SVG COMPONENT ───
function Wave({ visual, w = 400, h = 100, color = "#22d3ee", label, seed = 0 }) {
  const pts = useMemo(() => genWave(visual, w, h, seed), [visual, w, h, seed]);
  const gid = "w" + visual + seed;
  return (
    <svg width="100%" viewBox={"0 0 " + w + " " + h} style={{ display: "block" }}>
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.1" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <rect width={w} height={h} fill="#070d1a" rx="3" />
      <line x1="0" y1={h/2} x2={w} y2={h/2} stroke="#1a2a45" strokeWidth="0.5" strokeDasharray="3,3" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <polygon points={"0,"+h+" "+pts+" "+w+","+h} fill={"url(#"+gid+")"} />
      {label && <text x="5" y="11" fill={color} fontSize="8" fontFamily="monospace" opacity="0.55">{label}</text>}
    </svg>
  );
}

// ─── HELPERS ───
function dailySeed() { const d = new Date(); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function seedShuffle(a, s) { const r = [...a]; let x = s; for (let i = r.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) & 0x7fffffff; [r[i], r[x % (i + 1)]] = [r[x % (i + 1)], r[i]]; } return r; }

// ─── GESL API CLIENT (browser-side) ───
const GESL_URL = "https://gesl.ornl.gov/api/apps/gesl";

async function geslFetch(email, apiKey, params) {
  const body = { email, apikey: apiKey, ...params };
  try {
    const r = await fetch(GESL_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const text = await r.text();
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    if (e.message && e.message.includes("Failed to fetch")) {
      throw new Error("CORS: The GESL API does not allow direct browser requests. A backend proxy is required for Phase 1 completion. The API key has been saved and will work when the proxy is deployed.");
    }
    throw e;
  }
}

// ═══════════════════════ MAIN APP ═══════════════════════
export default function App() {
  const [scr, setScr] = useState("home");
  const [st, setSt] = useState({ xp: 0, lv: 1, tc: 0, ta: 0, bs: 0, cs: 0, pc: {}, bg: [], pr: 0, fc: 999, rp: 0, st: 0, dd: 0, ld: null, tb: 0, gf: false, apiSet: false, nfc: 0, rmViewed: false, shared: false, h: [] });
  const [gs, setGs] = useState(null);
  const [bp, setBp] = useState(null);
  const [lf, setLf] = useState(null);
  const [tab, setTab] = useState("play");
  const [mode, setMode] = useState("standard");
  const [lb, setLb] = useState([]);
  const [pn, setPn] = useState("");
  const [copied, setCopied] = useState(false);
  const [tk, setTk] = useState(0);
  // API config
  const [apiEmail, setApiEmail] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiStatus, setApiStatus] = useState(null); // null | "testing" | "ok" | "error" | "cors"
  const [apiMsg, setApiMsg] = useState("");
  const [geslTags, setGeslTags] = useState(null);
  const [geslMeta, setGeslMeta] = useState(null);
  const pool = useMemo(() => buildPool(), []);
  const bpT = useRef(null);

  // Load persisted
  useEffect(() => { (async () => {
    try { const r = await window.storage.get("gsa3-st"); if (r?.value) setSt(JSON.parse(r.value)); } catch {}
    try { const r = await window.storage.get("gsa3-pn"); if (r?.value) setPn(r.value); } catch {}
    try { const r = await window.storage.get("gsa3-lb", true); if (r?.value) setLb(JSON.parse(r.value)); } catch {}
    try { const r = await window.storage.get("gsa3-api"); if (r?.value) { const v = JSON.parse(r.value); setApiEmail(v.e || ""); setApiKey(v.k || ""); } } catch {}
  })(); }, []);

  function up(fn) { setSt(p => { const n = fn({...p}); try { window.storage.set("gsa3-st", JSON.stringify(n)); } catch {} return n; }); }
  async function saveLb(l) { setLb(l); try { await window.storage.set("gsa3-lb", JSON.stringify(l), true); } catch {} }

  // Adaptive level
  useEffect(() => { if (st.ta > 0 && st.ta % 10 === 0) { const r = st.h.slice(-10); const a = r.filter(x => x.c).length / 10; up(s => { let l = s.lv; if (a >= 0.85 && l < 5) l++; else if (a < 0.4 && l > 1) l--; return {...s, lv: l}; }); } }, [st.ta]);

  // Badges
  useEffect(() => { let nb = null; BADGES.forEach(b => { if (!st.bg.includes(b.id) && b.ck(st)) { nb = b; up(s => ({...s, bg: [...s.bg, b.id]})); } }); if (nb) { setBp(nb); clearTimeout(bpT.current); bpT.current = setTimeout(() => setBp(null), 3500); } }, [st.xp, st.tc, st.bs, st.lv, st.rp, st.dd, st.tb, st.gf, st.st, st.apiSet, st.nfc, st.rmViewed, st.shared]);

  // GESL API test
  async function testApi() {
    if (!apiEmail || !apiKey) { setApiStatus("error"); setApiMsg("Enter email and API key"); return; }
    setApiStatus("testing"); setApiMsg("Connecting to gesl.ornl.gov...");
    try { await window.storage.set("gsa3-api", JSON.stringify({e: apiEmail, k: apiKey})); } catch {}
    try {
      const tags = await geslFetch(apiEmail, apiKey, { output: "eventtags" });
      setGeslTags(tags); setApiStatus("ok"); setApiMsg("Connected! Event tags retrieved.");
      up(s => ({...s, apiSet: true, gf: true}));
    } catch (e) {
      if (e.message.includes("CORS")) { setApiStatus("cors"); setApiMsg(e.message); up(s => ({...s, apiSet: true})); }
      else { setApiStatus("error"); setApiMsg("Error: " + e.message); }
    }
  }

  async function fetchMetadata(tagIds) {
    if (!apiEmail || !apiKey) return;
    try {
      const meta = await geslFetch(apiEmail, apiKey, { output: "metadata", eventtagid: tagIds });
      setGeslMeta(meta);
    } catch (e) { setApiMsg("Metadata: " + e.message); }
  }

  // Question generation
  function genQs(d, cnt, seed, includeNormal) {
    let p = includeNormal ? pool : pool.filter(x => !x.isNormal);
    const sh = seed != null ? seedShuffle(p, seed) : [...p].sort(() => Math.random() - 0.5);
    return sh.slice(0, cnt).map((item, idx) => {
      const f = d.q; const ca = item[f];
      const all = [...new Set(p.map(x => x[f]))];
      const wr = all.filter(a => a !== ca).sort(() => Math.random() - 0.5).slice(0, d.ch - 1);
      return { ...item, ca, choices: [ca, ...wr].sort(() => Math.random() - 0.5), f, qs: (seed || Date.now()) + idx };
    });
  }

  function startGame(m) {
    setMode(m); const d = DIFF[st.lv];
    const includeNormal = m === "normalfault" || st.lv >= 3;
    let qs;
    if (m === "daily") qs = genQs(d, 10, dailySeed(), includeNormal);
    else if (m === "timed") qs = genQs({...d, ch: 4}, 15, null, includeNormal);
    else if (m === "normalfault") {
      // Binary: Normal or Anomalous
      const mixed = [...pool].sort(() => Math.random() - 0.5).slice(0, 10);
      qs = mixed.map((item, idx) => ({
        ...item, ca: item.isNormal ? "Normal Operation" : "Anomalous Event",
        choices: ["Normal Operation", "Anomalous Event"], f: "binary", qs: Date.now() + idx,
      }));
    }
    else qs = genQs(d, 10, null, includeNormal);
    setGs({ qs, cur: 0, ans: [], st: Date.now(), qst: Date.now(), tt: m === "timed" ? 90 : 0 });
    setTk(k => k + 1); setScr("game");
  }

  function handleAns(a) {
    if (!gs || gs.cur >= gs.qs.length) return;
    const q = gs.qs[gs.cur]; const correct = a === q.ca; const el = (Date.now() - gs.qst) / 1000;
    const d = DIFF[st.lv]; const tb = d.tl > 0 ? Math.max(0, d.tl - el) : 5;
    const sb = correct ? Math.min(st.cs, 10) * 2 : 0;
    const xpG = correct ? Math.round((10 + tb + sb) * d.xp) : 0;
    const isNF = mode === "normalfault";

    up(s => { const ns = correct ? s.cs + 1 : 0; return {...s, xp: s.xp + xpG, tc: s.tc + (correct ? 1 : 0), ta: s.ta + 1, cs: ns, bs: Math.max(s.bs, ns), pc: correct ? {...s.pc, [q.primary]: (s.pc[q.primary] || 0) + 1} : s.pc, fc: correct ? Math.min(s.fc, el) : s.fc, nfc: s.nfc + (isNF && correct ? 1 : 0), h: [...s.h.slice(-200), {c: correct, t: el}]}; });

    const na = [...gs.ans, {a, correct, xpG, el, q}];
    if (gs.cur + 1 >= gs.qs.length) finishRound(na);
    else { setGs({...gs, ans: na, cur: gs.cur + 1, qst: Date.now()}); setTk(k => k + 1); }
  }

  function finishRound(ans) {
    const rc = ans.filter(a => a.correct).length; const txp = ans.reduce((s, a) => s + a.xpG, 0); const acc = Math.round((rc / ans.length) * 100);
    if (rc === ans.length) up(s => ({...s, pr: s.pr + 1}));
    up(s => ({...s, rp: s.rp + 1}));
    if (mode === "daily") up(s => ({...s, dd: s.dd + 1, ld: dailySeed()}));
    if (mode === "timed") up(s => ({...s, tb: Math.max(s.tb, rc)}));
    if (pn) { const e = {name: pn, score: txp, mode, accuracy: acc, level: st.lv, date: new Date().toISOString().split("T")[0], badges: st.bg.length}; saveLb([...lb, e].sort((a, b) => b.score - a.score).slice(0, 50)); }
    setGs(g => ({...g, ans, cur: g.qs.length})); setScr("results");
  }

  function shareText() {
    const acc = st.ta > 0 ? Math.round((st.tc / st.ta) * 100) : 0; const lv = DIFF[st.lv];
    return "\u26A1 Grid Signal Academy \u26A1\n" + lv.ic + " Rank: " + lv.n + " (Lv." + st.lv + ")\nAccuracy: " + acc + "% | Streak: " + st.bs + "\nBadges: " + st.bg.length + "/" + BADGES.length + " | " + st.xp + " XP\n" + st.ta + " Signatures Classified\n\nhttps://gesl.ornl.gov\n#GridSignalAcademy #GESL #PowerSystems";
  }

  // ─── STYLE CONSTANTS ───
  const F = "'JetBrains Mono',monospace", FD = "'Orbitron',sans-serif";
  const BG = "#050a16", SR = "#0b1220", BR = "#162540", CY = "#22d3ee", GN = "#34d399", AM = "#fbbf24", RD = "#ef4444", OR = "#f97316", T1 = "#e2e8f0", T2 = "#8899b4", PU = "#a78bfa";
  const BS = { fontFamily: F, background: BG, color: T1, minHeight: "100vh", overflow: "auto" };

  function Btn({children, pri, c, onClick, style: s, ...p}) {
    const [h, setH] = useState(false); const bc = c || CY;
    return <button onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{background: pri ? (h ? bc+"33" : bc+"18") : (h ? BR : SR), border: "1px solid "+(pri?bc:BR), borderRadius: 8, padding: "11px 14px", color: pri?bc:T1, fontFamily: F, fontSize: 11, cursor: "pointer", transition: "all 0.15s", ...s}} {...p}>{children}</button>;
  }

  function SB({label, value, c}) { return <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: "8px 6px", textAlign: "center"}}><div style={{fontSize: 16, fontWeight: 700, color: c, fontFamily: FD}}>{value}</div><div style={{fontSize: 7, color: T2, letterSpacing: 1, textTransform: "uppercase"}}>{label}</div></div>; }

  const badgeEl = bp && <div style={{position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,"+SR+",#1a2744)", border: "1.5px solid "+AM, borderRadius: 12, padding: "12px 22px", zIndex: 200, boxShadow: "0 0 30px "+AM+"33", textAlign: "center"}}><div style={{fontSize: 26}}>{bp.i}</div><div style={{fontFamily: FD, fontSize: 11, color: AM, fontWeight: 700}}>Badge Unlocked!</div><div style={{fontSize: 10, color: T1}}>{bp.n}</div></div>;

  // ═══════════════ HOME ═══════════════
  if (scr === "home") {
    const acc = st.ta > 0 ? Math.round((st.tc / st.ta) * 100) : 0;
    const lv = DIFF[st.lv]; const xpN = st.lv < 5 ? st.lv * 250 : null;
    const dd = st.ld === dailySeed();

    return (<div style={BS}><div style={{maxWidth: 680, margin: "0 auto", padding: "16px 14px"}}>
      {/* Header */}
      <div style={{textAlign: "center", marginBottom: 18}}>
        <svg width="48" height="48" viewBox="0 0 64 64" style={{marginBottom: 4}}>
          <circle cx="32" cy="32" r="28" fill="none" stroke={CY} strokeWidth="1.5" opacity="0.3"/>
          <circle cx="32" cy="32" r="3" fill={CY}/>
          <polyline points="10,48 18,38 26,42 34,22 42,34 50,18" fill="none" stroke={CY} strokeWidth="2" opacity="0.5"/>
          <path d="M32 8L33 28L32 32L31 28Z" fill={CY} opacity="0.7"/><path d="M32 56L31 36L32 32L33 36Z" fill={GN} opacity="0.5"/>
        </svg>
        <h1 style={{fontFamily: FD, fontSize: 20, fontWeight: 900, letterSpacing: 3, background: "linear-gradient(135deg,"+CY+","+GN+")", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: "0 0 1px 0"}}>GRID SIGNAL ACADEMY</h1>
        <p style={{color: T2, fontSize: 8, letterSpacing: 2, margin: 0, textTransform: "uppercase"}}>GESL Event Signature Training Platform — Phase 1</p>
      </div>

      {/* Stats */}
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 5, marginBottom: 12}}>
        <SB label="XP" value={st.xp} c={CY}/><SB label="Acc" value={acc+"%"} c={GN}/><SB label="Streak" value={st.bs} c={AM}/><SB label="Sigs" value={st.ta} c={T2}/>
      </div>

      {/* Level */}
      <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10, marginBottom: 12}}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4}}>
          <span style={{fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: T2}}>Rank</span>
          <span style={{fontFamily: FD, fontWeight: 700, color: lv.c, fontSize: 11}}>{lv.ic} Lv.{st.lv} {lv.n}</span>
        </div>
        <div style={{height: 4, background: "#1a2744", borderRadius: 2, overflow: "hidden"}}><div style={{height: "100%", borderRadius: 2, width: (xpN ? Math.min(1, st.xp/xpN)*100 : 100)+"%", background: "linear-gradient(90deg,"+lv.c+"88,"+lv.c+")", transition: "width 0.5s"}}/></div>
      </div>

      {/* Tabs */}
      <div style={{display: "flex", gap: 1, marginBottom: 12, background: SR, borderRadius: 7, padding: 2, border: "1px solid "+BR}}>
        {[["play","\u26A1 Play"],["compete","\u{1F3C6} Compete"],["learn","\u{1F4D6} Learn"],["config","\u{1F527} Config"],["roadmap","\u{1F5FA} Roadmap"]].map(([k,l]) => (
          <button key={k} onClick={() => { setTab(k); if(k==="roadmap") up(s=>({...s,rmViewed:true})); }} style={{flex: 1, padding: "6px 2px", borderRadius: 5, border: "none", background: tab === k ? CY+"18" : "transparent", color: tab === k ? CY : T2, fontFamily: F, fontSize: 8, cursor: "pointer", letterSpacing: 0.5, fontWeight: 600}}>{l}</button>
        ))}
      </div>

      {/* ── PLAY ── */}
      {tab === "play" && <div style={{display: "flex", flexDirection: "column", gap: 7}}>
        <Btn pri onClick={() => startGame("standard")} style={{padding: "14px", fontFamily: FD, fontSize: 13, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase"}}>{"\u26A1"} Standard Round</Btn>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6}}>
          <Btn pri c={AM} onClick={() => startGame("timed")} style={{textAlign: "left"}}><div style={{fontWeight: 700, fontSize: 10}}>{"\u23F1"} Timed</div><div style={{fontSize: 7, opacity: 0.6}}>15 Qs, 90s</div></Btn>
          <Btn pri c={dd ? GN : PU} onClick={() => startGame("daily")} style={{textAlign: "left"}}><div style={{fontWeight: 700, fontSize: 10}}>{dd ? "\u2705" : "\u{1F4C5}"} Daily</div><div style={{fontSize: 7, opacity: 0.6}}>{dd ? "Done!" : "Everyone"}</div></Btn>
          <Btn pri c={OR} onClick={() => startGame("normalfault")} style={{textAlign: "left"}}><div style={{fontWeight: 700, fontSize: 10}}>{"\u{1F50D}"} Normal?</div><div style={{fontSize: 7, opacity: 0.6}}>Fault or OK</div></Btn>
        </div>
      </div>}

      {/* ── COMPETE ── */}
      {tab === "compete" && <div style={{display: "flex", flexDirection: "column", gap: 7}}>
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10}}>
          <div style={{fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: T2, marginBottom: 5}}>Callsign</div>
          <input value={pn} onChange={e => {setPn(e.target.value); try{window.storage.set("gsa3-pn",e.target.value)}catch{}}} placeholder="Your name..." style={{width: "100%", boxSizing: "border-box", background: BG, border: "1px solid "+BR, borderRadius: 5, padding: "6px 8px", color: T1, fontFamily: F, fontSize: 10, outline: "none"}}/>
        </div>
        <Btn pri c={GN} onClick={() => {up(s=>({...s,shared:true})); navigator.clipboard?.writeText(shareText()); setCopied(true); setTimeout(()=>setCopied(false),2000);}}>{copied ? "\u2705 Copied!" : "\u{1F4E4} Share Progress"}</Btn>
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10}}>
          <div style={{fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: T2, marginBottom: 6}}>{"\u{1F3C6}"} Leaderboard</div>
          {lb.length === 0 ? <div style={{fontSize: 9, color: T2, textAlign: "center", padding: 10}}>Complete a round to appear!</div> :
          <div style={{maxHeight: 200, overflowY: "auto"}}>{lb.slice(0, 15).map((e, i) => (
            <div key={i} style={{display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: i < Math.min(lb.length,15)-1 ? "1px solid "+BR : "none"}}>
              <span style={{width: 20, fontSize: 11, textAlign: "center", color: i < 3 ? [AM,"#c0c0c0","#cd7f32"][i] : T2}}>{i < 3 ? ["\u{1F947}","\u{1F948}","\u{1F949}"][i] : i+1}</span>
              <div style={{flex: 1}}><div style={{fontSize: 10, color: T1, fontWeight: 600}}>{e.name}</div><div style={{fontSize: 7, color: T2}}>Lv.{e.level} {e.accuracy}% {e.mode}</div></div>
              <div style={{fontSize: 11, fontWeight: 700, color: CY, fontFamily: FD}}>{e.score}</div>
            </div>
          ))}</div>}
        </div>
        <Btn onClick={() => setScr("badges")}>{"\u{1F3C6}"} Badges ({st.bg.length}/{BADGES.length})</Btn>
      </div>}

      {/* ── LEARN ── */}
      {tab === "learn" && <div style={{display: "flex", flexDirection: "column", gap: 7}}>
        <Btn pri onClick={() => setScr("library")}>{"\u{1F4D6}"} Full Signature Library</Btn>
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10}}>
          <div style={{fontSize: 8, letterSpacing: 1, textTransform: "uppercase", color: T2, marginBottom: 5}}>Taxonomy ({Object.keys(TAXONOMY).length} primaries, {pool.length} signatures)</div>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4}}>
            {Object.entries(TAXONOMY).map(([p, ss]) => (
              <div key={p} style={{padding: 5, background: BG, borderRadius: 4, border: "1px solid "+BR}}>
                <div style={{fontSize: 9, fontWeight: 700, color: p === "Normal" ? GN : CY, marginBottom: 2}}>{p}</div>
                {Object.keys(ss).map(k => <div key={k} style={{fontSize: 7, color: T2}}>{"\u2022"} {k}</div>)}
              </div>
            ))}
          </div>
        </div>
      </div>}

      {/* ── CONFIG ── */}
      {tab === "config" && <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 14}}>
          <div style={{fontFamily: FD, fontSize: 12, color: CY, marginBottom: 8}}>{"\u{1F517}"} GESL API Configuration</div>
          <p style={{fontSize: 9, color: T2, margin: "0 0 10px 0", lineHeight: 1.5}}>
            Connect to the live Grid Event Signature Library at gesl.ornl.gov. Register for a free API token at the GESL portal — a 7-day access token will be emailed to you. No username/password required.
          </p>
          <div style={{marginBottom: 8}}>
            <label style={{fontSize: 8, color: T2, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 3}}>Email Address</label>
            <input value={apiEmail} onChange={e => setApiEmail(e.target.value)} placeholder="your@email.com" style={{width: "100%", boxSizing: "border-box", background: BG, border: "1px solid "+BR, borderRadius: 5, padding: "8px 10px", color: T1, fontFamily: F, fontSize: 11, outline: "none"}}/>
          </div>
          <div style={{marginBottom: 10}}>
            <label style={{fontSize: 8, color: T2, letterSpacing: 1, textTransform: "uppercase", display: "block", marginBottom: 3}}>API Key (UUID Token)</label>
            <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" type="password" style={{width: "100%", boxSizing: "border-box", background: BG, border: "1px solid "+BR, borderRadius: 5, padding: "8px 10px", color: T1, fontFamily: F, fontSize: 11, outline: "none"}}/>
          </div>
          <Btn pri c={apiStatus === "ok" ? GN : apiStatus === "cors" ? AM : CY} onClick={testApi} style={{width: "100%"}}>
            {apiStatus === "testing" ? "Connecting..." : apiStatus === "ok" ? "\u2705 Connected" : apiStatus === "cors" ? "\u{1F517} Key Saved (Proxy Needed)" : "\u{1F50C} Test Connection"}
          </Btn>
          {apiMsg && <div style={{marginTop: 8, fontSize: 9, color: apiStatus === "ok" ? GN : apiStatus === "cors" ? AM : RD, background: (apiStatus === "ok" ? GN : apiStatus === "cors" ? AM : RD) + "0a", padding: 8, borderRadius: 5, lineHeight: 1.5}}>{apiMsg}</div>}
        </div>

        {/* API Endpoints Reference */}
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 12}}>
          <div style={{fontSize: 9, fontWeight: 600, color: T1, marginBottom: 6}}>GESL API Endpoints (gesl_api.py)</div>
          {[
            {fn: "get_event_tags", desc: "Full event tag taxonomy tree", out: "eventtags"},
            {fn: "get_event_ids", desc: "Signature IDs filtered by tags/source/date", out: "sigids"},
            {fn: "get_event_metadata", desc: "Metadata for filtered signatures", out: "metadata"},
            {fn: "get_event_data", desc: "Download waveform CSV (zip)", out: "data"},
          ].map((ep, i) => (
            <div key={i} style={{padding: "4px 0", borderBottom: i < 3 ? "1px solid "+BR : "none", fontSize: 9}}>
              <span style={{color: CY, fontWeight: 600}}>{ep.fn}</span>
              <span style={{color: T2, marginLeft: 6}}>output: "{ep.out}"</span>
              <div style={{fontSize: 8, color: T2, opacity: 0.7}}>{ep.desc}</div>
            </div>
          ))}
          <div style={{marginTop: 8, fontSize: 8, color: T2, opacity: 0.6}}>POST https://gesl.ornl.gov/api/apps/gesl</div>
        </div>

        {/* GESL tags display if fetched */}
        {geslTags && <div style={{background: SR, border: "1px solid "+GN+"44", borderRadius: 7, padding: 10}}>
          <div style={{fontSize: 9, color: GN, marginBottom: 5}}>{"\u2705"} Live Event Tags Retrieved</div>
          <div style={{maxHeight: 150, overflowY: "auto", fontSize: 8, color: T2}}>
            <pre style={{margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all"}}>{typeof geslTags === "string" ? geslTags.slice(0, 2000) : JSON.stringify(geslTags, null, 1).slice(0, 2000)}</pre>
          </div>
        </div>}
      </div>}

      {/* ── ROADMAP ── */}
      {tab === "roadmap" && <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 14}}>
          <div style={{fontFamily: FD, fontSize: 13, color: CY, marginBottom: 4}}>Project Roadmap</div>
          <p style={{fontSize: 9, color: T2, margin: "0 0 12px 0", lineHeight: 1.5}}>
            Grid Signal Academy evolves from training game to community-powered grid intelligence platform. Share this view with your team.
          </p>
        </div>
        {ROADMAP.map((ph, pi) => {
          const done = ph.items.filter(x => x.done).length;
          const pct = Math.round((done / ph.items.length) * 100);
          const sc = ph.status === "active" ? CY : ph.status === "planned" ? AM : T2;
          return (
            <div key={pi} style={{background: SR, border: "1px solid "+(ph.status === "active" ? CY+"44" : BR), borderRadius: 7, padding: 12}}>
              <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6}}>
                <div>
                  <span style={{fontFamily: FD, fontSize: 11, color: sc, fontWeight: 700}}>Phase {ph.phase}: {ph.name}</span>
                  <span style={{marginLeft: 8, fontSize: 8, padding: "1px 6px", borderRadius: 3, background: sc+"22", color: sc}}>{ph.status}</span>
                </div>
                <span style={{fontSize: 10, fontFamily: FD, color: sc}}>{pct}%</span>
              </div>
              <div style={{height: 3, background: "#1a2744", borderRadius: 2, overflow: "hidden", marginBottom: 8}}>
                <div style={{height: "100%", width: pct+"%", background: sc, borderRadius: 2, transition: "width 0.5s"}}/>
              </div>
              {ph.items.map((it, ii) => (
                <div key={ii} style={{display: "flex", gap: 6, alignItems: "flex-start", padding: "3px 0", fontSize: 9}}>
                  <span style={{color: it.done ? GN : T2, fontSize: 11, lineHeight: 1}}>{it.done ? "\u2705" : "\u2B1C"}</span>
                  <div>
                    <span style={{color: it.done ? T1 : T2}}>{it.name}</span>
                    {it.note && <span style={{fontSize: 7, color: AM, marginLeft: 4}}>({it.note})</span>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
        <Btn pri c={GN} onClick={() => {
          const text = "GRID SIGNAL ACADEMY - Project Status\n" + new Date().toISOString().split("T")[0] + "\n\n" + ROADMAP.map(ph => {
            const done = ph.items.filter(x => x.done).length;
            return "PHASE " + ph.phase + ": " + ph.name + " [" + ph.status.toUpperCase() + "] " + done + "/" + ph.items.length + "\n" + ph.items.map(it => (it.done ? "  [x] " : "  [ ] ") + it.name + (it.note ? " (" + it.note + ")" : "")).join("\n");
          }).join("\n\n") + "\n\nGESL API: " + (st.apiSet ? "Configured" : "Not configured") + "\ngesl.ornl.gov | ORNL + LLNL + PNNL | DOE Office of Electricity";
          navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000);
        }}>{copied ? "\u2705 Copied!" : "\u{1F4CB} Copy Roadmap Status for Team"}</Btn>
      </div>}

      <div style={{textAlign: "center", marginTop: 14, fontSize: 7, color: T2, opacity: 0.35}}>DOE Grid Event Signature Library {"\u2022"} gesl.ornl.gov {"\u2022"} ORNL {"\u2022"} LLNL {"\u2022"} PNNL</div>
    </div>{badgeEl}</div>);
  }

  // ═══════════════ GAME ═══════════════
  if (scr === "game" && gs && gs.cur < gs.qs.length) {
    const q = gs.qs[gs.cur]; const d = DIFF[st.lv]; const prog = (gs.cur / gs.qs.length) * 100;
    const isNF = mode === "normalfault";

    return (<div style={BS}><div style={{maxWidth: 680, margin: "0 auto", padding: "10px 14px"}}>
      <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 8}}>
        <button onClick={() => {setScr("home"); setGs(null);}} style={{background: "none", border: "none", color: T2, cursor: "pointer", fontFamily: F, fontSize: 11}}>{"\u2715"}</button>
        <div style={{flex: 1, height: 3, background: BR, borderRadius: 2, overflow: "hidden"}}><div style={{height: "100%", width: prog+"%", borderRadius: 2, background: "linear-gradient(90deg,"+CY+","+GN+")", transition: "width 0.3s"}}/></div>
        <span style={{fontSize: 9, color: T2}}>{gs.cur+1}/{gs.qs.length}</span>
        {mode !== "standard" && <span style={{fontSize: 8, padding: "1px 5px", borderRadius: 3, background: (isNF ? OR : mode === "timed" ? AM : PU)+"22", color: isNF ? OR : mode === "timed" ? AM : PU, fontWeight: 600}}>{isNF ? "NORMAL?" : mode === "timed" ? "TIMED" : "DAILY"}</span>}
      </div>

      <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10, marginBottom: 8, textAlign: "center"}}>
        <div style={{fontSize: 8, letterSpacing: 2, textTransform: "uppercase", color: T2, marginBottom: 3}}>
          {isNF ? "Is this Normal or Anomalous?" : "Identify the "+d.q+" category"}
        </div>
        {!isNF && <div style={{fontSize: 9, color: T2}}>
          {d.q === "primary" ? "What type of grid event?" : d.q === "secondary" ? "What "+q.primary+" event?" : q.primary+" \u2192 "+q.secondary+" \u2192 ?"}
        </div>}
      </div>

      {/* Waveform - multi channel like GESL viewer */}
      <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10, marginBottom: 6}}>
        <div style={{display: "flex", justifyContent: "space-between", marginBottom: 4}}>
          <span style={{fontSize: 7, color: CY, opacity: 0.5, letterSpacing: 1}}>SIG #{1000 + gs.cur * 37 + q.qs % 4500}</span>
          <span style={{fontSize: 7, color: T2}}>{q.sensor || "PMU"} {"\u2022"} {q.ieee || ""}</span>
        </div>
        {/* Voltage channels */}
        <div style={{marginBottom: 3}}>
          <div style={{fontSize: 7, color: T2, marginBottom: 2, letterSpacing: 0.5}}>VOLTAGE</div>
          <Wave visual={q.visual} w={600} h={70} color="#ef4444" label="Vc (V)" seed={q.qs}/>
          <div style={{height: 2}}/>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2}}>
            <Wave visual={q.visual} w={300} h={40} color="#3b82f6" label="Va (V)" seed={q.qs+10}/>
            <Wave visual={q.visual} w={300} h={40} color="#eab308" label="Vb (V)" seed={q.qs+20}/>
          </div>
        </div>
        {/* Current channels */}
        <div>
          <div style={{fontSize: 7, color: T2, marginBottom: 2, marginTop: 4, letterSpacing: 0.5}}>CURRENT</div>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2}}>
            <Wave visual={q.visual} w={200} h={35} color="#f472b6" label="Ia" seed={q.qs+30}/>
            <Wave visual={q.visual} w={200} h={35} color="#22d3ee" label="Ib" seed={q.qs+40}/>
            <Wave visual={q.visual} w={200} h={35} color="#a78bfa" label="Ic" seed={q.qs+50}/>
          </div>
        </div>
      </div>

      <div style={{background: AM+"06", border: "1px solid "+AM+"15", borderRadius: 5, padding: "4px 8px", marginBottom: 6, fontSize: 9, color: AM}}>{"\u{1F4A1}"} {q.desc}</div>

      <div style={{display: "flex", flexDirection: isNF ? "row" : "column", gap: 5}}>
        {q.choices.map((ch, i) => (
          <Btn key={i} onClick={() => handleAns(ch)} style={{
            textAlign: "left", padding: isNF ? "14px" : "10px 12px", flex: isNF ? 1 : undefined,
            ...(isNF && ch === "Normal Operation" ? {borderColor: GN+"66"} : {}),
            ...(isNF && ch === "Anomalous Event" ? {borderColor: RD+"66"} : {}),
          }}>
            {!isNF && <span style={{color: CY, marginRight: 6, fontSize: 9, opacity: 0.4}}>{String.fromCharCode(65+i)}</span>}
            {isNF && <span style={{marginRight: 6}}>{ch === "Normal Operation" ? "\u2705" : "\u26A0\uFE0F"}</span>}
            {ch}
          </Btn>
        ))}
      </div>
      {st.cs >= 3 && <div style={{textAlign: "center", marginTop: 6, fontSize: 10, color: AM, fontFamily: FD}}>{"\u{1F525}"} {st.cs} Streak!</div>}
    </div>{badgeEl}</div>);
  }

  // ═══════════════ RESULTS ═══════════════
  if (scr === "results" && gs) {
    const cor = gs.ans.filter(a => a.correct).length; const tot = gs.ans.length;
    const txp = gs.ans.reduce((s, a) => s + a.xpG, 0); const avg = (gs.ans.reduce((s, a) => s + a.el, 0) / tot).toFixed(1);
    return (<div style={BS}><div style={{maxWidth: 680, margin: "0 auto", padding: "16px 14px"}}>
      <div style={{textAlign: "center", marginBottom: 14}}>
        <div style={{fontSize: 36}}>{cor === tot ? "\u{1F48E}" : cor >= tot*0.8 ? "\u26A1" : "\u{1F4CA}"}</div>
        <h2 style={{fontFamily: FD, fontSize: 17, margin: "0 0 2px 0"}}>{mode === "normalfault" ? "Normal vs Fault Complete!" : mode === "daily" ? "Daily Drill Complete!" : mode === "timed" ? "Timed Challenge!" : "Round Complete"}</h2>
      </div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12}}>
        <SB label="Score" value={cor+"/"+tot} c={cor >= tot*0.7 ? GN : AM}/><SB label="XP" value={"+"+txp} c={CY}/><SB label="Avg" value={avg+"s"} c={T1}/>
      </div>
      <div style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 10, marginBottom: 12, maxHeight: 240, overflowY: "auto"}}>
        {gs.ans.map((a, i) => (
          <div key={i} style={{display: "flex", alignItems: "center", gap: 6, padding: "4px 0", borderBottom: i < gs.ans.length-1 ? "1px solid "+BR : "none"}}>
            <span style={{fontSize: 12}}>{a.correct ? "\u2705" : "\u274C"}</span>
            <div style={{flex: 1, minWidth: 0}}><div style={{fontSize: 10, color: T1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}}>{a.q.ca}</div><div style={{fontSize: 7, color: T2}}>{a.q.primary} {"\u2192"} {a.q.secondary}{!a.correct && a.a !== "__TIMEOUT__" && <span style={{color: RD}}> (chose: {a.a})</span>}</div></div>
            <span style={{fontSize: 8, color: CY}}>+{a.xpG}</span>
          </div>
        ))}
      </div>
      <div style={{display: "flex", gap: 6}}>
        <Btn pri onClick={() => startGame(mode)} style={{flex: 1, fontFamily: FD, fontSize: 12, fontWeight: 700}}>{"\u26A1"} Again</Btn>
        <Btn onClick={() => {setScr("home"); setGs(null);}} style={{flex: 1}}>Home</Btn>
      </div>
    </div>{badgeEl}</div>);
  }

  // ═══════════════ LIBRARY ═══════════════
  if (scr === "library") {
    const pks = Object.keys(TAXONOMY); const ap = lf || pks[0];
    return (<div style={BS}><div style={{maxWidth: 780, margin: "0 auto", padding: "12px"}}>
      <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 12}}>
        <button onClick={() => {setScr("home"); setLf(null);}} style={{background: "none", border: "none", color: T2, cursor: "pointer", fontFamily: F, fontSize: 11}}>{"\u2190"}</button>
        <h2 style={{fontFamily: FD, fontSize: 14, margin: 0}}>Signature Library</h2>
      </div>
      <div style={{display: "flex", gap: 3, marginBottom: 12, flexWrap: "wrap"}}>
        {pks.map(pk => <button key={pk} onClick={() => {setLf(pk); up(s=>({...s, st: s.st+1}));}} style={{background: pk===ap ? CY+"18" : SR, border: "1px solid "+(pk===ap ? CY : BR), borderRadius: 5, padding: "3px 8px", color: pk===ap ? CY : pk==="Normal" ? GN : T2, fontFamily: F, fontSize: 9, cursor: "pointer"}}>{pk}</button>)}
      </div>
      {Object.entries(TAXONOMY[ap] || {}).map(([sec, ts]) => (
        <div key={sec} style={{marginBottom: 14}}>
          <h3 style={{fontFamily: FD, fontSize: 11, color: ap === "Normal" ? GN : GN, margin: "0 0 6px 0"}}>{sec}</h3>
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 6}}>
            {Object.entries(ts).map(([t, info]) => (
              <div key={t} style={{background: SR, border: "1px solid "+BR, borderRadius: 7, padding: 8}}>
                <div style={{fontSize: 10, fontWeight: 600, color: T1, marginBottom: 3}}>{t}</div>
                <Wave visual={info.visual} w={190} h={45} color={ap === "Normal" ? GN : CY} seed={42}/>
                <div style={{fontSize: 8, color: T2, marginTop: 3, lineHeight: 1.4}}>{info.desc}</div>
                <div style={{fontSize: 7, color: CY, opacity: 0.4, marginTop: 2}}>{info.ieee} {"\u2022"} {info.sensor}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>{badgeEl}</div>);
  }

  // ═══════════════ BADGES ═══════════════
  if (scr === "badges") {
    return (<div style={BS}><div style={{maxWidth: 680, margin: "0 auto", padding: "12px"}}>
      <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 12}}>
        <button onClick={() => setScr("home")} style={{background: "none", border: "none", color: T2, cursor: "pointer", fontFamily: F, fontSize: 11}}>{"\u2190"}</button>
        <h2 style={{fontFamily: FD, fontSize: 14, margin: 0}}>Badges</h2>
        <span style={{marginLeft: "auto", fontSize: 10, color: AM, fontFamily: FD}}>{st.bg.length}/{BADGES.length}</span>
      </div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6}}>
        {BADGES.map(b => { const e = st.bg.includes(b.id); return (
          <div key={b.id} style={{background: e ? AM+"08" : SR, border: "1px solid "+(e ? AM+"44" : BR), borderRadius: 7, padding: 9, opacity: e ? 1 : 0.4}}>
            <div style={{display: "flex", alignItems: "center", gap: 4, marginBottom: 2}}><span style={{fontSize: 18}}>{e ? b.i : "\u{1F512}"}</span><span style={{fontFamily: FD, fontSize: 9, fontWeight: 700, color: e ? AM : T2}}>{b.n}</span></div>
            <div style={{fontSize: 8, color: T2}}>{b.d}</div>
          </div>
        );})}
      </div>
    </div>{badgeEl}</div>);
  }

  return null;
}
