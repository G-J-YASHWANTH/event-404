import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase = url && anon ? createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
export const backendConfigured = Boolean(supabase);

/* ------------------------------------------------------------------ types */
export type CompetitorKind = "individual" | "team";
export type EventStatus = "draft" | "live" | "paused" | "ended";
/** The page participants are looking at. Controlled by the organizer. */
export type Screen = "lobby" | "question" | "leaderboard";

export type EventInfo = {
  id: string; name: string; pin?: string; status: EventStatus;
  current_question: number; question_seconds: number; screen: Screen;
  deadline: string | null; paused_remaining: number | null;
};
export type Competitor = {
  id: string; display_name: string; kind: CompetitorKind; score: number; solved_count: number;
  claimed?: boolean; members?: string[]; answered?: boolean;
};
export type AnswerRow = {
  id: string; competitor_id: string; question_number: number; source_code: string;
  note: string; submitted_at: string; awarded_points: number;
};
export type OrganizerSnapshot = { server_now: string; event: EventInfo; competitors: Competitor[]; answers: AnswerRow[] };
export type ParticipantSnapshot = {
  server_now: string; event: EventInfo; me: Competitor;
  my_answer: { source_code: string; note: string; submitted_at: string } | null;
  leaderboard: Competitor[];
};
export type Session404 = { eventId: string; competitorId: string; token: string; name: string };

/* ---------------------------------------------------------------- helpers */
function requireClient() {
  if (!supabase) throw new Error("Backend is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.");
  return supabase;
}
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireClient().rpc(fn, args);
  if (error) throw new Error(error.message || "Request failed");
  return data as T;
}
export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return "Something went wrong";
}
export const isSessionInvalid = (e: unknown) => errMsg(e).includes("SESSION_INVALID");

/* -------------------------------------------------------------- organizer */
export async function signInOrganizer(email: string, password: string) {
  const { data, error } = await requireClient().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function signOutOrganizer() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}
export async function getSession(): Promise<Session | null> {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}
export async function checkOrganizer(): Promise<boolean> {
  if (!supabase) return false;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data, error } = await supabase.rpc("is_organizer");
  return !error && data === true;
}

export const listMyEvents = () => call<EventInfo[]>("organizer_list_events");
export async function createEvent(name: string, pin: string, questionSeconds: number) {
  const rows = await call<EventInfo[]>("create_event", { p_name: name, p_pin: pin, p_question_seconds: questionSeconds });
  if (!rows?.length) throw new Error("Event was not created");
  return rows[0];
}
export const organizerSnapshot = (eventId: string, question?: number) =>
  call<OrganizerSnapshot>("organizer_snapshot", { p_event_id: eventId, p_question: question ?? null });
export const updateEvent = (eventId: string, name: string, pin: string, questionSeconds: number) =>
  call<void>("organizer_update_event", { p_event_id: eventId, p_name: name, p_pin: pin, p_question_seconds: questionSeconds });
export const setEventState = (eventId: string, status: EventStatus) =>
  call<void>("organizer_set_event_status", { p_event_id: eventId, p_status: status });
export const setCurrentQuestion = (eventId: string, question: number, screen: Screen = "question") =>
  call<void>("organizer_set_question", { p_event_id: eventId, p_question: question, p_screen: screen });
export const setScreen = (eventId: string, screen: Screen) =>
  call<void>("organizer_set_screen", { p_event_id: eventId, p_screen: screen });
export const addCompetitor = (eventId: string, name: string, kind: CompetitorKind, members: string[]) =>
  call<string>("organizer_add_competitor", { p_event_id: eventId, p_display_name: name, p_kind: kind, p_members: members });
export const removeCompetitor = (id: string) => call<void>("organizer_remove_competitor", { p_competitor_id: id });
export const releaseCompetitor = (id: string) => call<void>("organizer_release_competitor", { p_competitor_id: id });
export const gradeAnswer = (answerId: string, points: number) =>
  call<void>("organizer_grade_answer", { p_answer_id: answerId, p_points: points });
export const resetEvent = (eventId: string) => call<void>("organizer_reset_event", { p_event_id: eventId });

/* ------------------------------------------------------------ participant */
export async function joinEvent(pin: string, name: string, kind: CompetitorKind, members: string[]): Promise<Session404> {
  const rows = await call<{ out_event_id: string; out_competitor_id: string; out_token: string }[]>(
    "join_event", { p_pin: pin, p_display_name: name, p_kind: kind, p_members: members });
  const r = rows?.[0];
  if (!r) throw new Error("Could not join the event");
  return { eventId: r.out_event_id, competitorId: r.out_competitor_id, token: r.out_token, name: name.trim() };
}
export const participantView = (s: Session404) =>
  call<ParticipantSnapshot>("participant_view", { p_event_id: s.eventId, p_competitor_id: s.competitorId, p_token: s.token });
export const submitAnswer = (s: Session404, question: number, code: string, note: string) =>
  call<string>("submit_answer", { p_event_id: s.eventId, p_competitor_id: s.competitorId, p_token: s.token, p_question: question, p_code: code, p_note: note });
