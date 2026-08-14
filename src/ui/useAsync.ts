import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

/**
 * Runs an async read and exposes its three real states.
 *
 * There is deliberately no fourth "silently empty" state: a failure
 * becomes `error` and is rendered, never swallowed into a blank screen
 * (non-negotiable #6). `reload` refetches without dropping back to the
 * skeleton, so a tap that rewrites one cell does not blank the table.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const alive = useRef(true);
  // Keep the newest loader without making it a dependency of the effect,
  // so an inline arrow function does not retrigger the fetch every render.
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const run = useCallback(async () => {
    try {
      const data = await loadRef.current();
      if (alive.current) setState({ status: "ready", data });
    } catch (err) {
      if (alive.current) setState({ status: "error", error: err instanceof Error ? err : new Error(String(err)) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}
