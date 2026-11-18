import { useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight, Flag, ShieldCheck } from "lucide-react";
import type { Competitor } from "../lib/supabase";
import { kindLabel } from "../lib/util";

export function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string | number; note: string }) {
  return <div className="metric-card"><span className="metric-icon">{icon}</span><span className="metric-label">{label}</span><b>{value}</b><small>{note}</small></div>;
}

export function Board({ rows, compact = false, highlightId }: { rows: Competitor[]; compact?: boolean; highlightId?: string }) {
  if (!rows.length) return <p className="muted empty-note">No competitors yet.</p>;
  return <div className={`board ${compact ? "compact" : ""}`}>{rows.map((p, i) =>
    <div className={`board-row ${i === 0 ? "first" : ""} ${p.id === highlightId ? "me" : ""}`} key={p.id}>
      <span className="rank">{i === 0 ? <Flag size={17} className="flag" /> : String(i + 1).padStart(2, "0")}</span>
      <span className="board-avatar">{p.display_name.slice(0, 1).toUpperCase()}</span>
      <span className="board-person"><b>{p.display_name}{i === 0 && p.score > 0 && <span className="leader-tag">LEADER</span>}{p.id === highlightId && <span className="leader-tag you-tag">YOU</span>}</b><small>{kindLabel(p.kind)} · {p.solved_count} solved</small></span>
      <b className="board-score">{p.score.toLocaleString()} <small>PTS</small></b>
    </div>)}</div>;
}

export function Decor({ home }: { home: boolean }) {
  return <div className="decor" aria-hidden="true">
    <i className="checker c-tl" /><i className="checker c-br" />
    {["b1", "b2", "b3", "b4", "b5"].map(c => <span key={c} className={`d brain ${c}`}>🧠</span>)}
    {["q1", "q2", "q3"].map(c => <span key={c} className={`d q ${c}`}>?</span>)}
    <span className="d hg">⏳</span><span className="d warn">⚠</span>
    {home && <div className="loadbar"><div><i /></div><small>LOADING...?</small></div>}
  </div>;
}

export function OrganizerGate({ status, error, configured, onLogin, onBack }: {
  status: "checking" | "out" | "in"; error: string; configured: boolean;
  onLogin: (e: string, p: string) => Promise<void>; onBack: () => void;
}) {
  const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { if (busy || !email || !pw) return; setBusy(true); await onLogin(email, pw); setBusy(false); };
  return <main className="participant-shell"><div className="join-card gate-card">
    <div className="join-icon"><ShieldCheck /></div><div className="section-kicker">RESTRICTED AREA</div>
    <h1>Organizer <span>login</span></h1>
    <p>This control room is private. Only authorised organizer accounts can open it.</p>
    {!configured ? <p className="gate-err">Organizer sign-in needs the backend. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.</p>
      : status === "checking" ? <p>Verifying session…</p>
      : <>
        <label className="field-label">EMAIL</label>
        <input className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} />
        <label className="field-label">PASSWORD</label>
        <input className="text-input" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void go(); }} />
        {error && <p className="gate-err">{error}</p>}
        <button className="primary-btn join-btn" disabled={busy || !email || !pw} onClick={() => void go()}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={16} /></button>
      </>}
    <button className="back-link" onClick={onBack}>← Back to home</button>
  </div></main>;
}
