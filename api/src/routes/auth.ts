import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { signToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { HttpError } from "../middleware/error.js";

export const authRouter = Router();

// Zod schemas play the role of Laravel FormRequest rules.
const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(72), // bcrypt ignores bytes after 72
});
const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

const publicUser = { id: true, name: true, email: true, role: true, createdAt: true } as const;

// Compared against when the email doesn't exist, so login takes the same
// time either way (prevents user enumeration via timing).
const dummyHash = bcrypt.hashSync("not-a-real-password", 10);

authRouter.post("/register", async (req, res) => {
  const { name, email, password } = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    // role is never taken from the request body: no mass-assignment hole.
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: publicUser,
    });
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      throw new HttpError(409, "Email already registered");
    }
    throw err;
  }
});

authRouter.post("/login", async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  const ok = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !ok) throw new HttpError(401, "Invalid credentials");

  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    token: signToken(user),
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUser });
  if (!user) throw new HttpError(401, "User no longer exists");
  res.json({ user });
});
