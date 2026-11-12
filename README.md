<p align="center">
  <img src="docs/brand/logo-lockup.svg" alt="Restoflux" width="320">
</p>

<p align="center"><strong>Restoflux</strong>: a multi-tenant restaurant management platform.</p>

Restaurants, brands and branches run on one deployment: POS, kitchen display, cash and shifts, inventory and recipes, purchasing, customers and marketing, delivery, staff, and reports, with each organization's data kept separate. Built as a portfolio project to learn the Node.js ecosystem (coming from Laravel), so the code is commented with the "why" behind the choices.

> **Branding lives in one file:** [`packages/contracts/src/brand.ts`](packages/contracts/src/brand.ts) holds the name, tagline, brand colour and the logo mark. Static copies of the logo are in [`docs/brand/`](docs/brand).

## What is in it

| Area | Modules |
|---|---|
| **Platform (the Restoflux team)** | Separate sign-in and console: create, suspend and configure organizations, plan limits, team, platform audit log |
| **Organization** | Brands, branches and warehouses, tax profiles, payment methods, price books, tables, users, tenant-defined roles with `module.action` permissions and approval limits, audit log, per-organization theme |
| **Menu** | Categories, products with sizes and add-ons, combos, menus by time of day, branch prices, the per-branch "86" board |
| **Sales** | POS (full screen, split tender, coupons and promotions), live orders, kitchen display, order history, shifts and cash, Z-reports, dashboard |
| **Inventory** | Items, stock on hand, recipes, counts, waste and adjustments, transfers, production, automatic deduction on completed orders |
| **Purchasing** | Suppliers and their packs, purchase orders, receiving, supplier invoices and payments, suggested orders |
| **Customers and marketing** | Customers, loyalty, coupons, promotions, feedback |
| **Delivery** | Zones and fees, riders, dispatch board |
| **Staff** | Employees, roster, time clock |
| **Reports** | Sales, end of day (Z), food cost, inventory, purchasing and supplier ledger, menu engineering, fraud watch |
| **Settings** | Receipt template, notification switches |

Status, decisions and known limitations are in [`docs/PROGRESS.md`](docs/PROGRESS.md); architecture and data model are in [`docs/`](docs).

## Tech stack

