import bcrypt from "bcrypt";
import { env } from "../config/env.js";

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, env.BCRYPT_ROUNDS);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/**
 * Compared against when the account does not exist, so a login attempt takes the same time either way
 * (prevents discovering which emails are registered by timing).
 */
export const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", env.BCRYPT_ROUNDS);
