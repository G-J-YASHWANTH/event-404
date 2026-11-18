import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronLeft, CircleHelp, Clock3, Code2, ExternalLink, Globe2, Lock, Maximize2, Pause, Sparkles, Trophy, X, Zap } from "lucide-react";
import { questions } from "../data/questions";
import { backendConfigured, errMsg, isSessionInvalid, joinEvent, participantView, submitAnswer } from "../lib/supabase";
import type { CompetitorKind, EventStatus, ParticipantSnapshot, Session404 } from "../lib/supabase";
import { digitsOnly, fmtClock, secondsLeft, starterCode } from "../lib/util";
import { Board } from "../components/shared";

type Props = {
  initialPin: string;
  notify: (msg: string, kind?: "ok" | "err") => void;
  onTop: (status: EventStatus | null, pin?: string) => void;
  onNet: (ok: boolean) => void;
  onLeave: () => void;
};

const LS_SESSION = "e404_session"; // lets a refresh resume; the real state always lives on the server
const docs = [
  { label: "JavaScript Guide", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" },
  { label: "Python Tutorial", url: "https://docs.python.org/3/tutorial/" },
  { label: "JS Reference", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference" },
  { label: "Python Library", url: "https://docs.python.org/3/library/" },
];

function loadSession(): Session404 | null {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session404;
    return s?.eventId && s?.competitorId && s?.token ? s : null;
  } catch { return null; }
}

export default function Participant({ initialPin, notify, onTop, onNet, onLeave }: Props) {
  const [session, setSession] = useState<Session404 | null>(loadSession);
  const [snap, setSnap] = useState<ParticipantSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());

  // join form
  const [pin, setPin] = useState(initialPin);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CompetitorKind>("individual");
  const [members, setMembers] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState("");

  // question workspace
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // reference browser
  const [browserUrl, setBrowserUrl] = useState(docs[0].url);
  const [browserAddress, setBrowserAddress] = useState(docs[0].url);
  const [browserOpen, setBrowserOpen] = useState(true);

  useEffect(() => { if (initialPin) setPin(initialPin); }, [initialPin]);

  const endSession = useCallback((message?: string) => {
    try { localStorage.removeItem(LS_SESSION); } catch { /* ignore */ }
    setSession(null); setSnap(null); onTop(null);
    if (message) notify(message, "err");
  }, [notify, onTop]);

  /* ------------------------------------------- follow the organizer (polling) */
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const pull = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const v = await participantView(s);
      if (sessionRef.current !== s) return;
      setSnap(v); setOffset(Date.parse(v.server_now) - Date.now()); onNet(true);
    } catch (e) {
      if (isSessionInvalid(e)) endSession("Your session ended. Please join again with the event PIN.");
      else onNet(false);
    }
  }, [endSession, onNet]);
  useEffect(() => {
    if (!session) return;
    void pull();
    const t = setInterval(() => { if (!document.hidden) void pull(); }, 2000);
    const vis = () => { if (!document.hidden) void pull(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("online", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); window.removeEventListener("online", vis); };
  }, [session, pull]);
  // Best-effort in-page guard. Browser and operating-system controls cannot be
  // fully disabled by a normal website; managed kiosk mode is needed for that.
  useEffect(() => {
    if (!session || snap?.event.status === "ended") return;
    const warnBeforeExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const blockNewContext = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a[target='_blank'], a[target='_new']")) {
        event.preventDefault();
        event.stopPropagation();
        notify("Opening new tabs is disabled during the event. Use the integrated browser.", "err");
      }
    };
    const blockAuxClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a")) { event.preventDefault(); event.stopPropagation(); }
    };
    const blockContextMenu = (event: MouseEvent) => event.preventDefault();
    const blockTabShortcuts = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && ["t", "n", "w", "l"].includes(key)) {
        event.preventDefault(); event.stopPropagation();
        notify("Use the event workspace and integrated browser during the competition.", "err");
      }
    };
    const onVisibility = () => {
      if (document.hidden) notify("The event page is still active. Return to the event to continue.", "err");
    };
    window.addEventListener("beforeunload", warnBeforeExit);
    document.addEventListener("click", blockNewContext, true);
    document.addEventListener("auxclick", blockAuxClick, true);
    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("keydown", blockTabShortcuts, true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeExit);
      document.removeEventListener("click", blockNewContext, true);
      document.removeEventListener("auxclick", blockAuxClick, true);
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("keydown", blockTabShortcuts, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session, snap?.event.status, notify]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => { onTop(snap?.event.status ?? null); }, [snap?.event.status, onTop]);

  // New question from the organizer -> fresh editor (or restore what this competitor already submitted).
  const qNum = snap?.event.current_question;
  useEffect(() => {
    if (qNum === undefined) return;
    setCode(snap?.my_answer?.source_code || starterCode(qNum));
    setNote(snap?.my_answer?.note ?? "");
    setShowHint(false);
  }, [qNum]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------------ actions */
  const join = async () => {
    setJoinErr("");
    if (!backendConfigured) { setJoinErr("This site isn’t connected to its backend yet. Tell the organizer."); return; }
    if (!name.trim() || !pin.trim()) { setJoinErr("Enter your name and the event PIN."); return; }
    setJoining(true);
    try {
      const members_ = kind === "team" ? members.split(",").map(x => x.trim()).filter(Boolean) : [];
      const s = await joinEvent(pin.trim(), name.trim(), kind, members_);
      try { localStorage.setItem(LS_SESSION, JSON.stringify(s)); } catch { /* ignore */ }
      setSession(s); onNet(true);
    } catch (e) { setJoinErr(errMsg(e)); }
    finally { setJoining(false); }
  };
  const submit = async () => {
    if (!session || qNum === undefined) return;
    if (code.trim() === starterCode(qNum).trim() && !note.trim()) { notify("Edit the code or add a note before submitting.", "err"); return; }
    setSubmitting(true);
    try {
      await submitAnswer(session, qNum, code, note);
      notify("Submitted ✓ You can resubmit until time runs out.");
      await pull();
    } catch (e) {
      if (isSessionInvalid(e)) endSession("Your session ended. Please join again with the event PIN.");
      else { notify(errMsg(e), "err"); void pull(); }
    } finally { setSubmitting(false); }
  };
  const leave = () => { if (window.confirm("Leave the event? You can re-join later with the PIN and the same name only if the organizer releases it.")) { endSession(); onLeave(); } };
  const openDoc = (url: string) => { setBrowserUrl(url); setBrowserAddress(url); setBrowserOpen(true); };
  const navigateBrowser = () => {
    try {
      const parsed = new URL(browserAddress);
      if (parsed.protocol !== "https:" || !["developer.mozilla.org", "docs.python.org"].includes(parsed.hostname)) {
        notify("Only the approved JavaScript and Python documentation sites are available here.", "err");
        return;
      }
      setBrowserUrl(parsed.toString());
      setBrowserAddress(parsed.toString());
    } catch { notify("Enter a valid documentation URL.", "err"); }
  };
  const enterFullscreen = async () => {
    try { await document.documentElement.requestFullscreen?.(); }
    catch { notify("Fullscreen is not available in this browser. Continue in the event window.", "err"); }
  };

  /* ============================================================= JOIN SCREEN */
  if (!session) return <main className="participant-shell"><div className="join-card">
    <div className="join-icon"><Code2 size={26} /></div><div className="section-kicker">PARTICIPANT ACCESS</div>
    <h1>Ready to hunt<br /><span>some bugs?</span></h1>
    <p>Enter the event PIN from your organizer and your details to enter the arena.</p>
    <label className="field-label">EVENT PIN</label>
    <input className="text-input pin-input" inputMode="numeric" value={pin} onChange={e => setPin(digitsOnly(e.target.value))} placeholder="Enter event PIN" />
    <label className="field-label">YOUR NAME / TEAM NAME</label>
    <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Byte Busters" onKeyDown={e => { if (e.key === "Enter") void join(); }} />
    <label className="field-label">COMPETE AS</label>
    <div className="segmented"><button className={kind === "individual" ? "selected" : ""} onClick={() => setKind("individual")}>Individual</button><button className={kind === "team" ? "selected" : ""} onClick={() => setKind("team")}>Team</button></div>
    {kind === "team" && <><label className="field-label">TEAM MEMBERS (OPTIONAL, COMMA SEPARATED)</label><textarea className="answer-box" value={members} onChange={e => setMembers(e.target.value)} placeholder="Alex, Sam, Jordan" /></>}
    <p className="muted hint-line">If the organizer already enrolled you, type that exact name to claim your spot.</p>
    {joinErr && <p className="gate-err">{joinErr}</p>}
    <button className="primary-btn join-btn" disabled={joining} onClick={() => void join()}>{joining ? "Joining…" : "Enter the arena"} <ArrowRight size={17} /></button>
    <button className="back-link" onClick={onLeave}><ChevronLeft size={15} /> Back to home</button>
  </div></main>;

  if (!snap) return <main className="participant-shell"><div className="join-card"><p>Connecting to the arena…</p>
    <button className="back-link" onClick={() => endSession()}>Cancel</button></div></main>;

  /* ============================================================ LIVE ARENA */
  const ev = snap.event;
  const me = snap.me;
  const ended = ev.status === "ended";
  const paused = ev.status === "paused";
  const view: "lobby" | "board" | "question" = ended ? "board" : ev.status === "draft" || ev.screen === "lobby" ? "lobby" : ev.screen === "leaderboard" ? "board" : "question";
  const current = questions[ev.current_question];
  const left = secondsLeft(ev, offset, now);
  const locked = paused || left === 0 || ev.status !== "live";
  const myRank = snap.leaderboard.findIndex(r => r.id === me.id) + 1;
  const submittedAt = snap.my_answer?.submitted_at;

  return <main className="participant-shell">
    <div className="participant-heading">
      <div><div className="breadcrumb">ERROR-404 / {ev.name.toUpperCase()}</div><h1>Welcome, {me.display_name}</h1><p>Stay sharp. Every second counts.</p></div>
      <div className="participant-heading-actions">
        <button className="secondary-btn" onClick={() => void enterFullscreen()}><Maximize2 size={14} /> Fullscreen</button>
        <div className="participant-score"><span>YOUR SCORE</span><b>{me.score} <small>PTS</small></b></div>
      </div>
    </div>

    {paused && <div className="paused-banner"><Pause size={16} /> The organizer paused the event. Your timer is frozen.</div>}

    {view === "lobby" && <div className="panel lobby-card">
      <div className="lobby-pulse"><Sparkles size={28} /></div>
      <h2>You’re in{ev.status === "draft" ? "" : "!"}</h2>
      <p>{ev.status === "draft" ? "Waiting for the organizer to start the event." : "Waiting for the organizer to release the next question."}</p>
      <small>This page updates by itself. No need to refresh.</small>
    </div>}

    {view === "board" && <div className="panel participant-board">
      <div className="winner-banner"><Trophy size={24} /><span><b>{ended ? "Competition complete!" : "Leaderboard reveal"}</b><small>{ended ? "The final standings are in." : "Here’s where everyone stands right now."}</small></span></div>
      <Board rows={snap.leaderboard} highlightId={me.id} />
      {myRank > 0 && <p className="my-rank">You are ranked <b>#{myRank}</b> of {snap.leaderboard.length}</p>}
      {!ended && <p className="muted waiting-note">Waiting for the organizer to continue…</p>}
    </div>}

    {view === "question" && <div className="arena-grid">
      <section className="panel challenge-panel">
        <div className="challenge-top">
          <div className="challenge-tags"><span>{ev.current_question === 0 ? "TRIAL QUESTION" : `QUESTION ${ev.current_question} OF 10`}</span><span>{current.language}</span><span>{current.difficulty}</span></div>
          <div className={`timer ${left < 30 && !paused ? "urgent" : ""}`}><Clock3 size={16} />{fmtClock(left)}</div>
        </div>
        <h2>{current.title}</h2><p>{current.prompt}</p>
        <div className="code-editor">
          <div className="editor-head"><span><span className="green-dot"></span> {current.language === "Python" ? "main.py" : "main.js"}</span><span>{locked ? "LOCKED" : "EDIT YOUR FIX"}</span></div>
          <textarea spellCheck={false} value={code} readOnly={locked} onChange={e => setCode(e.target.value)} aria-label="Code editor" />
        </div>
        <label className="field-label">SUBMISSION NOTE / OUTPUT</label>
        <textarea className="answer-box" value={note} readOnly={locked} onChange={e => setNote(e.target.value)} placeholder="Explain your fix or paste the output (optional)..." />
        <div className="challenge-footer">
          <button className="hint-btn" onClick={() => setShowHint(!showHint)}><CircleHelp size={15} /> {showHint ? "Hide hint" : "Need a hint?"}</button>
          <span>{current.points} POINTS AVAILABLE</span>
          <button className="primary-btn" disabled={locked || submitting} onClick={() => void submit()}>{submitting ? "Submitting…" : submittedAt ? "Resubmit fix" : "Submit fix"} <ArrowRight size={15} /></button>
        </div>
        {submittedAt && <div className="submitted-note"><Check size={14} /> Submitted at {new Date(submittedAt).toLocaleTimeString()}. The organizer will review it.</div>}
        {left === 0 && !paused && ev.status === "live" && <div className="submitted-note timeup">Time’s up for this question. Wait for the organizer.</div>}
        {showHint && <div className="hint-box"><Sparkles size={15} />{current.hint}</div>}
      </section>
      <aside className="arena-side">
        <div className="panel side-panel"><div className="panel-head"><div><h3>Quick resources</h3><p>Look it up. Learn. Fix it.</p></div><BookOpen size={18} /></div>
          {docs.map(d => <button className="resource-link" key={d.label} onClick={() => openDoc(d.url)}><Globe2 size={15} />{d.label}<ExternalLink size={13} /></button>)}
          <button className="secondary-btn full" onClick={() => setBrowserOpen(!browserOpen)}><Globe2 size={15} />{browserOpen ? "Close integrated browser" : "Open integrated browser"}</button></div>
        <div className="panel side-panel"><div className="panel-head"><div><h3>Challenge progress</h3><p>Keep your momentum.</p></div><Zap size={17} /></div>
          <div className="mini-progress"><b>{ev.current_question} <small>/ 10</small></b><div className="progress-track"><i style={{ width: `${ev.current_question * 10}%` }} /></div></div>
          <div className="progress-dots">{questions.slice(1).map((qq, i) => <span key={qq.id} className={i + 1 < ev.current_question ? "done" : i + 1 === ev.current_question ? "current" : ""}>{i + 1}</span>)}</div></div>
        <div className="panel side-panel"><div className="panel-head"><h3>Leaderboard</h3><Lock size={17} /></div>
          <p className="muted">Standings stay hidden until the organizer reveals them.</p></div>
      </aside>
    </div>}

    {browserOpen && <div className="browser-drawer"><div className="browser-bar"><div className="browser-title"><Globe2 size={16} /> INTEGRATED REFERENCE BROWSER</div>
      <div className="browser-address">
        <input aria-label="Documentation address" value={browserAddress} onChange={e => setBrowserAddress(e.target.value)} onKeyDown={e => { if (e.key === "Enter") navigateBrowser(); }} />
        <button className="icon-btn" aria-label="Go to documentation" onClick={navigateBrowser}><ArrowRight size={15} /></button>
      </div>
      <button className="icon-btn" aria-label="Close integrated browser" onClick={() => setBrowserOpen(false)}><X size={16} /></button></div>
      <iframe title="Programming reference browser" src={browserUrl} sandbox="allow-forms allow-scripts" referrerPolicy="no-referrer" />
      <div className="browser-note">Only approved JavaScript and Python documentation domains are allowed. Some sites may refuse embedded display; the event page cannot override those restrictions.</div></div>}

    <div className="participant-bottom"><span>EVENT: {ev.name.toUpperCase()}</span><span>SUBMISSIONS ARE TIME-STAMPED</span><button className="back-link" onClick={leave}>Leave event</button></div>
  </main>;
}
