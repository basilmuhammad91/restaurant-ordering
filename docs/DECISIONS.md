# Restoflux: Decision Log

> **Status:** **All 27 decisions ACCEPTED on 2026-11-09** (owner replied "Accept all defaults"). That includes the two open questions: **D22**: existing data is migrated, not discarded; **D18**: consolidated reports show one block per currency, with an optional converted view from a manually maintained `FxRate`. Later changes are recorded in the "Amendments" section at the bottom. **Last updated:** 2026-11-09.
> Entries marked **ASK** change existing behaviour, are expensive to reverse, or touch a requirement that was ambiguous. I will not build on them until you answer. All others are sensible defaults I will proceed with unless you object.

## Summary

| # | Decision | Recommendation | Status |
|---|---|---|---|
| D1 | Money representation | Integer minor units for amounts, Decimal for quantities/unit costs/rates | Accepted |
| D2 | Primary keys | UUIDv7 for all new tables | Accepted |
| D3 | Tenant isolation layers | Prisma extension + coverage/leak tests + composite FKs; RLS later | Accepted |
| D4 | Location model | One `Location` table with a type | Accepted |
| D5 | Users vs tenants vs customers | One tenant per user (email globally unique); staff and customers are separate tables | Accepted |
| D6 | Roles per user | Several roles, union of permissions, one global branch list | Accepted |
| D7 | Permission storage | Catalog in code, role→permission rows hold strings | Accepted |
| D8 | Approval thresholds | Per role and per currency | Accepted |
| D9 | Repo layout | npm workspaces: `api`, `web` (storefront), new `admin`, shared `packages/contracts` | Accepted |
| D10 | API envelope and error format | `/api/v1`, `{data, meta}` / `{error:{code,message,details,requestId}}` | Accepted |
| D11 | Auth tokens | 15-min access token + rotating refresh cookie; permissions loaded server-side | Accepted |
| D12 | Audit approach | Explicit `audit.record` in the same transaction | Accepted |
| D13 | Food-cost variance definition | (Actual − Theoretical) ÷ Theoretical; green < 2, amber 2-5, red > 5 | Accepted |
| D14 | Tax scope | Per-line, inclusive/exclusive, order-type rules; payment-method-dependent tax and fiscal integrations deferred | Accepted |
| D15 | Exports | CSV streamed, PDF with a pure-Node library | Accepted |
| D16 | Realtime | Polling now, SSE later | Accepted |
| D17 | Hosting and jobs | Vercel serverless + Upstash QStash; correctness never depends on a queue; drop `bullmq` | Accepted |
| D18 | Currency and consolidation | No FX inside operations; consolidated reports per currency, or via manual `FxRate` | Accepted |
| D19 | Storefront tenant resolution | Brand slug in the URL | Accepted |
| D20 | Phase 2-3 compatibility bridge | Thin bridge (vs pulling order tables into Phase 2) | Accepted |
| D21 | Demo seed size | ~30-45k orders, `--small` for dev | Accepted |
| D22 | Legacy order import assumptions | Orders become TAKEAWAY; completed orders get a synthetic "Legacy" payment | Accepted |
| D23 | Stock deduction trigger | On order COMPLETED, in the same transaction; negative stock allowed with alert | Accepted |
| D24 | Order type vs channel | Two dimensions; keep today's channel values and add PHONE, AGGREGATOR | Accepted |
| D25 | POS and KDS location | Full-screen routes inside the admin app | Accepted |
| D26 | Tenant onboarding | CLI `create-tenant`; no super-admin UI, no self-signup yet | Accepted |
| D27 | Prisma multi-file schema | Yes, after a one-hour Phase 1 spike | Accepted |

---

## Decisions that need your answer

