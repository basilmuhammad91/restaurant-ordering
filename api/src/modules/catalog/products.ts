import {
  categoryInputSchema, categoryUpdateSchema, idSchema, listQuerySchema, modifierGroupInputSchema, modifierGroupUpdateSchema,
  productInputSchema, productUpdateSchema, type ModifierGroupInput, type ProductInput,
} from "@restoflux/contracts";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext, withArchived } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { fieldError, notFound } from "../../core/http/errors.js";
import { offsetMeta, paging, parseSort, searchWhere } from "../../core/http/pagination.js";
import { assertRef, boolQuery, defineResource } from "../../core/http/resource.js";
import { securedRouter } from "../../core/http/secured.js";

// PRODUCTS, CATEGORIES AND MODIFIER GROUPS.
// A product is saved together with its variants (sizes) and modifier-group links in one transaction.
// Removing a variant or option archives it (orders and prices keep pointing at it) instead of deleting.

const idParams = z.object({ id: idSchema });
const tenantId = () => requireContext().tenantId;

// ---------------------------------------------------------------- categories
export const categories = defineResource({
  mount: "/api/v1/categories",
  label: "category",
  entityType: "Category",
  auditPrefix: "categories",
  model: (c) => c.category as never,
  permissions: { read: "menu.view", write: "menu.manage" },
  createSchema: categoryInputSchema,
  updateSchema: categoryUpdateSchema,
  searchFields: ["name"],
  sortable: ["name", "sortOrder", "createdAt"],
  defaultSort: "sortOrder,name",
  filters: { brandId: idSchema.optional(), isActive: boolQuery.optional() },
  prepare: async (input, { tx }) => {
    await assertRef(tx.brand as never, input.brandId, "brand");
    return input;
  },
});

// ---------------------------------------------------------------- products
const products = securedRouter("/api/v1/products");

const productSelect = {
  id: true, brandId: true, categoryId: true, name: true, description: true, imageUrl: true, sku: true, taxCategoryId: true,
  stationKey: true, tags: true, allergens: true, isActive: true, sortOrder: true, deletedAt: true, createdAt: true, updatedAt: true,
  category: { select: { id: true, name: true } },
  variants: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, sku: true, isDefault: true, sortOrder: true } },
  modifiers: { orderBy: { sortOrder: "asc" }, select: { modifierGroupId: true, sortOrder: true, minSelectOverride: true, maxSelectOverride: true, modifierGroup: { select: { id: true, name: true, minSelect: true, maxSelect: true } } } },
} satisfies Prisma.ProductSelect;

async function validateProductRefs(tx: Tx, input: Partial<ProductInput>, existing?: { brandId: string }) {
  const brandId = input.brandId ?? existing?.brandId;
  if (input.brandId) await assertRef(tx.brand as never, input.brandId, "brand");
  if (input.categoryId) {
    const cat = await assertRef(tx.category as never, input.categoryId, "category");
    if (cat && brandId && cat.brandId !== brandId) throw fieldError("categoryId", "That category belongs to a different brand");
  }
  await assertRef(tx.taxCategory as never, input.taxCategoryId, "taxCategory");
  for (const link of input.modifierGroups ?? []) {
    const group = await assertRef(tx.modifierGroup as never, link.modifierGroupId, "modifierGroup");
    if (group && brandId && group.brandId !== brandId) throw fieldError("modifierGroups", "A modifier group belongs to a different brand");
  }
}

/** Make the product's variants match the input: update by id, create without id, archive what is missing. */
async function syncVariants(tx: Tx, productId: string, variants: NonNullable<ProductInput["variants"]>) {
  const existing = await tx.productVariant.findMany({ where: { productId } });
  const byId = new Map(existing.map((v) => [v.id, v]));
  for (const v of variants) if (v.id && !byId.has(v.id)) throw fieldError("variants", "Unknown variant");

  // exactly one default: the flagged one, else the first
  const flagged = variants.findIndex((v) => v.isDefault);
  const defaultIndex = flagged >= 0 ? flagged : 0;

  await tx.productVariant.updateMany({ where: { productId }, data: { isDefault: false } }); // free the one-default index first
  const keep = new Set<string>();
  for (const [i, v] of variants.entries()) {
    const data = { name: v.name, sku: v.sku ?? null, isDefault: i === defaultIndex, sortOrder: v.sortOrder ?? i };
    if (v.id) {
      keep.add(v.id);
      await tx.productVariant.update({ where: { id: v.id }, data });
    } else {
      await tx.productVariant.create({ data: { tenantId: tenantId(), productId, ...data } });
    }
  }
  const gone = existing.filter((v) => !keep.has(v.id)).map((v) => v.id);
  if (gone.length) await tx.productVariant.updateMany({ where: { id: { in: gone } }, data: { deletedAt: new Date(), isDefault: false } });
}

