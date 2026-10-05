import {
  EXPIRY_OPTIONS,
  HEADER_AUTH_HASH,
  HEADER_EXPIRY,
  HEADER_SALT,
  isB64urlOfLength,
  isExpiryOption,
  isFileId,
  MAX_UPLOAD_BYTES,
  randomId,
} from "../shared/protocol.ts";
import type { ExpiryOption, UploadResult } from "../shared/protocol.ts";

export { FileVault } from "./vault.ts";

const FILE_ROUTE = /^\/api\/files\/([^/]+)$/;
const CLAIM_ROUTE = /^\/api\/files\/([^/]+)\/claim$/;
const MAX_CLAIM_BODY_BYTES = 1024;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "unhandled error",
          path: new URL(request.url).pathname,
          error: String(error),
        }),
      );
      return json({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/files") {
    return request.method === "POST" ? upload(request, env) : methodNotAllowed("POST");
  }

  const claimMatch = CLAIM_ROUTE.exec(pathname);
  if (claimMatch) {
    return request.method === "POST"
      ? claim(request, env, ctx, claimMatch[1] ?? "")
      : methodNotAllowed("POST");
  }

  const fileMatch = FILE_ROUTE.exec(pathname);
  if (fileMatch) {
    return request.method === "GET" ? info(env, fileMatch[1] ?? "") : methodNotAllowed("GET");
  }

  return json({ error: "not_found" }, 404);
}

async function upload(request: Request, env: Env): Promise<Response> {
  const parsed = parseUpload(request);
  if (parsed instanceof Response) {
    // Tell the runtime we won't read the body so the client isn't left streaming into a void.
    await request.body?.cancel();
    return parsed;
  }
  const { body, salt, authHash, expiry, length } = parsed;

  const id = randomId();
  const expiresAt = Date.now() + EXPIRY_OPTIONS[expiry] * 1000;
  await env.FILES.put(id, body);

  try {
    await vault(env, id).create({ r2Key: id, salt, authHash, size: length, expiresAt });
  } catch (error) {
    await env.FILES.delete(id);
    throw error;
  }

  console.log(JSON.stringify({ message: "file uploaded", size: length, expiry }));
  return json({ id, expiresAt } satisfies UploadResult, 201);
}

interface UploadParams {
  body: ReadableStream;
  salt: string;
  authHash: string;
  expiry: ExpiryOption;
  length: number;
}

function parseUpload(request: Request): UploadParams | Response {
  const salt = request.headers.get(HEADER_SALT);
  const authHash = request.headers.get(HEADER_AUTH_HASH);
  const expiry = request.headers.get(HEADER_EXPIRY);
  if (!isB64urlOfLength(salt, 16) || !isB64urlOfLength(authHash, 32) || !isExpiryOption(expiry)) {
    return json({ error: "invalid_request" }, 400);
  }

  const length = Number(request.headers.get("content-length"));
  if (!request.body || !Number.isInteger(length) || length <= 0) {
    return json({ error: "length_required" }, 411);
  }
  if (length > MAX_UPLOAD_BYTES) return json({ error: "too_large" }, 413);
  return { body: request.body, salt, authHash, expiry, length };
}

async function info(env: Env, id: string): Promise<Response> {
  if (!isFileId(id)) return json({ error: "gone" }, 404);
  const fileInfo = await vault(env, id).info();
  return fileInfo ? json(fileInfo) : json({ error: "gone" }, 404);
}

async function claim(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  if (!isFileId(id)) return json({ error: "gone", attemptsLeft: 0 }, 404);

  const length = Number(request.headers.get("content-length"));
  if (!Number.isInteger(length) || length > MAX_CLAIM_BODY_BYTES) {
    return json({ error: "invalid_request" }, 400);
  }
  const body: unknown = await request.json().catch(() => null);
  const authKey =
    typeof body === "object" && body !== null && "authKey" in body ? body.authKey : null;
  if (!isB64urlOfLength(authKey, 32)) return json({ error: "invalid_request" }, 400);

  const result = await vault(env, id).claim(authKey);
  if ("error" in result) {
    return json(result, result.error === "wrong_password" ? 401 : 404);
  }

  const object = await env.FILES.get(result.r2Key);
  if (!object) return json({ error: "gone", attemptsLeft: 0 }, 404);

  // Stream the ciphertext to the client and delete it as soon as the stream ends.
  const { readable, writable } = new FixedLengthStream(object.size);
  ctx.waitUntil(
    object.body
      .pipeTo(writable)
      .catch((error: unknown) => {
        console.warn(JSON.stringify({ message: "download interrupted", error: String(error) }));
      })
      .finally(() => env.FILES.delete(result.r2Key)),
  );
  console.log(JSON.stringify({ message: "file claimed", size: object.size }));

  return new Response(readable, {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}

function vault(env: Env, id: string) {
  return env.VAULT.get(env.VAULT.idFromName(id));
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function methodNotAllowed(allow: string): Response {
  return new Response(JSON.stringify({ error: "method_not_allowed" }), {
    status: 405,
    headers: { allow, "content-type": "application/json" },
  });
}
