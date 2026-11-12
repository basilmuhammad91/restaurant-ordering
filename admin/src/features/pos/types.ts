// Shapes of what the till reads from the API.

export interface PosMethod { id: string; name: string; type: string; requiresReference: boolean; opensDrawer: boolean }
export interface PosReason { id: string; type: string; name: string; requiresNote: boolean }
export interface PosTable { id: string; name: string; seats: number; section: string | null }

export interface PosContext {
  location: { id: string; name: string; currencyCode: string; timezone: string; orderPrefix: string | null; receiptHeader: string | null; receiptFooter: string | null; address: string | null; city: string | null; phone: string | null };
  currency: { code: string; exponent: number; symbol: string };
  paymentMethods: PosMethod[];
  tables: PosTable[];
  reasons: { discount: PosReason[]; void: PosReason[]; refund: PosReason[]; cashOut: PosReason[] };
  shift: { id: string; registerId: string; openedAt: string; openingFloatMinor: number; isBlindClose: boolean } | null;
}

export interface PosOrderLine {
  id: string; parentLineId: string | null; kind: "ITEM" | "COMBO" | "COMBO_ITEM"; variantId: string | null; comboId: string | null; nameSnapshot: string; variantNameSnapshot: string | null;
  quantity: number; unitPriceMinor: number; lineSubtotalMinor: number; discountMinor: number; taxMinor: number; lineTotalMinor: number; status: string; notes: string | null; stationKey: string | null;
  modifiers: { id: string; optionId: string; nameSnapshot: string; priceMinor: number }[];
  taxes: { id: string; ruleNameSnapshot: string; authorityCode: string; rateBp: number; baseMinor: number; taxMinor: number; isInclusive: boolean }[];
  children: PosOrderLine[];
}

export interface PosOrder {
  id: string; orderNumber: string; displayNumber: number | null; locationId: string; brandId: string; businessDate: string; orderType: string; channel: string; status: string; paymentStatus: string;
  customerName: string | null; customerPhone: string | null; tableId: string | null; covers: number | null; notes: string | null; deliveryAddress: { line1: string; area?: string | null; city?: string | null } | null;
  currencyCode: string; subtotalMinor: number; discountMinor: number; taxMinor: number; deliveryFeeMinor: number; tipMinor: number; totalMinor: number; paidMinor: number; refundedMinor: number; dueMinor: number;
  pricesIncludeTax: boolean; occurredAt: string; placedAt: string; completedAt: string | null; cancelledAt: string | null; cancelNote: string | null;
  lines: PosOrderLine[];
  discounts: { id: string; valueType: string; value: number; amountMinor: number; note: string | null }[];
  payments: { id: string; amountMinor: number; tenderedMinor: number; changeMinor: number; tipMinor: number; reference: string | null; occurredAt: string; paymentMethod: { name: string; type: string } }[];
  refunds: { id: string; amountMinor: number; note: string | null; occurredAt: string; paymentMethod: { name: string; type: string } }[];
  events: { id: string; fromStatus: string | null; toStatus: string; at: string; note: string | null }[];
  location: { name: string; orderPrefix: string | null; timezone: string; receiptHeader: string | null; receiptFooter: string | null; address: string | null; city: string | null; phone: string | null };
}
