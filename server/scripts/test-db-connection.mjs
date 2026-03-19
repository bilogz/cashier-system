import { createDbPool } from '../db.mjs';

async function main() {
  const pool = createDbPool();
  const [rows] = await pool.query('SELECT current_database() AS database_name, NOW() AS server_time');
  const row = Array.isArray(rows) ? rows[0] : null;
  console.log('Database connection successful.');
  console.log(`Database: ${row?.database_name || 'unknown'}`);
  console.log(`Server time: ${row?.server_time || 'unknown'}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error('Database connection failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
