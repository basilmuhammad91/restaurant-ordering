import { EmptyState } from "../components/ui";

// Placeholder for admin sections that are in the navigation but not built yet.
export default function ComingSoonPage({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-6 text-3xl font-extrabold tracking-tight">{title}</h1>
      <EmptyState title="Coming soon">This section isn't built yet.</EmptyState>
    </>
  );
}
