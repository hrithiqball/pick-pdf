import type { LockOptions, LockOutcome, PdfStatus, UnlockOutcome } from "./qpdf.ts";

export type PdfJob =
  | { op: "inspect" }
  | { op: "unlock"; password: string }
  | { op: "lock"; options: LockOptions };

export interface JobResults {
  inspect: PdfStatus;
  unlock: UnlockOutcome;
  lock: LockOutcome;
}

type Op = PdfJob["op"];

export type PdfRequest = PdfJob & { id: number; input: ArrayBuffer };

/** Tagged with `op` so the caller can narrow `result` to that job's result type. */
export type PdfResponse = { [K in Op]: { id: number; op: K; result: JobResults[K] } }[Op];
