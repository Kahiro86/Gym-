// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { createBodyweightRepository } from "../../../src/storage/repositories/bodyweightRepository.js";
import { useCurrentBodyweight } from "../../../src/app/hooks/useCurrentBodyweight.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

describe("useCurrentBodyweight", () => {
  it("falls back to a default when nothing has ever been logged", async () => {
    const db = new GymDatabase(uniqueDbName());
    const { result } = renderHook(() => useCurrentBodyweight(), { wrapper: withDatabase(db) });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.bodyweightKg).toBe(70);
    db.close();
  });

  it("resolves the nearest logged entry to now", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createBodyweightRepository(db).log({ bodyweightKg: 82, recordedAt: Date.now() - 1000 });

    const { result } = renderHook(() => useCurrentBodyweight(), { wrapper: withDatabase(db) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.bodyweightKg).toBe(82);
    db.close();
  });
});
