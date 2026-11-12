import { LogOut, Moon, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { visibleNav } from "@/app/nav.config";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { toPermissionSet } from "@/lib/permissions";

/**
 * How a typed phrase matches a page: every word must start a word of the page name (best), or appear inside it, or match its section.
 * (The library default is fuzzy and scatters letters, so "roles" used to match "Live orders".)
 */
export function matchPage(_value: string, search: string, keywords: string[] = []): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const label = (keywords[0] ?? "").toLowerCase();
  const section = (keywords[1] ?? "").toLowerCase();
  const labelWords = label.split(/[^a-z0-9]+/).filter(Boolean);
  const score: number[] = words.map((w) => (labelWords.some((lw) => lw.startsWith(w)) ? 1 : label.includes(w) ? 0.6 : section.includes(w) ? 0.2 : 0));
  return score.every((x) => x > 0) ? score.reduce((a, b) => a + b, 0) / words.length : 0;
}

/** Global search / command palette (Ctrl+K or Cmd+K): jump to any page you may use, or run a quick action. */
export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { me, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const groups = useMemo(() => visibleNav(toPermissionSet(me)), [me]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-2 text-muted-foreground sm:w-56 sm:justify-start" onClick={() => setOpen(true)} aria-label="Search">
        <Search className="size-4" />
        <span className="hidden sm:inline">Search pages…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 text-[10px] font-medium sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page or run an action" filter={matchPage}>
        <CommandInput placeholder="Type a page name…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.label} heading={g.label}>
              {g.items.map((i) => (
                <CommandItem key={i.to} value={i.to} keywords={[i.label, g.label]} onSelect={() => go(i.to)}>
                  <i.icon /> {i.label}
                  {i.soon && <span className="ml-auto text-xs text-muted-foreground">Soon</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem value="action-theme" keywords={["Toggle dark mode", "Actions"]} onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }}>
              {theme === "dark" ? <Sun /> : <Moon />} Toggle dark mode
            </CommandItem>
            <CommandItem value="action-signout" keywords={["Sign out", "Actions"]} onSelect={() => { setOpen(false); void logout(); }}>
              <LogOut /> Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
