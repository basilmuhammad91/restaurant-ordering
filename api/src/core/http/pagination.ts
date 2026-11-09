import type { OffsetMeta } from "@restoflux/contracts";
import { validationError } from "./errors.js";

// Pagination and sorting helpers shared by every list endpoint.

export function paging(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export const offsetMeta = (q: { page: number; pageSize: number }, total: number): OffsetMeta => ({
  page: q.page,
  pageSize: q.pageSize,
  total,
});

/**
 * "?sort=-createdAt,name" -> [{createdAt:"desc"},{name:"asc"}], accepting only whitelisted fields
 * (an open sort parameter would let clients order by, and so probe, any column).
 */
export function parseSort(sort: string | undefined, allowed: readonly string[], fallback: string): Record<string, "asc" | "desc">[] {
  const parts = (sort?.length ? sort : fallback).split(",").map((s) => s.trim()).filter(Boolean);
  return parts.map((part) => {
    const desc = part.startsWith("-");
    const field = desc ? part.slice(1) : part;
    if (!allowed.includes(field)) {
      throw validationError(`Cannot sort by "${field}"`, { allowed });
    }
    return { [field]: desc ? "desc" : "asc" } as Record<string, "asc" | "desc">;
  });
}

/** Case-insensitive "contains" search across several text fields. */
export function searchWhere(q: string | undefined, fields: readonly string[]): Record<string, unknown> | undefined {
  if (!q) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) };
}

// ---- cursor (keyset) pagination for large append-only lists, ordered by (time desc, id desc) ----

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { at: Date; id: string } {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    const at = new Date(iso ?? "");
    if (!id || Number.isNaN(at.getTime())) throw new Error("bad cursor");
    return { at, id };
  } catch {
    throw validationError("Invalid cursor");
  }
}

/** WHERE fragment for "rows after this cursor" when ordering by (field desc, id desc). */
export function afterCursor(field: string, cursor: string | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  const { at, id } = decodeCursor(cursor);
  return { OR: [{ [field]: { lt: at } }, { [field]: at, id: { lt: id } }] };
}
