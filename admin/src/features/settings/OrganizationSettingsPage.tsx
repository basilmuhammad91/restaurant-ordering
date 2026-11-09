import { DEFAULT_THEME_PRIMARY, THEME_PRESETS, THEME_RADII, themeSchema, type Theme } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { titleCase } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { useInvalidate } from "@/lib/queries";
import { applyTheme } from "@/lib/theme";

interface TenantDto {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  status: string;
  plan: string;
  maxLocations: number | null;
  maxUsers: number | null;
  theme: Theme;
}

const sameTheme = (a: Theme, b: Theme) => JSON.stringify([a.primary ?? null, a.sidebar ?? null, a.radius ?? null]) === JSON.stringify([b.primary ?? null, b.sidebar ?? null, b.radius ?? null]);

/** A colour input: the native picker plus a hex box, both editing the same value. */
function ColorField({ id, label, hint, value, onChange, disabled, allowEmpty }: { id: string; label: string; hint: string; value: string | undefined; onChange: (v: string | undefined) => void; disabled: boolean; allowEmpty?: boolean }) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const commit = (v: string) => {
    setText(v);
    if (v === "" && allowEmpty) onChange(undefined);
    else if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${label} picker`} disabled={disabled} value={value ?? "#ffffff"} onChange={(e) => commit(e.target.value)} className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 disabled:cursor-not-allowed" />
        <Input id={id} value={text} disabled={disabled} placeholder={allowEmpty ? "Follows light / dark mode" : "#b01e28"} onChange={(e) => commit(e.target.value.trim())} className="font-mono" aria-invalid={!!text && !/^#[0-9a-fA-F]{6}$/.test(text)} />
        {allowEmpty && value && !disabled && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>Clear</Button>}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export default function OrganizationSettingsPage() {
  const me = useMe();
  const { can, refreshMe } = useAuth();
  const canEdit = can("org.manage");
  const invalidate = useInvalidate();

  const tenant = useQuery({ queryKey: ["/tenant"], queryFn: async () => (await api.get<{ data: TenantDto }>("/tenant")).data });
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Theme>({});
  const saved = me.tenant.theme;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  useEffect(() => {
    if (!tenant.data) return;
    setName(tenant.data.name);
    setDraft(themeSchema.catch({}).parse(tenant.data.theme ?? {}));
  }, [tenant.data]);

  // Live preview: the whole app re-skins as you edit. Leaving the page without saving restores the saved look.
  useEffect(() => {
    applyTheme(draft);
  }, [draft]);
  useEffect(() => () => applyTheme(savedRef.current), []);

  const onSaved = async () => {
    await Promise.all([invalidate("/tenant"), refreshMe()]);
  };
  const saveTheme = useMutation({
    mutationFn: (theme: Theme) => api.patch("/tenant", { theme }),
    onSuccess: async () => { toast.success("Appearance saved for everyone in your organization"); await onSaved(); },
    onError: (e) => toast.error(e instanceof ApiError && e.status === 422 ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.message) : errorMessage(e)),
  });
  const saveName = useMutation({
    mutationFn: () => api.patch("/tenant", { name: name.trim() }),
    onSuccess: async () => { toast.success("Company name updated"); await onSaved(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (tenant.isPending) return <LoadingRows />;
  if (tenant.isError) return <ErrorState message={errorMessage(tenant.error)} onRetry={() => tenant.refetch()} />;
  const t = tenant.data;
  const dirty = !sameTheme(draft, saved);
  const set = (patch: Partial<Theme>) => setDraft((d) => {
    const next = { ...d, ...patch };
    for (const k of Object.keys(next) as (keyof Theme)[]) if (next[k] === undefined) delete next[k];
    return next;
  });

  return (
    <>
      <PageHeader title="Organization" description="Your company profile and how the dashboard looks for everyone on your team." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Pick your brand colours. The whole dashboard updates as you choose, and nothing is saved until you press Save. Text colours adjust automatically so everything stays readable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <Label className="mb-2 block">Start from a preset</Label>
                <div className="flex flex-wrap gap-2">
                  {THEME_PRESETS.map((p) => {
                    const active = sameTheme(draft, p.theme);
                    return (
                      <button key={p.name} type="button" disabled={!canEdit} onClick={() => setDraft({ ...p.theme })} aria-pressed={active}
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-primary ring-2 ring-primary/30" : ""}`}>
                        <span className="size-4 rounded-full border" style={{ background: p.theme.primary }} />
                        {p.name}
                        {active && <Check className="size-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ColorField id="theme-primary" label="Brand colour" hint="Buttons, links, focus rings and the active menu item." value={draft.primary ?? DEFAULT_THEME_PRIMARY} onChange={(v) => set({ primary: v })} disabled={!canEdit} />
                <ColorField id="theme-sidebar" label="Sidebar colour" hint="Optional. Leave empty to follow light and dark mode." value={draft.sidebar} onChange={(v) => set({ sidebar: v })} disabled={!canEdit} allowEmpty />
              </div>

              <div>
                <Label className="mb-2 block">Corners</Label>
                <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Corner style">
                  {THEME_RADII.map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={(draft.radius ?? "default") === r} disabled={!canEdit} onClick={() => set({ radius: r })}
                      className={`rounded-md px-4 py-1.5 text-sm transition-colors disabled:cursor-not-allowed ${(draft.radius ?? "default") === r ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                      {titleCase(r)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Primary button</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Badge>Badge</Badge>
                  <a className="text-sm text-primary underline-offset-4 hover:underline" href="#preview" onClick={(e) => e.preventDefault()}>A link</a>
                  <Input className="max-w-40" placeholder="Focus me" />
                </div>
              </div>

              {canEdit ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!dirty || saveTheme.isPending} onClick={() => saveTheme.mutate(draft)}>{saveTheme.isPending ? "Saving…" : "Save appearance"}</Button>
                  <Button variant="outline" disabled={saveTheme.isPending || (Object.keys(draft).length === 0 && Object.keys(saved).length === 0)} onClick={() => { setDraft({}); saveTheme.mutate({}); }}><RotateCcw /> Reset to Restoflux default</Button>
                  {dirty && <Button variant="ghost" onClick={() => setDraft(saved)}>Discard changes</Button>}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">You can see the current look. Ask an administrator with the Organization permission to change it.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Company</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="co-name">Company name</Label>
                <Input id="co-name" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} />
                {canEdit && <Button size="sm" className="mt-1" disabled={!name.trim() || name.trim() === t.name || saveName.isPending} onClick={() => saveName.mutate()}>Save name</Button>}
              </div>
              <dl className="space-y-2 text-sm">
                <Row k="Web address" v={t.slug} />
                <Row k="Currency" v={t.baseCurrency} />
                <Row k="Plan" v={titleCase(t.plan)} />
                <Row k="Status" v={titleCase(t.status)} />
                <Row k="Branch limit" v={t.maxLocations ?? "Unlimited"} />
                <Row k="User limit" v={t.maxUsers ?? "Unlimited"} />
              </dl>
              <p className="text-xs text-muted-foreground">Plan, limits and status are managed by the Restoflux team.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
