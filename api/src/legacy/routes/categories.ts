import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const categoriesRouter = Router();

const idParam = z.object({ id: z.coerce.number().int().positive() });
const body = z.object({ name: z.string().trim().min(1).max(100) });

// Public read, admin-only write. Same as Route::get(...) outside the auth group
// and Route::middleware(['auth', 'role:admin']) around the rest.
categoriesRouter.get("/", async (_req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
  res.json({ data: categories });
});

const admin = [requireAuth, requireRole("ADMIN")];

categoriesRouter.post("/", ...admin, async (req, res) => {
  const data = body.parse(req.body);
  res.status(201).json({ data: await prisma.category.create({ data }) });
});

categoriesRouter.patch("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  const data = body.parse(req.body);
  res.json({ data: await prisma.category.update({ where: { id }, data }) });
});

// Fails with 409 (FK violation) while menu items still use the category.
categoriesRouter.delete("/:id", ...admin, async (req, res) => {
  const { id } = idParam.parse(req.params);
  await prisma.category.delete({ where: { id } });
  res.status(204).end();
});
