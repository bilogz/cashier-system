# Cashier System Supabase Setup

## 1. Create a Supabase project

1. Create a new project at Supabase.
2. Open **Project Settings → Database** and copy the **Connection string** (URI).

## 2. Configure environment variables

Create a `.env.server` file in the repo root and add:

```env
API_PORT=3001
FRONTEND_ORIGIN=http://localhost:5173,http://localhost:5174

SUPABASE_DB_URL=postgresql://postgres:your-db-password@db.your-project-ref.supabase.co:5432/postgres
DB_SSL=true

SEED_ADMIN_USERNAME=admin@cashier.local
SEED_ADMIN_PASSWORD=admin123
```

## 3. Verify database connectivity

```bash
npm run db:ping
```

## 4. Create schema + seed demo data

```bash
npm run db:seed
```

## 5. Start the API

```bash
npm run server:dev
```

The API will ensure the schema exists on startup and keep demo data up to date.
