import { describe, expect, it } from "vite-plus/test";
import {
  HEADER_AUTH_HASH,
  HEADER_EXPIRY,
  HEADER_SALT,
  MAX_UPLOAD_BYTES,
  toB64url,
} from "../../src/shared/protocol.ts";
import { baseURL, seedFile } from "./helpers.ts";

const salt = toB64url(new Uint8Array(16));
const authHash = toB64url(new Uint8Array(32));

function upload(headers: Record<string, string>, body: BodyInit = "ciphertext") {
  return fetch(`${baseURL}/api/files`, { method: "POST", headers, body });
}

function claim(id: string, authKey: string) {
  return fetch(`${baseURL}/api/files/${id}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authKey }),
  });
}

describe("API", () => {
  it("rejects uploads with missing or malformed metadata", async () => {
    const valid = { [HEADER_SALT]: salt, [HEADER_AUTH_HASH]: authHash, [HEADER_EXPIRY]: "1h" };
    const cases: Record<string, string>[] = [
      {},
      { ...valid, [HEADER_SALT]: "short" },
      { ...valid, [HEADER_AUTH_HASH]: salt },
      { ...valid, [HEADER_EXPIRY]: "forever" },
    ];
    for (const headers of cases) {
      const response = await upload(headers);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
  });

  it("rejects empty and oversized uploads", async () => {
    const headers = { [HEADER_SALT]: salt, [HEADER_AUTH_HASH]: authHash, [HEADER_EXPIRY]: "1h" };
    expect((await upload(headers, "")).status).toBe(411);
    const tooBig = await upload(headers, new Uint8Array(MAX_UPLOAD_BYTES + 1));
    expect(tooBig.status).toBe(413);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    for (const id of ["AAAAAAAAAAAAAAAAAAAAAA", "nope", "%2e%2e"]) {
      const response = await fetch(`${baseURL}/api/files/${id}`);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("does not expose the auth hash, file name or key in file info", async () => {
    const seeded = await seedFile("info-check", { name: "private-name.pdf" });
    const text = await (await fetch(`${baseURL}/api/files/${seeded.id}`)).text();
    const info: unknown = JSON.parse(text);
    expect(Object.keys(info as object).toSorted()).toEqual([
      "attemptsLeft",
      "expiresAt",
      "salt",
      "size",
    ]);
    expect(text).not.toContain("private-name");
  });

  it("validates claim bodies without burning an attempt", async () => {
    const seeded = await seedFile("validate-claim");
    for (const authKey of ["", "short", "x".repeat(44), "+".repeat(43)]) {
      expect((await claim(seeded.id, authKey)).status).toBe(400);
    }
    const garbage = await fetch(`${baseURL}/api/files/${seeded.id}/claim`, {
      method: "POST",
      body: "not json",
    });
    expect(garbage.status).toBe(400);
    const info = (await (await fetch(`${baseURL}/api/files/${seeded.id}`)).json()) as {
      attemptsLeft: number;
    };
    expect(info.attemptsLeft).toBe(5);
  });

  it("serves the file exactly once, even under concurrent claims", async () => {
    const seeded = await seedFile("race-condition");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => claim(seeded.id, seeded.authKey)),
    );
    const statuses = responses.map((r) => r.status).toSorted((a, b) => a - b);
    expect(statuses).toEqual([200, 404, 404, 404, 404, 404, 404, 404]);

    const winner = responses.find((r) => r.status === 200);
    const payload = new Uint8Array(await winner!.arrayBuffer());
    expect(payload.length).toBeGreaterThan(seeded.content.length);
    expect(winner!.headers.get("cache-control")).toBe("no-store");
    await Promise.all(responses.filter((r) => r !== winner).map(async (r) => r.body?.cancel()));

    expect((await fetch(`${baseURL}/api/files/${seeded.id}`)).status).toBe(404);
  });

  it("rejects wrong methods and unknown routes", async () => {
    const seeded = await seedFile("methods");
    const get = await fetch(`${baseURL}/api/files/${seeded.id}/claim`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
    expect((await fetch(`${baseURL}/api/files`)).status).toBe(405);
    expect((await fetch(`${baseURL}/api/files/${seeded.id}`, { method: "DELETE" })).status).toBe(
      405,
    );
    expect((await fetch(`${baseURL}/api/nope`)).status).toBe(404);
  });

  it("serves the app with strict security headers", async () => {
    const response = await fetch(`${baseURL}/f/AAAAAAAAAAAAAAAAAAAAAA`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // Share links carry the file id; never leak it via Referer.
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
