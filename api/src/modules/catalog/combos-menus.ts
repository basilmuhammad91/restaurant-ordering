import { comboInputSchema, comboUpdateSchema, idSchema, listQuerySchema, menuInputSchema, menuUpdateSchema, type ComboInput } from "@restoflux/contracts";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext, withArchived } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { fieldError, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging, parseSort, searchWhere } from "../../core/http/pagination.js";
import { assertRef, boolQuery } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";

// COMBOS (bundles with choice slots) and MENUS (time-based: breakfast, lunch, dinner).

const idParams = z.object({ id: idSchema });
const tenantId = () => requireContext().tenantId;

// ---------------------------------------------------------------- combos
const combos = securedRouter("/api/v1/combos");

const comboSelect = {
  id: true, brandId: true, name: true, description: true, imageUrl: true, taxCategoryId: true, isActive: true, startsAt: true, endsAt: true, deletedAt: true, createdAt: true, updatedAt: true,
  slots: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true, name: true, quantity: true, sortOrder: true,
      options: { select: { id: true, variantId: true, isDefault: true, variant: { select: { id: true, name: true, product: { select: { id: true, name: true } } } } } },
    },
  },
} satisfies Prisma.ComboSelect;
const loadCombo = (tx: Tx | typeof db, id: string) => tx.combo.findFirst({ where: { id }, select: comboSelect });

async function syncSlots(tx: Tx, comboId: string, brandId: string, slots: NonNullable<ComboInput["slots"]>) {
  // every chosen variant must exist and belong to the same brand as the combo
  const variantIds = [...new Set(slots.flatMap((s) => s.options.map((o) => o.variantId)))];
  const variants = await tx.productVariant.findMany({ where: { id: { in: variantIds }, deletedAt: null }, select: { id: true, product: { select: { brandId: true } } } });
  if (variants.length !== variantIds.length) throw fieldError("slots", "A chosen item does not exist");
  if (variants.some((v) => v.product.brandId !== brandId)) throw fieldError("slots", "A chosen item belongs to a different brand");

  const existingSlots = await tx.comboSlot.findMany({ where: { comboId }, include: { options: true } });
  const slotIds = new Set(existingSlots.map((s) => s.id));
  for (const s of slots) if (s.id && !slotIds.has(s.id)) throw fieldError("slots", "Unknown slot");

  const keptSlots = new Set<string>();
  const keptOptions = new Set<string>();
  for (const [i, s] of slots.entries()) {
    let slotId = s.id;
    if (slotId) {
      keptSlots.add(slotId);
      await tx.comboSlot.update({ where: { id: slotId }, data: { name: s.name, quantity: s.quantity, sortOrder: i } });
    } else {
      slotId = (await tx.comboSlot.create({ data: { tenantId: tenantId(), comboId, name: s.name, quantity: s.quantity, sortOrder: i } })).id;
    }
    const before = existingSlots.find((x) => x.id === slotId)?.options ?? [];
    const optionIds = new Set(before.map((o) => o.id));
    for (const o of s.options) {
      if (o.id && optionIds.has(o.id)) {
        keptOptions.add(o.id);
        await tx.comboSlotOption.update({ where: { id: o.id }, data: { variantId: o.variantId, isDefault: o.isDefault ?? false } });
      } else {
        await tx.comboSlotOption.create({ data: { tenantId: tenantId(), slotId, variantId: o.variantId, isDefault: o.isDefault ?? false } });
      }
    }
  }
  // removed options and slots: their up-charge prices go first (a price must always point at something)
  const goneOptions = existingSlots.flatMap((s) => s.options).filter((o) => !keptOptions.has(o.id) && keptSlots.has(o.slotId)).map((o) => o.id);
  const goneSlots = existingSlots.filter((s) => !keptSlots.has(s.id));
  const allGone = [...goneOptions, ...goneSlots.flatMap((s) => s.options.map((o) => o.id))];
  if (allGone.length) {
    await tx.price.deleteMany({ where: { comboSlotOptionId: { in: allGone } } });
    await tx.comboSlotOption.deleteMany({ where: { id: { in: allGone } } });
  }
  if (goneSlots.length) await tx.comboSlot.deleteMany({ where: { id: { in: goneSlots.map((s) => s.id) } } });
}

