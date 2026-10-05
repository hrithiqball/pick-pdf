import { describe, expect, it } from "vite-plus/test";
import { checkPasswords, formatBytes, formatRelative } from "../../src/client/format.ts";
import {
  fromB64url,
  isB64urlOfLength,
  isExpiryOption,
  isFileId,
  randomId,
  toB64url,
} from "../../src/shared/protocol.ts";

describe("base64url", () => {
  it("round-trips arbitrary bytes of every padding length", () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      const encoded = toB64url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromB64url(encoded)).toEqual(bytes);
    }
  });

  it("validates encoded length", () => {
    const sixteen = toB64url(new Uint8Array(16));
    expect(isB64urlOfLength(sixteen, 16)).toBe(true);
    expect(isB64urlOfLength(sixteen, 32)).toBe(false);
    expect(isB64urlOfLength(`${sixteen.slice(0, -1)}+`, 16)).toBe(false);
    expect(isB64urlOfLength(null, 16)).toBe(false);
  });
});

describe("ids", () => {
  it("generates unique, valid ids", () => {
    const ids = new Set(Array.from({ length: 200 }, randomId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(isFileId(id)).toBe(true);
  });

  it("rejects malformed ids", () => {
    expect(isFileId("short")).toBe(false);
    expect(isFileId("../../../../etc/passwd/xx")).toBe(false);
    expect(isFileId("a".repeat(23))).toBe(false);
  });
});

describe("isExpiryOption", () => {
  it("only accepts known options", () => {
    expect(isExpiryOption("1h")).toBe(true);
    expect(isExpiryOption("7d")).toBe(true);
    expect(isExpiryOption("30d")).toBe(false);
    expect(isExpiryOption("toString")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
  });

  it("formats relative expiry", () => {
    const now = 1_000_000_000_000;
    expect(formatRelative(now + 3600_000, now)).toBe("in 1 hour");
    expect(formatRelative(now + 86_400_000, now)).toBe("tomorrow");
    expect(formatRelative(now + 7 * 86_400_000, now)).toBe("in 7 days");
    expect(formatRelative(now + 30 * 60_000, now)).toBe("in 30 minutes");
    expect(formatRelative(now + 86_400_000 - 2_000, now)).toBe("tomorrow");
    expect(formatRelative(now + 3600_000 - 2_000, now)).toBe("in 1 hour");
  });

  it("checks passwords", () => {
    expect(checkPasswords("abc", "abc")).toBe("too_short");
    expect(checkPasswords("abcdef", "abcdeg")).toBe("mismatch");
    expect(checkPasswords("abcdef", "abcdef")).toBeNull();
  });
});
