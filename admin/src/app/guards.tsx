import type { PermissionKey } from "@restoflux/contracts";
import { ShieldOff } from "lucide-react";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { EmptyState, FullPageSpinner } from "@/components/page/states";
import { useAuth } from "@/lib/auth";
import { ScopeProvider } from "@/lib/scope";
import { applyTheme } from "@/lib/theme";

/** Everything inside needs a login. Shows a spinner while the session is restored, the login page when anonymous. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <FullPageSpinner label="Restoring your session…" />;
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <ScopeProvider>
      <TenantTheme />
      <Outlet />
    </ScopeProvider>
  );
}

/** Applies the organization's saved colours (buttons, sidebar, corners) for as long as someone is signed in. */
function TenantTheme() {
  const { me } = useAuth();
  const theme = me?.tenant.theme;
  useEffect(() => {
    applyTheme(theme);
    return () => applyTheme(null); // signing out returns to the default look
  }, [theme]);
  return null;
}

/** Route guard by permission (any one of them). The API enforces the same rule; this just avoids a dead page. */
export function RequirePermission({ anyOf }: { anyOf: PermissionKey[] }) {
  const { canAny } = useAuth();
  if (!canAny(anyOf)) {
    return <EmptyState icon={<ShieldOff className="size-8" />} title="You don't have access to this page" description="Ask an administrator to grant you the permission, or use the menu to go somewhere else." />;
  }
  return <Outlet />;
}
