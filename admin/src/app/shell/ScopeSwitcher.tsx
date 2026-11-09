import { Building2, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useAll } from "@/lib/queries";
import { useScope } from "@/lib/scope";

interface Brand {
  id: string;
  name: string;
}

/** Brand + branch switcher: what the rest of the app (lists, dashboard, reports) is filtered to. */
export function ScopeSwitcher() {
  const { can } = useAuth();
  const scope = useScope();
  const brands = useAll<Brand>("/brands", {}, can("org.view"));

  const total = scope.availableLocations.length;
  const selected = scope.locationIds.length;
  const brandName = scope.brandId ? brands.data?.find((b) => b.id === scope.brandId)?.name : null;
  const label =
    selected === 1
      ? scope.availableLocations.find((l) => l.id === scope.locationIds[0])?.name ?? "1 branch"
      : selected > 1
        ? `${selected} branches`
        : `${brandName ?? "All brands"} · ${total} ${total === 1 ? "branch" : "branches"}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[240px] justify-between gap-2" aria-label="Choose brand and branches">
          <Building2 className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        {brands.data && brands.data.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Brand</Label>
            <Select value={scope.brandId ?? "__all__"} onValueChange={(v) => scope.setBrand(v === "__all__" ? null : v)}>
              <SelectTrigger className="w-full" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All brands</SelectItem>
                {brands.data.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Branches</Label>
            {selected > 0 && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => scope.setLocations([])}>
                Clear
              </button>
            )}
          </div>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {scope.availableLocations.length === 0 && <p className="py-2 text-sm text-muted-foreground">No branches available to you.</p>}
            {scope.availableLocations.map((l) => (
              <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                <Checkbox
                  checked={scope.locationIds.includes(l.id)}
                  onCheckedChange={(c) => scope.setLocations(c ? [...scope.locationIds, l.id] : scope.locationIds.filter((x) => x !== l.id))}
                />
                <span className="truncate">{l.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{l.currencyCode}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{selected === 0 ? "Showing all your branches." : `Showing ${selected} selected.`}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
