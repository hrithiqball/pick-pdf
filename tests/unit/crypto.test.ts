import { describe, expect, it } from "vite-plus/test";
import { decryptFile, deriveKeys, encryptFile } from "../../src/shared/crypto.ts";
import { fromB64url, sha256, toB64url } from "../../src/shared/protocol.ts";

// Low iteration count keeps unit tests fast; production uses PBKDF2_ITERATIONS.
const ITERATIONS = 1_000;
const salt = new Uint8Array(16).fill(7);

describe("deriveKeys", () => {
  it("is deterministic for the same password and salt", async () => {
    const a = await deriveKeys("hunter22", salt, ITERATIONS);
    const b = await deriveKeys("hunter22", salt, ITERATIONS);
    expect(a.authKey).toBe(b.authKey);
    expect(a.authHash).toBe(b.authHash);
  });

  it("produces a 32-byte auth key whose SHA-256 is the auth hash", async () => {
    const keys = await deriveKeys("hunter22", salt, ITERATIONS);
    const authBytes = fromB64url(keys.authKey);
    expect(authBytes).toHaveLength(32);
    expect(toB64url(await sha256(authBytes))).toBe(keys.authHash);
  });

  it("differs for different passwords or salts", async () => {
    const base = await deriveKeys("hunter22", salt, ITERATIONS);
    const otherPassword = await deriveKeys("hunter23", salt, ITERATIONS);
    const otherSalt = await deriveKeys("hunter22", new Uint8Array(16).fill(8), ITERATIONS);
    expect(otherPassword.authKey).not.toBe(base.authKey);
    expect(otherSalt.authKey).not.toBe(base.authKey);
  });
});

describe("encryptFile / decryptFile", () => {
  it("round-trips file bytes and header", async () => {
    const { encryptionKey } = await deriveKeys("correct horse", salt, ITERATIONS);
    const data = crypto.getRandomValues(new Uint8Array(4096));
    const header = { name: "résumé final (2).pdf", type: "application/pdf" };

    const payload = await encryptFile(encryptionKey, header, data);
    const result = await decryptFile(encryptionKey, payload);

    expect(result.header).toEqual(header);
    expect(result.data).toEqual(data);
  });

  it("does not leak the file name in the ciphertext", async () => {
    const { encryptionKey } = await deriveKeys("correct horse", salt, ITERATIONS);
    const payload = await encryptFile(
      encryptionKey,
      { name: "secret-plans.pdf", type: "application/pdf" },
      new TextEncoder().encode("hello"),
    );
    expect(new TextDecoder().decode(payload)).not.toContain("secret-plans");
  });

  it("uses a fresh IV every time", async () => {
    const { encryptionKey } = await deriveKeys("correct horse", salt, ITERATIONS);
    const data = new TextEncoder().encode("same input");
    const header = { name: "a.txt", type: "text/plain" };
    const a = await encryptFile(encryptionKey, header, data);
    const b = await encryptFile(encryptionKey, header, data);
    expect(toB64url(a)).not.toBe(toB64url(b));
  });

  it("rejects the wrong key", async () => {
    const right = await deriveKeys("right password", salt, ITERATIONS);
    const wrong = await deriveKeys("wrong password", salt, ITERATIONS);
    const payload = await encryptFile(
      right.encryptionKey,
      { name: "a.txt", type: "text/plain" },
      new TextEncoder().encode("x"),
    );
    await expect(decryptFile(wrong.encryptionKey, payload)).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const { encryptionKey } = await deriveKeys("pw123456", salt, ITERATIONS);
    const payload = await encryptFile(
      encryptionKey,
      { name: "a.txt", type: "text/plain" },
      new TextEncoder().encode("integrity matters"),
    );
    payload[payload.length - 1] = (payload.at(-1) ?? 0) ^ 1;
    await expect(decryptFile(encryptionKey, payload)).rejects.toThrow();
  });
});
