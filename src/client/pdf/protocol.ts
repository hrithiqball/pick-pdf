import type { UnlockOutcome } from "./qpdf.ts";

export interface UnlockRequest {
  id: number;
  input: ArrayBuffer;
  password: string;
}

export interface UnlockResponse {
  id: number;
  outcome: UnlockOutcome;
}
