import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Check, Code2, Flag, Menu, ShieldCheck, Sparkles, Trophy, Users, X, Zap } from "lucide-react";
import { backendConfigured, checkOrganizer, signInOrganizer, signOutOrganizer, supabase } from "./lib/supabase";
import type { EventStatus } from "./lib/supabase";
import { Decor, OrganizerGate } from "./components/shared";
import Organizer from "./views/Organizer";
import Participant from "./views/Participant";

type Role = "home" | "organizer" | "participant";
type Toast = { id: number; msg: string; kind: "ok" | "err" } | null;

/** Links: `#organizer` (private login), `#join` and `#join/123456` (participant, PIN pre-filled). */
function readHash(): { role: Role; pin: string } | null {
  const h = location.hash;
  if (h === "#organizer") return { role: "organizer", pin: "" };
  if (h.startsWith("#join")) return { role: "participant", pin: (h.split("/")[1] || "").replace(/\D/g, "").slice(0, 8) };
  return null;
}

export default function App() {
  const initial = readHash();
  const [role, setRole] = useState<Role>(initial?.role ?? "home");
  const [joinPin, setJoinPin] = useState(initial?.pin ?? "");
  const [orgAuth, setOrgAuth] = useState<"checking" | "out" | "in">("checking");
  const [orgErr, setOrgErr] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [top, setTop] = useState<{ status: EventStatus | null; pin?: string }>({ status: null });
  const [net, setNet] = useState(true);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now(); setToast({ id, msg, kind });
    setTimeout(() => setToast(t => (t && t.id === id ? null : t)), kind === "err" ? 5000 : 3200);
  }, []);
  const onTop = useCallback((status: EventStatus | null, pin?: string) => setTop(t => (t.status === status && t.pin === pin ? t : { status, pin })), []);
  const onNet = useCallback((ok: boolean) => setNet(ok), []);

  const go = (r: Role, hash: string) => {
    setRole(r); setTop({ status: null }); setMobileNav(false);
    if (hash) history.replaceState(null, "", location.pathname + location.search + hash);
    else history.replaceState(null, "", location.pathname + location.search);
  };

  useEffect(() => {
    const onHash = () => { const r = readHash(); if (r) { setRole(r.role); setJoinPin(r.pin); } };
    window.addEventListener("hashchange", onHash);
    let alive = true;
    const verify = async () => { try { const ok = await checkOrganizer(); if (alive) setOrgAuth(ok ? "in" : "out"); } catch { if (alive) setOrgAuth("out"); } };
    void verify();
    const sub = supabase?.auth.onAuthStateChange(() => { setTimeout(() => { void verify(); }, 0); });
    return () => { alive = false; window.removeEventListener("hashchange", onHash); sub?.data.subscription.unsubscribe(); };
  }, []);

  const loginOrganizer = async (email: string, pw: string) => {
    setOrgErr("");
    try {
      await signInOrganizer(email, pw);
      if (await checkOrganizer()) setOrgAuth("in");
      else { await signOutOrganizer(); setOrgAuth("out"); setOrgErr("This account is not an authorised organizer."); }
    } catch (e) { setOrgErr(e instanceof Error ? e.message : "Sign-in failed"); }
  };
  const logoutOrganizer = useCallback(async () => {
    try { await signOutOrganizer(); } catch { /* ignore */ }
    setOrgAuth("out"); go("home", "");
  }, []);

  const label = top.status === "live" ? "EVENT LIVE" : top.status === "paused" ? "EVENT PAUSED" : top.status === "ended" ? "EVENT ENDED" : top.status === "draft" ? "EVENT SETUP" : role === "home" ? "READY" : "CONNECTING";
  const conn = !backendConfigured ? "Backend not configured" : net ? "Backend connected" : "Reconnecting…";

  return <div className="app-shell"><Decor home={role === "home"} />
    <header className="topbar">
      <button className="brand" onClick={() => go("home", "")}><span className="brand-mark"><Code2 size={20} /></span><span>ERROR<span className="brand-dash">-</span>404<small>THE DEBUGGER</small></span></button>
      <div className="top-center"><span className={`live-dot ${top.status === "live" ? "on" : ""}`}></span>{label} {role === "organizer" && orgAuth === "in" && top.pin && <span className="pin-chip">PIN&nbsp; {top.pin}</span>}</div>
      <div className="top-actions"><span className={`connection ${net && backendConfigured ? "" : "bad"}`}><span className={net && backendConfigured ? "green-dot" : "red-dot"}></span>{conn}</span>{role === "organizer" && orgAuth === "in" && <button className="icon-btn mobile-only" onClick={() => setMobileNav(!mobileNav)}><Menu /></button>}<button className="avatar" title="Profile">{role === "organizer" ? "ORG" : "404"}</button></div>
    </header>
    {role === "home" ? <main className="landing">
   <div className="hero-grid"><section className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> LIVE DEBUGGING COMPETITION PLATFORM</div><h1 className="glitch-title"><span className="glitch" data-text="ERROR">ERROR</span><span className="glitch big" data-text="404">404</span><span className="nf">not found</span></h1><p className="hero-sub">A fast-paced debugging arena for sharp minds. Teams and solo coders go head-to-head across 10 challenges in Python and JavaScript.</p><div className="hero-buttons"><button className="primary-btn" onClick={()=>go("participant","#join")}>Join the event <ArrowRight size={17}/></button></div><div className="hero-meta"><span><Users size={15}/> Teams + individuals</span><span><Zap size={15}/> 10 live challenges</span><span><ShieldCheck size={15}/> Fair scoring</span></div></section>
    <div className="hero-visual"><div className="visual-glow"></div><div className="code-window"><div className="window-head"><div className="window-dots"><i/><i/><i/></div><span>challenge_04.py</span><span className="window-live">● LIVE</span></div><div className="code-lines"><div><em>01</em><span className="kw">def</span> <b>find_the_bug</b>(items):</div><div><em>02</em>&nbsp;&nbsp; total = <strong>0</strong></div><div><em>03</em>&nbsp;&nbsp; <span className="kw">for</span> item <span className="kw">in</span> items:</div><div className="bug-line"><em>04</em>&nbsp;&nbsp;&nbsp;&nbsp; <span className="kw">if</span> item = <strong>404</strong>:</div><div><em>05</em>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; total += 1</div><div><em>06</em>&nbsp;&nbsp; <span className="kw">return</span> total</div></div><div className="bug-toast"><span className="bug-icon">!</span><span><b>SyntaxError detected</b><small>Line 04 · Unexpected assignment</small></span><span className="toast-fix">FIX IT</span></div><div className="window-foot"><span><span className="green-dot"></span> Python 3.12</span><span>Ln 4, Col 12</span></div></div><div className="float-card score-float"><Trophy size={17}/><span><b>+200 XP</b><small>Challenge cleared</small></span></div><div className="float-card rank-float"><Flag size={18}/><span><b>TOP OF THE BOARD</b><small>Your flag is waiting</small></span></div></div>
   </div><div className="landing-stats"><div><b>11</b><span>QUESTIONS TOTAL</span></div><div><b>02</b><span>LANGUAGES</span></div><div><b>∞</b><span>WAYS TO DEBUG</span></div><div><b>01</b><span>ULTIMATE WINNER</span></div></div><section className="how-section"><div className="section-kicker">HOW IT WORKS</div><h2>One event. Three stages.</h2><div className="steps"><div><span>01</span><h3>Get in the game</h3><p>Join solo or compete as a team using your event PIN.</p></div><div><span>02</span><h3>Hunt the bugs</h3><p>Fix real code issues in JavaScript and Python. Beat the clock.</p></div><div><span>03</span><h3>Take the lead</h3><p>Watch the leaderboard shift after every challenge. Earn the flag.</p></div></div></section>
   <footer className="footer"><span>© 2026 ERROR-404</span><span>BUILT FOR THE DEBUGGING COMMUNITY</span><span>THE BUG STOPS HERE.</span></footer>
  </main>
    : role === "organizer" && orgAuth !== "in" ? <OrganizerGate status={orgAuth} error={orgErr} configured={backendConfigured} onLogin={loginOrganizer} onBack={() => go("home", "")} />
    : role === "organizer" ? <Organizer notify={notify} onTop={onTop} onNet={onNet} mobileNav={mobileNav} closeNav={() => setMobileNav(false)} onLogout={() => { void logoutOrganizer(); }} />
    : <Participant initialPin={joinPin} notify={notify} onTop={onTop} onNet={onNet} onLeave={() => go("home", "")} />}
    {toast && <div className={`toast ${toast.kind === "err" ? "err" : ""}`}>{toast.kind === "err" ? <X size={16} /> : <Check size={16} />}{toast.msg}</div>}
  </div>;
}