### D1. Money representation (ASK)
**Context:** the spec allows "Prisma Decimal (or integer minor units) consistently". Today every amount is an integer in minor units (`priceCents`, paisa), with tests and UI built on it. Stock costs need sub-minor precision (Rs 0.012 per gram of flour).
**Options:** (A) everything `Decimal`; (B) **amounts as integer minor units + currency, measures and unit costs as `Decimal`**.
**Recommendation: B.**
- *Why:* integers cannot drift, are fast to sum, and match the existing code; amounts are a count of the smallest unit, while unit costs and quantities are *rates*, which genuinely need decimals. The two meet at one rounding point per posting (half-up), documented per module.
- *Cost:* JSON carries decimal strings for rates/quantities; a `Currency` table supplies each currency's exponent (KWD has 3 decimals, JPY 0).
- *Consistency rule:* "if it is an amount of money, it is minor units; if it is a rate or measurement, it is Decimal".
**Alternative cost (A):** a big rewrite of existing code/tests and Decimal handling (decimal.js) everywhere in the UI.

### D2. Primary keys: UUIDv7 (ASK)
**Context:** today `Int autoincrement`. Offline-first needs client-generated ids; multi-tenant public ids should not be guessable or reveal volume.
**Recommendation:** UUIDv7 (time-ordered, index-friendly) for all new tables; reference tables keyed by code. Old integer tables are migrated by **copy** into new tables (plan in DATA_MODEL 6), not altered in place.
**Cost:** longer ids in URLs and logs; the legacy id map during the transition.
**Alternative:** keep `Int` ids plus a separate public UUID column; simpler migrations but offline creation needs a second key and every join stays integer-based.

### D5. Users, tenants and customers (ASK)
**Context:** a person could theoretically work for two companies; customers and staff are different kinds of users.
**Recommendation:** **one tenant per staff account** (email globally unique), so login is `email + password` with no tenant picker. **Customers are a separate table** (`Customer`), optionally with a storefront login (separate token audience).
**Cost:** a person who works for two companies needs two emails (rare in restaurants).
**Alternative:** `(tenantId, email)` uniqueness plus a company chooser at login; more flexible, more UI and ambiguity.

### D9. Repository layout (ASK)
**Recommendation:** npm **workspaces** at the root with `api/`, `web/` (storefront stays), a **new `admin/`** app, and `packages/contracts` (permission catalog, enums, Zod schemas, money helpers) shared by all three.
- *Why:* one permission list and one set of validation schemas; separate deploys and bundles for the heavy shadcn admin app; `web/` does not move.
- *Cost:* root tooling, a Vercel configuration per project; slightly more setup in Phase 1.
**Alternative:** put the admin inside `web/` as another route tree (less setup, one big bundle, mixed UI kits) and duplicate the permission list.

### D10. API envelope and errors (ASK, breaking for the storefront)
**Recommendation:** `/api/v1/...`; success `{ data, meta }`; errors `{ error: { code, message, details?, requestId } }` with stable codes. Today's shape is `{ error: "text" }` and `{ data }`/`{ data, meta }`.
**Impact:** the storefront's API client is updated in Phase 1; legacy routes keep the old format until removed in Phase 3. Stable error codes let the UI branch on `APPROVAL_REQUIRED` and validation details reliably.

### D13. Variance definition (ASK)
**Context:** the spec gives thresholds (green < 2%, amber 2-5%, red > 5%) for "variance %". The industry uses two definitions.
**Recommendation:** **variance % = (actual cost − theoretical cost) ÷ theoretical cost**, per item and per branch (it answers "how much more did we use than we should have"), with food cost % of net sales (theoretical and actual) shown next to it, and thresholds configurable per tenant.
**Alternative:** percentage points of sales (actual food-cost % − theoretical food-cost %). It is common on owner dashboards but is not meaningful per item. We can show both at branch level.

