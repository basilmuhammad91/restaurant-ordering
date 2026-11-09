import { Router } from "express";
import { prisma } from "../prisma.js";

// A Router is like a Laravel route file / route group.
export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

healthRouter.get("/db", async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", database: "up" });
});
