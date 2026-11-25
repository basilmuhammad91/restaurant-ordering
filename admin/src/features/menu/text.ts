/** A text box's value for the API: trimmed, or null when empty. Safe to apply twice. */
export const textOrNull = (s: string | null | undefined): string | null => s?.trim() || null;