| Layer | Tools |
|---|---|
| API | Node.js 22+, Express 5, TypeScript (ES modules), Zod |
| Database | PostgreSQL ([Neon](https://neon.tech) recommended) with Prisma 7 + `@prisma/adapter-pg` |
| Auth | JWT access tokens + rotating refresh cookies, bcrypt; separate staff and platform sign-ins |
| Admin app | React 19, Vite, Tailwind v4, shadcn/ui, TanStack Query and Table, react-hook-form + Zod |
| Shared | `packages/contracts`: permissions, roles, validation schemas and the money maths, used by both the API and the admin app |
| Tests | Vitest + Supertest (API), Vitest (admin and contracts) |

## Project structure

```
restaurant-ordering/
├── api/                  Express + Prisma backend (modules per area under src/modules, /api/v1)
│   ├── prisma/           schema (one file per area) and migrations
│   ├── scripts/          seeds and account scripts
│   └── tests/            API tests (run against the real database)
├── admin/                React admin app: back office, POS, kitchen display and the platform console
├── packages/contracts/   shared types, permissions, validation and money maths
└── docs/                 PROGRESS, DECISIONS, ARCHITECTURE, DATA_MODEL, PRODUCT_SPEC
```

> The API still serves the original single-restaurant storefront routes under `/api` (auth, menu-items, deals, orders, stats) from `api/src/legacy`. They are unused and slated for removal. `docker-compose.yml` in the repo root is also an unused leftover.

## Getting started

**Prerequisites:** Node.js 22 or newer, npm, and a PostgreSQL database (a free Neon project is the easiest).

```bash
npm install                      # installs every workspace and builds the contracts package
cp api/.env.example api/.env     # then edit api/.env (see below)
cd api && npx prisma migrate deploy && npx prisma generate && cd ..
```

`api/.env`:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. On Neon use the **direct** (non-pooled) URL for migrations |
| `JWT_SECRET` | yes | Random string of at least 32 characters (`node -p "require('crypto').randomBytes(48).toString('hex')"`) |
| `JWT_EXPIRES_IN` | no | Token lifetime |
| `PORT` | no | API port, default `4000` |
| `CORS_ORIGINS` | no | Comma-separated browser origins allowed to call the API (add the admin app's address when deployed) |

Create the demo data and the first Restoflux team account, then start everything:

```bash
npm run bootstrap:default-tenant -w api      # one-off: creates the default tenant (idempotent)
npm run seed:demo -w api                     # demo organization, one user per role; prints random passwords ONCE
npm run seed:demo-orders -w api              # ten days of demo orders, shifts and Z-reports
npm run seed:demo-ops -w api                 # sample inventory, recipes, suppliers, customers, offers, delivery, staff, feedback (add -- --reset to rebuild)
npm run create-platform-admin -w api -- --email you@restoflux.com --name "Your Name"
npm run dev                                  # API on :4000 and admin app on :5174, together
```

- **A restaurant organization:** sign in at <http://localhost:5174> with `owner@demo.restoflux.test` and the password the seed printed. `npm run seed:demo -w api -- --reset` rebuilds the demo organization with fresh passwords (this removes its orders).
- **The Restoflux team console:** <http://localhost:5174/platform/login>, with the platform account you just created.
- **Health check:** <http://localhost:4000/api/v1/health>.

## Scripts

| Command (from the repo root) | What it does |
|---|---|
| `npm run dev` | API and admin app together |
| `npm run typecheck` | Type-check every workspace |
| `npm test` | Build the contracts, then run every workspace's tests |
| `npm run dev:api` / `npm run dev:admin` | Run one of them |
| `npm run db:migrate -w api` | Create and apply a migration in development |
| `npm run db:deploy -w api` | Apply existing migrations |
| `npm run db:studio -w api` | Open Prisma Studio, a visual database browser |

## Testing

```bash
npm test
```

> **The API tests run against the real database in `DATABASE_URL`.** Each test file creates its own uniquely named organization and removes it afterwards, but point `DATABASE_URL` at a throwaway database or a separate Neon branch, never production. The full API suite is slow over a remote database (several minutes); run single files while working, for example `npx vitest run tests/v1/orders.test.ts` from `api/`.

## Design notes

- **One deployment, many organizations.** Every business table carries a `tenantId`, enforced in one place (a Prisma client extension) so a forgotten filter cannot leak data. Branch access is enforced the same way. A coverage test fails if a new table is added without being scoped.
- **Money** is stored as integer minor units, never floats. The money maths (tax, discounts, change) lives in `packages/contracts` and is used by both the POS and the server, so the screen cannot disagree with the server.
- **The server decides prices.** Orders are priced from the branch's sellable menu and tax rules, never from client numbers, and names, prices and tax rates are snapshotted. Coupons and promotions are checked and priced by the server too.
- **Safe to retry.** Orders and payments carry a client-made id, so a resent request returns the first result instead of creating a duplicate.
- **Append-only records.** Payments, refunds, cash movements, stock movements, loyalty points, supplier payments and the audit logs cannot be edited or deleted (database triggers).
- **Permissions** are tenant-defined (`module.action`), with limits and manager approvals for discounts, voids and refunds. The UI hides what a person cannot use, but the API checks are what secure the app.

## Troubleshooting

**"Cannot reach the server"** The admin app cannot reach the API. Make sure `npm run dev` is running and <http://localhost:4000/api/v1/health> responds.

**API exits immediately with "Invalid environment variables"** `DATABASE_URL` or `JWT_SECRET` is missing or too short in `api/.env`.

**CORS error in the browser console** The admin app's origin must be listed in `CORS_ORIGINS`.

**A `pg` warning about `sslmode` on every start** Harmless for now. Add `sslmode=verify-full` to your `DATABASE_URL` to silence it and keep today's behaviour.

## Roadmap

See "Next steps" in [`docs/PROGRESS.md`](docs/PROGRESS.md). Main open items: a customer storefront on the new menu, image upload, deployment, server push for live screens, and the limitations listed there.
