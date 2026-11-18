import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, Check, ChevronLeft, Clock3, Code2, Copy, Eye, EyeOff, Link2, LogOut, Play,
  Plus, Radio, RefreshCw, Search, ShieldCheck, SkipForward, Trophy, Users, X,
} from "lucide-react";
import { questions } from "../data/questions";
import {
  addCompetitor, createEvent, errMsg, gradeAnswer, listMyEvents, organizerSnapshot, releaseCompetitor,
  removeCompetitor, resetEvent, setCurrentQuestion, setEventState, setScreen, updateEvent,
} from "../lib/supabase";
import type { CompetitorKind, EventInfo, EventStatus, OrganizerSnapshot, Screen } from "../lib/supabase";
import { copyText, csvCell, digitsOnly, fmtClock, genPin, joinLink, kindLabel, secondsLeft, starterCode } from "../lib/util";
import { Board, Metric } from "../components/shared";

type Notify = (msg: string, kind?: "ok" | "err") => void;
type Props = {
  notify: Notify;
  onTop: (status: EventStatus | null, pin?: string) => void;
  onNet: (ok: boolean) => void;
  mobileNav: boolean;
  closeNav: () => void;
  onLogout: () => void;
};

const LS_EVENT = "e404_org_event"; // only remembers WHICH event this browser was last controlling
const NAV: [string, string][] = [["overview", "Overview"], ["participants", "Participants"], ["questions", "Questions"], ["leaderboard", "Leaderboard"], ["settings", "Event settings"]];
const SCREENS: [Screen, string][] = [["lobby", "Waiting room"], ["question", "Question"], ["leaderboard", "Leaderboard"]];