### D18. Currency and consolidation (ASK)
**Context:** branches trade in PKR, AED and USD; head office wants one view.
**Recommendation:** (1) every branch has **one currency** and operations never convert; (2) purchasing is in the receiving location's currency; (3) consolidated dashboards and reports show **one block per currency by default**, and offer an optional **reporting currency** that converts with a manually maintained `FxRate(asOfDate)` table (clearly labelled "converted"); (4) approval limits are per currency.
**Why not live FX:** automatic rates need a provider, historical rates and a policy for which date applies; manual rates are auditable and enough for v1.
**Question for you:** do you need converted consolidated totals in Phase 6, or are per-currency blocks enough for the first release?

### D20. Compatibility bridge between Phase 2 and Phase 3 (ASK)
**Context:** the catalog (Phase 2) moves before orders (Phase 3), but the live storefront keeps taking orders in between.
**Recommendation:** a **thin bridge**: the storefront reads the new catalog; its checkout posts to a legacy-shaped route that stores orders in the legacy tables with the new variant id and a name snapshot; Phase 3 migrates them and deletes the bridge.
**Alternative:** pull a minimal version of the new `Order`/`OrderLine` tables into Phase 2; no bridge, but Phase 2 grows and Phase 3 loses its "migrate orders" step.
**Risk of the bridge:** two sources of truth for a short window (kept read-only for catalog data; reconciliation queries guard it).

### D22. Importing legacy orders (ASK)
**Context:** the old app has no order types, tax or payments.
**Recommendation:** imported orders become `orderType = TAKEAWAY`, `taxMinor = 0`, default branch, `Asia/Karachi` business date; `COMPLETED` orders get one **synthetic payment** on a "Legacy / unspecified" method (type OTHER) so reports balance; others stay unpaid. All are flagged `legacyOrderId` and can be excluded from cash and fraud reports.
**Question for you:** is the data in the current Neon database real, or demo/test data that can simply be discarded instead of migrated? Discarding removes the whole bridge and simplifies Phases 2 and 3.

---

## Defaults I will proceed with unless you object

