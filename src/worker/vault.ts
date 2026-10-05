import { DurableObject } from "cloudflare:workers";
import { fromB64url, MAX_ATTEMPTS, sha256 } from "../shared/protocol.ts";
import type { ClaimRejection, FileInfo } from "../shared/protocol.ts";

interface VaultRecord {
  r2Key: string;
  salt: string;
  authHash: string;
  size: number;
  expiresAt: number;
  attempts: number;
  claimed: boolean;
}

export type ClaimResult = { ok: true; r2Key: string; size: number } | ClaimRejection;

/** Grace period for the Worker to finish streaming a claimed file before the sweeper runs. */
const CLAIM_SWEEP_MS = 10 * 60 * 1000;
const KEY = "record";

/**
 * One instance per uploaded file. Durable Objects process one event at a time, so the
 * "check password, then mark as claimed" sequence is atomic: a file can be claimed once.
 */
export class FileVault extends DurableObject<Env> {
  async create(record: Omit<VaultRecord, "attempts" | "claimed">): Promise<void> {
    if (await this.ctx.storage.get(KEY)) throw new Error("Vault already initialised");
    await this.ctx.storage.put<VaultRecord>(KEY, { ...record, attempts: 0, claimed: false });
    await this.ctx.storage.setAlarm(record.expiresAt);
  }

  async info(): Promise<FileInfo | null> {
    const record = await this.live();
    if (!record) return null;
    return {
      salt: record.salt,
      size: record.size,
      expiresAt: record.expiresAt,
      attemptsLeft: MAX_ATTEMPTS - record.attempts,
    };
  }

  async claim(authKey: string): Promise<ClaimResult> {
    const record = await this.live();
    if (!record) return { error: "gone", attemptsLeft: 0 };

    const presented = await sha256(fromB64url(authKey));
    const expected = fromB64url(record.authHash);
    const matches =
      presented.byteLength === expected.byteLength &&
      crypto.subtle.timingSafeEqual(presented, expected);

    if (matches) {
      // Mark claimed immediately; the Worker deletes the blob once streamed and the
      // alarm sweeps up anything left behind if that stream is interrupted.
      await this.ctx.storage.put<VaultRecord>(KEY, { ...record, claimed: true });
      await this.ctx.storage.setAlarm(Date.now() + CLAIM_SWEEP_MS);
      return { ok: true, r2Key: record.r2Key, size: record.size };
    }

    const attempts = record.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.destroy(record);
      return { error: "destroyed", attemptsLeft: 0 };
    }
    await this.ctx.storage.put<VaultRecord>(KEY, { ...record, attempts });
    return { error: "wrong_password", attemptsLeft: MAX_ATTEMPTS - attempts };
  }

  override async alarm(): Promise<void> {
    const record = await this.ctx.storage.get<VaultRecord>(KEY);
    if (record) await this.destroy(record);
  }

  /** The record if it can still be downloaded; expired records are destroyed on access. */
  private async live(): Promise<VaultRecord | null> {
    const record = await this.ctx.storage.get<VaultRecord>(KEY);
    if (!record || record.claimed) return null;
    if (record.expiresAt <= Date.now()) {
      await this.destroy(record);
      return null;
    }
    return record;
  }

  private async destroy(record: VaultRecord): Promise<void> {
    await this.env.FILES.delete(record.r2Key);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
