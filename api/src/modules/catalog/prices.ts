import { priceListQuerySchema, pricesDeleteSchema, pricesUpsertSchema, type PriceInput } from "@restoflux/contracts";
import { recordAudit } from "../../core/audit/audit.js";
import { requireContext } from "../../core/context/context.js";
import { db, type Tx } from "../../core/db/scoped.js";
import { fieldError, forbidden, notFound } from "../../core/http/errors.js";
import { securedRouter } from "../../core/http/secured.js";

// PRICES. One price = one target (variant, modifier option, combo or combo slot option) in one scope
// (a price book, or a single branch), optionally for one channel. Amounts are integer minor units in the
// currency of the book or branch; the API stamps the currency itself so it can never disagree with it.
// Reading follows `menu.view`; changing follows `menu.price.edit` (a separate permission on purpose:
// the person who writes the menu is not always the person who sets the money).

const prices = securedRouter("/api/v1/prices");
const TARGET_KEYS = ["variantId", "modifierOptionId", "comboId", "comboSlotOptionId"] as const;
type TargetKey = (typeof TARGET_KEYS)[number];

const targetOf = (t: PriceInput["target"]): { key: TargetKey; id: string } => {
  const key = TARGET_KEYS.find((k) => k in t)!;
  return { key, id: (t as Record<string, string>)[key]! };
};

/** The brand a priceable thing belongs to, or throw if it does not exist in this tenant. */
async function brandOfTarget(tx: Tx, key: TargetKey, id: string): Promise<string> {
  const notThere = () => fieldError("target", "That item does not exist");
  switch (key) {
    case "variantId": {
      const v = await tx.productVariant.findFirst({ where: { id, deletedAt: null }, select: { product: { select: { brandId: true } } } });
      if (!v) throw notThere();
      return v.product.brandId;
    }
    case "modifierOptionId": {
      const o = await tx.modifierOption.findFirst({ where: { id, deletedAt: null }, select: { group: { select: { brandId: true } } } });
      if (!o) throw notThere();
      return o.group.brandId;
    }
    case "comboId": {
      const c = await tx.combo.findFirst({ where: { id }, select: { brandId: true } });
      if (!c) throw notThere();
      return c.brandId;
    }
    case "comboSlotOptionId": {
      const o = await tx.comboSlotOption.findFirst({ where: { id }, select: { slot: { select: { combo: { select: { brandId: true } } } } } });
      if (!o) throw notThere();
      return o.slot.combo.brandId;
    }
  }
}

const rowSelect = {
  id: true, variantId: true, modifierOptionId: true, comboId: true, comboSlotOptionId: true, priceBookId: true, locationId: true,
  channel: true, amountMinor: true, compareAtMinor: true, currencyCode: true, updatedAt: true,
  priceBook: { select: { id: true, name: true } },
  location: { select: { id: true, name: true, code: true } },
} as const;

prices.get("/", "menu.view", async (req, res) => {
  const q = priceListQuerySchema.parse(req.query);
  const target = TARGET_KEYS.filter((k) => q[k]).map((k) => ({ [k]: q[k] }));
  const rows = await db.price.findMany({
    where: { AND: target, ...(q.priceBookId && { priceBookId: q.priceBookId }), ...(q.locationId && { locationId: q.locationId }) },
    select: rowSelect,
    orderBy: [{ priceBookId: "asc" }, { locationId: "asc" }, { channel: "asc" }],
  });
  res.json({ data: rows });
});

prices.put("/", "menu.price.edit", async (req, res) => {
  const { prices: input } = pricesUpsertSchema.parse(req.body);
  const ctx = requireContext();

  const saved = await db.$transaction(async (tx) => {
    const out: { id: string; created: boolean }[] = [];
    const audit: unknown[] = [];

    for (const p of input) {
      const { key, id } = targetOf(p.target);
      const brandId = await brandOfTarget(tx, key, id);

      let scopeKey: "priceBookId" | "locationId";
      let scopeId: string;
      let currencyCode: string;
      if ("priceBookId" in p.scope) {
        // company-wide prices affect every branch, so only people who can see every branch may change them
        if (!ctx.allLocations) throw forbidden("Only users with access to all branches can change price book prices");
        const book = await tx.priceBook.findFirst({ where: { id: p.scope.priceBookId } });
        if (!book) throw fieldError("scope", "That price book does not exist");
        if (book.brandId && book.brandId !== brandId) throw fieldError("scope", "That price book belongs to a different brand");
        [scopeKey, scopeId, currencyCode] = ["priceBookId", book.id, book.currencyCode];
      } else {
        const loc = await tx.location.findFirst({ where: { id: p.scope.locationId } });
        if (!loc) throw fieldError("scope", "That branch does not exist");
        if (loc.brandId && loc.brandId !== brandId) throw fieldError("scope", "That branch belongs to a different brand");
        [scopeKey, scopeId, currencyCode] = ["locationId", loc.id, loc.currencyCode];
      }

      const channel = p.channel ?? null;
      const existing = await tx.price.findFirst({ where: { [key]: id, [scopeKey]: scopeId, channel } });
      const data = { amountMinor: p.amountMinor, compareAtMinor: p.compareAtMinor ?? null, currencyCode };
      if (existing) {
        await tx.price.update({ where: { id: existing.id }, data });
        out.push({ id: existing.id, created: false });
      } else {
        const created = await tx.price.create({ data: { tenantId: ctx.tenantId, [key]: id, [scopeKey]: scopeId, channel, ...data } });
        out.push({ id: created.id, created: true });
      }
      audit.push({ target: { [key]: id }, scope: { [scopeKey]: scopeId }, channel, before: existing ? { amountMinor: existing.amountMinor, compareAtMinor: existing.compareAtMinor } : null, after: data });
    }

    await recordAudit(tx, { action: "prices.update", entityType: "Price", entityId: out[0]!.id, after: { changes: audit } });
    return out;
  });
  res.json({ data: saved });
});

prices.post("/delete", "menu.price.edit", async (req, res) => {
  const { ids } = pricesDeleteSchema.parse(req.body);
  const ctx = requireContext();
  await db.$transaction(async (tx) => {
    const rows = await tx.price.findMany({ where: { id: { in: ids } } });
    if (rows.length !== new Set(ids).size) throw notFound("price");
    if (!ctx.allLocations && rows.some((r) => r.priceBookId)) throw forbidden("Only users with access to all branches can change price book prices");
    await tx.price.deleteMany({ where: { id: { in: ids } } });
    await recordAudit(tx, { action: "prices.delete", entityType: "Price", entityId: ids[0]!, before: { removed: rows.map((r) => ({ id: r.id, amountMinor: r.amountMinor, channel: r.channel })) } });
  });
  res.status(204).end();
});

export const pricesRouter = prices.router;