combos.get("/", "menu.view", async (req, res) => {
  const q = listQuerySchema.extend({ brandId: idSchema.optional(), isActive: boolQuery.optional() }).parse(req.query);
  const where = { ...(q.brandId && { brandId: q.brandId }), ...(q.isActive !== undefined && { isActive: q.isActive }), ...(searchWhere(q.q, ["name", "description"]) ?? {}) };
  const run = <T>(fn: () => T) => (q.includeArchived ? withArchived(fn) : fn());
  const [rows, total] = await run(() =>
    Promise.all([db.combo.findMany({ where, select: comboSelect, orderBy: parseSort(q.sort, ["name", "createdAt"], "name") as never, ...paging(q) }), db.combo.count({ where })]),
  );
  const prices = rows.length ? await db.price.findMany({ where: { comboId: { in: rows.map((r) => r.id) }, priceBookId: { not: null } }, select: { comboId: true, amountMinor: true, currencyCode: true } }) : [];
  res.json({
    data: rows.map((r) => {
      const own = prices.filter((p) => p.comboId === r.id);
      const first = own[0]?.currencyCode;
      const amounts = own.filter((p) => p.currencyCode === first).map((p) => p.amountMinor);
      return { ...r, priceRange: amounts.length ? { minMinor: Math.min(...amounts), maxMinor: Math.max(...amounts), currencyCode: first } : null };
    }),
    meta: offsetMeta(q, total),
  });
});

combos.get("/:id", "menu.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await loadCombo(db, id);
  if (!row) throw notFound("combo");
  res.json({ data: row });
});

combos.post("/", "menu.manage", async (req, res) => {
  const input = comboInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    await assertRef(tx.brand as never, input.brandId, "brand");
    await assertRef(tx.taxCategory as never, input.taxCategoryId, "taxCategory");
    const { slots, startsAt, endsAt, ...fields } = input;
    const combo = await tx.combo.create({
      data: { tenantId: tenantId(), ...fields, description: fields.description ?? null, imageUrl: fields.imageUrl ?? null, taxCategoryId: fields.taxCategoryId ?? null, startsAt: startsAt ? new Date(startsAt) : null, endsAt: endsAt ? new Date(endsAt) : null },
    });
    await syncSlots(tx, combo.id, combo.brandId, slots);
    const full = await loadCombo(tx, combo.id);
    await recordAudit(tx, { action: "combos.create", entityType: "Combo", entityId: combo.id, after: full });
    return full;
  });
  res.status(201).json({ data: created });
});

combos.patch("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = comboUpdateSchema.parse(req.body);
  const updated = await db.$transaction(async (tx) => {
    const before = await loadCombo(tx, id);
    if (!before) throw notFound("combo");
    await assertRef(tx.taxCategory as never, input.taxCategoryId, "taxCategory");
    const { slots, startsAt, endsAt, brandId: _ignored, ...fields } = input;
    void _ignored; // a combo never moves to another brand: its items belong to the old one
    const data = { ...fields, ...(startsAt !== undefined && { startsAt: startsAt ? new Date(startsAt) : null }), ...(endsAt !== undefined && { endsAt: endsAt ? new Date(endsAt) : null }) };
    if (Object.keys(data).length) await tx.combo.update({ where: { id }, data });
    if (slots) await syncSlots(tx, id, before.brandId, slots);
    const after = await loadCombo(tx, id);
    await recordAudit(tx, { action: "combos.update", entityType: "Combo", entityId: id, before, after });
    return after;
  });
  res.json({ data: updated });
});

combos.delete("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadCombo(tx, id);
    if (!before) throw notFound("combo");
    await tx.combo.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { action: "combos.archive", entityType: "Combo", entityId: id, before });
  });
  res.status(204).end();
});

combos.post("/:id/restore", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const restored = await withArchived(() =>
    db.$transaction(async (tx) => {
      const before = await tx.combo.findFirst({ where: { id, deletedAt: { not: null } } });
      if (!before) throw notFound("combo");
      await tx.combo.update({ where: { id }, data: { deletedAt: null } });
      const after = await loadCombo(tx, id);
      await recordAudit(tx, { action: "combos.restore", entityType: "Combo", entityId: id, before, after });
      return after;
    }),
  );
  res.json({ data: restored });
});

export const combosRouter = combos.router;

// ---------------------------------------------------------------- menus
const menus = securedRouter("/api/v1/menus");

const menuSelect = {
  id: true, brandId: true, name: true, isDefault: true, isActive: true, deletedAt: true, createdAt: true, updatedAt: true,
  schedules: { select: { id: true, weekdays: true, startsAt: true, endsAt: true } },
  products: { orderBy: { sortOrder: "asc" }, select: { productId: true } },
  combos: { orderBy: { sortOrder: "asc" }, select: { comboId: true } },
} satisfies Prisma.MenuSelect;
const loadMenu = (tx: Tx | typeof db, id: string) => tx.menu.findFirst({ where: { id }, select: menuSelect });
const toMenuDto = (m: NonNullable<Awaited<ReturnType<typeof loadMenu>>>) => ({ ...m, productIds: m.products.map((p) => p.productId), comboIds: m.combos.map((c) => c.comboId), products: undefined, combos: undefined });

