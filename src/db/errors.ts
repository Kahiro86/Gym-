// Typed errors (spec Layer 1 §8). Every one carries the offending field
// and value — "invalid input" is explicitly not an acceptable message.
//
// These cross a Worker postMessage boundary, where prototypes are lost, so
// each class is paired with serialize/revive so `instanceof` still works
// for callers on the main thread.

export class ValidationError extends Error {
  constructor(readonly field: string, readonly value: unknown, detail: string) {
    super(`ValidationError: ${field} = ${JSON.stringify(value) ?? String(value)} — ${detail}`);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(readonly entity: string, readonly entityId: string) {
    super(`NotFoundError: no ${entity} with id ${entityId}`);
    this.name = "NotFoundError";
  }
}

export class ConstraintError extends Error {
  constructor(readonly constraint: string, detail: string) {
    super(`ConstraintError: ${constraint} — ${detail}`);
    this.name = "ConstraintError";
  }
}

export class ConfirmationRequiredError extends Error {
  constructor(readonly action: string) {
    super(`ConfirmationRequiredError: ${action} is destructive and requires { confirmed: true }`);
    this.name = "ConfirmationRequiredError";
  }
}

export class IllegalStateChangeError extends Error {
  constructor(readonly field: string, detail: string) {
    super(`IllegalStateChangeError: ${field} — ${detail}`);
    this.name = "IllegalStateChangeError";
  }
}

/**
 * Layer 1b §7.5. Names both sides of the collision and which one won, so
 * a lost edit is explainable rather than merely gone.
 */
export class SyncConflictError extends Error {
  constructor(
    readonly table: string,
    readonly recordId: string,
    readonly localUpdatedAt: string,
    readonly remoteUpdatedAt: string,
    readonly winner: "local" | "remote",
  ) {
    super(
      `SyncConflictError: ${table}/${recordId} — local ${localUpdatedAt} vs ` +
      `remote ${remoteUpdatedAt}; ${winner} won`,
    );
    this.name = "SyncConflictError";
  }
}

export interface SerializedError {
  name: string;
  message: string;
  extra: Record<string, unknown>;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof ValidationError) return { name: err.name, message: err.message, extra: { field: err.field, value: err.value } };
  if (err instanceof NotFoundError) return { name: err.name, message: err.message, extra: { entity: err.entity, entityId: err.entityId } };
  if (err instanceof ConstraintError) return { name: err.name, message: err.message, extra: { constraint: err.constraint } };
  if (err instanceof ConfirmationRequiredError) return { name: err.name, message: err.message, extra: { action: err.action } };
  if (err instanceof IllegalStateChangeError) return { name: err.name, message: err.message, extra: { field: err.field } };
  if (err instanceof SyncConflictError) {
    return {
      name: err.name,
      message: err.message,
      extra: {
        table: err.table, recordId: err.recordId, localUpdatedAt: err.localUpdatedAt,
        remoteUpdatedAt: err.remoteUpdatedAt, winner: err.winner,
      },
    };
  }
  if (err instanceof Error) return { name: err.name || "Error", message: err.message, extra: {} };
  return { name: "Error", message: String(err), extra: {} };
}

const PROTOTYPES: Record<string, object> = {
  ValidationError: ValidationError.prototype,
  NotFoundError: NotFoundError.prototype,
  ConstraintError: ConstraintError.prototype,
  ConfirmationRequiredError: ConfirmationRequiredError.prototype,
  IllegalStateChangeError: IllegalStateChangeError.prototype,
  SyncConflictError: SyncConflictError.prototype,
};

export function reviveError(s: SerializedError): Error {
  const proto = PROTOTYPES[s.name];
  if (!proto) {
    const plain = new Error(s.message);
    plain.name = s.name;
    return plain;
  }
  const err = Object.create(proto) as Error;
  err.message = s.message;
  err.name = s.name;
  Object.assign(err, s.extra);
  return err;
}
