import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const menuItemsRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  // query strings are always text, so "true"/"false" need explicit handling
  available: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

const createBody = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  priceCents: z.number().int().min(0).max(1_000_000),
  available: z.boolean().optional(),
  categoryId: z.number().int().positive(),
});
// PATCH = every field optional (partial update)
const updateBody = createBody.partial();

const include = { category: { select: { id: true, name: true } } } as const;

menuItemsRouter.get("/", async (req, res) => {
  const { categoryId, available } = listQuery.parse(req.query);
  const items = await prisma.menuItem.findMany({
    where: {
      ...(categoryId !== undefined && { categoryId }),
      ...(available !== undefined && { available }),
    },
    include,
    orderBy: [{ categoryId: "asc" }, { name: "asc" }],
  });
  res.json({ data: items });
});

menuItemsRouter.get("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const item = await prisma.menuItem.findUnique({ where: { id }, include });
  if (!item) throw new HttpError(404, "Not found");
  res.json({ data: item });
});

const admin = [requireAuth, requireRole("ADMIN")];

menuItemsRouter.post("/", ...admin, async (req, res) => {
  const data = createBody.parse(req.body);
  // A bad categoryId raises a foreign-key error, mapped to 409 by the error handler.
  const item = await prisma.menuItem.create({ data, include });
  res.status(201).json({ data: item });
});

menuItemsRouter.patch("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = updateBody.parse(req.body);
  const item = await prisma.menuItem.update({ where: { id }, data, include });
  res.json({ data: item });
});

// Items already ordered can't be deleted (FK, 409): mark them unavailable instead.
menuItemsRouter.delete("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  await prisma.menuItem.delete({ where: { id } });
  res.status(204).end();
});
