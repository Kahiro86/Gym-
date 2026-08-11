import { Navigate } from "react-router-dom";
import { useSession } from "../hooks/useSession.js";

// A session's logging UI is Tasks 6-7's job. This route exists now so the
// Start sheet (Task 5) has somewhere to navigate a newly created or
// resumed session into — there is at most one in_progress session at a
// time (sessionRepository enforces it), so this route takes no params.
export function ActiveSessionScreen() {
  const { loading, check } = useSession();

  if (loading) return null;
  if (!check) return <Navigate to="/start" replace />;

  return (
    <section>
      <h1>Session in progress</h1>
      <p>Logging screen coming soon.</p>
    </section>
  );
}