| # | Context and decision | Consequence |
|---|---|---|
| **D3** | Tenant isolation: Prisma client extension (tenant, soft delete, location) + coverage test over the Prisma DMMF + leak tests per endpoint + composite FKs on critical relations. Postgres RLS is a later hardening step, not Phase 1. | Strong and testable; RLS needs a transaction per request and pooler care, so it waits. |
| **D4** | One `Location` table with `type` (BRANCH/WAREHOUSE/CENTRAL_KITCHEN); "allowed branches" means allowed locations. | Inventory, transfers and access work uniformly; only BRANCH locations sell. |
| **D6** | A user may hold several roles (permissions = union, limits = highest) plus one global location list. Per-branch role assignment (cashier at A, manager at B) is deferred. | Simple v1; extension path is a `UserLocationRole` table. |
| **D7** | The permission catalog lives in code (`packages/contracts`); `RolePermission` stores strings validated against it. | No sync step; the matrix UI reads the catalog from the API. |
| **D8** | Discount % limit on the role; void, refund, PO and adjustment limits per role **per currency** (`RoleLimit`); no row means approval always required. | Correct across currencies; more rows to seed. |
| **D11** | Access JWT 15 min (memory), rotating refresh token in an HttpOnly cookie, hashed in `Session`; roles/permissions are **not** in the JWT: one indexed query per request (session revoked? current `authVersion`?) plus a cache of the heavy permission load keyed by version. | Role changes and revocations apply on the next request; the current 7-day JWT-with-role design is replaced. Requires same-site `/api` via rewrites. |
| **D12** | Audit via explicit `audit.record(tx, ...)` calls, same transaction, before/after snapshots, redaction of secrets; no automatic model hooks. | Meaningful records and testability; discipline needed (a test per sensitive action). |
| **D14** | Tax: per-line computation, inclusive/exclusive, rules by tax category and order type, compound option, stored breakdown. **Deferred:** tax rates that depend on the payment method, and fiscal/government invoice integrations (for example FBR in Pakistan; a port interface is reserved). Seeded rates are illustrative only. | Covers the common cases; Pakistan card-vs-cash provincial differences need a later design. |
| **D15** | CSV streamed; PDF generated server-side with a pure-Node library (no headless browser). | Fits serverless limits; PDF layouts are code, not HTML templates. |
| **D16** | Live screens poll every 5-15 s with ETags; SSE can be added behind the same event layer. | Works on Vercel; slight latency. |
| **D17** | Vercel serverless API; Upstash QStash/cron call signed job endpoints; stock deduction and cash correctness are synchronous in the request transaction; `bullmq` is removed from dependencies. | No long-running workers. |
| **D19** | The storefront resolves tenant/brand from the brand slug (`VITE_BRAND_SLUG`, later `/r/:slug`); brand slugs are globally unique. | One storefront codebase serves any brand. |
| **D21** | Demo seed ≈ 30-45k orders over 90 days, chunked inserts, `--small` (7 days) and `--reset` flags, keyed by tenant slug `demo`. | Seeding takes minutes on Neon; fast option for development. |
| **D23** | Stock is deducted when an order becomes COMPLETED, inside the same transaction; negative stock is allowed (never block a sale) with a notification and report line; voids after kitchen fire become waste. | Matches how kitchens work; unexplained negatives surface in variance. |
| **D24** | Order *type* (DINE_IN/TAKEAWAY/DELIVERY) and *channel* (POS/WEB/ANDROID/IOS/PHONE/AGGREGATOR) are separate columns; existing channel values are kept; aggregators are tenant data. | Clean reporting by either dimension. |
| **D25** | POS and KDS are full-screen routes in the admin app (shared auth and permissions), extractable to a PWA later. | Faster to build; revisit when offline work starts. |
| **D26** | Tenants are created by a CLI (`create-tenant`) that also creates the Owner; no super-admin UI or public sign-up in this program. | Smaller scope; self-serve onboarding is a later product decision. |
| **D27** | Use Prisma's multi-file schema (`prisma/schema/*.prisma`); the first Phase 1 task is a one-hour spike confirming multi-file schema, `uuid(7)`, composite relations, client extensions and interactive transactions on Prisma 7.10 with the `pg` adapter. | If the spike fails, fall back to one large `schema.prisma`; documented here either way. |

## Questions that are not decisions yet (to answer before the relevant phase)
- **Phase 3:** which printers/receipt formats are required first (browser print at 80 mm is the default)?
- **Phase 3:** should cashiers on a closed shift be blocked from selling, or only warned?
- **Phase 4:** counting cadence defaults (weekly full count plus daily cycle counts on top-value items)?
- **Phase 6:** which reports must be pixel-exact PDFs versus simple tables?
- **Any phase:** Arabic/RTL needed in the first release or only designed for?

## Amendments

| Date | Decision | Change |
|---|---|---|
| 2026-11-09 | all | Accepted as written. |
| 2026-11-09 | D9 | The workspace root contains `api`, `admin` and `packages/*` in Phase 1. **`web/` stays a standalone package until Phase 2** (it does not consume `packages/contracts` yet, and the owner's storefront dev server was running, so its dependencies must not be reinstalled underneath it). |
| 2026-11-09 | D10 | Phase 1 keeps the legacy routes (`/api/...`) and their old error format untouched, so the storefront needs **no changes in Phase 1**. The new envelope is used only under `/api/v1`. |

## Amendments

- **D9 amended (2026-11-13): the old `web/` app was removed.** It was the single-restaurant storefront and admin from before the SaaS rebuild; it ran on the legacy tables and never saw the new menu, stock, offers or delivery zones, and orders placed there did not reach the POS, kitchen or reports. The workspaces are now `api`, `admin` and `packages/contracts`. A new, tenant-aware storefront (each organization or brand on its own address, reading the same sellable-menu calculation as the POS) will be built as a new app in Phase 2b. The old code stays in git history (last present at commit `95b32f6`). The legacy API routes (`api/src/legacy`) and legacy tables are still in place and are the next things to remove.
