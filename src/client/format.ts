import { MIN_PASSWORD_LENGTH } from "../shared/protocol.ts";

const UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** "in 3 hours", "in 2 days", "in 40 minutes" relative to `now`. */
export function formatRelative(timestamp: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const seconds = Math.round((timestamp - now) / 1000);
  // Compare rounded values so 23h59m reads as "tomorrow", not "in 24 hours".
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(seconds / 3600);
  if (Math.abs(seconds) < 60) return rtf.format(seconds, "second");
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

export type PasswordProblem = "too_short" | "mismatch" | null;

export function checkPasswords(password: string, confirm: string): PasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password !== confirm) return "mismatch";
  return null;
}
