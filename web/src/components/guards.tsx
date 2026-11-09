import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import { EmptyState, Spinner } from "./ui";

// Route guards: like Laravel's `auth` and `can:admin` route middleware.
// Note this only hides UI: the API re-checks every request, which is what actually secures it.
export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== "ADMIN") {
    return <EmptyState title="Admins only">You don't have access to this page.</EmptyState>;
  }
  return <Outlet />;
}
