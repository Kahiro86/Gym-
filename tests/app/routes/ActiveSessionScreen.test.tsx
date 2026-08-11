// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GymDatabase } from "../../../src/storage/db.js";
import { createSessionRepository } from "../../../src/storage/repositories/sessionRepository.js";
import { ActiveSessionScreen } from "../../../src/app/routes/ActiveSessionScreen.js";
import { uniqueDbName, withDatabase } from "../testDb.js";

function renderAt(db: GymDatabase, path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/session" element={<ActiveSessionScreen />} />
        <Route path="/start" element={<div>START SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
    { wrapper: withDatabase(db) }
  );
}

describe("ActiveSessionScreen", () => {
  it("renders once there is an active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    await createSessionRepository(db).create({ startedAt: Date.now() });
    renderAt(db, "/session");

    expect(await screen.findByRole("heading", { name: "Session in progress" })).toBeInTheDocument();
    db.close();
  });

  it("redirects to /start when there is no active session", async () => {
    const db = new GymDatabase(uniqueDbName());
    renderAt(db, "/session");

    expect(await screen.findByText("START SCREEN")).toBeInTheDocument();
    db.close();
  });
});