export default function Organizer({ notify, onTop, onNet, mobileNav, closeNav, onLogout }: Props) {
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [eventId, setEventId] = useState<string | null>(() => { try { return localStorage.getItem(LS_EVENT); } catch { return null; } });
  const [creating, setCreating] = useState(false);

  const [snap, setSnap] = useState<OrganizerSnapshot | null>(null);
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState("overview");
  const [viewQ, setViewQ] = useState(0);
  const viewQRef = useRef(0);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState<CompetitorKind>("individual");
  const [addMembers, setAddMembers] = useState("");

  const [sName, setSName] = useState("");
  const [sPin, setSPin] = useState("");
  const [sMins, setSMins] = useState(5);
  const [pts, setPts] = useState<Record<string, string>>({});

  /* ------------------------------------------------------------- load events */
  const loadEvents = useCallback(async () => {
    setLoadErr("");
    try {
      const list = await listMyEvents();
      setEvents(list); onNet(true);
      setEventId(cur => (cur && list.some(e => e.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) { onNet(false); setLoadErr(errMsg(e)); }
  }, [onNet]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    try { if (eventId) localStorage.setItem(LS_EVENT, eventId); else localStorage.removeItem(LS_EVENT); } catch { /* ignore */ }
    setSnap(null);
  }, [eventId]);

  /* -------------------------------------------------- live state (polling) */
  useEffect(() => { viewQRef.current = viewQ; }, [viewQ]);
  const refresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const s = await organizerSnapshot(eventId, viewQRef.current);
      setSnap(s); setOffset(Date.parse(s.server_now) - Date.now()); onNet(true);
    } catch (e) {
      const m = errMsg(e);
      if (m.includes("not found or access denied")) { setEventId(null); void loadEvents(); }
      onNet(false);
    }
  }, [eventId, onNet, loadEvents]);
  useEffect(() => {
    if (!eventId) return;
    void refresh();
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, 2000);
    const vis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [eventId, refresh]);
  useEffect(() => { if (eventId) void refresh(); }, [viewQ]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const ev = snap?.event;
  const comps = useMemo(() => snap?.competitors ?? [], [snap]);
  const ranked = useMemo(() => [...comps].sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name)), [comps]);
  const q = ev?.current_question ?? 0;

  useEffect(() => { onTop(ev?.status ?? null, ev?.pin); }, [ev?.status, ev?.pin, onTop]);
  useEffect(() => { if (ev) setViewQ(ev.current_question); }, [ev?.current_question, ev?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ev) { setSName(ev.name); setSPin(ev.pin ?? ""); setSMins(Math.max(1, Math.round(ev.question_seconds / 60))); }
  }, [ev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) notify(okMsg); await refresh(); }
    catch (e) { notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  };

  /* ------------------------------------------------- no event yet / loading */
  if (loadErr && !events) return <main className="participant-shell"><div className="join-card gate-card">
    <div className="join-icon"><ShieldCheck /></div><h1>Can’t reach <span>the backend</span></h1>
    <p className="gate-err">{loadErr}</p>
    <button className="primary-btn join-btn" onClick={() => void loadEvents()}><RefreshCw size={15} /> Retry</button>
    <button className="back-link" onClick={onLogout}><LogOut size={13} /> Sign out</button>
  </div></main>;
  if (!events) return <main className="participant-shell"><div className="join-card gate-card"><p>Loading your events…</p></div></main>;
  if (creating || !eventId) return <CreateEventCard
    existing={events}
    notify={notify}
    onCancel={eventId ? () => setCreating(false) : undefined}
    onOpen={id => { setEventId(id); setCreating(false); setTab("overview"); }}
    onCreated={e => { setEvents(list => [e, ...(list ?? [])]); setEventId(e.id); setCreating(false); setTab("overview"); notify(`Event created. PIN ${e.pin}`); }}
    onLogout={onLogout} />;
  if (!ev) return <main className="participant-shell"><div className="join-card gate-card"><p>Loading event…</p></div></main>;

  /* ------------------------------------------------------------ derived UI */
  const cur = questions[q];
  const viewing = questions[viewQ];
  const answeredCount = comps.filter(c => c.answered).length;
  const left = secondsLeft(ev, offset, now);
  const link = ev.pin ? joinLink(ev.pin) : "";
  const joined = comps.filter(c => c.claimed).length;
  const isRunning = ev.status === "live" || ev.status === "paused";
  const running = ev.status === "live" && ev.screen === "question";

  const goNext = () => {
    if (q >= 10) {
      if (window.confirm("End the competition and show final standings to everyone?")) void act(() => setEventState(ev.id, "ended"), "Competition ended.");
      return;
    }
    if (running && !window.confirm(`Skip ahead to question ${q + 1}? Participants move on immediately.`)) return;
    void act(() => setCurrentQuestion(ev.id, q + 1, "question"), `Question ${q + 1} is now live for participants.`);
  };
  const goPrev = () => { if (q > 0) void act(() => setCurrentQuestion(ev.id, q - 1, "question"), `Participants moved back to ${q - 1 === 0 ? "the trial question" : `question ${q - 1}`}.`); };
  const showScreen = (s: Screen) => void act(() => setScreen(ev.id, s), s === "leaderboard" ? "Leaderboard revealed to participants." : s === "lobby" ? "Participants sent to the waiting room." : "Participants are back on the question.");
  const copy = async (text: string, what: string) => notify((await copyText(text)) ? `${what} copied.` : "Copy failed — select and copy it manually.", "ok");

  const submitAdd = () => {
    if (!addName.trim()) { notify("Enter a participant or team name.", "err"); return; }
    const members = addKind === "team" ? addMembers.split(",").map(x => x.trim()).filter(Boolean) : [];
    void act(async () => {
      await addCompetitor(ev.id, addName.trim(), addKind, members);
      setAddName(""); setAddMembers(""); setShowAdd(false);
    }, addKind === "team" ? "Team enrolled. They’ll appear on their screens as soon as they join with the PIN." : "Participant enrolled.");
  };
  const exportCsv = () => {
    const rows = [["name", "type", "members", "score", "solved", "joined"], ...ranked.map(p => [p.display_name, kindLabel(p.kind), (p.members ?? []).join("; "), p.score, p.solved_count, p.claimed ? "yes" : "no"])];
    const csv = rows.map(r => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "error-404-participants.csv"; a.click();
  };
  const saveSettings = () => {
    if (!/^\d{4,8}$/.test(sPin)) { notify("PIN must be 4–8 digits.", "err"); return; }
    void act(() => updateEvent(ev.id, sName, sPin, Math.max(1, sMins) * 60), "Event settings saved.");
  };
  const saveTimer = () => void act(() => updateEvent(ev.id, ev.name, ev.pin ?? "", Math.max(1, sMins) * 60), "Timer saved. It applies from the next question you send.");

  const titles: Record<string, [string, string]> = {
    overview: ["Organizer dashboard", "Your event at a glance. Control every moment from here."],
    participants: ["Participants", "Enroll individuals and teams, or let them join with the PIN."],
    questions: ["Question control", "Choose what participants see and when."],
    leaderboard: ["Live leaderboard", "Track the standings and decide when to reveal them."],
    settings: ["Event settings", "PIN, name and timing. Everything syncs to participants instantly."],
  };

  return <div className="dashboard-layout">
    <aside className={`sidebar ${mobileNav ? "nav-open" : ""}`}>
      <div className="side-label">EVENT CONTROL</div>
      {NAV.map(([id, label]) => <button key={id} className={`nav-item ${tab === id ? "active" : ""}`} onClick={() => { setTab(id); closeNav(); }}>
        {id === "overview" ? <Activity /> : id === "participants" ? <Users /> : id === "questions" ? <Code2 /> : id === "leaderboard" ? <Trophy /> : <ShieldCheck />}
        {label}{id === "participants" && <span className="nav-count">{comps.length}</span>}
      </button>)}
      <div className="sidebar-bottom">
        <div className="event-mini"><span className="mini-label">CURRENT EVENT</span><b>{ev.name}</b><small>PIN: {ev.pin}</small></div>
        <button className="nav-item" onClick={onLogout}><LogOut /> Sign out</button>
      </div>
    </aside>

    <main className="dashboard-main">
      <div className="page-heading">
        <div><div className="breadcrumb">EVENT CONTROL / {tab.toUpperCase()}</div><h1>{titles[tab][0]}</h1><p>{titles[tab][1]}</p></div>
        <div className="heading-actions">
          <button className="secondary-btn small" onClick={() => void copy(link, "Join link")}><Link2 size={14} /> Copy join link</button>
          {isRunning && <button className="secondary-btn small" disabled={busy} onClick={() => { if (window.confirm("End the event for everyone?")) void act(() => setEventState(ev.id, "ended"), "Event ended."); }}>End event</button>}
          {ev.status === "live"
            ? <button className="danger-btn" disabled={busy} onClick={() => void act(() => setEventState(ev.id, "paused"), "Event paused. Timers are frozen.")}>Pause event</button>
            : ev.status === "ended"
              ? <button className="primary-btn small" disabled={busy} onClick={() => void act(() => setEventState(ev.id, "live"), "Event re-opened.")}><Play size={15} /> Re-open event</button>
              : <button className="primary-btn small" disabled={busy} onClick={() => void act(() => setEventState(ev.id, "live"), ev.status === "paused" ? "Event resumed." : "Event is live. Participants can begin.")}><Play size={15} /> {ev.status === "paused" ? "Resume event" : "Start event"}</button>}
        </div>
      </div>

      {/* ------------------------------------------------------------ OVERVIEW */}
      {tab === "overview" && <>
        <div className="metric-grid">
          <Metric icon={<Users />} label="ENROLLED" value={comps.length} note={`${joined} joined on a device`} />
          <Metric icon={<Code2 />} label="QUESTIONS" value={`${q}/10`} note="Official round progress" />
          <Metric icon={<Trophy />} label="TOP SCORE" value={ranked[0]?.score ?? 0} note={ranked[0] && ranked[0].score > 0 ? ranked[0].display_name : "No leader yet"} />
          <Metric icon={<Radio />} label="EVENT STATUS" value={ev.status.toUpperCase()} note="Live event state" />
        </div>
        <div className="overview-grid">
          <section className="panel">
            <div className="panel-head"><div><h3>Competition control</h3><p>What you do here changes every participant’s screen.</p></div><span className={`status-pill ${ev.status}`}>{ev.status}</span></div>
            <div className="round-progress"><div><span>QUESTION PROGRESS</span><b>{q} <small>/ 10</small></b></div><div className="progress-track"><i style={{ width: `${q * 10}%` }} /></div></div>
            <div className="current-challenge"><div className="challenge-icon"><Code2 /></div><div><span>{q === 0 ? "TRIAL QUESTION" : `QUESTION ${q} · ${cur.difficulty.toUpperCase()}`}</span><b>{cur.title}</b><small>{cur.language} · {cur.points} points</small></div></div>

            <div className="sync-stats">
              <div><span>PARTICIPANTS SEE</span><b>{ev.status === "ended" ? "Final standings" : ev.screen === "lobby" || ev.status === "draft" ? "Waiting room" : ev.screen === "leaderboard" ? "Leaderboard" : `Question ${q === 0 ? "T" : q}`}</b></div>
              <div><span>TIME LEFT</span><b className="mono-b"><Clock3 size={13} /> {ev.status === "draft" ? "—" : fmtClock(left)}{ev.status === "paused" ? " ⏸" : ""}</b></div>
              <div><span>ANSWERS IN</span><b>{answeredCount} / {comps.length}</b></div>
            </div>

            <label className="field-label">PAGE SHOWN TO PARTICIPANTS</label>
            <div className="segmented three">{SCREENS.map(([s, label]) => <button key={s} disabled={busy || ev.status === "ended"} className={ev.screen === s ? "selected" : ""} onClick={() => showScreen(s)}>{label}</button>)}</div>

            <div className="control-actions">
              <button className="secondary-btn" disabled={busy || q === 0} onClick={goPrev}><ChevronLeft size={16} /> Previous</button>
              <button className="secondary-btn" disabled={busy || ev.status === "ended"} onClick={() => showScreen(ev.screen === "leaderboard" ? "question" : "leaderboard")}>{ev.screen === "leaderboard" ? <><EyeOff size={16} /> Hide leaderboard</> : <><Eye size={16} /> Reveal leaderboard</>}</button>
              <button className="primary-btn" disabled={busy || ev.status === "ended"} onClick={goNext}>{q >= 10 ? "End competition" : running ? <><SkipForward size={16} /> Skip to next question</> : "Release next question"} <ArrowRight size={16} /></button>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><h3>Leaderboard preview</h3><p>Current top performers</p></div><button className="text-btn" onClick={() => setTab("leaderboard")}>View all <ArrowRight size={14} /></button></div>
            <Board rows={ranked.slice(0, 4)} />
          </section>
        </div>
        <div className="panel bottom-panel">
          <div className="panel-head"><div><h3>Share with participants</h3><p>Anyone with the link and PIN can join from any device.</p></div><span className="status-pill live"><span className="green-dot" /> Synced</span></div>
          <div className="share-row"><span className="share-label">EVENT PIN</span><b className="share-pin">{ev.pin}</b><button className="secondary-btn small" onClick={() => void copy(ev.pin ?? "", "PIN")}><Copy size={14} /> Copy PIN</button></div>
          <div className="share-row"><span className="share-label">JOIN LINK</span><code className="share-link">{link}</code><button className="secondary-btn small" onClick={() => void copy(link, "Join link")}><Link2 size={14} /> Copy link</button></div>
        </div>
      </>}

      {/* -------------------------------------------------------- PARTICIPANTS */}
      {tab === "participants" && <>
        <div className="toolbar">
          <div className="search-box"><Search size={16} /><input placeholder="Search participants..." value={search} onChange={e => setSearch(e.target.value)} /></div>
          <button className="primary-btn small" onClick={() => setShowAdd(true)}><Plus size={16} /> Enroll participant</button>
        </div>
        <div className="panel table-panel">
          <div className="panel-head"><div><h3>Enrolled participants</h3><p>{comps.length} entries · {joined} joined on a device</p></div><button className="secondary-btn small" onClick={exportCsv}>Export CSV</button></div>
          <table><thead><tr><th>NAME / TEAM</th><th>TYPE</th><th>SCORE</th><th>SOLVED</th><th>STATUS</th><th></th></tr></thead>
            <tbody>
              {comps.filter(p => p.display_name.toLowerCase().includes(search.toLowerCase())).map(p => <tr key={p.id}>
                <td><b>{p.display_name}</b>{p.kind === "team" && !!p.members?.length && <small className="sub-cell">{p.members.join(", ")}</small>}</td>
                <td><span className="type-pill">{kindLabel(p.kind)}</span></td>
                <td>{p.score}</td><td>{p.solved_count}/10</td>
                <td><span className={`status-pill ${p.claimed ? "live" : "draft"}`}>{p.claimed ? "Joined" : "Not joined yet"}</span></td>
                <td className="row-actions">
                  {p.claimed && <button className="icon-btn" title="Release name (lets them re-join from another device)" onClick={() => { if (window.confirm(`Release “${p.display_name}”? Their current device will be signed out so they can re-join.`)) void act(() => releaseCompetitor(p.id), "Released. They can join again with the PIN."); }}><RefreshCw size={14} /></button>}
                  <button className="icon-btn" title="Remove" onClick={() => { if (window.confirm(`Remove “${p.display_name}” and their answers?`)) void act(() => removeCompetitor(p.id), "Removed."); }}><X size={15} /></button>
                </td>
              </tr>)}
              {!comps.length && <tr><td colSpan={6} className="muted empty-note">Nobody yet. Enroll someone, or share the PIN so they can join themselves.</td></tr>}
            </tbody></table>
        </div>
      </>}

      {/* ----------------------------------------------------------- QUESTIONS */}
      {tab === "questions" && <>
        <div className="questions-admin">
          <div className="panel">
            <div className="panel-head"><div><h3>Question release control</h3><p>Pick a question, then send it. Sending any question restarts the timer.</p></div><span className="pin-chip">LIVE: {q === 0 ? "TRIAL" : `Q${q}`}</span></div>
            <div className="question-selector">{questions.map((qq, i) => <button key={qq.id} className={`q-select ${viewQ === i ? "selected" : ""} ${i === 0 ? "trial" : ""} ${q === i ? "is-live" : ""}`} onClick={() => setViewQ(i)}>{i === 0 ? "T" : i}<small>{qq.language === "Python" ? "PY" : "JS"}</small></button>)}</div>
            <div className="admin-question">
              <div className="challenge-tags"><span>{viewQ === 0 ? "TRIAL" : `QUESTION ${viewQ}`}</span><span>{viewing.language}</span><span>{viewing.difficulty}</span><span>{viewing.points} PTS</span>{viewQ === q && <span className="live-tag">ON PARTICIPANT SCREENS</span>}</div>
              <h2>{viewing.title}</h2><p>{viewing.prompt}</p>
              <pre>{starterCode(viewQ)}</pre>
              <div className="admin-question-actions">
                <button className="secondary-btn" disabled={busy || ev.status === "ended"} onClick={() => showScreen("leaderboard")}>Show leaderboard</button>
                <button className="primary-btn" disabled={busy || ev.status === "ended"} onClick={() => void act(() => setCurrentQuestion(ev.id, viewQ, "question"), `${viewQ === 0 ? "Trial question" : `Question ${viewQ}`} sent to participants.`)}>
                  {viewQ === q && ev.screen === "question" ? "Restart timer" : `Send ${viewQ === 0 ? "trial" : `Q${viewQ}`} to participants`} <ArrowRight size={15} /></button>
              </div>
            </div>
          </div>
          <div className="panel">
            <h3>Timing</h3>
            <p className="muted">Time each question stays open. Applies from the next question you send.</p>
            <label className="field-label">Question time limit (minutes)</label>
            <input className="text-input" type="number" min={1} max={30} value={sMins} onChange={e => setSMins(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
            <button className="secondary-btn full" disabled={busy} onClick={saveTimer}>Save timer</button>
            <div className="mini-stat"><span>ANSWERS IN (CURRENT Q)</span><b>{answeredCount} / {comps.length}</b></div>
          </div>
        </div>

        <div className="panel answers-panel">
          <div className="panel-head"><div><h3>Submissions · {viewQ === 0 ? "Trial" : `Question ${viewQ}`}</h3><p>Review answers and award points. The leaderboard updates for everyone.</p></div><span className="pin-chip">{(snap?.answers ?? []).filter(a => a.question_number === viewQ).length} RECEIVED</span></div>
          {(snap?.answers ?? []).filter(a => a.question_number === viewQ).map(a => {
            const who = comps.find(c => c.id === a.competitor_id);
            const val = pts[a.id] ?? String(a.awarded_points || viewing.points);
            return <div className="answer-row" key={a.id}>
              <div className="answer-who"><b>{who?.display_name ?? "Unknown"}</b><small>{new Date(a.submitted_at).toLocaleTimeString()} · {a.awarded_points > 0 ? `${a.awarded_points} pts awarded` : "ungraded"}</small></div>
              <details className="answer-code"><summary>View submission</summary><pre>{a.source_code || "(no code)"}</pre>{a.note && <p className="answer-note">Note: {a.note}</p>}</details>
              <div className="answer-grade">
                <input className="text-input" type="number" min={0} max={1000} value={val} onChange={e => setPts(p => ({ ...p, [a.id]: e.target.value }))} />
                <button className="primary-btn small" disabled={busy} onClick={() => void act(() => gradeAnswer(a.id, Math.max(0, Math.min(1000, Number(val) || 0))), "Points saved.")}><Check size={14} /> Award</button>
                {a.awarded_points > 0 && <button className="secondary-btn small" disabled={busy} onClick={() => void act(() => gradeAnswer(a.id, 0), "Points removed.")}>Clear</button>}
              </div>
            </div>;
          })}
          {!(snap?.answers ?? []).some(a => a.question_number === viewQ) && <p className="muted empty-note">No submissions for this question yet.</p>}
        </div>
      </>}

      {/* --------------------------------------------------------- LEADERBOARD */}
      {tab === "leaderboard" && <div className="panel">
        <div className="panel-head">
          <div><h3>Competition standings</h3><p>First place earns the Error-404 flag. Participants only see this when you reveal it.</p></div>
          <button className="secondary-btn small" disabled={busy || ev.status === "ended"} onClick={() => showScreen(ev.screen === "leaderboard" ? "question" : "leaderboard")}>{ev.screen === "leaderboard" ? <><EyeOff size={14} /> Hide from participants</> : <><Eye size={14} /> Reveal to participants</>}</button>
        </div>
        <Board rows={ranked} />
      </div>}

      {/* ------------------------------------------------------------ SETTINGS */}
      {tab === "settings" && <div className="panel settings-panel">
        <h3>Event configuration</h3>
        <label className="field-label">Event name</label>
        <input className="text-input" value={sName} onChange={e => setSName(e.target.value)} />
        <label className="field-label">Event PIN (4–8 digits, chosen by you)</label>
        <div className="pin-edit">
          <input className="text-input" inputMode="numeric" value={sPin} onChange={e => setSPin(digitsOnly(e.target.value))} />
          <button className="secondary-btn" onClick={() => setSPin(genPin())}><RefreshCw size={15} /> Generate</button>
          <button className="secondary-btn" onClick={() => void copy(sPin, "PIN")}><Copy size={15} /> Copy</button>
        </div>
        <p className="muted hint-line">Changing the PIN doesn’t kick out anyone who has already joined. It only affects new joiners.</p>
        <label className="field-label">Default question timer (minutes)</label>
        <input className="text-input" type="number" min={1} max={30} value={sMins} onChange={e => setSMins(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
        <label className="field-label">Participant join link</label>
        <div className="pin-edit"><input className="text-input" readOnly value={link} onFocus={e => e.currentTarget.select()} /><button className="secondary-btn" onClick={() => void copy(link, "Join link")}><Copy size={15} /> Copy</button></div>
        <div className="settings-actions">
          <button className="danger-btn" disabled={busy} onClick={() => { if (window.confirm("Reset this event? All answers and scores are deleted and the event goes back to setup. Enrolled participants stay.")) void act(() => resetEvent(ev.id), "Event reset."); }}>Reset event</button>
          <button className="primary-btn" disabled={busy} onClick={saveSettings}>Save settings</button>
        </div>
        <div className="event-switch">
          <h3>Your events</h3>
          {events.map(e => <button key={e.id} className={`switch-row ${e.id === ev.id ? "current" : ""}`} onClick={() => { if (e.id !== ev.id) { setEventId(e.id); setTab("overview"); } }}><b>{e.name}</b><small>PIN {e.pin} · {e.status}</small>{e.id === ev.id && <span className="status-pill live">Open</span>}</button>)}
          <button className="secondary-btn full" onClick={() => setCreating(true)}><Plus size={15} /> Create a new event</button>
        </div>
      </div>}
    </main>

    {showAdd && <div className="modal-backdrop" onClick={() => setShowAdd(false)}><div className="modal" onClick={e => e.stopPropagation()}>
      <div className="modal-head"><div><h2>Enroll competitor</h2><p>Add an individual or create a team. They’ll claim it by joining with the PIN and the same name.</p></div><button className="icon-btn" onClick={() => setShowAdd(false)}><X /></button></div>
      <label className="field-label">COMPETITOR NAME</label>
      <input className="text-input" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name or team name" autoFocus />
      <label className="field-label">PARTICIPATION TYPE</label>
      <div className="segmented"><button className={addKind === "individual" ? "selected" : ""} onClick={() => setAddKind("individual")}>Individual</button><button className={addKind === "team" ? "selected" : ""} onClick={() => setAddKind("team")}>Team</button></div>
      {addKind === "team" && <><label className="field-label">TEAM MEMBERS (COMMA SEPARATED)</label><textarea className="answer-box" value={addMembers} onChange={e => setAddMembers(e.target.value)} placeholder="Alex, Sam, Jordan" /></>}
      <button className="primary-btn full" disabled={busy} onClick={submitAdd}>Add to event <Plus size={16} /></button>
    </div></div>}
  </div>;
}

/* ===================================================================== create */
function CreateEventCard({ existing, notify, onCancel, onOpen, onCreated, onLogout }: {
  existing: EventInfo[]; notify: Notify; onCancel?: () => void; onOpen: (id: string) => void;
  onCreated: (e: EventInfo) => void; onLogout: () => void;
}) {
  const [name, setName] = useState("Campus Debugging Showdown");
  const [pin, setPin] = useState(() => genPin());
  const [mins, setMins] = useState(5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const create = async () => {
    setErr("");
    if (!name.trim()) { setErr("Enter an event name."); return; }
    if (!/^\d{4,8}$/.test(pin)) { setErr("PIN must be 4–8 digits."); return; }
    setBusy(true);
    try { onCreated(await createEvent(name.trim(), pin, Math.max(1, mins) * 60)); }
    catch (e) { setErr(errMsg(e)); notify(errMsg(e), "err"); }
    finally { setBusy(false); }
  };
  return <main className="participant-shell"><div className="join-card gate-card">
    <div className="join-icon"><ShieldCheck /></div><div className="section-kicker">ORGANIZER SETUP</div>
    <h1>Create your <span>event</span></h1>
    <p>You choose the PIN. Participants need it (and the join link) to enter the arena.</p>
    <label className="field-label">EVENT NAME</label>
    <input className="text-input" value={name} onChange={e => setName(e.target.value)} />
    <label className="field-label">EVENT PIN (4–8 DIGITS)</label>
    <div className="pin-edit"><input className="text-input pin-input" inputMode="numeric" value={pin} onChange={e => setPin(digitsOnly(e.target.value))} /><button className="secondary-btn" onClick={() => setPin(genPin())}><RefreshCw size={15} /></button></div>
    <label className="field-label">QUESTION TIME LIMIT (MINUTES)</label>
    <input className="text-input" type="number" min={1} max={30} value={mins} onChange={e => setMins(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
    {err && <p className="gate-err">{err}</p>}
    <button className="primary-btn join-btn" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : "Create event"} <ArrowRight size={16} /></button>
    {existing.length > 0 && <div className="event-switch"><h3>Or open an existing event</h3>{existing.map(e => <button key={e.id} className="switch-row" onClick={() => onOpen(e.id)}><b>{e.name}</b><small>PIN {e.pin} · {e.status}</small></button>)}</div>}
    {onCancel && <button className="back-link" onClick={onCancel}>← Cancel</button>}
    <button className="back-link" onClick={onLogout}><LogOut size={13} /> Sign out</button>
  </div></main>;
}