async function syncModifierLinks(tx: Tx, productId: string, links: NonNullable<ProductInput["modifierGroups"]>) {
  await tx.productModifierGroup.deleteMany({ where: { productId } });
  if (!links.length) return;
  await tx.productModifierGroup.createMany({
    data: links.map((l, i) => ({
      tenantId: tenantId(), productId, modifierGroupId: l.modifierGroupId, sortOrder: l.sortOrder ?? i,
      minSelectOverride: l.minSelectOverride ?? null, maxSelectOverride: l.maxSelectOverride ?? null,
    })),
  });
}

const loadProduct = (tx: Tx | typeof db, id: string) => tx.product.findFirst({ where: { id }, select: productSelect });

products.get("/", "menu.view", async (req, res) => {
  const q = listQuerySchema.extend({ brandId: idSchema.optional(), categoryId: idSchema.optional(), isActive: boolQuery.optional() }).parse(req.query);
  const where = {
    ...(q.brandId && { brandId: q.brandId }), ...(q.categoryId && { categoryId: q.categoryId }), ...(q.isActive !== undefined && { isActive: q.isActive }),
    ...(searchWhere(q.q, ["name", "sku", "description"]) ?? {}),
  };
  const run = <T>(fn: () => T) => (q.includeArchived ? withArchived(fn) : fn());
  const [rows, total] = await run(() =>
    Promise.all([
      db.product.findMany({ where, select: productSelect, orderBy: parseSort(q.sort, ["name", "sortOrder", "createdAt"], "name") as never, ...paging(q) }),
      db.product.count({ where }),
    ]),
  );

  // price range per product (across its variants, in price books), shown in the list
  const variantIds = rows.flatMap((r) => r.variants.map((v) => v.id));
  const prices = variantIds.length ? await db.price.findMany({ where: { variantId: { in: variantIds }, priceBookId: { not: null } }, select: { variantId: true, amountMinor: true, currencyCode: true } }) : [];
  const byVariant = new Map<string, typeof prices>();
  for (const p of prices) byVariant.set(p.variantId!, [...(byVariant.get(p.variantId!) ?? []), p]);

  res.json({
    data: rows.map((r) => {
      const own = r.variants.flatMap((v) => byVariant.get(v.id) ?? []);
      const currency = own[0]?.currencyCode;
      const amounts = own.filter((p) => p.currencyCode === currency).map((p) => p.amountMinor);
      return { ...r, priceRange: amounts.length ? { minMinor: Math.min(...amounts), maxMinor: Math.max(...amounts), currencyCode: currency } : null };
    }),
    meta: offsetMeta(q, total),
  });
});

products.get("/:id", "menu.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const product = await loadProduct(db, id);
  if (!product) throw notFound("product");
  res.json({ data: product });
});

products.post("/", "menu.manage", async (req, res) => {
  const input = productInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    await validateProductRefs(tx, input);
    const { variants, modifierGroups, ...fields } = input;
    const product = await tx.product.create({
      data: { tenantId: tenantId(), ...fields, description: fields.description ?? null, imageUrl: fields.imageUrl ?? null, sku: fields.sku ?? null, taxCategoryId: fields.taxCategoryId ?? null, stationKey: fields.stationKey ?? null },
    });
    await syncVariants(tx, product.id, variants);
    await syncModifierLinks(tx, product.id, modifierGroups ?? []);
    const full = await loadProduct(tx, product.id);
    await recordAudit(tx, { action: "products.create", entityType: "Product", entityId: product.id, after: full });
    return full;
  });
  res.status(201).json({ data: created });
});

products.patch("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = productUpdateSchema.parse(req.body);
  const updated = await db.$transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    if (!before) throw notFound("product");
    await validateProductRefs(tx, input, before);
    const { variants, modifierGroups, ...fields } = input;
    if (Object.keys(fields).length) await tx.product.update({ where: { id }, data: fields });
    if (variants) await syncVariants(tx, id, variants);
    if (modifierGroups) await syncModifierLinks(tx, id, modifierGroups);
    const after = await loadProduct(tx, id);
    await recordAudit(tx, { action: "products.update", entityType: "Product", entityId: id, before, after });
    return after;
  });
  res.json({ data: updated });
});

products.delete("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadProduct(tx, id);
    if (!before) throw notFound("product");
    await tx.product.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { action: "products.archive", entityType: "Product", entityId: id, before });
  });
  res.status(204).end();
});

products.post("/:id/restore", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const restored = await withArchived(() =>
    db.$transaction(async (tx) => {
      const before = await tx.product.findFirst({ where: { id, deletedAt: { not: null } } });
      if (!before) throw notFound("product");
      await tx.product.update({ where: { id }, data: { deletedAt: null } });
      const after = await loadProduct(tx, id);
      await recordAudit(tx, { action: "products.restore", entityType: "Product", entityId: id, before, after });
      return after;
    }),
  );
  res.json({ data: restored });
});

export const productsRouter = products.router;

