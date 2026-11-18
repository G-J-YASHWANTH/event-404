import { questions } from "../data/questions";
import type { EventInfo } from "./supabase";

/** Starter code in questions.ts stores line breaks as a literal backslash-n. */
export const starterCode = (n: number) => (questions[n]?.code ?? "").split("\\n").join("\n");

/** Seconds left on the running question, based on the SERVER deadline so every device agrees. */
export function secondsLeft(ev: EventInfo, offsetMs: number, nowMs: number): number {
  if (ev.status === "paused" && ev.paused_remaining != null) return ev.paused_remaining;
  if (ev.deadline) return Math.max(0, Math.ceil((Date.parse(ev.deadline) - (nowMs + offsetMs)) / 1000));
  return ev.question_seconds;
}
export const fmtClock = (s: number) =>
  String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

export function genPin(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000)); // 6 digits
}
export const digitsOnly = (v: string) => v.replace(/\D/g, "").slice(0, 8);
export const joinLink = (pin: string) => `${location.origin}${location.pathname}#join/${pin}`;

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try {
      const t = document.createElement("textarea");
      t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy"); t.remove(); return ok;
    } catch { return false; }
  }
}
export const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
export const kindLabel = (k: string) => (k === "team" ? "Team" : "Individual");
