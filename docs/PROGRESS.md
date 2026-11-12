# Restoflux: Progress and Resume Guide

> **A new session must read, in this order:** this file → [DECISIONS.md](DECISIONS.md) (what is approved) → [ARCHITECTURE.md](ARCHITECTURE.md) → [DATA_MODEL.md](DATA_MODEL.md) → [PRODUCT_SPEC.md](PRODUCT_SPEC.md). Then read the code of the phase you are about to extend.
> **Last updated:** 2026-11-12 (Phases 4 to 8 built in one pass, at the owner's request to finish every "Soon" module).

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
| **3** | Orders, POS, kitchen display, payments, shifts and cash drawer, Z-reports, dashboard sales | **Built, final test run in progress** (2026-11-10). Deferred: legacy storefront migration (2b), customers (7), service charge |
| **4** | Inventory: items, stock on hand, recipes, counts, adjustments and waste, transfers, production, automatic deduction on completed orders | **Built, API tests green** (2026-11-12) |
| **5** | Purchasing: suppliers and their packs and prices, purchase orders, receiving, supplier invoices and payments, suggested orders | **Built, API tests green** (2026-11-12) |
| **6** | Reports: sales, end of day / Z, food cost, inventory, purchasing and supplier ledger, menu engineering, fraud watch | **Built, API tests green** (2026-11-12) |
| **7** | Customers, loyalty, coupons, promotions (applied at the till, priced by the server), feedback | **Built, API tests green** (2026-11-12) |
| **8** | Delivery (zones, riders, dispatch board), staff (employees, roster, time clock), receipt template, notification settings | **Built** (2026-11-12) |

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

## What Phase 3 produced (orders, POS, kitchen, cash)
- **Money maths in the shared contracts** (`packages/contracts/src/orders.ts`, 35 unit tests including randomized checks): tax added on top or already inside the price (round half up, per line, split per authority), discounts before tax spread over lines with no cent lost (largest remainder), cash tender and change, payment status, order status machine, expected cash, trading-day rule. The POS uses the SAME functions to show live totals, so the screen cannot disagree with the server.
- **Data (migration `20261111090000_phase3_orders`):** `Order`, `OrderLine` (combo parts as child lines), `OrderLineModifier`, `OrderLineTax` (the stored tax breakdown), `OrderDiscount`, `OrderStatusEvent`, `Payment`, `Refund`, `OrderSequence`, `CashRegister`, `CashShift`, `CashMovement`, `ZReport`. Database-enforced: no negative money, refunds never exceed payments, one open shift per till, and payments, refunds, cash movements, status history and Z-reports are **append-only** (triggers). The old storefront OrderStatus enum was renamed in Prisma only (`LegacyOrderStatus`, same database type).
- **The order engine** (`api/src/modules/orders/engine.ts`): an order is priced from the branch sellable menu and tax rules, never from client numbers; names, prices and tax rates are snapshotted. It validates required choices (min and max), that add-ons belong to the product, combo slots, 86 and unpriced items, table and delivery address.
- **Safe to retry:** an order has a client-made id (same id means same order, even if two requests race), and payments too. Order numbers (KH-0042) are assigned atomically per branch and trading day.
- **API** (`/api/v1`): `POST/PUT /orders`, `GET /orders` (filters, search), status changes, `/orders/:id/payments` (split tender, change, tips, reference), line void, refund, `/kds` (tickets per station, bump), `/pos/context` (everything the till needs, gated by `pos.access`), `/shifts` (open, movements, close with expected vs counted, blind close), `/cash-registers`, `/z-reports` (shift and day), `/reports/sales-summary`, `/dashboard/summary` (money hidden without `dashboard.financial.view`).
- **Approvals wired in:** discounts above a role limit, voids and refunds above limits, and cancelling a sent order need a manager. The API error says exactly what to approve (including the payload hash), the till shows a PIN dialog, then retries. An approval is single-use and bound to that exact action.
- **Admin screens:** **POS** (full screen: categories, photo cards, deals, dietary filters, search, size, add-on and combo pickers, basket with live totals, discount, hold, send, pay with split tender and change, receipt printing at 80 mm, running orders, open shift), **Live orders** board, **Kitchen display**, **Order history** with full detail (void, refund, receipt), **Shifts & cash** (open, cash in, cash out, paid out, safe drop, close and count, Z-reports, end-of-day report), and **real dashboard numbers** (net sales, tax, collected, per-day trend, order types, payment methods, channels, voids, refunds and cancellations, per currency).
- **Demo data:** `npm run seed:demo-orders` adds about ten days of believable trading at the four demo branches (about 600 orders, shifts, Z-reports). `-- --reset` regenerates it.
- **Connection pool:** the database client now drops idle connections early (Neon closes idle ones), which removed the intermittent "Server has closed the connection" test failures.

### Decisions made while building Phase 3
- A **cashier cannot void or refund at all** (least privilege, as approved). A manager voids and refunds; a custom role can hold `orders.void` with a small limit, and anything above it needs a manager PIN.
- Tips handed over in cash count as cash in the drawer. Tax-inclusive and tax-exclusive branches coexist (the branch tax profile decides).
- Held bills (status OPEN) are edited in place (`PUT /orders/:id`); once sent to the kitchen an order changes only by void or refund.

### Known limitations (Phase 3)
- Service charge is not modelled (tips are recorded per payment).
- Stock is not deducted yet (Phase 4 posts it when an order completes).
- No customer accounts yet (name and phone are stored on the order; Phase 7).
- Delivery fees are typed at the till; zones and rider assignment come in Phase 8.
- Receipts print through the browser (80 mm CSS); direct thermal-printer drivers and cash-drawer kick are not included.
- The legacy storefront still uses its own order tables (Phase 2b migrates and rebuilds it).

## What Phases 4 to 8 produced (the back office)
Every item in the sidebar is now a real screen: the navigation has no "Soon" marker left. Each phase has its own migration and API test file (`tests/v1/inventory`, `purchasing`, `reports`, `marketing`, `operations`).

### Phase 4: inventory (`modules/inventory`, migration `20261112090000_phase4_inventory`)
- **One stock engine.** Every change to stock goes through `postMovement()` (`stock.ts`): it locks the branch's stock level, writes one ledger row, updates the running quantity and the **weighted average cost**, all in the caller's transaction. The ledger (`stock_movements`) is **append-only** (trigger) and stock can never go below zero except for sales (a sale is never blocked by a wrong shelf count).
- **Data:** `InventoryItem` (unit kg/g/l/ml/pcs, kind RAW/PREP/PACKAGING, reference cost, reorder and par level), `StockLevel`, `StockMovement`, `Recipe` + `RecipeLine` (a menu variant or a prep batch, with waste %), `StockCount` (+lines), `StockTransfer` (+lines), `ProductionRun`. Quantities are decimals, shown to the API as numbers (`core/db/decimal.ts`).
- **Automatic deduction:** completing an order takes its recipes' ingredients out of that branch's stock in the same transaction (`consumeForOrder`, idempotent). Items without a recipe use no stock.
- **Screens:** Stock on hand (value, low and out, adjust), Items, Recipes (cost per portion), Counts (blind count sheet, submit, manager approves and stock is corrected), Adjustments and waste (the ledger plus the form), Transfers (request, ship, receive with shortages), Production (batches).
- **Alerts:** an item falling to its reorder level raises a LOW_STOCK notification once a day per branch.

### Phase 5: purchasing (`modules/purchasing`, migration `20261113090000_phase5_purchasing`)
- Suppliers with payment terms; what they sell as **packs** (a 25 kg sack at a price, one preferred supplier per item); purchase orders (draft, approve, send, cancel); **receiving** posts PURCHASE ledger rows at the order's price (partial deliveries, over-receiving refused) and keeps the supplier's catalogue price current; direct receipts without an order; supplier invoices (unique per supplier, due date from terms), payments (append-only, never over the balance), void; **suggested orders** (items at their reorder level topped up to par, rounded up to whole packs, grouped by preferred supplier, unsourced items listed).

### Phase 6: reports (`modules/reports`, no schema change)
- Sales (overview, by day/week/month, by source, cancellations and refunds, tax and payments), End of day / Z list and generator, **Food cost** (theoretical from recipes plus waste and counted losses, actual %, coverage warning), **Inventory** (valuation by location and category, movement, most used), **Purchasing** (spend, payables ageing, biggest purchases, **supplier ledger** with running balance), **Menu engineering** (stars, plowhorses, puzzles, dogs), **Fraud watch** (voids, refunds, discounts, cash taken out, till shortages and write-offs per person, flagged when far above colleagues). **A report is always in one currency** (the organization's own unless another is chosen); CSV export on the main tables.

### Phase 7: customers and marketing (`modules/customers`, migration `20261114090000_phase7_customers_marketing`)
- **Customers** are matched to orders by phone number (normalised) and created automatically when an order with a phone number completes; profile shows orders, spend, last order, points and feedback.
- **Coupons and promotions are priced by the server.** The till sends only a code or a promotion id (`offer` on the order); `offers.ts` checks it (active, dates, use limit, customer-bound, branch, weekday and time window in the branch's own time zone, minimum spend) and turns it into an ordinary order discount, so a cashier without discount rights can use one and nobody can invent an amount. Usage is counted when the order completes.
- **Loyalty:** one programme per organization (spend per point, point value, minimum to redeem); points are earned on net spend when an order completes (organization's own currency only); the points ledger is append-only; redeeming turns points into a single-use coupon tied to the customer's phone number.
- **Feedback:** ratings and comments per branch, reply, resolve, average and distribution.
- **POS:** the Discount button opens "Coupon or offer" (code box and the promotions running right now) and, for people allowed, "Manual".

### Phase 8: delivery, staff, settings (`modules/operations`, migration `20261115090000_phase8_delivery_staff`)
- **Delivery:** zones with fee, minimum order and usual time (the POS shows them as one-tap chips that fill in the fee), riders, and a **dispatch board** (needs a rider, on the road, delivered): assign, picked up, delivered, failed with a reason, change rider. Picking up moves the order to "out for delivery"; delivering a paid order completes it (stock, coupons and loyalty follow as for any completed order); an unpaid one stays open for cash collection.
- **Staff:** employees (a login is optional), a weekly **roster** (no overlapping shifts for one person, night shifts past midnight, copy a week), a **time clock** (clock in and out, one open entry per person enforced by the database, managers correct times with a mandatory reason that goes to the audit log) with hours and an estimated labour cost.
- **Settings:** an organization **receipt template** (header, footer, tax breakdown, customer line) used by the printed receipt (a branch's own header and footer still win), and per-person **notification** switches that filter the bell.

### Decisions made while building Phases 4 to 8
- Costs are stored in **minor units per base unit** (decimals), and forms accept normal money. Cost in reports uses the average across stocked branches, or the reference cost when nothing is stocked.
- Reports never add different currencies; a currency picker appears when branches use more than one.
- A coupon or promotion needs no discount permission or manager approval, because the server decides its value; a manual discount still does.
- Delivery assignment is separate from the order status machine; only pick-up and a paid delivery move the order.

### Known limitations (Phases 4 to 8)
- No batch or expiry tracking yet; no per-modifier stock use (add-ons do not deduct stock); refunds do not restock automatically (record a correction or waste entry).
- Purchase order approval has no money limit yet (any holder of `purchasing.approve` approves); no credit notes or three-way invoice matching.
- Reports show the organization's own currency by default and are not yet exportable to PDF. There is no income statement or expense report (no expense module yet).
- Loyalty points are earned in the organization's own currency only; no tiers; no email or SMS to customers (opt-in is recorded).
- Delivery has no live rider tracking or route maths; zones are named areas with a fee, not map polygons. The time clock is operated by managers (no self-service or PIN kiosk yet) and there is no payroll export.
- Receipt templates are organization-wide (not per brand); direct thermal-printer drivers are still out of scope.
- Real-time updates are still timer polling (kitchen 5 s, orders 8 s, dashboard 30 s); server push (SSE) is a hosting decision, see the realtime notes in DECISIONS.
- Photo upload is not built: images are still URLs. Planned: Cloudflare R2 with signed uploads and resizing.

## Next steps
1. **You:** review Phases 1 to 8 on the demo organization: `npm run seed:demo-ops -w api` adds sample inventory, recipes, suppliers, customers, offers, delivery and staff data to the demo tenant.
2. **Open:** Phase 2b (move the legacy menu into the new catalog, rebuild a thin storefront on `catalog/sellable`, remove the old admin pages from `web/`).
3. **Open:** image uploads (R2), server push for live screens, self-service sign-up and billing, support impersonation, and the limitations listed above.

## Change log
| Date | Change |
|---|---|
| 2026-11-09 | Phase 0 documents written (spec, architecture, data model, decisions, progress). |
| 2026-11-09 | Phase 1 built: tenancy, org, IAM, approvals, audit, `/api/v1`, admin app shell. 219 API + 19 admin tests green. |
| 2026-11-09 | Phase 1B built: platform console and API, organization lifecycle and plan limits, per-organization theme. |
| 2026-11-10 | Phase 2a built: catalog schema, price resolution, menus and dayparts, 86, sellable menu API, admin Menu screens, demo menu. |
| 2026-11-10 | Phase 3 built: order engine and money maths, POS, live orders, kitchen display, order history, shifts and cash, Z-reports, dashboard sales, demo orders. |
| 2026-11-12 | POS menu restyled (skeleton loader, quiet cards); dashboard opens on the organization's currency. |
| 2026-11-12 | Phases 4 to 8 built: inventory and recipes, purchasing, reports, customers and marketing (coupons, promotions, loyalty, feedback), delivery, staff, receipt template, notification settings. Every sidebar item is now a real screen. |
