import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import { PasswordInput } from "../components/PasswordInput";
import { ApiError } from "../lib/api";
import { btnPrimary, card, ErrorBox, Field, inputClass, PageTitle } from "../components/ui";

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const state = location.state as { from?: string; expired?: boolean } | null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in (or just logged in): go back where they came from.
  if (user) return <Navigate to={state?.from ?? (user.role === "ADMIN" ? "/admin" : "/")} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 422 ? "Please enter a valid email and password." : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle>Welcome back</PageTitle>
      {state?.expired && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Your session expired. Please log in again.</p>
      )}
      <form onSubmit={onSubmit} className={`${card} space-y-4 p-6`}>
        {error && <ErrorBox message={error} />}
        <Field label="Email">
          <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        New here?{" "}
        <Link to="/register" state={state} className="text-brand underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
