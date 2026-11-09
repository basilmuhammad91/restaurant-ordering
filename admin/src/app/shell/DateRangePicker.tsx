import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PRESET_LABELS, rangeForPreset, useScope, type RangePreset } from "@/lib/scope";

const PRESETS: Exclude<RangePreset, "custom">[] = ["today", "yesterday", "last7", "last30", "thisMonth"];

/** The global date range. Reports use it; days are interpreted in each branch's own timezone by the API. */
export function DateRangePicker() {
  const { range, setRange } = useScope();
  const fmt = (d: string) => format(parseISO(d), "d MMM");
  const label = range.preset === "custom" ? `${fmt(range.from)} - ${fmt(range.to)}` : PRESET_LABELS[range.preset];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Choose date range">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="hidden sm:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3">
        <div className="grid gap-1">
          {PRESETS.map((p) => (
            <Button key={p} variant={range.preset === p ? "secondary" : "ghost"} size="sm" className="justify-start" onClick={() => setRange(rangeForPreset(p))}>
              {PRESET_LABELS[p]}
            </Button>
          ))}
        </div>
        <div className="space-y-2 border-t pt-3">
          <Label className="text-xs text-muted-foreground">Custom range</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ preset: "custom", from: e.target.value, to: range.to })} />
            <Input type="date" aria-label="To" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ preset: "custom", from: range.from, to: e.target.value })} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
