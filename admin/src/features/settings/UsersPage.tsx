import { USER_STATUSES, userCreateSchema, userUpdateSchema } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { fmtDateTime, titleCase } from "@/components/cells";
import { CrudPage } from "@/components/crud/CrudPage";
import type { FieldDef } from "@/components/crud/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, api, errorMessage, type Cursored } from "@/lib/api";
import { useAll, useInvalidate } from "@/lib/queries";

interface UserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: (typeof USER_STATUSES)[number];
  allLocations: boolean;
  locationIds: string[];
  roles: { id: string; name: string; isOwner: boolean }[];
  hasPin: boolean;
  lastLoginAt: string | null;
  deletedAt: string | null;
}
interface Role { id: string; name: string }
interface Loc { id: string; name: string }

const statusVariant = { ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", INVITED: "bg-amber-500/15 text-amber-700 dark:text-amber-400", DISABLED: "bg-muted text-muted-foreground" } as const;

const columns: ColumnDef<UserRow, any>[] = [
  {
    accessorKey: "name", header: "User", meta: { sortKey: "name", label: "Name" },
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="text-xs text-muted-foreground">{row.original.email}</div>
      </div>
    ),
  },
  {
    id: "roles", header: "Roles", meta: { label: "Roles" }, accessorFn: (r) => r.roles.map((x) => x.name).join(", "),
    cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Badge key={r.id} variant={r.isOwner ? "default" : "outline"}>{r.name}</Badge>)}</div>,
  },
  { id: "branches", header: "Branches", meta: { label: "Branches" }, accessorFn: (r) => (r.allLocations ? "All branches" : `${r.locationIds.length} branch${r.locationIds.length === 1 ? "" : "es"}`) },
  { accessorKey: "status", header: "Status", cell: ({ getValue }) => <Badge variant="secondary" className={statusVariant[getValue() as keyof typeof statusVariant]}>{titleCase(getValue())}</Badge> },
  { accessorKey: "lastLoginAt", header: "Last sign-in", meta: { sortKey: "lastLoginAt", label: "Last sign-in" }, cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{getValue() ? fmtDateTime(getValue()) : "Never"}</span> },
];

function Checklist({ items, selected, onChange }: { items: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border p-2">
      {items.length === 0 && <p className="p-2 text-sm text-muted-foreground">Nothing to choose from.</p>}
      {items.map((i) => (
        <label key={i.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
          <Checkbox checked={selected.includes(i.id)} onCheckedChange={(c) => onChange(c ? [...selected, i.id] : selected.filter((x) => x !== i.id))} />
          {i.name}
        </label>
      ))}
    </div>
  );
}

/** Everything about one user's access, shown under the edit form. Each block saves on its own. */
function UserAccess({ user }: { user: UserRow }) {
  const roles = useAll<Role>("/roles");
  const locations = useAll<Loc>("/locations");
  const invalidate = useInvalidate();
  const [roleIds, setRoleIds] = useState(user.roles.map((r) => r.id));
  const [allLocations, setAllLocations] = useState(user.allLocations);
  const [locationIds, setLocationIds] = useState(user.locationIds);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");

  const done = (msg: string) => async () => { toast.success(msg); await invalidate("/users"); };
  const fail = (e: unknown) => toast.error(e instanceof ApiError && e.status === 422 ? (Object.values(e.fieldErrors)[0]?.[0] ?? e.message) : errorMessage(e));

  const saveRoles = useMutation({ mutationFn: () => api.put(`/users/${user.id}/roles`, { roleIds }), onSuccess: done("Roles updated. They apply on the user's next request."), onError: fail });
  const saveLocations = useMutation({ mutationFn: () => api.put(`/users/${user.id}/locations`, { allLocations, locationIds }), onSuccess: done("Branch access updated"), onError: fail });
  const reset = useMutation({ mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }), onSuccess: () => { setPassword(""); toast.success("Password reset. The user was signed out everywhere."); }, onError: fail });
  const setPinM = useMutation({ mutationFn: () => api.put(`/users/${user.id}/pin`, { pin }), onSuccess: async () => { setPin(""); await done("POS PIN set")(); }, onError: fail });

  const sessions = useQuery({ queryKey: ["/users", "sessions", user.id], queryFn: async () => (await api.get<{ data: { id: string; ip: string | null; userAgent: string | null; lastUsedAt: string }[] }>(`/users/${user.id}/sessions`)).data });
  const history = useQuery({ queryKey: ["/users", "history", user.id], queryFn: () => api.get<Cursored<{ id: string; success: boolean; failureReason: string | null; ip: string | null; occurredAt: string }>>(`/users/${user.id}/login-history`, { limit: 5 }) });
  const revoke = useMutation({ mutationFn: (sid: string) => api.del(`/users/${user.id}/sessions/${sid}`), onSuccess: () => { toast.success("Session signed out"); void sessions.refetch(); }, onError: fail });

  return (
    <>
      <section className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Roles</h3>
        <Checklist items={roles.data ?? []} selected={roleIds} onChange={setRoleIds} />
        <Button size="sm" onClick={() => saveRoles.mutate()} disabled={saveRoles.isPending || roleIds.length === 0}>Save roles</Button>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Branch access</h3>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <Label htmlFor="all-loc" className="cursor-pointer">Can see every branch</Label>
          <Switch id="all-loc" checked={allLocations} onCheckedChange={setAllLocations} />
        </div>
        {!allLocations && <Checklist items={locations.data ?? []} selected={locationIds} onChange={setLocationIds} />}
        <Button size="sm" onClick={() => saveLocations.mutate()} disabled={saveLocations.isPending}>Save branch access</Button>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h3 className="font-semibold">Sign-in and POS</h3>
        <div className="flex items-end gap-2">
          <div className="grow space-y-1.5"><Label htmlFor="reset-pw">New password</Label><Input id="reset-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" /></div>
          <Button variant="outline" onClick={() => reset.mutate()} disabled={reset.isPending || password.length < 10}>Reset password</Button>
        </div>
        <div className="flex items-end gap-2">
          <div className="grow space-y-1.5"><Label htmlFor="pin">POS PIN {user.hasPin && <Badge variant="secondary" className="ml-1">set</Badge>}</Label><Input id="pin" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="4 to 8 digits" /></div>
          <Button variant="outline" onClick={() => setPinM.mutate()} disabled={setPinM.isPending || pin.length < 4}>{user.hasPin ? "Change PIN" : "Set PIN"}</Button>
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <h3 className="font-semibold">Active sessions</h3>
        {sessions.data?.length === 0 && <p className="text-sm text-muted-foreground">Not signed in anywhere.</p>}
        {sessions.data?.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">{s.userAgent ?? "Unknown device"}</div>
              <div className="text-xs text-muted-foreground">{s.ip ?? "?"} · last used {fmtDateTime(s.lastUsedAt)}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => revoke.mutate(s.id)}>Sign out</Button>
          </div>
        ))}
        <h3 className="pt-2 font-semibold">Recent sign-ins</h3>
        {history.data?.data.map((h) => (
          <div key={h.id} className="flex items-center justify-between text-sm">
            <span>{h.success ? "Signed in" : `Failed (${h.failureReason?.replace(/_/g, " ")})`}</span>
            <span className="text-xs text-muted-foreground">{h.ip ?? ""} · {fmtDateTime(h.occurredAt)}</span>
          </div>
        ))}
      </section>
    </>
  );
}

