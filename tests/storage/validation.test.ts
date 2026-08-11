import { describe, it, expect } from "vitest";
import {
  ValidationError,
  validateBodyweightKg,
  validateWeightKg,
  validateReps,
  validateDurationSec,
  validateRpe,
  validateLoggedAt,
} from "../../src/storage/validation.js";

describe("validation", () => {
  describe("validateBodyweightKg", () => {
    it("accepts the boundary values", () => {
      expect(() => validateBodyweightKg(20)).not.toThrow();
      expect(() => validateBodyweightKg(400)).not.toThrow();
    });
    it("rejects out-of-bounds values", () => {
      expect(() => validateBodyweightKg(19.9)).toThrow(ValidationError);
      expect(() => validateBodyweightKg(400.1)).toThrow(ValidationError);
    });
  });

  describe("validateWeightKg", () => {
    it("accepts the boundary values", () => {
      expect(() => validateWeightKg(0)).not.toThrow();
      expect(() => validateWeightKg(500)).not.toThrow();
    });
    it("rejects out-of-bounds values", () => {
      expect(() => validateWeightKg(-1)).toThrow(ValidationError);
      expect(() => validateWeightKg(500.1)).toThrow(ValidationError);
    });
  });

  describe("validateReps", () => {
    it("accepts the boundary values", () => {
      expect(() => validateReps(1)).not.toThrow();
      expect(() => validateReps(200)).not.toThrow();
    });
    it("rejects out-of-bounds and non-integer values", () => {
      expect(() => validateReps(0)).toThrow(ValidationError);
      expect(() => validateReps(201)).toThrow(ValidationError);
      expect(() => validateReps(5.5)).toThrow(ValidationError);
    });
  });

  describe("validateDurationSec", () => {
    it("accepts the boundary values", () => {
      expect(() => validateDurationSec(1)).not.toThrow();
      expect(() => validateDurationSec(86_400)).not.toThrow();
    });
    it("rejects out-of-bounds values", () => {
      expect(() => validateDurationSec(0)).toThrow(ValidationError);
      expect(() => validateDurationSec(86_401)).toThrow(ValidationError);
    });
  });

  describe("validateRpe", () => {
    it("accepts half-point steps within bounds", () => {
      expect(() => validateRpe(6)).not.toThrow();
      expect(() => validateRpe(7.5)).not.toThrow();
      expect(() => validateRpe(10)).not.toThrow();
    });
    it("rejects out-of-bounds and non-half-point values", () => {
      expect(() => validateRpe(5.5)).toThrow(ValidationError);
      expect(() => validateRpe(10.5)).toThrow(ValidationError);
      expect(() => validateRpe(7.3)).toThrow(ValidationError);
    });
  });

  describe("validateLoggedAt", () => {
    it("accepts the present and the past", () => {
      expect(() => validateLoggedAt(1000, 1000)).not.toThrow();
      expect(() => validateLoggedAt(0, 1000)).not.toThrow();
    });
    it("accepts up to 60s in the future", () => {
      expect(() => validateLoggedAt(1000 + 60_000, 1000)).not.toThrow();
    });
    it("rejects more than 60s in the future", () => {
      expect(() => validateLoggedAt(1000 + 60_001, 1000)).toThrow(ValidationError);
    });
  });
});
