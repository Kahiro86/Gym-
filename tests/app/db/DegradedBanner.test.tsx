// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GymDatabase } from "../../../src/storage/db.js";
import { DatabaseContext } from "../../../src/app/db/context.js";
import { DegradedBanner } from "../../../src/app/db/DegradedBanner.js";
import { uniqueDbName } from "../testDb.js";

function renderWithDegraded(degraded: boolean) {
  const db = new GymDatabase(uniqueDbName());
  render(
    <DatabaseContext.Provider value={{ db, degraded }}>
      <DegradedBanner />
    </DatabaseContext.Provider>
  );
  return db;
}

describe("DegradedBanner", () => {
  it("renders nothing when storage is not degraded", () => {
    const db = renderWithDegraded(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    db.close();
  });

  it("shows a persistent warning when storage is degraded", () => {
    const db = renderWithDegraded(true);
    expect(screen.getByRole("alert")).toHaveTextContent(/nothing you log will be saved/i);
    db.close();
  });
});