export default function UsersPage() {
  const roles = useAll<Role>("/roles");
  const locations = useAll<Loc>("/locations");

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: "name", label: "Full name", type: "text", required: true, span: 1 },
      { name: "email", label: "Email", type: "email", required: true, span: 1, mode: "create", hint: "They sign in with this." },
      { name: "phone", label: "Phone", type: "text", nullable: true, span: 1 },
      { name: "password", label: "Initial password", type: "password", required: true, span: 1, mode: "create", hint: "At least 10 characters (12 for roles with financial access). Share it securely." },
      { name: "status", label: "Status", type: "select", span: 1, mode: "edit", options: USER_STATUSES.map((s) => ({ value: s, label: titleCase(s) })), hint: "Disabling signs the user out immediately." },
      { name: "roleIds", label: "Roles", type: "multicheck", required: true, mode: "create", options: (roles.data ?? []).map((r) => ({ value: r.id, label: r.name })) },
      { name: "allLocations", label: "Can see every branch", type: "switch", mode: "create" },
      { name: "locationIds", label: "Branches", type: "multicheck", mode: "create", options: (locations.data ?? []).map((l) => ({ value: l.id, label: l.name })), hint: "Ignored when 'every branch' is on." },
    ],
    [roles.data, locations.data],
  );

  return (
    <CrudPage<UserRow>
      title="Users" description="Staff accounts. Roles decide what a person can do; branch access decides where." entity="user" path="/users"
      columns={columns} defaultSort="name" fields={fields} createSchema={userCreateSchema} updateSchema={userUpdateSchema}
      defaults={{ name: "", email: "", phone: "", password: "", roleIds: [], allLocations: false, locationIds: [], status: "ACTIVE" }}
      writePermission="users.manage" wide
      filters={[{ key: "status", label: "Status", options: USER_STATUSES.map((s) => ({ value: s, label: titleCase(s) })) }, ...(roles.data ? [{ key: "roleId", label: "Role", options: roles.data.map((r) => ({ value: r.id, label: r.name })) }] : [])]}
      extraSections={(row) => <UserAccess key={row.id} user={row} />}
      searchPlaceholder="Search name, email or phone…"
      emptyDescription="Invite your team: managers, cashiers, kitchen staff."
    />
  );
}
