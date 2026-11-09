# Restoflux: Product Specification

> **Status:** Phase 0 draft, awaiting review. **Last updated:** 2026-11-09.
> Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md) · [DATA_MODEL.md](DATA_MODEL.md) · [DECISIONS.md](DECISIONS.md) · [PROGRESS.md](PROGRESS.md)

## 1. Vision and scope

Restoflux becomes a **multi-tenant Restaurant Management SaaS**: one platform that runs a restaurant company's daily operations (selling, kitchen, cash, stock, purchasing, customers, delivery, staff) and gives head office a trustworthy, branch-by-branch view of money and waste.

The platform serves **companies (tenants)** that own **brands**, which operate **branches** (and **warehouses / central kitchens**) in several countries. Head office sees everything; each branch manager sees only their own branches.

**What "done" means for the program:** an owner can open one dashboard and see, per branch and per item, what was sold, what it should have cost, what it actually cost, where the difference went (waste, theft, over-portioning, supplier price creep), and who approved or abused voids, refunds and discounts.

### Product principles
1. **Built around daily pain, not features.** Every module traces to one of the 8 problems in section 3.
2. **Numbers must be defensible.** Money is exact, every figure is reproducible from a ledger, every sensitive action is audited.
3. **The POS never blocks a sale.** Stock, tax or approval problems degrade gracefully (alerts and approvals), not hard stops, except where fraud control demands it.
4. **Branch-level truth, company-level view.** Data is captured per branch; consolidation is a view.
5. **Offline-ready by design** (client-generated ids, idempotent writes, append-only ledgers), without building sync now.

## 2. Users

| Persona | Typical daily job | What they must see or do |
|---|---|---|
| **Owner / CEO** (often multi-country) | Check performance from a phone, spot leakage | All brands and branches, financial reports, fraud signals, approvals above limits |
| **Head Office Admin** | Maintain master data | Menus, price books, tax profiles, roles, branch setup, templates |
| **Area Manager** | Oversee 3 to 10 branches | Variance, cash shortages, approvals, staffing across their branches |
| **Branch Manager** | Run the shop | Live orders, counts, waste, approvals, shift close, schedule, ordering |
| **Cashier** | Take orders and money | POS, shift open/close, cash drawer, limited discounts |
| **Kitchen Staff** | Cook and bump tickets | Kitchen Display only |
| **Inventory Clerk** | Receive, count, transfer | Receiving, counts, adjustments, transfers, production |
| **Rider** | Deliver | Assigned deliveries, status updates, cash to hand in |
| **Customer** | Order food | Storefront: menu, deals, cart, checkout, order tracking, loyalty |
| **Platform operator** (us) | Create tenants | CLI only in this program (no super-admin UI) |

## 3. Problems this product solves (traceability)

| # | Operational problem | How the product addresses it | Modules | Key success metric |
|---|---|---|---|---|
| 1 | **Food cost leakage**: actual cost drifts above theoretical (over-portioning, unlogged waste, theft, bad data) | Recipes give theoretical usage per sale; counts give real usage; the gap is split into *logged waste* vs *unexplained variance*, per branch and per item, with traffic-light thresholds | Inventory, Reports | Variance % per branch/item visible weekly; red items < 5% of SKUs |
| 2 | **Stockouts and over-ordering**, supplier price creep | Par levels and reorder points, suggested purchase orders, supplier price history, price-difference flags at receiving | Inventory, Purchasing | Stockout incidents; % of receipts with unflagged price changes |
| 3 | **Order chaos across channels** | One order model for dine-in, takeaway, delivery, web/app, phone and aggregators; one kitchen display; channel mix and aggregator commission visible | Orders/POS, Delivery, Dashboard | % orders on the unified flow; time-to-ready |
| 4 | **Cash and fraud**: abused voids, refunds, discounts; drawer shortages | Role limits, approval workflow with reasons, shift-based cash control (float, expected vs counted), Z-report, fraud-watch report, full audit trail | Orders/POS, Roles, Audit, Reports | Cash variance per shift; void/discount rate per staff vs baseline |
| 5 | **Menu profitability unknown** | Recipe-based cost per item, contribution margin, menu-engineering quadrant (Stars/Plowhorses/Puzzles/Dogs) | Catalog, Inventory, Reports | % of menu with a costed recipe |
| 6 | **Multi-branch control** | Tenant → Brand → Branch hierarchy; users limited to allowed branches; consolidated head-office views | Organization, RBAC, Dashboard | Zero cross-branch data leakage (tested) |
| 7 | **Multi-country**: currencies, time zones, tax rules, inclusive/exclusive pricing | Per-branch currency, timezone, tax profile; price books per currency; tax computed per line with stored breakdown | Organization, Catalog, Orders | Receipts and tax reports match each authority's requirements |
| 8 | **Unreliable internet** | Offline-ready order flow: client-generated ids, idempotency keys, append-only ledgers, business-date semantics (sync itself is a later program) | Orders/POS, all writes | Documented offline readiness checklist passes |

