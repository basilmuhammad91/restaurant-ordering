import { Prisma } from "../../generated/prisma/client.js";

// What the tenancy extension needs to know about each model, derived from the generated client so
// that adding a model to the schema cannot silently skip scoping:
//   - has a `tenantId` field  -> tenant scoped (automatic)
//   - has a `deletedAt` field -> soft delete (automatic)
//   - location scoping is DECLARED below and enforced by a coverage test (tests/core/tenancy.coverage.test.ts)

type FieldEnums = Record<string, Record<string, string> | undefined>;
const enums = Prisma as unknown as FieldEnums;

const fieldsOf = (model: string): Set<string> => new Set(Object.keys(enums[`${model}ScalarFieldEnum`] ?? {}));

export interface ModelMeta {
  tenantScoped: boolean;
  softDelete: boolean;
  /** Column holding the location id, and whether rows without a location (tenant-wide) exist. */
  location: { field: string; nullable: boolean } | null;
}

/**
 * Models filtered by the user's allowed locations. `Location` is filtered by its own id.
 * Nullable = rows with no location (company-wide) stay visible to everyone in the tenant.
 */
export const LOCATION_SCOPED: Readonly<Record<string, { field: string; nullable: boolean }>> = {
  Location: { field: "id", nullable: false },
  LocationOpeningHour: { field: "locationId", nullable: false },
  DiningTable: { field: "locationId", nullable: false },
  KitchenStation: { field: "locationId", nullable: false },
  LocationPaymentMethod: { field: "locationId", nullable: false },
  UserLocation: { field: "locationId", nullable: false },
  ApprovalRequest: { field: "locationId", nullable: true },
  AuditLog: { field: "locationId", nullable: false }, // company-wide entries are hidden from branch-limited users
  Notification: { field: "locationId", nullable: true },
  LocationAvailability: { field: "locationId", nullable: false },
  Price: { field: "locationId", nullable: true }, // company-wide (price book) prices stay visible; branch overrides are branch-scoped
};

/** Models that have no tenantId on purpose. Anything else without one fails the coverage test. */
export const NOT_TENANT_SCOPED: ReadonlySet<string> = new Set([
  "Currency", // shared reference data
  "Tenant", // scoped by its own id instead
  "PlatformUser", "PlatformSession", "PlatformAuditLog", // the Restoflux team: outside every tenant
  // Legacy single-restaurant tables: removed in Phase 3
  "LegacyUser", "LegacyCategory", "LegacyMenuItem", "LegacyOrder", "LegacyOrderItem",
  "LegacyDeal", "LegacyDealItem", "LegacyOrderDeal",
]);

const cache = new Map<string, ModelMeta>();

export function metaFor(model: string): ModelMeta {
  let meta = cache.get(model);
  if (!meta) {
    const fields = fieldsOf(model);
    meta = {
      tenantScoped: fields.has("tenantId"),
      softDelete: fields.has("deletedAt"),
      location: LOCATION_SCOPED[model] ?? null,
    };
    cache.set(model, meta);
  }
  return meta;
}

export const allModelNames = (): string[] => Object.values(Prisma.ModelName);
export const modelFields = fieldsOf;
