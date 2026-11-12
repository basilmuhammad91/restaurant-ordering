import { Prisma } from "../../generated/prisma/client.js";

// Quantities and per-unit costs are Postgres decimals. Prisma returns them as Decimal objects, which JSON
// would turn into strings ("2.500"). Our ranges are tiny compared with what a double holds exactly, so the
// API sends plain numbers instead: one rule here instead of a conversion in every route.
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function toJSON(this: Prisma.Decimal) {
  return this.toNumber();
};