## 4. Glossary

- **Tenant**: a customer company of the platform. All business data belongs to exactly one tenant.
- **Brand**: a restaurant concept owned by a tenant (own menu, own storefront).
- **Location**: any place that holds stock or sells. Types: **BRANCH** (outlet that sells), **WAREHOUSE**, **CENTRAL_KITCHEN**. "Branch" in the UI means a Location of type BRANCH.
- **Minor units**: the smallest currency unit (paisa, fils, cents). All money amounts are stored as integers in minor units.
- **Price book**: a set of prices in one currency (for example "Pakistan PKR"), assigned to branches.
- **Theoretical usage/cost**: what the recipes say should have been consumed by what was sold.
- **Actual usage/cost**: what really left stock (theoretical + logged waste + unexplained loss).
- **Variance**: actual minus theoretical, shown as value and %.
- **Par level**: the stock level to restore to when ordering. **Reorder point**: the level that triggers an alert and a suggested order.
- **WAC**: weighted average cost, the stock valuation method.
- **BOM / recipe**: the ingredients (and sub-recipes) that make one sellable item or one prep batch.
- **86 / "86'd"**: kitchen slang for "sold out" at a branch.
- **Business date**: the trading day a transaction belongs to (a bar open until 2 am still trades on yesterday's date). Defined per branch by timezone plus a day-start time.
- **Z-report**: the end-of-day or end-of-shift closing report with totals by payment method, tax, discounts, voids and cash variance.
- **KDS**: Kitchen Display System.
- **Aggregator**: third-party delivery marketplace (Foodpanda, Uber Eats, DoorDash and similar).

## 5. Functional specification by module

Each module lists capabilities, the rules that matter, the permissions it introduces (full catalog in section 7) and acceptance criteria. "AC" items become automated tests where they involve money, stock, permissions or tenancy.

### 5.1 Dashboard
- **Capabilities:** KPIs (net sales, orders, average ticket, food cost % theoretical and actual, labour % placeholder), live orders by status, sales trend, top items, channel mix, **alerts panel** (low stock, high variance, pending approvals, cash shortages, voids spike). Filters: brand, branch(es), date range.
- **Rules:** every figure respects the user's branch scope; multi-currency scope shows totals per currency unless a reporting currency is chosen (see Decision D18). Net sales exclude tax and cancelled/voided amounts; refunds are subtracted on the business date of the refund.
- **Permissions:** `dashboard.view`, `dashboard.financial.view` (hides sales and cost figures from roles that should only see operations).
- **AC:** a branch manager's dashboard never includes other branches; alert counts equal the underlying list counts.

### 5.2 Organization
- **Capabilities:** tenant profile; brands; locations (branch, warehouse, central kitchen); per-location settings: **country, currency, timezone, tax profile, price book, opening hours (multiple ranges per day), business-day start time, receipt header/footer, order-number prefix**; dining tables and kitchen stations per branch; **tax profiles** (several taxes per profile, inclusive or exclusive, per tax category and order type); **payment methods** (cash, card, mobile wallet such as JazzCash/Easypaisa, QR, bank transfer, other) configurable per tenant and enabled per branch.
- **Rules:** a branch has exactly one currency (no mixed-currency branch). Currency, timezone and tax profile changes are audited and apply only to new transactions. Locations are soft-deleted; locations with history cannot be hard-deleted.
- **Permissions:** `org.view`, `org.manage`, `locations.manage`, `taxes.manage`, `payment-methods.manage`, `settings.manage`.
- **AC:** two branches with different timezones assign the same instant to different business dates correctly; a tax profile change never alters past orders.

### 5.3 Users, Roles and Permissions
- **Capabilities:** user management (invite/create, deactivate, reset password, POS PIN), **tenant-defined roles** with editable permission sets (matrix UI), role thresholds, branch assignment, login history, session revocation.
- **Rules:**
  - Permissions are `module.action` strings from a fixed catalog; roles are tenant-editable sets of them. System roles (Owner) cannot lose `roles.manage` and the last Owner cannot be removed.
  - A user can hold several roles (permissions are the union; limits take the highest) and a list of allowed branches, or "all branches".
  - **Thresholds per role:** maximum discount %, and per currency: void limit, refund limit, purchase-order approval limit, stock adjustment value limit. Above a limit, the action needs approval (inline manager PIN or async approval request). No threshold row for a currency means "everything needs approval".
  - Role, permission and branch-access changes take effect on the next request (not at token expiry) and are audited.
- **Permissions:** `users.view`, `users.manage`, `roles.view`, `roles.manage`, `audit.view`, `approvals.view`, `approvals.decide`.
- **AC:** removing a permission from a role denies the next request; assigning a user to branch A hides branch B data everywhere.

### 5.4 Catalog and Menu
- **Capabilities:** categories; products with **variants/sizes** (every product has at least one variant); **modifier groups** (required/optional, min/max selections, priced add-ons, optional stock usage); **combos/deals** (fixed bundles and choice slots, such as "pick any burger + any drink"); **price books** per currency with **branch-level overrides** and **channel-specific pricing** (for example aggregator markup); **time-based menus** (breakfast/lunch/dinner schedules); **per-branch availability and "86"**; images; tax category per product; kitchen station per product.
- **Rules:** price resolution order for (variant, branch, channel): branch+channel → branch → price-book+channel → price-book. No price found means the item is not sold at that branch/channel. A sold-out (86) flag is per branch and takes effect immediately on POS, storefront and aggregator entry. Archiving a product keeps order history.
- **Permissions:** `menu.view`, `menu.manage`, `menu.price.edit`, `menu.availability.toggle`.
- **AC:** the price-resolution matrix is unit-tested; the storefront shows only items that are active, in a currently-scheduled menu, priced and not 86'd at the chosen branch.

### 5.5 Orders and POS (web)
- **Capabilities:**
  - **Order types** (service): dine-in (with tables), takeaway, delivery. **Channels:** POS, web, Android, iOS, phone, aggregator (with aggregator name and external reference).
  - **Lifecycle:** open/held → placed → confirmed → preparing → ready → (out for delivery) → completed, or cancelled. Per-line kitchen status drives the **Kitchen Display** (by station).
  - **Payments:** split tender across methods, tips, change calculation; payment methods per branch.
  - **Discounts and coupons:** manual (percent/amount, reason, limited by role), coupon codes, automatic promotions; discount applied before tax.
  - **Voids and refunds** with mandatory reason codes; above the role's limit they need a manager (PIN or approval request). Voiding a line already sent to the kitchen is logged as **waste** and flagged in fraud watch.
  - **Receipts:** per-branch header/footer, tax breakdown per authority, printable at 80 mm.
  - **Shifts and cash drawer:** open shift with opening float; cash in/out/paid-out/safe-drop with reasons; close with **expected vs counted** cash (optional blind count); variance recorded; **Z-report** generated at close and for the business day.
- **Rules:**
  - Every order carries `locationId`, `businessDate`, currency, a **client-generated id** and an **idempotency key**; creating the same order twice returns the first.
  - Prices, taxes and discounts are **snapshotted** on the order; later menu or tax changes never alter it.
  - Tax is computed per line (inclusive or exclusive), rounded half-up to minor units, stored per authority; the order total is the sum of lines (no order-level rounding drift).
  - Stock is deducted from recipes when the order becomes **completed** (see 5.6).
  - Payments are append-only; corrections are refunds, not edits.
  - Cash expected at close = opening float + cash sales − cash refunds + cash in − cash out/paid-outs − safe drops.
- **Permissions:** `pos.access`, `orders.view`, `orders.create`, `orders.update`, `orders.cancel`, `orders.discount`, `orders.void`, `orders.refund`, `payments.take`, `kds.access`, `shifts.view`, `shifts.open`, `shifts.close`, `cash.manage`, `zreport.view`.
- **AC:** totals and tax for inclusive and exclusive profiles, split payments, change, rounding, discount allocation, shift expected cash and variance, approval thresholds and idempotent order creation are all covered by unit/integration tests.

### 5.6 Inventory
- **Capabilities:** raw items and **prep items** (sub-recipe outputs); **units with conversions** (kg↔g, L↔ml, case↔piece, per item); **recipes/BOM** with sub-recipes, **yield** and waste % per line, modifier-option stock usage; **automatic deduction** at order completion; **stock per location**; **stock counts** (scheduled, multi-person by section, optional blind, **locked once submitted**, approval posts variances); **adjustments** with mandatory reason (waste, expiry, staff meal, damage, theft) and value-based approval; **transfers** (request → approve → dispatch → receive, with in-transit and receiving variance); **central kitchen production** runs (ingredients consumed, prep item produced at actual yield); **par levels, reorder points, low-stock alerts**; optional **batch/expiry tracking** (FEFO); **stock valuation by weighted average cost**.
- **Rules (food cost model, the core of problem 1):**
  - Stock is an **append-only movement ledger** plus a maintained on-hand/average-cost row per (location, item).
  - Sale consumption is posted at the **theoretical** recipe quantity. Counts post the difference between **counted** and **system-expected** as *count variance*.
  - Therefore, for any period: `Actual usage = Theoretical + Logged waste + Unexplained loss`, where unexplained loss is the net count variance. Per item and per branch the product shows all three, valued at average cost.
  - **Variance %** = (Actual cost − Theoretical cost) ÷ Theoretical cost. Thresholds: **green < 2%, amber 2% to 5%, red > 5%** (configurable per tenant). Food cost % of sales is shown alongside.
  - Weighted average cost is recalculated on every receipt: `newAvg = (oldQty × oldAvg + inQty × inCost) ÷ (oldQty + inQty)`. Issues use the current average.
  - Negative on-hand is allowed by default (the POS never blocks a sale) but raises an alert and is reported.
  - Submitted counts and posted movements are immutable; corrections are new movements.
- **Permissions:** `inventory.view`, `items.manage`, `recipes.manage`, `inventory.adjust`, `inventory.count`, `inventory.count.approve`, `inventory.transfer`, `inventory.transfer.approve`, `inventory.production`, `inventory.batches.manage`.
- **AC:** unit conversion, yield, sub-recipe explosion, WAC after receipts and issues, count variance maths, transfer in-transit accounting, deduction on completion and reversal on post-completion refund, count lock, all tested.

### 5.7 Purchasing and Suppliers
- **Capabilities:** suppliers; **supplier-item catalog** (pack size, supplier SKU, preferred supplier, lead time) with **price history**; **purchase orders** with approval workflow (value-based per role); **suggested orders** from par levels grouped by preferred supplier; **goods receiving** (partial deliveries, rejections, price differences flagged, batch/expiry); **supplier invoices** matched to receipts, **payments** and **credit notes**, outstanding balances per supplier.
- **Rules:** receiving posts purchase-receipt movements and updates average cost; a received unit price different from the last known price is flagged and creates a price-history row; PO approval needs `purchasing.approve` and the amount within the approver's limit for the branch currency; purchases are in the receiving location's currency (no FX in v1); invoice vs received value mismatches beyond a tolerance are flagged.
- **Permissions:** `purchasing.view`, `purchasing.create`, `purchasing.approve`, `purchasing.receive`, `suppliers.manage`, `invoices.manage`.
- **AC:** partial receipts, over/under delivery, price-change flag, approval limit enforcement, supplier balance maths, suggested-order quantities.

### 5.8 Customers and Marketing
- **Capabilities:** CRM (multiple addresses, order history, consent flags), **promotions** (time windows, item/category/brand/branch scope, priority and stacking rules), **coupon codes** with total and per-customer usage limits, **loyalty** (earn and redeem rules per currency, expiry, ledger), **feedback** (rating, comment, staff reply).
- **Rules:** a coupon redemption is recorded atomically with the order (no double use under concurrency); loyalty is an append-only ledger; promotions never stack unless both allow it.
- **Permissions:** `customers.view`, `customers.manage`, `promotions.manage`, `coupons.manage`, `loyalty.manage`, `feedback.view`.
- **AC:** usage limits under concurrent redemption, promotion priority/stacking, loyalty balance equals ledger sum.

### 5.9 Delivery
- **Capabilities:** riders (availability, vehicle), **assignment**, delivery statuses (assigned → picked up → delivered / failed / returned), **delivery zones with fees and minimum order** per branch, cash-on-delivery collection and rider cash settlement.
- **Permissions:** `delivery.view`, `delivery.assign`, `delivery.manage`, `riders.manage`.
- **AC:** zone fee applied to the order; COD cash appears in the rider's settlement and the branch cash report.

### 5.10 Staff
- **Capabilities:** employees (linked to a user when they log in), roster shifts, **clock-in/out**, hours worked (basic). Labour cost is a placeholder KPI fed by hourly rate × hours.
- **Permissions:** `staff.view`, `staff.manage`, `roster.manage`, `timeclock.manage`.
- **AC:** clock-in/out pairs, overlapping shift rejection, hours total per employee/period.

### 5.11 Reports
All reports filter by **brand / branch / date range**, respect branch scope and **export to CSV and PDF**.

| Group | Reports |
|---|---|
| **Sales** | Summary; by hour/day; by item, category, channel, order type, branch, staff; payment methods; **taxes collected** per authority; **discounts, voids and refunds by staff (fraud watch)** |
| **Cash** | End-of-day / Z-report; shift report with cash variance; rider settlement |
| **Food cost** | Theoretical vs actual; variance % per branch and per item with green/amber/red; waste breakdown by reason |
| **Inventory** | Stock on hand and valuation; movement history; waste report; COGS |
| **Purchasing** | Purchases by supplier; supplier price changes; outstanding balances |
| **Menu engineering** | Stars, Plowhorses, Puzzles, Dogs |

**Fraud watch signals (configurable):** void or discount rate per staff vs the branch median, voids after kitchen fire, refunds above a limit, no-sale drawer opens, repeated cash shortages for the same cashier, orders closed long after the last void.

**Menu engineering rule (Kasavana-Smith):** within a category, an item is *popular* if its share of units sold ≥ 70% of the average share (70% × 1/N); it is *high margin* if its contribution margin per unit (price net of tax − recipe cost) ≥ the sales-weighted average margin of the category. Stars = popular and high margin; Plowhorses = popular, low margin; Puzzles = not popular, high margin; Dogs = neither. Items without a costed recipe are listed as "unclassified".

**Permissions:** `reports.sales.view`, `reports.cash.view`, `reports.financial.view`, `reports.inventory.view`, `reports.foodcost.view`, `reports.purchasing.view`, `reports.menu.view`, `reports.fraud.view`, `reports.export`.

### 5.12 Settings and Audit
- **Capabilities:** receipt templates, notification settings (who gets which alert), **audit log viewer** with filters (actor, branch, action, entity, date), approval rules overview.
- **Audit rules:** every sensitive action records actor, time, branch, action key (for example `orders.void`), entity, **before/after values**, reason, request id and IP, in the same transaction as the change. The log is append-only and never editable from the application. Sensitive actions: prices, availability, stock adjustments/counts/transfers, voids, refunds, discounts, cash movements, role/permission/user/branch-access changes, approvals, purchase orders, supplier price changes, tax and currency settings.
- **Permissions:** `settings.manage`, `audit.view`, `notifications.manage`.

## 6. Cross-cutting requirements

| Area | Requirement |
|---|---|
| **Multi-tenancy** | Every business table has `tenantId`, enforced centrally (see ARCHITECTURE). Cross-tenant access returns "not found". Branch-scoped tables are additionally filtered by the user's allowed locations. |
| **RBAC** | `requirePermission("x.y")` on every route; the UI hides what the user cannot use; the backend always re-checks. |
| **Money** | Integer minor units + currency for amounts; Decimal for quantities, unit costs and rates. No floats anywhere. |
| **Time** | Store UTC instants; every branch has an IANA timezone; reports group by **business date** in the branch timezone. |
| **Tax** | Several taxes per profile, inclusive/exclusive, per tax category and order type, per-line rounding, stored breakdown. Seeded rates are **illustrative, not tax advice**. |
| **Soft delete** | Master data uses `deletedAt`; uniqueness applies to non-deleted rows; history stays readable. |
| **Lists** | Every list endpoint: pagination (offset for admin tables, cursor for large ledgers), filtering, sorting (whitelisted fields), consistent envelope. |
| **Errors** | One format: `{ error: { code, message, details?, requestId } }` with stable codes. |
| **Audit** | See 5.12. |
| **Offline-ready** | Client-generated UUIDs, idempotency keys, occurred-at vs recorded-at, append-only ledgers, no server-only sequence numbers that block creation (display numbers are assigned on sync). |
| **i18n** | UI strings go through a translation layer from day one; RTL (Arabic) support is designed for, delivered later. |
| **Security** | Hashed passwords and PINs, rate limiting on auth and approval endpoints, secure headers, session revocation, no secrets in the frontend, least-privilege defaults for new roles. |

## 7. Roles and permissions

### 7.1 Permission catalog (the fixed list, defined once in code)

| Module | Permissions |
|---|---|
| Dashboard | `dashboard.view`, `dashboard.financial.view` |
| Organization | `org.view`, `org.manage`, `locations.manage`, `taxes.manage`, `payment-methods.manage`, `settings.manage` |
| Users and access | `users.view`, `users.manage`, `roles.view`, `roles.manage`, `audit.view`, `approvals.view`, `approvals.decide`, `notifications.manage` |
| Menu | `menu.view`, `menu.manage`, `menu.price.edit`, `menu.availability.toggle` |
| Orders and POS | `pos.access`, `orders.view`, `orders.create`, `orders.update`, `orders.cancel`, `orders.discount`, `orders.void`, `orders.refund`, `payments.take`, `kds.access`, `shifts.view`, `shifts.open`, `shifts.close`, `cash.manage`, `zreport.view` |
| Inventory | `inventory.view`, `items.manage`, `recipes.manage`, `inventory.adjust`, `inventory.count`, `inventory.count.approve`, `inventory.transfer`, `inventory.transfer.approve`, `inventory.production`, `inventory.batches.manage` |
| Purchasing | `purchasing.view`, `purchasing.create`, `purchasing.approve`, `purchasing.receive`, `suppliers.manage`, `invoices.manage` |
| Customers | `customers.view`, `customers.manage`, `promotions.manage`, `coupons.manage`, `loyalty.manage`, `feedback.view` |
| Delivery | `delivery.view`, `delivery.assign`, `delivery.manage`, `riders.manage` |
| Staff | `staff.view`, `staff.manage`, `roster.manage`, `timeclock.manage` |
| Reports | `reports.sales.view`, `reports.cash.view`, `reports.financial.view`, `reports.inventory.view`, `reports.foodcost.view`, `reports.purchasing.view`, `reports.menu.view`, `reports.fraud.view`, `reports.export` |

### 7.2 Default roles (seeded per tenant, then editable)

Legend: **M** = manage/full, **V** = view, **A** = approve (within limit), **U** = use (operate), **-** = none. Branch scope in brackets.

| Area | Owner | Head Office Admin | Area Manager | Branch Manager | Cashier | Kitchen Staff | Inventory Clerk | Rider |
|---|---|---|---|---|---|---|---|---|
| Branch scope | all | all | assigned | assigned | assigned | assigned | assigned | assigned |
| Dashboard (incl. financial) | M | M | V | V | - | - | - | - |
| Organization / taxes / payment methods | M | M | V | V | - | - | - | - |
| Users, roles, audit | M | M (no owner roles) | V users, V audit | V users, V audit | - | - | - | - |
| Menu and prices | M | M | V | availability + V | - | availability (86) | - | - |
| POS, orders | M | V | V, A | M | U | - | - | - |
| Discounts | unlimited | unlimited | 25% | 20% | 10% | - | - | - |
| Voids, refunds | A | A | A | A | request only | - | - | - |
| Shifts, cash, Z-report | M | V | V | M | open/close own | - | - | - |
| Kitchen display | V | - | V | U | - | U | - | - |
| Inventory (items, recipes) | M | M | V | V | - | - | U | - |
| Counts, adjustments, transfers | M | M | A | A | - | - | U (counts/adjust small) | - |
| Purchasing (PO) | A | M | A | create, A small | - | - | create, receive | - |
| Customers, promotions, loyalty | M | M | V | V | V | - | - | - |
| Delivery | M | M | M | M | V | - | - | U (own) |
| Staff, roster | M | M | V | M | - | - | - | - |
| Reports (incl. food cost, fraud) | M | M | M | V | - | - | V inventory | - |

Dollar/rupee/dirham **approval limits** are per role and per currency, set in the seed (for example Branch Manager void limit: PKR 10,000, AED 150, USD 50). The exact matrix lives in code and is editable in the UI.

## 8. Admin UI specification

### 8.1 Application shell
- **Collapsible left sidebar**, grouped: *Overview, Sales & Orders, Menu, Inventory, Purchasing, Customers & Marketing, Delivery, Staff, Reports, Organization, Settings*. An item appears only if the user holds the required permission; a group with no visible items is hidden. Collapsed state is remembered.
- **Top bar:** brand/branch switcher (multi-select within the user's scope), **global date range** (presets plus custom, interpreted in each branch's timezone), **global search** (command palette: pages, orders, products, customers, items), **notifications** (alerts and approvals), user menu (profile, theme, sign out).
- **Light and dark mode** with a single accent colour (brand red); responsive down to **tablet** (branch managers); the POS and KDS screens are full-screen, touch-first layouts.

### 8.2 Page pattern (every list/detail page)
Title + **breadcrumbs** + primary action → filter bar → **data table** (search, filters, sort, column toggles, pagination, CSV export, row actions) → create/edit in a **side sheet or dialog** → **toasts** → explicit **empty, loading and error** states. Forms use react-hook-form + Zod; permission-gated buttons are hidden, not disabled with no explanation.

### 8.3 Navigation tree
- **Overview:** Dashboard
- **Sales & Orders:** Live orders, POS (opens full screen), Kitchen display, Order history, Shifts & cash, Approvals (voids/refunds/discounts)
- **Menu:** Products, Categories, Modifier groups, Combos & deals, Menus & dayparts, Price books, Branch availability (86)
- **Inventory:** Stock on hand, Items, Recipes, Counts, Adjustments & waste, Transfers, Production
- **Purchasing:** Suppliers, Purchase orders, Receiving, Invoices & payments, Suggested orders
- **Customers & Marketing:** Customers, Promotions, Coupons, Loyalty, Feedback
- **Delivery:** Deliveries, Riders, Zones & fees
- **Staff:** Employees, Roster, Time clock
- **Reports:** Sales, End of day / Z, Food cost, Inventory, Purchasing, Menu engineering, Fraud watch
- **Organization:** Brands, Branches & warehouses, Tax profiles, Payment methods, Tables & stations
- **Settings:** Users, Roles & permissions, Receipt templates, Notifications, Audit log

### 8.4 Storefront (customer site, `web/`)
Keeps working through every phase. It resolves the brand (and branch for pickup/delivery) and **reads the new catalog** through public endpoints (Phase 2), places orders through the new order model (Phase 3), and uses the new customer accounts (Phase 3). Its design stays as built; it is rebranded per brand later.

## 9. Demo data specification

One realistic tenant, `demo`, safe to re-run (it is identified by slug and can be reset with a flag).

- **Brands (2, fictional):** a burger concept and a Pakistani/desi grill concept.
- **Branches (4):** Karachi (PKR, `Asia/Karachi`), Lahore (PKR, `Asia/Karachi`), Dubai (AED, `Asia/Dubai`, VAT, tax-inclusive prices), Houston (USD, `America/Chicago`, sales tax, tax-exclusive prices). Plus one central kitchen/warehouse (Karachi).
- **Tax profiles (illustrative):** Pakistan provincial sales tax on services (SRB for Sindh, PRA for Punjab, rates configurable), UAE VAT 5% inclusive, Texas sales tax exclusive. Rates are demo values and must be verified before real use.
- **Menus:** full menus per brand with variants, modifier groups, combos/deals, a breakfast and a lunch/dinner menu, branch overrides, channel-specific prices (aggregator markup), a few 86'd items.
- **Inventory:** ~120 raw items, ~15 prep items, recipes with yields and sub-recipes, packaging conversions, par levels.
- **Purchasing:** ~12 suppliers, 90 days of purchase orders, receipts (some partial, some with price changes), invoices and payments.
- **Orders:** **90 days** across all channels (POS dine-in/takeaway, web, app, phone, two aggregators), split payments, discounts and coupons, including **voids, refunds, a few suspicious patterns** (one cashier with high voids, one with repeated cash shortages).
- **Cash:** shifts with opening floats, drops, closes with realistic variances.
- **Inventory events:** waste entries in every reason category, weekly counts with **injected variances** (a few red items), transfers (central kitchen to branches), production runs.
- **Users:** one demo user per default role, plus a few extra cashiers and managers; all with documented demo credentials in the seed output (never in source for production).
- **Size:** roughly 30 to 45 thousand orders; a `--small` flag generates 7 days for fast development.

## 10. Non-goals and assumptions

**Not in this program:** offline sync (design only), native mobile apps, live aggregator API integrations (manual entry only), payment gateway integration, fiscal/government invoice integrations (for example FBR POS integration in Pakistan; a port is reserved), payroll, accounting-system export, automatic exchange rates, a platform super-admin UI, SMS/email/WhatsApp delivery (notifications are in-app first).

**Assumptions** (see DECISIONS.md for the ones needing your confirmation): one tenant per user account; one currency per branch; no FX conversion inside operations; consolidated multi-currency reporting uses manually maintained rates; Vercel serverless hosting with Upstash for background jobs; polling for live screens.

## 11. Delivery plan

Eight build phases, **one per session**, each ending with a stop, a summary and a green build. Phase 0 (this document set) comes first.

| Phase | Scope | Exit criteria (in addition to the Definition of Done) |
|---|---|---|
| **1** | Tenancy foundation, organization (brands, locations, tax profiles, payment methods), users, roles and permissions, thresholds and approvals framework, audit log, sessions/login history, **admin app shell** (sidebar, top bar, branch switcher, auth, permission-aware nav, shared contracts package) | A second tenant cannot read the first tenant's data (automated); permission changes apply on the next request; storefront still works |
| **2** | Catalog and menu: products, variants, modifiers, combos, price books, overrides, channel prices, dayparts, 86; migrate existing menu items and deals; storefront reads the new catalog | Price-resolution tests; migrated menu matches the legacy menu item-for-item |
| **3** | Orders, POS, kitchen display, payments, tax engine, discounts/coupons basics, voids/refunds with approvals, shifts and cash drawer, Z-report; migrate existing orders and customers; legacy routes removed | Money/tax/cash tests; legacy order totals reconcile to the cent; offline-readiness checklist passes |
| **4** | Inventory: items, units, recipes, automatic deduction, counts, adjustments, transfers, production, par levels, valuation | Stock maths tests; theoretical vs count-variance identity holds in tests |
| **5** | Purchasing and suppliers: POs with approval, suggested orders, receiving, price history, invoices, payments | Receiving updates WAC correctly; supplier balances reconcile |
| **6** | Dashboard and reports (all groups), exports (CSV/PDF), alerts panel, rollups if needed | Every report reproducible from ledgers; performance budget met on 90-day seed |
| **7** | Customers, promotions, coupons, loyalty, feedback | Concurrency-safe coupon use; loyalty = ledger |
| **8** | Delivery and staff | Zone fees, rider settlement, clock-in/out tests |

### Definition of Done (every phase)
1. Prisma **migrations** (with a data-migration step and rollback note for anything touching existing data).
2. **Seed** updated; running it twice is safe.
3. Every new route has `requirePermission`; every sensitive action writes an **audit** record.
4. **Tests** for the business rules, especially money, stock, permissions and tenancy; legacy tests removed only together with their routes.
5. `typecheck` and **all tests pass** in every package.
6. **docs/** updated: PROGRESS.md (done / next), DATA_MODEL.md and ARCHITECTURE.md where changed, DECISIONS.md entries.
7. Stop, summarize, wait for review.

### Main risks
| Risk | Mitigation |
|---|---|
| Program size | Strict phase gates; the plan is useful even if stopped after any phase |
| Tenant data leakage | Central enforcement + a test that fails if any model lacks tenant scoping + composite foreign keys on critical relations |
| Money/tax bugs | Pure, heavily unit-tested money and tax modules; integer minor units; golden-file receipts |
| Migrating live data while the storefront runs | Expand/contract migrations, a temporary compatibility bridge, Neon branch as rollback, reconciliation queries |
| Report speed | Indexes on `(tenantId, locationId, businessDate)`; rollup tables only when measured |
| Serverless limits (timeouts, connections) | Pooled connections, chunked seeds, PDF generation without headless browsers, jobs through a queue |
