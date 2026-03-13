# Cashier System XAMPP + MySQL Setup

## 1. Start XAMPP

Open XAMPP Control Panel and start:

- `Apache` for phpMyAdmin access
- `MySQL`

Default local database settings used by this project:

- Host: `127.0.0.1`
- Port: `3306`
- User: `root`
- Password: blank by default in XAMPP
- Database: `cashier_system`

## 2. Import the full BPA schema

The main import file now creates and seeds all workflow modules:

- students
- student accounts
- billing records
- billing items
- payment transactions
- payment attempts
- receipts
- proof documents
- reconciliations
- notifications
- audit logs
- auto debit arrangements
- admin activity logs

### Option A: phpMyAdmin

1. Open `http://localhost/phpmyadmin`
2. Create a database named `cashier_system`
3. Open the `Import` tab
4. Import [cashier_system_mysql.sql](/C:/Users/Bilog/Projects/cashier-system/database/mysql/cashier_system_mysql.sql)

### Option B: MySQL command line

```powershell
"C:\xampp\mysql\bin\mysql.exe" -u root < database\mysql\cashier_system_mysql.sql
```

If your XAMPP MySQL uses a password:

```powershell
"C:\xampp\mysql\bin\mysql.exe" -u root -p < database\mysql\cashier_system_mysql.sql
```

## 3. Alternative: seed from the Node script

If you already created an empty `cashier_system` database and want the backend to seed it for you instead of importing the SQL file:

```powershell
npm run db:seed
```

Use one approach:

- import the SQL file for a full ready-made schema and demo data
- or run `npm run db:seed` against an empty schema

## 4. Configure the Node backend

Create `.env.server` in the project root using [server/.env.example](/C:/Users/Bilog/Projects/cashier-system/server/.env.example) as the template.

Recommended values:

```env
API_PORT=3001
FRONTEND_ORIGIN=http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=
MYSQL_DATABASE=cashier_system
SEED_ADMIN_USERNAME=admin@cashier.local
SEED_ADMIN_PASSWORD=admin123
SEED_STUDENT_PASSWORD=student123
```

## 5. Configure the Vue frontend

Add this to the root `.env`:

```env
VITE_API_BASE_URL=http://localhost:3001/api
```

## 6. Install dependencies

From the project root:

```powershell
npm install
```

## 7. Verify the MySQL connection

```powershell
npm run db:ping
```

Expected result:

```text
MySQL connection successful.
Database: cashier_system
```

## 8. Run the backend

```powershell
npm run server:dev
```

Expected result:

```text
Cashier API running at http://localhost:3001
```

## 9. Run the frontend

In another terminal:

```powershell
npm run dev
```

Then open:

```text
http://localhost:5173
```

## 10. Default login

- Admin: `admin@cashier.local` / `admin123`
- Faculty or Staff: `staff@cashier.local` / `staff123`
- Compliance: `compliance@cashier.local` / `compliance123`
- Student Portal: `2024-0001` / `student123`

Student access is available from:

```text
http://localhost:5173/student/
```

## 11. Quick health check

Open:

```text
http://localhost:3001/api/health
```

Expected response:

```json
{
  "ok": true,
  "data": {
    "status": "ok",
    "database": "mysql"
  }
}
```

## 12. Workflow coverage

The current backend is no longer limited to login or profile data. It now exposes dynamic BPA workflow endpoints for:

- `Student Portal & Billing`
- `Pay Bills`
- `Payment Processing & Gateway`
- `Compliance & Documentation`
- `Reporting & Reconciliation`
- dashboard summaries
- notifications
- audit logs

## Notes

- Re-importing the SQL file is safe for the seeded demo keys because the inserts use unique codes and upsert patterns where applicable.
- If you want a completely clean demo reset, drop `cashier_system`, recreate it, then import the SQL file again.
