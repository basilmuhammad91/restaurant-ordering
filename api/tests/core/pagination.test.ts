import { describe, expect, it } from "vitest";
import { AppError } from "../../src/core/http/errors.js";
import { afterCursor, decodeCursor, encodeCursor, offsetMeta, paging, parseSort, searchWhere } from "../../src/core/http/pagination.js";

describe("paging", () => {
  it("computes skip/take and meta", () => {
    expect(paging({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(paging({ page: 3, pageSize: 10 })).toEqual({ skip: 20, take: 10 });
    expect(offsetMeta({ page: 3, pageSize: 10 }, 42)).toEqual({ page: 3, pageSize: 10, total: 42 });
  });
});

describe("parseSort", () => {
  const allowed = ["name", "createdAt"];
  it("parses ascending, descending and multiple fields", () => {
    expect(parseSort("-createdAt,name", allowed, "name")).toEqual([{ createdAt: "desc" }, { name: "asc" }]);
  });
  it("falls back to the default", () => {
    expect(parseSort(undefined, allowed, "-createdAt")).toEqual([{ createdAt: "desc" }]);
    expect(parseSort("", allowed, "name")).toEqual([{ name: "asc" }]);
  });
  it("rejects fields that are not whitelisted (cannot probe arbitrary columns)", () => {
    expect(() => parseSort("passwordHash", allowed, "name")).toThrow(AppError);
    expect(() => parseSort("name,-secret", allowed, "name")).toThrow(/Cannot sort/);
  });
});

describe("searchWhere", () => {
  it("is undefined without a query and OR-contains across fields with one", () => {
    expect(searchWhere(undefined, ["name"])).toBeUndefined();
    expect(searchWhere("kar", ["name", "city"])).toEqual({
      OR: [{ name: { contains: "kar", mode: "insensitive" } }, { city: { contains: "kar", mode: "insensitive" } }],
    });
  });
});

describe("cursor pagination", () => {
  it("round-trips a cursor", () => {
    const at = new Date("2026-11-09T10:15:30.123Z");
    const cursor = encodeCursor(at, "abc-123");
    expect(decodeCursor(cursor)).toEqual({ at, id: "abc-123" });
  });
  it("rejects malformed cursors with a validation error", () => {
    expect(() => decodeCursor("not-base64-at-all!!")).toThrow(AppError);
    expect(() => decodeCursor(Buffer.from("garbage").toString("base64url"))).toThrow(/Invalid cursor/);
  });
  it("builds the keyset condition (older than the cursor, ties broken by id)", () => {
    expect(afterCursor("occurredAt", undefined)).toBeUndefined();
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(afterCursor("occurredAt", encodeCursor(at, "x"))).toEqual({ OR: [{ occurredAt: { lt: at } }, { occurredAt: at, id: { lt: "x" } }] });
  });
});
