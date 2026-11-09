# Ember & Oak: Restaurant Ordering

A full-stack restaurant ordering platform: customers browse the menu and deals and place orders online, and staff run the restaurant from an admin panel with a live order board and a sales dashboard.

Built as a portfolio project to learn the Node.js ecosystem (coming from Laravel), so the code is commented with the "why" behind the choices.

> The product name is a placeholder. Change it in one place: [`web/src/brand.ts`](web/src/brand.ts). The header, footer, page title and favicon all follow it.

## Features

**Customers**
- Landing page with hero, hot **deals** (with "% OFF" badges) and the menu grouped by category
- Cart that persists across reloads (items and deals), quantity controls, totals in PKR
- Register / log in (JWT), show/hide password, automatic logout when a session expires
- Checkout with optional kitchen notes, then an order page that updates its status automatically
- Order history, and cancelling an order while it's still pending

**Admin panel** (dark top bar: Dashboard, Orders, Menu, Deals, Reports, Settings)
- **Dashboard:** status pipeline (count and amount per status), KPIs (orders, sales, average order, cancelled rate), daily orders/sales chart, orders-by-channel donut, top 5 items, date range picker
- **Live order board:** kanban columns (New → Confirmed → Preparing → Ready → Completed), one click to advance an order, auto-refresh every 15 s
- **Menu management:** add/edit items, prices, images, availability (sold out)
- **Deals:** bundle menu items at a discount, optional schedule, on/off switch
- Reports and Settings are placeholders for now

## Tech stack

