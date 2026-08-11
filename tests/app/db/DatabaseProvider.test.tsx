// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DatabaseProvider } from "../../../src/app/db/DatabaseProvider.js";
import { useDatabase } from "../../../src/app/db/context.js";

function Probe() {
  const { db, degraded } = useDatabase();
  return (
    <div>
      <span>ready</span>
      <span data-testid="degraded">{String(degraded)}</span>
      <span data-testid="db-name">{db.name}</span>
    </div>
  );
}

describe("DatabaseProvider", () => {
  it("renders nothing until the database opens, then provides it to descendants", async () => {
    render(
      <DatabaseProvider>
        <Probe />
      </DatabaseProvider>
    );

    await waitFor(() => expect(screen.getByText("ready")).toBeInTheDocument());
    expect(screen.getByTestId("db-name").textContent).toBe("gymxp");
    expect(screen.getByTestId("degraded").textContent).toBe("false");
  });
});
