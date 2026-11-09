import { Compass, Hammer } from "lucide-react";
import { Link, useLocation } from "react-router";
import { allNavItems } from "@/app/nav.config";
import { PageHeader } from "@/components/page/PageHeader";
import { EmptyState } from "@/components/page/states";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

/** For modules that appear in the navigation but are built in a later phase. */
export function ComingSoonPage() {
  const { pathname } = useLocation();
  const item = allNavItems().find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
  if (!item) return <NotFoundPage />;
  return (
    <>
      <PageHeader title={item.label} />
      <EmptyState icon={<Hammer className="size-8" />} title="This module is coming soon" description={`${item.group} is being built step by step. ${item.label} will appear here when its phase is complete.`} action={<Button variant="outline" asChild><Link to="/">Back to dashboard</Link></Button>} />
    </>
  );
}

export function NotFoundPage() {
  return <EmptyState icon={<Compass className="size-8" />} title="Page not found" description="The page you are looking for doesn't exist or has moved." action={<Button variant="outline" asChild><Link to="/">Back to dashboard</Link></Button>} />;
}

/** The home page for people without dashboard access (kitchen staff, riders ...). */
export function WelcomePage() {
  const { me } = useAuth();
  return (
    <>
      <PageHeader title={`Welcome, ${me?.user.name.split(" ")[0] ?? ""}`} description={me?.tenant.name} />
      <EmptyState title="Use the menu to get started" description="The sections you can use are listed in the sidebar." />
    </>
  );
}
