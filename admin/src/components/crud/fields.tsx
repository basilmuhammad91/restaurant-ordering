import { Controller, type Control, type FieldErrors, type UseFormRegister } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

// Declarative form fields: pages describe their fields as data and this renders them with react-hook-form.

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "textarea" | "switch" | "select" | "multicheck" | "password" | "email" | "date";
  options?: FieldOption[];
  placeholder?: string;
  hint?: string;
  /** Empty string is sent as null (clears the value) instead of "". */
  nullable?: boolean;
  required?: boolean;
  /** 2 = full width, 1 = half width (default 2 on small screens). */
  span?: 1 | 2;
  /** Only show when creating, only when editing, or both (default). */
  mode?: "create" | "edit" | "both";
  min?: number;
  max?: number;
  step?: number;
  /** Disable the control (e.g. immutable after creation). */
  disabledWhen?: (editing: boolean) => boolean;
  /** Select: offer an empty "None" choice. */
  allowEmpty?: boolean;
}

const NONE = "__none__"; // Radix Select cannot hold an empty string value

export function FieldControl({
  field, register, control, errors, editing,
}: {
  field: FieldDef;
  register: UseFormRegister<any>;
  control: Control<any>;
  errors: FieldErrors<any>;
  editing: boolean;
}) {
  const id = `f-${field.name}`;
  const error = errors[field.name]?.message as string | undefined;
  const disabled = field.disabledWhen?.(editing) ?? false;
  const wrap = (children: React.ReactNode, inline = false) => (
    <div className={`space-y-1.5 ${field.span === 1 ? "" : "sm:col-span-2"}`}>
      {inline ? children : (
        <>
          <Label htmlFor={id}>
            {field.label}
            {field.required && <span className="text-destructive"> *</span>}
          </Label>
          {children}
        </>
      )}
      {field.hint && !error && <p className="text-xs text-muted-foreground">{field.hint}</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );

  switch (field.type) {
    case "textarea":
      return wrap(<Textarea id={id} rows={3} placeholder={field.placeholder} disabled={disabled} aria-invalid={!!error} {...register(field.name)} />);
    case "number":
      return wrap(
        <Input id={id} type="number" min={field.min} max={field.max} step={field.step ?? 1} placeholder={field.placeholder} disabled={disabled} aria-invalid={!!error} {...register(field.name, { valueAsNumber: true })} />,
      );
    case "switch":
      return wrap(
        <Controller
          control={control}
          name={field.name}
          render={({ field: f }) => (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2">
              <Label htmlFor={id} className="cursor-pointer">{field.label}</Label>
              <Switch id={id} checked={!!f.value} onCheckedChange={f.onChange} disabled={disabled} />
            </div>
          )}
        />,
        true,
      );
    case "select":
      return wrap(
        <Controller
          control={control}
          name={field.name}
          render={({ field: f }) => (
            <Select value={f.value ? String(f.value) : field.allowEmpty ? NONE : ""} onValueChange={(v) => f.onChange(v === NONE ? null : v)} disabled={disabled}>
              <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
                <SelectValue placeholder={field.placeholder ?? "Select…"} />
              </SelectTrigger>
              <SelectContent>
                {field.allowEmpty && <SelectItem value={NONE}>None</SelectItem>}
                {(field.options ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />,
      );
    case "multicheck":
      return wrap(
        <Controller
          control={control}
          name={field.name}
          render={({ field: f }) => {
            const value: string[] = Array.isArray(f.value) ? f.value : [];
            return (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                {(field.options ?? []).length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">Nothing to choose from yet.</p>}
                {(field.options ?? []).map((o) => (
                  <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                    <Checkbox checked={value.includes(o.value)} onCheckedChange={(c) => f.onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))} disabled={disabled} />
                    {o.label}
                  </label>
                ))}
              </div>
            );
          }}
        />,
      );
    default:
      return wrap(
        <Input id={id} type={field.type === "text" ? "text" : field.type} placeholder={field.placeholder} disabled={disabled} autoComplete={field.type === "password" ? "new-password" : "off"} aria-invalid={!!error} {...register(field.name)} />,
      );
  }
}
