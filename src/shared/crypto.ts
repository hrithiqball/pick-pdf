// End-to-end encryption. The password never leaves the browser: PBKDF2 stretches it
// into 64 bytes, the first half becomes the AES-GCM key and the second half is the
// "auth key" the server checks (it only stores a SHA-256 of it).

import { sha256, toB64url } from "./protocol.ts";

export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface DerivedKeys {
  encryptionKey: CryptoKey;
  /** base64url auth key sent when claiming a file. */
  authKey: string;
  /** base64url SHA-256 of the auth key, stored server-side at upload. */
  authHash: string;
}

export interface FileHeader {
  name: string;
  type: string;
}

export async function deriveKeys(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = PBKDF2_ITERATIONS,
): Promise<DerivedKeys> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      512,
    ),
  );
  const encryptionKey = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const authBytes = bits.slice(32);
  return {
    encryptionKey,
    authKey: toB64url(authBytes),
    authHash: toB64url(await sha256(authBytes)),
  };
}

/** Payload layout: iv(12) || AES-GCM( headerLength(u32 BE) || header JSON || file bytes ). */
export async function encryptFile(
  key: CryptoKey,
  header: FileHeader,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  const plain = new Uint8Array(4 + headerBytes.length + data.length);
  new DataView(plain.buffer).setUint32(0, headerBytes.length);
  plain.set(headerBytes, 4);
  plain.set(data, 4 + headerBytes.length);

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  const out = new Uint8Array(IV_BYTES + cipher.length);
  out.set(iv);
  out.set(cipher, IV_BYTES);
  return out;
}

export async function decryptFile(
  key: CryptoKey,
  payload: Uint8Array<ArrayBuffer>,
): Promise<{ header: FileHeader; data: Uint8Array<ArrayBuffer> }> {
  const iv = payload.slice(0, IV_BYTES);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, payload.slice(IV_BYTES)),
  );
  const headerLength = new DataView(plain.buffer).getUint32(0);
  const raw: unknown = JSON.parse(new TextDecoder().decode(plain.slice(4, 4 + headerLength)));
  return { header: parseHeader(raw), data: plain.slice(4 + headerLength) };
}

function parseHeader(raw: unknown): FileHeader {
  if (typeof raw === "object" && raw !== null && "name" in raw && "type" in raw) {
    const { name, type } = raw;
    if (typeof name === "string" && typeof type === "string") return { name, type };
  }
  throw new Error("Corrupt file header");
}
