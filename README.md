# OMNIRA

**One Platform. Every Business.**

Universal multi-tenant point-of-sale platform, developed by **KINGSTECH PLC** — evolved from the architecture of [PHARMORA](https://github.com/kingstechplc-lang/PHARMORA), KINGSTECH's enterprise pharmacy platform, and generalized to fit **every kind of business**.

> OMNIRA supports supermarkets, pharmacies, restaurants, fashion stores, electronics shops, hardware dealers, salons, liquor stores, bookstores, wholesalers, service businesses and general traders — many isolated organizations on one codebase, each with its own users, branches, stock locations, roles, permissions, settings and audit trail.

---

## What OMNIRA inherits from PHARMORA

| PHARMORA foundation | OMNIRA status |
|---|---|
| Multi-tenancy: Platform → Organization → Branch → Warehouse with server-derived tenant context (client org ids never trusted) | ✅ Inherited |
| NextAuth credentials flow, bcrypt hashing, login lockout, rate limiting, JWT sessions | ✅ Inherited |
| RBAC: 48 granular permissions across 19 modules, system role templates cloned per tenant, custom roles with a permission matrix | ✅ Inherited |
| Immutable audit trail on every mutation (actor, tenant, before/after, IP metadata) | ✅ Inherited |
| Membership model — one user, many tenants, per-tenant roles | ✅ Inherited |
| Platform owner console: tenant lifecycle (provision / suspend / soft-delete), plans & subscriptions, usage vs limits, audited support access into any tenant | ✅ Inherited |
| Configuration-first org settings (tax, receipts, loyalty, thresholds) | ✅ Inherited |

## What makes OMNIRA universal

- **`Organization.businessType`** — a retail vertical pack (12 types) that pre-seeds starter categories, sensible tax defaults, units and per-perishable batch tracking at provisioning time.
- **`Product.trackBatches`** — expiry/lot tracking is *optional per product*: on by default for pharmacy & grocery packs (FEFO deduction at the POS), off for fashion, electronics, services…
- **`Product.isService`** — salons, repair shops and consultancies bill non-stock items through the same catalog, cart and receipt flow.
- **Loyalty accrual** per organization (points per currency unit spent), tracked on every customer.
- **Universal commerce engine** — multi-method split payments (cash / mobile money / card / bank transfer / credit), per-line and order-level discounts, per-product tax rates, idempotent POS checkouts (client request id replay-safe), voids with restock, line-item refunds, cash-drawer sessions with expected-vs-counted variance.
- **Purchasing** — suppliers, purchase orders with approval workflow, receiving into any warehouse with batch capture.
- **AI Insights** — GLM-powered business digests generated from each tenant's real sales data (revenue trends, top movers, payment mix, low stock).

## Demo accounts (seeded)

| Account | Email | Password | Scope |
|---|---|---|---|
| Platform Superadmin | `admin@omnira.io` | `Omnira#Platform2025` | KINGSTECH platform console (tenants, plans, usage, billing KPIs) |
| Supermarket Admin | `admin@kingsmart.com` | `Demo#Admin2025` | Kings Mart Supermarket (GH, GHS) — full retail demo |
| Restaurant Admin | `admin@urbaneats.com` | `Urban#Admin2025` | Urban Eats Restaurant (NG, NGN) — menu-driven POS, tax on |
| Pharmacy Admin | `admin@mediplus.com` | `Medi#Admin2025` | MediPlus Pharmacy (GH, GHS) — batch & expiry control |

Each tenant also has `manager@`, `cashier@` and `clerk@` demo users (`Demo#Manager2025` / `Demo#Cash2025` / `Demo#Clerk2025` patterns — see `prisma/seed.ts`) to experience the RBAC differences live.

Self-serve signup is open at `#/signup` — pick a business type, name your store, and the platform provisions roles, a main branch, stock locations, starter categories and a 14-day Starter trial in a single transaction.

---

## Quick start

```bash
bun install
cp .env.example .env      # or create .env from the template below
bun run db:push           # create the SQLite schema
bun run db:seed           # permissions, roles, plans, platform admin + 3 demo tenants
bun run dev               # http://localhost:3000
```

Environment (`.env`):

```
DATABASE_URL="file:./db/custom.db"
NEXTAUTH_SECRET="<random base64>"
NEXTAUTH_URL="http://localhost:3000"
```

## Project structure

```
prisma/            schema.prisma (33 models), seed.ts
src/
  app/             page.tsx (hash-routed SPA at /), api/** (route handlers)
  components/      layout (shell, sidebar, topbar, command menu), shared (data-table, …), auth
  lib/             auth, tenancy, permissions catalog, api (errors/handler), audit,
                   sequence, constants (business-type packs), client (api/router/format/queries)
  modules/         dashboard, pos, sales, products, inventory, purchasing, suppliers,
                   customers, reports, insights, expenses, users, roles, branches,
                   settings, audit, platform
  store/           zustand UI state
  types/           shared API contracts (DTOs)
```

## Technology

Next.js 16 (App Router) · TypeScript 5 · SQLite (Prisma 6) · NextAuth 4 · Tailwind CSS 4 · shadcn/ui · TanStack Query · Zod 4 · Recharts · Zustand · Framer Motion · date-fns · Lucide · z-ai-web-dev-sdk (AI insights, backend only)

## Multi-tenancy guarantees

- The active organization is **always derived server-side** from a validated cookie + membership rows — client-supplied organization ids are never trusted.
- Every tenant query filters by the context organization; cross-tenant ids are indistinguishable from missing rows (404, never a leak).
- Suspended tenants vanish from their members' context on the next request; role assignments are validated to belong to the active tenant.
- The platform owner enters a tenant only through the audited support-access flow (amber banner while inside).

## Roadmap ideas

Offline POS with sync queue · e-commerce & delivery integrations · webhooks and API credentials · multi-currency pricing · stock count sessions on mobile · WhatsApp customer receipts.

---

© 2026 KINGSTECH PLC. OMNIRA is a trademark of KINGSTECH PLC.
