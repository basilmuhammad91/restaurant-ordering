# Restoflux: Progress and Resume Guide

> **A new session must read, in this order:** this file → [DECISIONS.md](DECISIONS.md) (what is approved) → [ARCHITECTURE.md](ARCHITECTURE.md) → [DATA_MODEL.md](DATA_MODEL.md) → [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Then read the code of the phase you are about to extend.
> **Last updated:** 2026-11-09.

## Working agreement
- One phase per session. Build it, make `typecheck` and **all tests** pass, update these docs, **stop** with a summary, wait for review.
- Ambiguity or conflict with existing code: ask, do not guess.
- Never print or change values in any `.env` file.
- Keep the existing storefront working at the end of every phase.

## Status board

| Phase | Scope | Status |
|---|---|---|
| **0** | Planning docs | **Approved 2026-11-09** (all decisions accepted) |
| 1 | Tenancy, organization, users, roles and permissions, audit, admin app shell | **Done, awaiting review** (2026-11-09) |
| **1B** | Platform layer: Restoflux super-admin console, organization management, per-organization theme | **Built, tests running** (2026-11-09) |
| **2a** | Catalog core: categories, products and sizes, modifiers, combos, menus and dayparts, prices, branch availability (86), demo menu, admin Menu screens | **Built, final test run in progress** (2026-11-10) |
| 2b | Move the legacy menu into the new catalog, rebuild a thin storefront on it, remove the old admin pages from `web/` | Not started |
| 3 | Orders, POS, KDS, payments, shifts and cash drawer | Not started |
| 4 | Inventory, recipes, automatic deduction | Not started |
| 5 | Purchasing and suppliers | Not started |
| 6 | Dashboard and reports | Not started |
| 7 | Customers, promotions, coupons, loyalty | Not started |
| 8 | Delivery and staff | Not started |

## Baseline (before Phase 1)
- **API** (`api/`): Express 5 + TypeScript ESM, Prisma 7.10.1 on Neon, Zod, JWT + bcrypt, Vitest + Supertest. Routes: auth, categories, menu-items, deals, orders, stats, health. **38 tests passing**, typecheck clean.
- **Web** (`web/`): React 19 + Vite + Tailwind v4 + react-router; customer storefront plus a basic admin (dashboard, live order board, menu, deals). Brand: Restoflux (single source `web/src/brand.ts`).
- **Data:** 3 migrations; integer ids; money in integer minor units (PKR paisa); demo seed (10 items, 4 deals, 60 demo orders).
- **Git:** 4 commits on the main branch at the time of planning.

## What Phase 0 produced
- [PRODUCT_SPEC.md](PRODUCT_SPEC.md): scope, personas, problem traceability, 12 modules with rules and acceptance criteria, roles and permission catalog, admin UI spec, seed spec, phases and Definition of Done.
- [ARCHITECTURE.md](ARCHITECTURE.md): repo layout, module boundaries, request lifecycle, tenancy, auth, RBAC, approvals, audit, API conventions, money/tax/time/units, stock and cash design, food-cost model, reporting, jobs, offline-readiness, admin app, testing, tooling.
- [DATA_MODEL.md](DATA_MODEL.md): ~110 entities by module, constraints, and the migration plan from the current schema.
- [DECISIONS.md](DECISIONS.md): 27 decisions; 9 need the owner's answer (marked **ASK**).

## What Phase 1 produced
- **Workspaces:** `packages/contracts` (permission catalog, default roles, enums, Zod schemas, brand), `api`, `admin`. `web` joins in Phase 2 (D9).
- **Tenancy:** `tenantId` everywhere, enforced once in the Prisma client extension (`api/src/core/db/scoped.ts`) from an AsyncLocalStorage context; fail-closed; coverage test over the generated Prisma metadata; legacy tables kept as `Legacy*` models.
- **IAM:** access JWT + rotating refresh cookie with replay detection, `authVersion` so permission changes apply on the next request, roles with per-currency approval limits, branch scoping, POS PIN with lockout, anti-escalation rules, approvals (inbox or inline PIN override), notifications, append-only audit log (DB triggers).
- **API `/api/v1`:** auth, org (brands, price books, locations, opening hours, tables, stations, tax, payment methods, reason codes, tenant, currencies), users, roles and permission matrix, approvals, audit, notifications. Every route declares its access via `securedRouter()`.
- **Admin app (`admin/`):** shadcn/ui shell (sidebar from permissions, branch/brand and date-range scope, command search, notifications, theme), login, dashboard shell, organization screens, users, roles and matrix, approvals, audit log. Later modules show as "Soon" in the sidebar.
- **Scripts:** `bootstrap:default-tenant`, `create-tenant`, `seed:demo [--reset]`, `test:cleanup` (removes tenants leaked by an aborted test run).

### Run it
```bash
npm install
npm run bootstrap:default-tenant -w api   # once; idempotent
npm run seed:demo -w api                  # prints one password per demo role, once
npm run dev:api                           # :4000
npm run dev:admin                         # :5174
npm run typecheck                         # all workspaces
npm test                                  # all workspaces
```

### Tests (all green at hand-off)
**API: 19 files, 219 tests passing. Admin: 2 files, 19 tests passing. Typecheck clean in api, admin and contracts.** Suites: `api/tests/core` (policy, pagination, contracts, tenancy coverage), `api/tests/v1` (auth, org, users and roles, security permission matrix + tenant leak matrix, location scope, approvals, audit and notifications, provisioning), `api/tests/legacy` (38 original storefront tests), `admin/tests` (navigation by permission, money and date-range helpers).

### Known limitations
- Rate limiting is in memory, per instance (Upstash planned with the Vercel move).
- Notifications are marked read one at a time (no "mark all").
- Tests run against the remote Neon database, so the full API suite is slow (minutes). If a run is aborted, `npm run test:cleanup -w api` removes leaked test tenants.
- The admin bundle is a single ~1 MB chunk; route-level code splitting comes with the heavier modules.
- The legacy storefront still uses its own old error format (D10) and is untouched.
- Demo and default tenants live in the same Neon database as the legacy data.

## What Phase 1B produced (platform layer, added after Phase 1 on the owner's request)
- **Separate platform auth.** `PlatformUser`, `PlatformSession`, `PlatformAuditLog` tables (outside every tenant; audit log is append-only by trigger). Token audience `platform`, refresh cookie `rf_platform` scoped to `/api/v1/platform/auth`. A restaurant token is rejected by platform routes and the other way round (tested).
- **Platform API `/api/v1/platform`:** auth (login, refresh with replay detection, logout, me), organizations (list with counts, last activity, search/filter/sort; summary; create with generated owner password shown once; update plan and limits; suspend/reactivate; reset an owner's password), platform audit log, team (add, disable). Own route registry (`platformRouter`) with a test that only login/refresh/logout are public.
- **Organization lifecycle:** `TenantStatus` is now TRIAL / ACTIVE / SUSPENDED; plan label, trial end, `maxLocations`, `maxUsers`. Suspending revokes every session and blocks sign-in and refresh at once. Limits are enforced on creating users and locations (`PLAN_LIMIT` 403).
- **Per-organization theme.** `Tenant.theme` (primary colour, optional sidebar colour, corner roundness), validated by `themeSchema`; text colours are derived for contrast. Returned in `/auth/me`; edited at **Settings > Organization & appearance** with live preview, presets and reset. Applied as CSS variables by `admin/src/lib/theme.ts`.
- **Admin app:** `/platform` console (separate login, organizations list and detail, platform audit, team) and the organization settings page.
- **Script:** `npm run create-platform-admin -w api -- --email <e> --name "<n>" [--password <12+>]` (generates and prints a password once if omitted).
- **Migration:** `20261109124651_phase1b_platform_theme`.

### Platform console: how to sign in
Open `http://localhost:5174/platform`. The first account is created with the script above; the console can then add more team members.

### Known limitations (1B)
- No self-service signup or billing yet: organizations are created by the platform team only.
- No impersonation ("view as organization"): support is limited to resetting an owner's password and changing plan, limits and status.
- Platform login rate limiting is in memory (same limitation as staff login).

## What Phase 2a produced (catalog core)
- **Data (migration `20261110090000_phase2a_catalog`):** `Category`, `Product`, `ProductVariant`, `ModifierGroup`, `ModifierOption`, `ProductModifierGroup`, `Menu`, `MenuSchedule`, `MenuProduct`, `MenuCombo`, `Combo`, `ComboSlot`, `ComboSlotOption`, `Price`, `LocationAvailability`. All tenant-scoped, composite tenant-safe foreign keys, soft delete on the master data.
  - Database-enforced rules: names unique per brand (case-insensitive, live rows only); exactly one default variant per product and one default menu per brand; a price has exactly one target and exactly one scope; one price per target + scope + channel; modifier min <= max; schedule days 0 to 6 and "HH:MM" times; availability has exactly one target.
- **Price resolution (pure, in `packages/contracts`):** branch + channel, then branch, then price book + channel, then price book. No price found means the item is not sold there. Prices are integer minor units; the API stamps the currency from the book or branch, so they cannot disagree.
- **Menus and dayparts (pure rules):** evaluated in the branch's timezone, windows can run past midnight (they belong to the day they started), a brand with no menus sells everything priced, a menu with no schedule is served only if it is the default.
- **86:** per-branch sold-out flag, optional timer, "unlisted at this branch", bulk restock. Takes effect on the next read.
- **`GET /api/v1/catalog/sellable?locationId&channel&at`:** the one answer to "what can this branch sell right now, in this channel, at what price" (active item, a served menu, a price, not unlisted, not 86'd, modifier options and combos included). The POS (Phase 3) and the storefront will both use it, so they cannot disagree.
- **API:** categories, products (with sizes and add-on links in one transaction), modifier groups, combos, menus, prices (upsert, list, delete), availability, sellable. Reading needs `menu.view`, writing `menu.manage`, prices `menu.price.edit`, 86 `menu.availability.toggle`. Branch-limited users can price and 86 only their own branch; price-book prices need all-branch access. Everything is audited.
- **Admin (Menu group):** Products (sizes, add-ons, indicators, allergens, station, tax category, price editor with branch and channel special prices), Categories, Modifier groups (with add-on prices), Combos & deals (choice slots, bundle price with "was" price, up-charges, time window), Menus & dayparts, Branch availability (86 board).
- **Demo menu:** `npm run seed:demo` includes it; for an existing demo tenant run `npm run seed:demo-menu` (`-- --reset` rebuilds only the menu and keeps all passwords). 23 products, 4 add-on groups, 1 combo, lunch and dinner menus for Saffron Table, PKR / AED / USD prices, a web-channel price, a branch override, two 86 / unlisted examples.

### Deferred to Phase 2b (decided, not forgotten)
- Copying the legacy menu items and deals into the new catalog, and the compatibility bridge so storefront orders keep working.
- The thin customer storefront rebuilt on `catalog/sellable`, and removing the old admin menu/deals pages from `web/`.
- Product images upload (images are URLs for now).
- Date-limited prices (`validFrom` / `validTo`): promotions in Phase 7 cover time-based pricing.

### Notes for later phases (from the owner's reference screenshots)
- POS (Phase 3): category list on the left, product grid with photos, order-type tabs (online, dine-in, delivery, takeaway), settle / running orders, cart with subtotal, tax, service charge, discount, delivery charge, hold / sync.
- Reports (Phase 6): dashboard tiles (net sale, tax, net sale incl. tax, delivery charges, service charges, total collected), sales by order type, by payment method, by channel (including aggregators), day of week, branch comparison, last three months; daily, monthly, work-period, source-wise, cancelled orders and cancelled items, income statement, expense report, supplier ledger, discounts, hourly sales, stock ledger and stock consumption.

## Next steps
1. **You:** review Phases 1 and 1B (sign in as the demo Owner, change the theme; sign in to `/platform`, create an organization, suspend it and watch its users get signed out).
2. **You:** review Phase 2a (Menu screens in the admin app).
3. **Phase 2b**, then **Phase 3** (orders, POS, kitchen display, shifts and cash), and so on through Phase 8 until no "Soon" item is left in the sidebar.

## Change log
| Date | Change |
|---|---|
| 2026-11-09 | Phase 0 documents written (spec, architecture, data model, decisions, progress). |
| 2026-11-09 | Phase 1 built: tenancy, org, IAM, approvals, audit, `/api/v1`, admin app shell. 219 API + 19 admin tests green. |
| 2026-11-09 | Phase 1B built: platform console and API, organization lifecycle and plan limits, per-organization theme. |
| 2026-11-10 | Phase 2a built: catalog schema, price resolution, menus and dayparts, 86, sellable menu API, admin Menu screens, demo menu. |
