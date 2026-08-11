// Boundary validation (spec §6.1): every repository write validates
// before persisting. Reject, don't clamp — a fat-fingered 1000 kg becomes
// a permanent PR that poisons every future comparison, and silently
// clamping it just replaces one wrong number with a different wrong
// number. A single small module since every bound in §6.1 lives in one
// table there; repositories from tasks 6 and 10 both import from here.

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function validateBodyweightKg(value: number): void {
  if (value < 20 || value > 400) {
    throw new ValidationError(`bodyweightKg must be between 20 and 400 (got ${value})`);
  }
}

export function validateWeightKg(value: number): void {
  if (value < 0 || value > 500) {
    throw new ValidationError(`weightKg must be between 0 and 500 (got ${value})`);
  }
}

export function validateReps(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new ValidationError(`reps must be an integer between 1 and 200 (got ${value})`);
  }
}

export function validateDurationSec(value: number): void {
  if (value < 1 || value > 86_400) {
    throw new ValidationError(`durationSec must be between 1 and 86400 (got ${value})`);
  }
}

// Half-point steps: 6, 6.5, 7, ..., 10.
export function validateRpe(value: number): void {
  const isHalfStep = Math.round(value * 2) === value * 2;
  if (value < 6 || value > 10 || !isHalfStep) {
    throw new ValidationError(`rpe must be between 6 and 10 in half-point steps (got ${value})`);
  }
}

export function validateLoggedAt(epochMs: number, nowMs: number = Date.now()): void {
  if (epochMs > nowMs + 60_000) {
    throw new ValidationError(`loggedAt cannot be more than 60s in the future (got ${epochMs}, now ${nowMs})`);
  }
}
