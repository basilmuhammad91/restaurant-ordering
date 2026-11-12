import { describe, expect, it } from "vitest";
import { matchPage } from "../src/app/shell/CommandSearch";

const score = (search: string, label: string, section = "Settings") => matchPage(label, search, [label, section]);

describe("command search matching", () => {
  it("finds a page by the start of its words and not by scattered letters", () => {
    expect(score("roles", "Roles & permissions")).toBeGreaterThan(0);
    expect(score("roles", "Live orders", "Sales & Orders")).toBe(0); // the old fuzzy match let this through
    expect(score("roles", "Tax profiles", "Organization")).toBe(0);
    expect(score("tax", "Tax profiles", "Organization")).toBeGreaterThan(0);
    expect(score("perm", "Roles & permissions")).toBeGreaterThan(0);
  });

  it("needs every word, and lets a word match the section name", () => {
    expect(score("stock on", "Stock on hand", "Inventory")).toBeGreaterThan(0);
    expect(score("inventory stock", "Stock on hand", "Inventory")).toBeGreaterThan(0);
    expect(score("stock purchasing", "Stock on hand", "Inventory")).toBe(0);
  });

  it("ranks a word start above a match inside a word, and shows everything for an empty search", () => {
    expect(score("order", "Order history", "Sales")).toBeGreaterThan(score("rder", "Order history", "Sales"));
    expect(score("hist", "Order history", "Sales")).toBeGreaterThan(score("story", "Order history", "Sales"));
    expect(score("", "Anything")).toBe(1);
  });
});
