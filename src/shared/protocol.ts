// Constants and helpers shared by the browser client and the Worker.

/** Largest plaintext file the UI accepts (the Worker request-body limit is 100 MB). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Ciphertext adds a 12-byte IV, a 16-byte GCM tag and a small metadata header. */
export const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 64 * 1024;
export const MAX_ATTEMPTS = 5;
export const MIN_PASSWORD_LENGTH = 6;

export const EXPIRY_OPTIONS = {
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
} as const;
export type ExpiryOption = keyof typeof EXPIRY_OPTIONS;
export const DEFAULT_EXPIRY: ExpiryOption = "1d";

export const HEADER_SALT = "x-pick-salt";
export const HEADER_AUTH_HASH = "x-pick-auth-hash";
export const HEADER_EXPIRY = "x-pick-expiry";

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const B64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isExpiryOption(value: unknown): value is ExpiryOption {
  return typeof value === "string" && Object.hasOwn(EXPIRY_OPTIONS, value);
}

export function isFileId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** True when `value` is base64url that decodes to exactly `byteLength` bytes. */
export function isB64urlOfLength(value: unknown, byteLength: number): value is string {
  return (
    typeof value === "string" &&
    B64URL_PATTERN.test(value) &&
    value.length === Math.ceil((byteLength * 4) / 3)
  );
}

export function toB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomId(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export interface FileInfo {
  salt: string;
  size: number;
  expiresAt: number;
  attemptsLeft: number;
}

export interface UploadResult {
  id: string;
  expiresAt: number;
}

export interface ClaimRejection {
  /** `destroyed` means this request used up the last attempt; `gone` means it was already unavailable. */
  error: "wrong_password" | "gone" | "destroyed";
  attemptsLeft: number;
}
