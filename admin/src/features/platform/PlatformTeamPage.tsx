import { zodResolver } from "@hookform/resolvers/zod";
import { platformUserCreateSchema } from "@restoflux/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { fmtDateTime, titleCase } from "@/components/cells";
import { PageHeader } from "@/components/page/PageHeader";
import { ErrorState, LoadingRows } from "@/components/page/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, errorMessage, platformApi } from "@/lib/api";
import { usePlatformAuth, usePlatformInvalidate } from "@/lib/platform";

interface Member {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED" | "INVITED";
  lastLoginAt: string | null;
}

type Form = { name: string; email: string; password: string };

export default function PlatformTeamPage() {
  const { me } = usePlatformAuth();
  const invalidate = usePlatformInvalidate();
  const [adding, setAdding] = useState(false);
  const team = useQuery({ queryKey: ["/platform/admins"], queryFn: async () => (await platformApi.get<{ data: Member[] }>("/admins")).data });
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm<Form>({ resolver: zodResolver(platformUserCreateSchema as never), defaultValues: { name: "", email: "", password: "" } });

  const add = useMutation({
    mutationFn: (v: Form) => platformApi.post("/admins", v),
    onSuccess: async () => { toast.success("Team member added"); setAdding(false); reset(); await invalidate("/admins"); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) for (const [f, m] of Object.entries(e.fieldErrors)) setError(f as keyof Form, { message: m[0] });
      else toast.error(errorMessage(e));
    },
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "DISABLED" }) => platformApi.patch(`/admins/${id}`, { status }),
    onSuccess: async () => { await invalidate("/admins"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const err = (k: keyof Form) => errors[k] && <p className="text-xs text-destructive">{String(errors[k]?.message ?? "Invalid")}</p>;

  return (
    <>
      <PageHeader title="Restoflux team" description="People who can sign in to this console. Disabling someone signs them out immediately." actions={<Button onClick={() => setAdding(true)}><Plus /> Add member</Button>} />
      {team.isError ? (
        <ErrorState message={errorMessage(team.error)} onRetry={() => team.refetch()} />
      ) : team.isPending ? (
        <LoadingRows />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Last sign-in</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
            <TableBody>
              {team.data.map((m) => (
                <TableRow key={m.id}>
                  <TableCell><div className="font-medium">{m.name}{m.id === me?.id && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</div><div className="text-xs text-muted-foreground">{m.email}</div></TableCell>
                  <TableCell><Badge variant="secondary" className={m.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground"}>{titleCase(m.status)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{m.lastLoginAt ? fmtDateTime(m.lastLoginAt) : "Never"}</TableCell>
                  <TableCell className="text-right">
                    {m.id !== me?.id && (
                      <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: m.id, status: m.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>
                        {m.status === "ACTIVE" ? "Disable" : "Enable"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a team member</DialogTitle><DialogDescription>They will sign in with this email and password. Use at least 10 characters.</DialogDescription></DialogHeader>
          <form onSubmit={handleSubmit((v) => add.mutate(v))} className="space-y-4" noValidate>
            <div className="space-y-1.5"><Label htmlFor="t-name">Name</Label><Input id="t-name" {...register("name")} />{err("name")}</div>
            <div className="space-y-1.5"><Label htmlFor="t-email">Email</Label><Input id="t-email" type="email" {...register("email")} />{err("email")}</div>
            <div className="space-y-1.5"><Label htmlFor="t-pw">Password</Label><Input id="t-pw" type="password" autoComplete="new-password" {...register("password")} />{err("password")}</div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" disabled={add.isPending}>{add.isPending ? "Adding…" : "Add member"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
