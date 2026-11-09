import type { Prisma } from "../../generated/prisma/client.js";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const dealsRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

// A deal is orderable when it is switched on and "now" is inside its optional schedule window.
export function activeDealWhere(now = new Date()) {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
    ],
  };
}

const include = {
  items: {
    include: { menuItem: { select: { id: true, name: true, imageUrl: true, available: true, priceCents: true } } },
    orderBy: { id: "asc" },
  },
} as const;

type DealWithItems = Prisma.LegacyDealGetPayload<{ include: typeof include }>;

// `available` is derived: a deal can't be ordered while one of its parts is sold out.
function serialize(deal: DealWithItems) {
  return { ...deal, available: deal.items.every((i) => i.menuItem.available) };
}

const money = z.number().int().min(0).max(100_000_000);
const base = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  imageUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().optional(),
  dealPriceCents: money,
  originalPriceCents: money.optional(), // defaults to the sum of the parts
  isActive: z.boolean().optional(),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  items: z
    .array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(20),
});

function checks(b: Partial<z.infer<typeof base>>, ctx: z.RefinementCtx) {
  if (b.items && new Set(b.items.map((i) => i.menuItemId)).size !== b.items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Each menu item may appear only once" });
  }
  if (b.startsAt && b.endsAt && new Date(b.startsAt) >= new Date(b.endsAt)) {
    ctx.addIssue({ code: "custom", path: ["endsAt"], message: "End must be after start" });
  }
}
const createBody = base.superRefine(checks);
// Zod 4 can't .partial() a schema that already has refinements, so partial first, refine after.
const updateBody = base.partial().superRefine(checks);

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

async function sumOfParts(lines: { menuItemId: number; quantity: number }[]) {
  const menuItems = await prisma.legacyMenuItem.findMany({ where: { id: { in: lines.map((l) => l.menuItemId) } } });
  if (menuItems.length !== lines.length) throw new HttpError(422, "One or more menu items do not exist");
  const price = new Map(menuItems.map((m) => [m.id, m.priceCents]));
  return lines.reduce((sum, l) => sum + l.quantity * price.get(l.menuItemId)!, 0);
}

// ---- public: customers see only deals that are on and inside their schedule ----
dealsRouter.get("/", async (_req, res) => {
  const deals = await prisma.legacyDeal.findMany({ where: activeDealWhere(), include, orderBy: { id: "asc" } });
  res.json({ data: deals.map(serialize) });
});

// ---- admin ----
const admin = [requireAuth, requireRole("ADMIN")];

// Every deal, including switched-off and expired ones (declared before any /:id route).
dealsRouter.get("/manage", ...admin, async (_req, res) => {
  const deals = await prisma.legacyDeal.findMany({ include, orderBy: { id: "desc" } });
  res.json({ data: deals.map(serialize) });
});

dealsRouter.post("/", ...admin, async (req, res) => {
  const b = createBody.parse(req.body);
  const parts = await sumOfParts(b.items); // also validates that every menu item exists
  const original = b.originalPriceCents ?? parts;
  if (b.dealPriceCents > original) throw new HttpError(422, "Deal price cannot exceed the original price");

  const deal = await prisma.legacyDeal.create({
    data: {
      name: b.name,
      description: b.description ?? null,
      imageUrl: b.imageUrl ?? null,
      dealPriceCents: b.dealPriceCents,
      originalPriceCents: original,
      isActive: b.isActive ?? true,
      startsAt: toDate(b.startsAt) ?? null,
      endsAt: toDate(b.endsAt) ?? null,
      items: { create: b.items },
    },
    include,
  });
  res.status(201).json({ data: serialize(deal) });
});

dealsRouter.patch("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const b = updateBody.parse(req.body);
  const existing = await prisma.legacyDeal.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Not found");

  // Replacing the items recalculates the original price unless the admin supplied one.
  const parts = b.items ? await sumOfParts(b.items) : undefined;
  const original = b.originalPriceCents ?? parts ?? existing.originalPriceCents;
  const dealPrice = b.dealPriceCents ?? existing.dealPriceCents;
  if (dealPrice > original) throw new HttpError(422, "Deal price cannot exceed the original price");

  const deal = await prisma.$transaction(async (tx) => {
    if (b.items) {
      await tx.legacyDealItem.deleteMany({ where: { dealId: id } });
      await tx.legacyDealItem.createMany({ data: b.items.map((i) => ({ ...i, dealId: id })) });
    }
    return tx.legacyDeal.update({
      where: { id },
      data: {
        name: b.name,
        description: b.description,
        imageUrl: b.imageUrl,
        dealPriceCents: b.dealPriceCents,
        originalPriceCents: original,
        isActive: b.isActive,
        startsAt: toDate(b.startsAt),
        endsAt: toDate(b.endsAt),
      },
      include,
    });
  });
  res.json({ data: serialize(deal) });
});

// Deals that were ever ordered can't be deleted (409): switch them off instead.
dealsRouter.delete("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  await prisma.legacyDeal.delete({ where: { id } });
  res.status(204).end();
});