// ---------------------------------------------------------------- modifier groups
const groups = securedRouter("/api/v1/modifier-groups");

const groupSelect = {
  id: true, brandId: true, name: true, minSelect: true, maxSelect: true, isActive: true, deletedAt: true, createdAt: true, updatedAt: true,
  options: { where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true, sortOrder: true } },
  _count: { select: { products: true } },
} satisfies Prisma.ModifierGroupSelect;
const loadGroup = (tx: Tx | typeof db, id: string) => tx.modifierGroup.findFirst({ where: { id }, select: groupSelect });

async function syncOptions(tx: Tx, groupId: string, options: NonNullable<ModifierGroupInput["options"]>) {
  const existing = await tx.modifierOption.findMany({ where: { groupId } });
  const ids = new Set(existing.map((o) => o.id));
  for (const o of options) if (o.id && !ids.has(o.id)) throw fieldError("options", "Unknown option");
  const keep = new Set<string>();
  for (const [i, o] of options.entries()) {
    const data = { name: o.name, isDefault: o.isDefault ?? false, sortOrder: o.sortOrder ?? i };
    if (o.id) {
      keep.add(o.id);
      await tx.modifierOption.update({ where: { id: o.id }, data });
    } else {
      await tx.modifierOption.create({ data: { tenantId: tenantId(), groupId, ...data } });
    }
  }
  const gone = existing.filter((o) => !keep.has(o.id)).map((o) => o.id);
  if (gone.length) await tx.modifierOption.updateMany({ where: { id: { in: gone } }, data: { deletedAt: new Date() } });
}

groups.get("/", "menu.view", async (req, res) => {
  const q = listQuerySchema.extend({ brandId: idSchema.optional(), isActive: boolQuery.optional() }).parse(req.query);
  const where = { ...(q.brandId && { brandId: q.brandId }), ...(q.isActive !== undefined && { isActive: q.isActive }), ...(searchWhere(q.q, ["name"]) ?? {}) };
  const run = <T>(fn: () => T) => (q.includeArchived ? withArchived(fn) : fn());
  const [rows, total] = await run(() =>
    Promise.all([
      db.modifierGroup.findMany({ where, select: groupSelect, orderBy: parseSort(q.sort, ["name", "createdAt"], "name") as never, ...paging(q) }),
      db.modifierGroup.count({ where }),
    ]),
  );
  res.json({ data: rows, meta: offsetMeta(q, total) });
});

groups.get("/:id", "menu.view", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const row = await loadGroup(db, id);
  if (!row) throw notFound("modifier group");
  res.json({ data: row });
});

groups.post("/", "menu.manage", async (req, res) => {
  const input = modifierGroupInputSchema.parse(req.body);
  const created = await db.$transaction(async (tx) => {
    await assertRef(tx.brand as never, input.brandId, "brand");
    const { options, ...fields } = input;
    const group = await tx.modifierGroup.create({ data: { tenantId: tenantId(), ...fields } });
    await syncOptions(tx, group.id, options);
    const full = await loadGroup(tx, group.id);
    await recordAudit(tx, { action: "modifier-groups.create", entityType: "ModifierGroup", entityId: group.id, after: full });
    return full;
  });
  res.status(201).json({ data: created });
});

groups.patch("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const input = modifierGroupUpdateSchema.parse(req.body);
  const updated = await db.$transaction(async (tx) => {
    const before = await loadGroup(tx, id);
    if (!before) throw notFound("modifier group");
    const { options, ...fields } = input;
    if (Object.keys(fields).length) await tx.modifierGroup.update({ where: { id }, data: fields });
    if (options) await syncOptions(tx, id, options);
    const after = await loadGroup(tx, id);
    await recordAudit(tx, { action: "modifier-groups.update", entityType: "ModifierGroup", entityId: id, before, after });
    return after;
  });
  res.json({ data: updated });
});

groups.delete("/:id", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  await db.$transaction(async (tx) => {
    const before = await loadGroup(tx, id);
    if (!before) throw notFound("modifier group");
    await tx.modifierGroup.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(tx, { action: "modifier-groups.archive", entityType: "ModifierGroup", entityId: id, before });
  });
  res.status(204).end();
});

groups.post("/:id/restore", "menu.manage", async (req, res) => {
  const { id } = idParams.parse(req.params);
  const restored = await withArchived(() =>
    db.$transaction(async (tx) => {
      const before = await tx.modifierGroup.findFirst({ where: { id, deletedAt: { not: null } } });
      if (!before) throw notFound("modifier group");
      await tx.modifierGroup.update({ where: { id }, data: { deletedAt: null } });
      const after = await loadGroup(tx, id);
      await recordAudit(tx, { action: "modifier-groups.restore", entityType: "ModifierGroup", entityId: id, before, after });
      return after;
    }),
  );
  res.json({ data: restored });
});

export const modifierGroupsRouter = groups.router;
