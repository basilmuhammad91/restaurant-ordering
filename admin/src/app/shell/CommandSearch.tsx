import { LogOut, Moon, Search, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { visibleNav } from "@/app/nav.config";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/lib/auth";
import { toPermissionSet } from "@/lib/permissions";

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
      <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page or run an action">
        <CommandInput placeholder="Type a page name…" />
        <CommandList>
          <CommandEmpty>No matching page.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.label} heading={g.label}>
              {g.items.map((i) => (
                <CommandItem key={i.to} value={`${g.label} ${i.label}`} onSelect={() => go(i.to)}>
                  <i.icon /> {i.label}
                  {i.soon && <span className="ml-auto text-xs text-muted-foreground">Soon</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => { setTheme(theme === "dark" ? "light" : "dark"); setOpen(false); }}>
              {theme === "dark" ? <Sun /> : <Moon />} Toggle dark mode
            </CommandItem>
            <CommandItem onSelect={() => { setOpen(false); void logout(); }}>
              <LogOut /> Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