| Layer | Tools |
|---|---|
| API | Node.js 22+, Express 5, TypeScript (ES modules) |
| Database | PostgreSQL ([Neon](https://neon.tech) recommended) with Prisma 7 + `@prisma/adapter-pg` |
| Validation / auth | Zod, JWT (`jsonwebtoken`), bcrypt |
| API tests | Vitest + Supertest |
| Web | React 19, Vite, TypeScript, React Router, Tailwind CSS v4, Recharts |

## Project structure

```
restaurant-ordering/
├── api/                      Express + Prisma backend
│   ├── prisma/               schema.prisma and migrations
│   ├── scripts/              create-admin.ts, seed.ts
│   ├── src/
│   │   ├── config/env.ts     validated environment variables
│   │   ├── lib/              prisma client, JWT helpers
│   │   ├── middleware/       auth/role guards, error handler
│   │   └── routes/           auth, categories, menu-items, deals, orders, stats, health
│   └── tests/                Vitest + Supertest tests
└── web/                      React + Vite frontend
    └── src/
        ├── brand.ts          product name (single source of truth)
        ├── lib/              typed API client, formatting helpers
        ├── context/          auth and cart state
        ├── components/       layouts, route guards, shared UI
        └── pages/            customer and admin pages
```

> `docker-compose.yml` in the repo root is an unused leftover; the project runs without Docker.

## Getting started

### Prerequisites
- **Node.js 22 or newer** and npm
- A **PostgreSQL** database. A free [Neon](https://neon.tech) project is the easiest; a local Postgres works too.

### 1. Clone and install

```bash
git clone <your-repo-url>
cd restaurant-ordering

cd api && npm install
cd ../web && npm install
```

> npm 11 blocks dependency install scripts by default. This repo already lists the approved ones (`prisma`, `@prisma/engines`, `esbuild`) under `allowScripts` in `api/package.json`, so a normal `npm install` works.

### 2. Configure the API

```bash
cd api
cp .env.example .env
```

Edit `api/.env`:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. On Neon, use the **direct** (non-pooled) URL for migrations |
| `JWT_SECRET` | yes | Random string, at least 32 characters. Generate one with the command below |
| `JWT_EXPIRES_IN` | no | Token lifetime, default `7d` |
| `PORT` | no | API port, default `4000` |
| `CORS_ORIGINS` | no | Comma-separated browser origins allowed to call the API, default `http://localhost:5173` |

```bash
node -p "require('crypto').randomBytes(48).toString('hex')"
```

### 3. Create the database tables

```bash
npx prisma migrate deploy
npx prisma generate
```

### 4. Create an admin account

Nobody can become an admin through the API (it ignores any `role` in requests), so create the first one with the script:

```bash
npm run create-admin -- you@example.com "Your Name" 'a-strong-password'
```

- Quote the password. In PowerShell, use double quotes instead of single quotes.
- Running it again for the same email resets the password and keeps the account an admin.

### 5. (Optional) Load sample data

```bash
npm run db:seed
```

Creates 10 menu items in 4 categories, 4 deals and 60 demo orders spread over the last 30 days (so the dashboard has something to show). It's safe to run repeatedly. To regenerate the demo orders relative to today:

```bash
npm run db:seed -- --refresh-demo
```

### 6. Configure the web app

```bash
cd ../web
cp .env.example .env
```

`VITE_API_URL` defaults to `http://localhost:4000`. Only change it if your API runs elsewhere. Variables here are shipped to the browser, so never put secrets in `web/.env`.

### 7. Run both apps

You need **two terminals**:

```bash
# terminal 1
cd api
npm run dev
```

```bash
# terminal 2
cd web
npm run dev
```

- Web app: http://localhost:5173
- API: http://localhost:4000 (health check: http://localhost:4000/health)
- Admin panel: log in with your admin account, then open http://localhost:5173/admin

## Scripts

**`api/`**

| Command | What it does |
|---|---|
| `npm run dev` | Start the API with auto-reload (`tsx watch`) |
| `npm run build` / `npm start` | Generate the Prisma client, compile to `dist/`, run the compiled server |
| `npm run typecheck` | TypeScript check without emitting |
| `npm test` | Run the test suite (see the warning below) |
| `npm run db:migrate` | Create and apply a new migration in development (`prisma migrate dev`) |
| `npm run db:deploy` | Apply existing migrations (`prisma migrate deploy`) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Open Prisma Studio, a visual database browser |
| `npm run create-admin` | Create or promote an admin user |
| `npm run db:seed` | Load sample menu, deals and demo orders |

**`web/`**

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server on port 5173 |
| `npm run build` | Typecheck and build for production |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check |

## Testing

```bash
cd api
npm test
```

> **The tests run against the real database in `DATABASE_URL`.** Each test file creates its own uniquely named rows and deletes them afterwards, and the stats tests use a date range in 2001 so they can't collide with seeded data. Even so, point `DATABASE_URL` at a throwaway database or a separate Neon branch rather than production.

## Roles

| Role | Access |
|---|---|
| `CUSTOMER` | Browse, order, view and cancel (while pending) their own orders |
| `ADMIN` | Everything: menu, deals, all orders and status changes, dashboard stats |

Roles live in a Postgres enum and are enforced by `requireRole(...)` middleware on the API. The UI hides pages by role too, but the API checks are what secure the app.

## API overview

All routes are under `/api`. Responses are JSON; errors look like `{ "error": "message" }`, and validation errors (`422`) add `{ "details": { "field": ["message"] } }`. Authenticated routes expect `Authorization: Bearer <token>`.

| Area | Endpoints | Access |
|---|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | public, public, logged in |
| Categories | `GET /categories` | public |
| | `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id` | admin |
| Menu items | `GET /menu-items` (`?categoryId=&available=`), `GET /menu-items/:id` | public |
| | `POST /menu-items`, `PATCH /menu-items/:id`, `DELETE /menu-items/:id` | admin |
| Deals | `GET /deals` (active deals only) | public |
| | `GET /deals/manage`, `POST /deals`, `PATCH /deals/:id`, `DELETE /deals/:id` | admin |
| Orders | `POST /orders` (items and/or deals, optional notes), `GET /orders` (`?status=&page=&limit=`), `GET /orders/:id`, `POST /orders/:id/cancel` | logged in (customers see only their own) |
| | `PATCH /orders/:id/status` | admin |
| Stats | `GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD` (default: last 30 days) | admin |
| Health | `GET /health`, `GET /health/db` (outside `/api`) | public |

## Design notes

- **Money** is stored as integer minor units (paisa), never floats, and shown as `Rs. 1,250`. Column names still say `...Cents` from the first version.
- **Prices are never trusted from the client.** The checkout sends only ids and quantities; the server reads prices from the database and stores a **price snapshot** on each order line and deal, so later menu or deal edits never rewrite history.
- **Order lifecycle** is a small state machine: `PENDING → CONFIRMED → PREPARING → READY → COMPLETED`, with `CANCELLED` allowed from `PENDING` or `CONFIRMED`. Status changes use a compare-and-set update, so two simultaneous requests can't both apply.
- **Stats** treat "a day" as a day in `Asia/Karachi`. Sales, average order value and top items exclude cancelled orders; order counts include them.
- **Order channel** (`WEB`, `POS`, `ANDROID`, `IOS`) exists on every order for the dashboard. The web app always creates `WEB` orders; the other channels appear in the seeded demo data until those clients exist.
- **Auth** uses stateless JWTs stored in `localStorage`, with login timing-equalised to avoid revealing which emails exist.

## Troubleshooting

**"Cannot reach the server. Check your connection and that the API is running."**
The web app can't reach the API. Make sure `npm run dev` is running in `api/` (second terminal) and that http://localhost:4000/health responds.

**API exits immediately with "Invalid environment variables"**
`DATABASE_URL` or `JWT_SECRET` is missing or too short in `api/.env`.

**CORS error in the browser console**
The web app must run on an origin listed in `CORS_ORIGINS` (default `http://localhost:5173`). Add other origins, comma-separated.

**`create-admin` mangles my password**
Wrap the password in quotes (single quotes in Git Bash/macOS/Linux, double quotes in PowerShell).

**A `pg` warning about `sslmode` on every start**
Harmless for now. Add `sslmode=verify-full` to your `DATABASE_URL` to silence it and keep today's behaviour.

## Status and roadmap

Working locally. Not yet done:
- Deployment config for Vercel (serverless API entry point, SPA rewrites, pooled Neon connection)
- Rate limiting on login/register and security headers (`helmet`)
- Change password / forgot password, and a staff management page
- More roles (manager, kitchen staff) and category management in the admin UI
- Reports and Settings pages
- Frontend tests
- Background jobs for notifications (planned with Upstash)

## License

Add a license of your choice (for example MIT) before publishing.
