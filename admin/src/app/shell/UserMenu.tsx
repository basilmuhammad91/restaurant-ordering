import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordInputSchema } from "@restoflux/contracts";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme, type Theme } from "@/hooks/use-theme";
import { ApiError, api, errorMessage } from "@/lib/api";
import { useMe, useAuth } from "@/lib/auth";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials(me.user.name)}</AvatarFallback>
            </Avatar>
            <span className="hidden max-w-32 truncate text-sm font-medium md:inline">{me.user.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block truncate font-semibold">{me.user.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{me.user.email}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{me.roles.map((r) => r.name).join(", ")} · {me.tenant.name}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
            <DropdownMenuRadioItem value="light"><Sun className="mr-2 size-4" /> Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon className="mr-2 size-4" /> Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor className="mr-2 size-4" /> System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPwOpen(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void logout()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { register, handleSubmit, reset, setError, formState } = useForm<{ currentPassword: string; newPassword: string }>({ resolver: zodResolver(changePasswordInputSchema) });
  const [formError, setFormError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => api.post("/auth/change-password", v),
    onSuccess: () => {
      toast.success("Password changed. Your other sessions were signed out.");
      reset();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422) {
        for (const [name, msgs] of Object.entries(e.fieldErrors)) if (name === "currentPassword" || name === "newPassword") setError(name, { message: msgs[0] ?? "Invalid" });
      } else setFormError(errorMessage(e));
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); setFormError(null); } onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You will stay signed in here; your other sessions are signed out.</DialogDescription>
        </DialogHeader>
        <form id="pw-form" className="space-y-3" onSubmit={handleSubmit((v) => change.mutate(v))} noValidate>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <div className="space-y-1.5">
            <Label htmlFor="cp-current">Current password</Label>
            <Input id="cp-current" type="password" autoComplete="current-password" {...register("currentPassword")} />
            {formState.errors.currentPassword && <p className="text-xs text-destructive">{formState.errors.currentPassword.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cp-new">New password</Label>
            <Input id="cp-new" type="password" autoComplete="new-password" {...register("newPassword")} />
            <p className="text-xs text-muted-foreground">At least 10 characters (12 for roles with financial access).</p>
            {formState.errors.newPassword && <p className="text-xs text-destructive">{formState.errors.newPassword.message}</p>}
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="pw-form" disabled={change.isPending}>{change.isPending ? "Saving…" : "Change password"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
