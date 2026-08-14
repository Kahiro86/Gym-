// One error class per failure kind (spec Layer 1 §8). Each carries the
// offending field/value so the message is never just "invalid input".

export class ValidationError extends Error {
  readonly field: string;
  readonly value: unknown;
  constructor(field: string, value: unknown, message: string) {
    super(`ValidationError: ${field} = ${JSON.stringify(value)} — ${message}`);
    this.name = "ValidationError";
    this.field = field;
    this.value = value;
  }
}

export class NotFoundError extends Error {
  readonly entity: string;
  readonly id: string;
  constructor(entity: string, id: string) {
    super(`NotFoundError: no ${entity} with id ${id}`);
    this.name = "NotFoundError";
    this.entity = entity;
    this.id = id;
  }
}

export class ConstraintError extends Error {
  readonly constraint: string;
  constructor(constraint: string, message: string) {
    super(`ConstraintError: ${constraint} — ${message}`);
    this.name = "ConstraintError";
    this.constraint = constraint;
  }
}

export class ConfirmationRequiredError extends Error {
  readonly action: string;
  constructor(action: string) {
    super(`ConfirmationRequiredError: ${action} requires { confirmed: true }`);
    this.name = "ConfirmationRequiredError";
    this.action = action;
  }
}

export class IllegalStateChangeError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(`IllegalStateChangeError: ${field} — ${message}`);
    this.name = "IllegalStateChangeError";
    this.field = field;
  }
}

export type DbError =
  | ValidationError
  | NotFoundError
  | ConstraintError
  | ConfirmationRequiredError
  | IllegalStateChangeError;

const CTORS: Record<string, new (...args: never[]) => Error> = {
  ValidationError,
  NotFoundError,
  ConstraintError,
  ConfirmationRequiredError,
  IllegalStateChangeError,
};

// Errors thrown inside the Worker cross a postMessage boundary as plain
// data; this rebuilds a real Error instance (with the right prototype and
// name) on the main-thread side of client.ts so callers can `instanceof` it.
export function reviveError(serialized: { name: string; message: string; extra?: Record<string, unknown> }): Error {
  const Ctor = CTORS[serialized.name];
  if (!Ctor) {
    const e = new Error(serialized.message);
    e.name = serialized.name;
    return e;
  }
  const e = Object.create(Ctor.prototype) as Error & Record<string, unknown>;
  e.message = serialized.message;
  e.name = serialized.name;
  if (serialized.extra) Object.assign(e, serialized.extra);
  return e;
}

export function serializeError(err: unknown): { name: string; message: string; extra?: Record<string, unknown> } {
  if (err instanceof ValidationError) return { name: err.name, message: err.message, extra: { field: err.field, value: err.value } };
  if (err instanceof NotFoundError) return { name: err.name, message: err.message, extra: { entity: err.entity, id: err.id } };
  if (err instanceof ConstraintError) return { name: err.name, message: err.message, extra: { constraint: err.constraint } };
  if (err instanceof ConfirmationRequiredError) return { name: err.name, message: err.message, extra: { action: err.action } };
  if (err instanceof IllegalStateChangeError) return { name: err.name, message: err.message, extra: { field: err.field } };
  if (err instanceof Error) return { name: err.name || "Error", message: err.message };
  return { name: "Error", message: String(err) };
}
