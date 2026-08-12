import { describe, it, expect } from "vitest";
import { describeError } from "../../src/app/errorMessage.js";

describe("describeError", () => {
  it("returns a storage-full message for a QuotaExceededError", () => {
    const err = new DOMException("quota exceeded", "QuotaExceededError");
    expect(describeError(err, "Failed to log set")).toBe("Storage is full — free up space and try again.");
  });

  it("falls back to the provided message for any other error", () => {
    expect(describeError(new Error("boom"), "Failed to log set")).toBe("Failed to log set");
    expect(describeError("not even an Error", "Failed to log set")).toBe("Failed to log set");
  });
});
