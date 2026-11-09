import { zodResolver } from "@hookform/resolvers/zod";
import { BRAND, loginInputSchema } from "@restoflux/contracts";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useLocation } from "react-router";
import { Logo } from "@/app/shell/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string; password: string }>({ resolver: zodResolver(loginInputSchema as never) });

  if (status === "authenticated") return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setError(null);
    try {
      await login(email, password);
    } catch (e) {
      setError(e instanceof ApiError ? (e.status === 429 ? "Too many attempts. Please wait a minute and try again." : e.message) : "Something went wrong");
    }
  });

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex justify-center">
          <Logo size={44} className="text-2xl" />
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle>Sign in to your workspace</CardTitle>
            <CardDescription>{BRAND.tagline}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {error && (
                <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" autoFocus {...register("email")} aria-invalid={!!formState.errors.email} />
                {formState.errors.email && <p className="text-xs text-destructive">Enter a valid email address</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" className="pr-10" {...register("password")} aria-invalid={!!formState.errors.password} />
                  <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {formState.errors.password && <p className="text-xs text-destructive">Enter your password</p>}
              </div>
              <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
                {formState.isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
