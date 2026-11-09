import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contrastRatio, readableOn, THEME_PRESETS, themeSchema } from "@restoflux/contracts";
import { createApp } from "../../src/app.js";
import { unscopedDb } from "../../src/core/db/client.js";
import { createFixture, createStaff, login, loginOwner, loginStaff, type Fixture } from "../helpers/fixtures.js";
import { api } from "../helpers/http.js";

const app = createApp();

describe("theme helpers (shared by API and admin UI)", () => {
  it("picks a readable text colour on any background", () => {
    expect(readableOn("#ffffff")).toBe("#111111");
    expect(readableOn("#000000")).toBe("#ffffff");
    for (const hex of ["#b01e28", "#1d4ed8", "#15803d", "#c2410c", "#7e22ce", "#334155", "#facc15", "#808080", "#fde047"]) {
      expect(contrastRatio(hex, readableOn(hex)), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every preset is a valid theme", () => {
    for (const p of THEME_PRESETS) expect(themeSchema.safeParse(p.theme).success, p.name).toBe(true);
  });

  it("rejects anything that is not a #rrggbb colour or a known radius", () => {
    for (const bad of [{ primary: "red" }, { primary: "#fff" }, { primary: "url(x)" }, { sidebar: "#12345g" }, { radius: "huge" }]) {
      expect(themeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("organization theme", () => {
  let fx: Fixture;
  let owner: string;

  beforeAll(async () => {
    fx = await createFixture();
    owner = (await loginOwner(app, fx)).token;
  });
  afterAll(async () => {
    await fx.cleanup();
    await unscopedDb.$disconnect();
  });

  it("starts empty, saves a custom theme, and returns it in /auth/me for every user of the organization", async () => {
    const asOwner = api(app, owner);
    expect((await asOwner.get("/tenant")).body.data.theme).toEqual({});

    const res = await asOwner.patch("/tenant", { theme: { primary: "#1d4ed8", sidebar: "#0f172a", radius: "round" } });
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toEqual({ primary: "#1d4ed8", sidebar: "#0f172a", radius: "round" });

    const cashier = await loginStaff(app, await createStaff(fx, { roleName: "Cashier" }));
    expect(cashier.me.tenant.theme).toEqual({ primary: "#1d4ed8", sidebar: "#0f172a", radius: "round" });
  });

  it("rejects invalid colours, resets with an empty object, and audits the change", async () => {
    const asOwner = api(app, owner);
    expect((await asOwner.patch("/tenant", { theme: { primary: "blue" } })).status).toBe(422);
    expect((await asOwner.patch("/tenant", { theme: {} })).body.data.theme).toEqual({});
    const log = await unscopedDb.auditLog.findMany({ where: { tenantId: fx.tenantId, action: "tenant.update" } });
    expect(log.length).toBeGreaterThanOrEqual(2);
  });

  it("only users who can manage the organization may change it", async () => {
    const cashier = await loginStaff(app, await createStaff(fx, { roleName: "Cashier" }));
    expect((await api(app, cashier.token).patch("/tenant", { theme: { primary: "#15803d" } })).status).toBe(403);
  });

  it("one organization's theme never leaks to another", async () => {
    const other = await createFixture();
    try {
      const otherMe = await login(app, other.ownerEmail, other.ownerPassword);
      expect(otherMe.me.tenant.theme).toEqual({});
    } finally {
      await other.cleanup();
    }
  });
});
