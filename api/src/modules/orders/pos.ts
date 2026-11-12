import { idSchema } from "@restoflux/contracts";
import { z } from "zod";
import { db } from "../../core/db/scoped.js";
import { notFound } from "../../core/http/errors.js";
import { securedRouter } from "../../core/http/secured.js";

// The POS screen's one-call bootstrap. A cashier does not have the "organization" permissions that the
// admin screens use to read payment methods, tables and reasons, so the till gets exactly what it needs
// through its own permission (pos.access) and nothing more.

const pos = securedRouter("/api/v1/pos");

pos.get("/context", "pos.access", async (req, res) => {
  const { locationId } = z.object({ locationId: idSchema }).parse(req.query);
  const location = await db.location.findFirst({
    where: { id: locationId },
    select: { id: true, name: true, type: true, brandId: true, currencyCode: true, timezone: true, orderPrefix: true, receiptHeader: true, receiptFooter: true, address: true, city: true, phone: true, businessDayStartTime: true },
  });
  if (!location || location.type !== "BRANCH") throw notFound("branch");

  const [links, tables, reasons, shift, currency] = await Promise.all([
    db.locationPaymentMethod.findMany({ where: { locationId, isEnabled: true }, orderBy: { sortOrder: "asc" } }),
    db.diningTable.findMany({ where: { locationId, isActive: true }, orderBy: [{ section: "asc" }, { name: "asc" }], select: { id: true, name: true, seats: true, section: true } }),
    db.reasonCode.findMany({ where: { type: { in: ["VOID", "REFUND", "DISCOUNT", "CASH_OUT"] } }, orderBy: { name: "asc" }, select: { id: true, type: true, name: true, requiresNote: true } }),
    db.cashShift.findFirst({ where: { locationId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true, registerId: true, openedAt: true, openingFloatMinor: true, isBlindClose: true } }),
    db.currency.findFirst({ where: { code: location.currencyCode } }),
  ]);
  const methods = await db.paymentMethod.findMany({ where: { id: { in: links.map((l) => l.paymentMethodId) }, isActive: true }, select: { id: true, name: true, type: true, requiresReference: true, opensDrawer: true } });
  const order = new Map(links.map((l, i) => [l.paymentMethodId, i]));

  res.json({
    data: {
      location,
      currency: { code: location.currencyCode, exponent: currency?.minorUnitExponent ?? 2, symbol: currency?.symbol ?? location.currencyCode },
      paymentMethods: methods.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
      tables,
      reasons: {
        discount: reasons.filter((r) => r.type === "DISCOUNT"), void: reasons.filter((r) => r.type === "VOID"),
        refund: reasons.filter((r) => r.type === "REFUND"), cashOut: reasons.filter((r) => r.type === "CASH_OUT"),
      },
      shift,
    },
  });
});

export const posRouter = pos.router;
