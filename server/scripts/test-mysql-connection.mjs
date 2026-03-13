import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env.server') });
dotenv.config();

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'cashier_system'
  });

  const [rows] = await connection.query('SELECT DATABASE() AS database_name, NOW() AS server_time');
  await connection.end();

  const row = Array.isArray(rows) ? rows[0] : null;
  console.log('MySQL connection successful.');
  console.log(`Database: ${row?.database_name || 'unknown'}`);
  console.log(`Server time: ${row?.server_time || 'unknown'}`);
}

main().catch((error) => {
  console.error('MySQL connection failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
