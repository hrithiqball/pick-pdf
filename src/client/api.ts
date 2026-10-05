import { HEADER_AUTH_HASH, HEADER_EXPIRY, HEADER_SALT } from "../shared/protocol.ts";
import type { ClaimRejection, ExpiryOption, FileInfo, UploadResult } from "../shared/protocol.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

interface UploadParams {
  body: Uint8Array<ArrayBuffer>;
  salt: string;
  authHash: string;
  expiry: ExpiryOption;
  onProgress: (fraction: number) => void;
}

/** XHR rather than fetch so we get upload progress events. */
export function uploadFile({
  body,
  salt,
  authHash,
  expiry,
  onProgress,
}: UploadParams): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader(HEADER_SALT, salt);
    xhr.setRequestHeader(HEADER_AUTH_HASH, authHash);
    xhr.setRequestHeader(HEADER_EXPIRY, expiry);
    xhr.responseType = "json";
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener("load", () => {
      const data: unknown = xhr.response;
      if (xhr.status === 201 && isUploadResult(data)) resolve(data);
      else reject(new ApiError(xhr.status, errorCode(data)));
    });
    xhr.addEventListener("error", () => reject(new ApiError(0, "network_error")));
    xhr.send(body);
  });
}

export async function getFileInfo(id: string): Promise<FileInfo | null> {
  const response = await fetch(`/api/files/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, errorCode(await safeJson(response)));
  const data = await safeJson(response);
  if (!isFileInfo(data)) throw new ApiError(response.status, "invalid_response");
  return data;
}

export type ClaimOutcome =
  | { ok: true; payload: Uint8Array<ArrayBuffer> }
  | ({ ok: false } & ClaimRejection);

export async function claimFile(id: string, authKey: string): Promise<ClaimOutcome> {
  const response = await fetch(`/api/files/${encodeURIComponent(id)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ authKey }),
  });
  if (response.ok) return { ok: true, payload: new Uint8Array(await response.arrayBuffer()) };
  const data = await safeJson(response);
  if ((response.status === 401 || response.status === 404) && isClaimRejection(data)) {
    return { ok: false, ...data };
  }
  throw new ApiError(response.status, errorCode(data));
}

function isUploadResult(data: unknown): data is UploadResult {
  return typeof data === "object" && data !== null && "id" in data && "expiresAt" in data;
}

function isFileInfo(data: unknown): data is FileInfo {
  return (
    typeof data === "object" &&
    data !== null &&
    "salt" in data &&
    typeof data.salt === "string" &&
    "size" in data &&
    typeof data.size === "number" &&
    "expiresAt" in data &&
    typeof data.expiresAt === "number" &&
    "attemptsLeft" in data &&
    typeof data.attemptsLeft === "number"
  );
}

function isClaimRejection(data: unknown): data is ClaimRejection {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    (data.error === "wrong_password" || data.error === "gone" || data.error === "destroyed") &&
    "attemptsLeft" in data &&
    typeof data.attemptsLeft === "number"
  );
}

function errorCode(data: unknown): string {
  return typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string"
    ? data.error
    : "unknown_error";
}

async function safeJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}
