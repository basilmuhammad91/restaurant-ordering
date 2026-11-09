// Legacy storefront code uses the plain (unscoped) client: its tables have no tenant.
// Deleted together with the legacy folder in Phase 3.
export { unscopedDb as prisma } from "../core/db/client.js";