async function syncMenu(tx: Tx, menuId: string, brandId: string, input: { schedules?: { weekdays: number[]; startsAt?: string | null | undefined; endsAt?: string | null | undefined }[] | undefined; productIds?: string[] | undefined; comboIds?: string[] | undefined }) {
  if (input.productIds) {
    const found = await tx.product.count({ where: { id: { in: input.productIds }, brandId } });
    if (found !== new Set(input.productIds).size) throw fieldError("productIds", "A product does not exist or belongs to a different brand");
    await tx.menuProduct.deleteMany({ where: { menuId } });
    if (input.productIds.length) await tx.menuProduct.createMany({ data: [...new Set(input.productIds)].map((productId, i) => ({ tenantId: tenantId(), menuId, productId, sortOrder: i })) });
  }
  if (input.comboIds) {
    const found = await tx.combo.count({ where: { id: { in: input.comboIds }, brandId } });
    if (found !== new Set(input.comboIds).size) throw fieldError("comboIds", "A combo does not exist or belongs to a different brand");
    await tx.menuCombo.deleteMany({ where: { menuId } });
    if (input.comboIds.length) await tx.menuCombo.createMany({ data: [...new Set(input.comboIds)].map((comboId, i) => ({ tenantId: tenantId(), menuId, comboId, sortOrder: i })) });
  }
  if (input.schedules) {
    await tx.menuSchedule.deleteMany({ where: { menuId } });
    if (input.schedules.length) {
      await tx.menuSchedule.createMany({ data: input.schedules.map((s) => ({ tenantId: tenantId(), menuId, weekdays: [...new Set(s.weekdays)].sort(), startsAt: s.startsAt ?? null, endsAt: s.endsAt ?? null })) });
    }
  }
}

menus.get("/", "menu.view", async (req, res) => {
  const q = listQuerySchema.extend({ brandId: idSchema.optional(), isActive: boolQuery.optional() }).parse(req.query);
  const where = { ...(q.brandId && { brandId: q.brandId }), ...(q.isActive !== undefined && { isActive: q.isActive }), ...(searchWhere(q.q, ["name"]) ?? {}) };
  const run = <T>(fn: () => T) => (q.includeArchived ? withArchived(fn) : fn());
  const [rows, total] = await run(() =>
    Promise.all([db.menu.findMany({ where, select: menuSelect, orderBy: parseSort(q.sort, ["name", "createdAt"], "name") as never, ...paging(q) }), db.menu.count({ where })]),
  );
  res.json({ data: rows.map(toMenuDto), meta: offsetMeta(q, total) });
});

menus.get("/:id", "menu.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await loadMenu(db, id);
  if (!row) throw notFound("menu");
  res.json({ data: toMenuDto(row) });
});

menus.post("/", "menu.manage", async (req, res) => {
  const input = menuInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    await assertRef(tx.brand as never, input.brandId, "brand");
    if (input.isDefault) await tx.menu.updateMany({ where: { brandId: input.brandId, isDefault: true }, data: { isDefault: false } });
    const menu = await tx.menu.create({ data: { tenantId: tenantId(), brandId: input.brandId, name: input.name, isDefault: input.isDefault ?? false, isActive: input.isActive ?? true } });
    await syncMenu(tx, menu.id, menu.brandId, input);
    const full = await loadMenu(tx, menu.id);
    await recordAudit(tx, { action: "menus.create", entityType: "Menu", entityId: menu.id, after: full });
    return full!;
  });
  res.status(201).json({ data: toMenuDto(created) });
});

menus.patch("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = menuUpdateSchema.parse(req.body);
  const updated = await db.$transaction(async (tx) => {
    const before = await loadMenu(tx, id);
    if (!before) throw notFound("menu");
    if (input.isDefault) await tx.menu.updateMany({ where: { brandId: before.brandId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
    const { schedules: _s, productIds: _p, comboIds: _c, brandId: _b, ...fields } = input;
    void [_s, _p, _c, _b]; // a menu never moves to another brand
    if (Object.keys(fields).length) await tx.menu.update({ where: { id }, data: fields });
    await syncMenu(tx, id, before.brandId, input);
    const after = await loadMenu(tx, id);
    await recordAudit(tx, { action: "menus.update", entityType: "Menu", entityId: id, before, after });
    return after!;
  });
  res.json({ data: toMenuDto(updated) });
});

menus.delete("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadMenu(tx, id);
    if (!before) throw notFound("menu");
    await tx.menu.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    await recordAudit(tx, { action: "menus.archive", entityType: "Menu", entityId: id, before });
  });
  res.status(204).end();
});

menus.post("/:id/restore", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const restored = await withArchived(() =>
    db.$transaction(async (tx) => {
      const before = await tx.menu.findFirst({ where: { id, deletedAt: { not: null } } });
      if (!before) throw notFound("menu");
      await tx.menu.update({ where: { id }, data: { deletedAt: null } });
      const after = await loadMenu(tx, id);
      await recordAudit(tx, { action: "menus.restore", entityType: "Menu", entityId: id, before, after });
      return after!;
    }),
  );
  res.json({ data: toMenuDto(restored) });
});

export const menusRouter = menus.router;
