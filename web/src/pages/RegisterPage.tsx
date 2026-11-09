import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation } from "react-router";
import { useAuth } from "../context/AuthContext";
import { PasswordInput } from "../components/PasswordInput";
import { ApiError } from "../lib/api";
import { btnPrimary, card, ErrorBox, Field, inputClass, PageTitle } from "../components/ui";

export default function RegisterPage() {
  const { user, register } = useAuth();
  const state = useLocation().state as { from?: string } | null;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={state?.from ?? "/"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register(name, email, password);
    } catch (err) {
      // 422 carries per-field messages from Zod: {details: {email: ["..."], ...}}
      if (err instanceof ApiError && err.details) setFieldErrors(err.details);
      else setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle sub="Create an account to place orders.">Join us</PageTitle>
      <form onSubmit={onSubmit} className={`${card} space-y-4 p-6`} noValidate>
        {error && <ErrorBox message={error} />}
        <Field label="Name" error={fieldErrors.name?.[0]}>
          <input className={inputClass} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" error={fieldErrors.email?.[0]}>
          <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password (min. 8 characters)" error={fieldErrors.password?.[0]}>
          <PasswordInput autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        Already registered?{" "}
        <Link to="/login" state={state} className="text-ember underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
