// The Worker RPC wire format, shared by both sides of the boundary so
// they cannot drift apart.
import type { SerializedError } from "./errors.js";

export interface RpcRequest {
  id: number;
  method: string;
  args: unknown[];
}

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: SerializedError };

/** Methods handled by the worker shell itself rather than the Repository. */
export const WORKER_LOCAL_METHODS = ["__setTestClock", "__getStatementCount", "__resetStatementCount"] as const;
