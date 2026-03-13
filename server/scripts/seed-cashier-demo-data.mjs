import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomBytes, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env.server') });
dotenv.config();

function nowSql(hoursAgo = 0) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function ensureSchema(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(190) NOT NULL UNIQUE,
      email VARCHAR(190) NOT NULL,
      full_name VARCHAR(190) NOT NULL,
      role VARCHAR(120) NOT NULL DEFAULT 'Cashier Admin',
      department VARCHAR(120) DEFAULT 'Cashier',
      access_exemptions_json JSON NOT NULL,
      is_super_admin TINYINT(1) NOT NULL DEFAULT 0,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      phone VARCHAR(60) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_profile_preferences (
      user_id INT NOT NULL PRIMARY KEY,
      email_notifications TINYINT(1) NOT NULL DEFAULT 1,
      in_app_notifications TINYINT(1) NOT NULL DEFAULT 1,
      dark_mode TINYINT(1) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      action VARCHAR(100) NOT NULL,
      raw_action VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      ip_address VARCHAR(80) NOT NULL DEFAULT '127.0.0.1',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS students (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_no VARCHAR(50) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL,
      course VARCHAR(100) DEFAULT NULL,
      year_level VARCHAR(20) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS student_accounts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL UNIQUE,
      username VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS billing_records (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      student_id INT NOT NULL,
      billing_code VARCHAR(50) NOT NULL UNIQUE,
      semester VARCHAR(50) NOT NULL,
      school_year VARCHAR(20) NOT NULL,
      total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      balance_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      billing_status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS billing_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      billing_id INT NOT NULL,
      item_code VARCHAR(60) DEFAULT NULL,
      item_name VARCHAR(190) NOT NULL,
      category VARCHAR(100) DEFAULT NULL,
      amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      sort_order INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS billing_notifications (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      billing_id INT NOT NULL,
      student_id INT NOT NULL,
      notification_type VARCHAR(50) NOT NULL DEFAULT 'billing_reminder',
      subject VARCHAR(190) NOT NULL,
      message TEXT NOT NULL,
      recipient_name VARCHAR(150) NOT NULL,
      recipient_email VARCHAR(150) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'sent',
      created_by INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      billing_id INT NOT NULL,
      reference_number VARCHAR(50) NOT NULL UNIQUE,
      amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'Online',
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      reporting_status VARCHAR(30) NOT NULL DEFAULT 'logged',
      payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_by INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS receipt_records (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL,
      receipt_number VARCHAR(50) NOT NULL UNIQUE,
      issued_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      receipt_status VARCHAR(30) NOT NULL DEFAULT 'queued',
      remarks VARCHAR(255) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      payment_id INT DEFAULT NULL,
      billing_id INT NOT NULL,
      reference_number VARCHAR(60) DEFAULT NULL,
      gateway_name VARCHAR(120) NOT NULL DEFAULT 'Mock Gateway',
      attempt_status VARCHAR(40) NOT NULL DEFAULT 'processing',
      request_payload_json JSON DEFAULT NULL,
      response_payload_json JSON DEFAULT NULL,
      remarks TEXT DEFAULT NULL,
      created_by INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS proof_documents (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      receipt_id INT NOT NULL,
      payment_id INT NOT NULL,
      document_type VARCHAR(60) NOT NULL DEFAULT 'proof_of_payment',
      file_name VARCHAR(190) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      verified_by INT DEFAULT NULL,
      verified_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS reconciliations (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL UNIQUE,
      receipt_id INT DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
      discrepancy_note TEXT DEFAULT NULL,
      reconciled_by INT DEFAULT NULL,
      reconciled_at DATETIME DEFAULT NULL,
      reported_at DATETIME DEFAULT NULL,
      archived_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      recipient_role VARCHAR(60) NOT NULL DEFAULT 'cashier',
      recipient_name VARCHAR(190) DEFAULT NULL,
      channel VARCHAR(40) NOT NULL DEFAULT 'in_app',
      type VARCHAR(80) NOT NULL,
      title VARCHAR(190) NOT NULL,
      message TEXT NOT NULL,
      entity_type VARCHAR(60) DEFAULT NULL,
      entity_id INT DEFAULT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME DEFAULT NULL
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      actor_user_id INT DEFAULT NULL,
      actor_name VARCHAR(190) DEFAULT NULL,
      actor_role VARCHAR(120) DEFAULT NULL,
      module_key VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id INT NOT NULL,
      action VARCHAR(120) NOT NULL,
      before_status VARCHAR(60) DEFAULT NULL,
      after_status VARCHAR(60) DEFAULT NULL,
      remarks TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS auto_debit_arrangements (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      billing_id INT NOT NULL,
      account_name VARCHAR(190) NOT NULL,
      bank_name VARCHAR(190) DEFAULT NULL,
      account_mask VARCHAR(40) DEFAULT NULL,
      frequency VARCHAR(40) NOT NULL DEFAULT 'monthly',
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by INT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function seedActivityLog(connection, userId, action, rawAction, description, hoursAgo = 0) {
  await connection.query(
    `INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
     SELECT ?, ?, ?, ?, '127.0.0.1', ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin_activity_logs
       WHERE raw_action = ? AND description = ?
     )`,
    [userId, action, rawAction, description, nowSql(hoursAgo), rawAction, description]
  );
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'cashier_system'
  });

  await ensureSchema(connection);

  const defaultUsername = process.env.SEED_ADMIN_USERNAME || 'admin@cashier.local';
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const staffUsername = process.env.SEED_STAFF_USERNAME || 'staff@cashier.local';
  const staffPassword = process.env.SEED_STAFF_PASSWORD || 'staff123';
  const complianceUsername = process.env.SEED_COMPLIANCE_USERNAME || 'compliance@cashier.local';
  const compliancePassword = process.env.SEED_COMPLIANCE_PASSWORD || 'compliance123';
  const studentPassword = process.env.SEED_STUDENT_PASSWORD || 'student123';

  await connection.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      full_name = VALUES(full_name),
      role = VALUES(role),
      department = VALUES(department),
      access_exemptions_json = VALUES(access_exemptions_json),
      is_super_admin = VALUES(is_super_admin),
      status = VALUES(status),
      phone = VALUES(phone)`,
    [
      defaultUsername,
      defaultUsername,
      'Cashier System Administrator',
      'Admin',
      'Cashier',
      JSON.stringify([
        'billing_verification',
        'manage_billing',
        'process_payment',
        'generate_receipt',
        'financial_transactions',
        'reports'
      ]),
      1,
      hashPassword(defaultPassword),
      'active',
      '+63 912 345 6789'
    ]
  );

  await connection.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      full_name = VALUES(full_name),
      role = VALUES(role),
      department = VALUES(department),
      access_exemptions_json = VALUES(access_exemptions_json),
      is_super_admin = VALUES(is_super_admin),
      status = VALUES(status),
      phone = VALUES(phone)`,
    [
      staffUsername,
      staffUsername,
      'Faculty and Staff Finance Monitor',
      'Accounting Faculty Staff',
      'Transaction Reporting',
      JSON.stringify(['process_payment', 'generate_receipt', 'reports']),
      0,
      hashPassword(staffPassword),
      'active',
      '+63 912 555 0101'
    ]
  );

  await connection.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      full_name = VALUES(full_name),
      role = VALUES(role),
      department = VALUES(department),
      access_exemptions_json = VALUES(access_exemptions_json),
      is_super_admin = VALUES(is_super_admin),
      status = VALUES(status),
      phone = VALUES(phone)`,
    [
      complianceUsername,
      complianceUsername,
      'Compliance Documentation Officer',
      'Compliance Staff',
      'Compliance',
      JSON.stringify(['generate_receipt', 'reports']),
      0,
      hashPassword(compliancePassword),
      'active',
      '+63 912 555 0102'
    ]
  );

  const [adminRows] = await connection.query('SELECT id FROM admin_users WHERE username = ? LIMIT 1', [defaultUsername]);
  const adminId = Array.isArray(adminRows) && adminRows[0] ? Number(adminRows[0].id) : 1;

  await connection.query(
    `INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode, updated_at)
     VALUES (?, 1, 1, 0, ?)
     ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
    [adminId, nowSql()]
  );

  await connection.query(
    `INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode, updated_at)
     SELECT id, 1, 1, 0, ?
     FROM admin_users
     WHERE username IN (?, ?)
     ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
    [nowSql(), staffUsername, complianceUsername]
  );

  await connection.query(`
    INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
    VALUES
      ('2024-0001', 'Juan Dela Cruz', 'BSIT', '3rd Year', 'juan@gmail.com', '09123456789', 'active'),
      ('2024-0002', 'Maria Santos', 'BSBA', '2nd Year', 'maria@gmail.com', '09987654321', 'active'),
      ('2024-0003', 'Angela Dela Cruz', 'BS Information Technology', '2nd Year', 'angela@gmail.com', '09170000001', 'active'),
      ('2024-0004', 'Michael Santos', 'BS Business Administration', '3rd Year', 'michael@gmail.com', '09170000002', 'active'),
      ('2024-0005', 'Trisha Mendoza', 'BS Accountancy', '4th Year', 'trisha@gmail.com', '09170000003', 'active'),
      ('2024-0006', 'Carlo Reyes', 'BS Computer Science', '1st Year', 'carlo@gmail.com', '09170000004', 'active'),
      ('2024-0007', 'Liza Garcia', 'BS Hospitality Management', '2nd Year', 'liza@gmail.com', '09170000005', 'active'),
      ('2024-0008', 'Ethan Flores', 'BS Office Administration', '3rd Year', 'ethan@gmail.com', '09170000006', 'active'),
      ('2024-0009', 'Nina Bautista', 'BS Psychology', '1st Year', 'nina@gmail.com', '09170000007', 'active'),
      ('2024-0010', 'Patrick Lim', 'BS Tourism Management', '4th Year', 'patrick@gmail.com', '09170000008', 'active')
    ON DUPLICATE KEY UPDATE
      full_name = VALUES(full_name),
      course = VALUES(course),
      year_level = VALUES(year_level),
      email = VALUES(email),
      phone = VALUES(phone),
      status = VALUES(status)
  `);

  await connection.query(
    `INSERT INTO student_accounts (student_id, username, password_hash, status, created_at)
     SELECT s.id, s.student_no, ?, 'active', ?
     FROM students s
     WHERE NOT EXISTS (
       SELECT 1 FROM student_accounts sa WHERE sa.student_id = s.id
     )`,
    [hashPassword(studentPassword), nowSql()]
  );

  const billingSeeds = [
    ['2024-0001', 'BILL-1001', '1st Semester', '2025-2026', 15000.0, 5000.0, 10000.0, 'partial'],
    ['2024-0002', 'BILL-1002', '1st Semester', '2025-2026', 12000.0, 12000.0, 0.0, 'paid'],
    ['2024-0003', 'BILL-1003', '2nd Semester', '2025-2026', 12450.0, 0.0, 12450.0, 'unpaid'],
    ['2024-0004', 'BILL-1004', '2nd Semester', '2025-2026', 8960.0, 0.0, 8960.0, 'on_hold'],
    ['2024-0005', 'BILL-1005', '2nd Semester', '2025-2026', 15300.0, 0.0, 15300.0, 'unpaid'],
    ['2024-0006', 'BILL-1006', '2nd Semester', '2025-2026', 4520.0, 0.0, 4520.0, 'correction'],
    ['2024-0007', 'BILL-1007', '1st Semester', '2025-2026', 9340.0, 2500.0, 6840.0, 'partial'],
    ['2024-0008', 'BILL-1008', '1st Semester', '2025-2026', 11080.0, 11080.0, 0.0, 'paid'],
    ['2024-0009', 'BILL-1009', '2nd Semester', '2025-2026', 6780.0, 0.0, 6780.0, 'unpaid'],
    ['2024-0010', 'BILL-1010', '2nd Semester', '2025-2026', 14200.0, 6200.0, 8000.0, 'partial']
  ];

  for (const [studentNo, billingCode, semester, schoolYear, total, paid, balance, status] of billingSeeds) {
    await connection.query(
      `INSERT INTO billing_records (
        student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
      )
      SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM students
      WHERE student_no = ?
      ON DUPLICATE KEY UPDATE
        semester = VALUES(semester),
        school_year = VALUES(school_year),
        total_amount = VALUES(total_amount),
        paid_amount = VALUES(paid_amount),
        balance_amount = VALUES(balance_amount),
        billing_status = VALUES(billing_status),
        updated_at = VALUES(updated_at)`,
      [billingCode, semester, schoolYear, total, paid, balance, status, nowSql(), nowSql(), studentNo]
    );
  }

  const [billingRows] = await connection.query('SELECT id, total_amount FROM billing_records ORDER BY id ASC');
  for (const row of Array.isArray(billingRows) ? billingRows : []) {
    const billingId = Number(row.id);
    const totalAmount = Number(row.total_amount || 0);
    const [existingItemRows] = await connection.query('SELECT COUNT(*) AS total FROM billing_items WHERE billing_id = ?', [billingId]);
    if (Number(existingItemRows[0]?.total || 0) > 0) continue;

    const tuitionAmount = Number((totalAmount * 0.7).toFixed(2));
    const miscAmount = Number((totalAmount * 0.2).toFixed(2));
    const portalAmount = Number((totalAmount - tuitionAmount - miscAmount).toFixed(2));

    await connection.query(
      `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
       VALUES
         (?, 'TUITION', 'Tuition Fee', 'Tuition', ?, 1, ?),
         (?, 'MISC', 'Miscellaneous Fee', 'Assessment', ?, 2, ?),
         (?, 'PORTAL', 'Portal and Service Fee', 'Services', ?, 3, ?)`,
      [billingId, tuitionAmount, nowSql(), billingId, miscAmount, nowSql(), billingId, portalAmount, nowSql()]
    );
  }

  const notificationSeeds = [
    ['BILL-1005', 'billing_reminder', 'Balance reminder sent', 'A reminder was sent for BILL-1005 after verification review.'],
    ['BILL-1006', 'correction_notice', 'Correction notice queued', 'The billing record requires registrar confirmation before payment can continue.'],
    ['BILL-1009', 'billing_reminder', 'Initial billing reminder sent', 'Student was notified about an unpaid balance awaiting cashier verification.'],
    ['BILL-1010', 'payment_followup', 'Partial payment follow-up', 'Student was informed about the remaining balance before full posting.']
  ];

  for (const [billingCode, type, subject, message] of notificationSeeds) {
    await connection.query(
      `INSERT INTO billing_notifications (
        billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
      )
      SELECT b.id, s.id, ?, ?, ?, s.full_name, s.email, 'sent', ?, ?
      FROM billing_records b
      INNER JOIN students s ON s.id = b.student_id
      WHERE b.billing_code = ?
        AND NOT EXISTS (
          SELECT 1
          FROM billing_notifications bn
          WHERE bn.billing_id = b.id AND bn.subject = ?
        )`,
      [type, subject, message, adminId, nowSql(), billingCode, subject]
    );
  }

  const paymentSeeds = [
    ['BILL-1005', 'PAY-2026-0041', 7450.0, 'GCash', 'posted', 7],
    ['BILL-1006', 'PAY-2026-0046', 4520.0, 'Bank Transfer', 'pending_validation', 6],
    ['BILL-1008', 'PAY-2026-0050', 11080.0, 'Maya', 'posted', 5],
    ['BILL-1010', 'PAY-2026-0057', 6200.0, 'Online Banking', 'posted', 4]
  ];

  for (const [billingCode, reference, amount, method, status, hoursAgo] of paymentSeeds) {
    await connection.query(
        `INSERT INTO payment_transactions (
          billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
        )
        SELECT b.id, ?, ?, ?, ?, 'logged', ?, ?, ?
        FROM billing_records b
        WHERE b.billing_code = ?
        ON DUPLICATE KEY UPDATE
          amount_paid = VALUES(amount_paid),
          payment_method = VALUES(payment_method),
          payment_status = VALUES(payment_status),
          reporting_status = VALUES(reporting_status),
          payment_date = VALUES(payment_date),
          processed_by = VALUES(processed_by)`,
      [reference, amount, method, status, nowSql(hoursAgo), adminId, nowSql(hoursAgo), billingCode]
    );
  }

  await connection.query(
    `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
     SELECT p.id, 'OR-2026-0089', ?, 'released', 'Official receipt already released and archived.', ?
     FROM payment_transactions p
     WHERE p.reference_number = 'PAY-2026-0050'
     ON DUPLICATE KEY UPDATE
       issued_date = VALUES(issued_date),
       receipt_status = VALUES(receipt_status),
       remarks = VALUES(remarks)`,
    [nowSql(3), nowSql(3)]
  );

  await connection.query(
    `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
     SELECT p.id, 'OR-2026-0094', ?, 'queued', 'Queued for final approval after partial settlement.', ?
     FROM payment_transactions p
     WHERE p.reference_number = 'PAY-2026-0057'
     ON DUPLICATE KEY UPDATE
       issued_date = VALUES(issued_date),
       receipt_status = VALUES(receipt_status),
       remarks = VALUES(remarks)`,
    [nowSql(2), nowSql(2)]
  );

  await seedActivityLog(connection, adminId, 'Verification Queue Seeded', 'BILLING_NOTIFY', 'Student billing verification queue was seeded with sample billing reminders.', 9);
  await seedActivityLog(connection, adminId, 'Billing Management Seeded', 'BILLING_UPDATE', 'Manage student billing board was seeded with ledger updates for demo monitoring.', 8);
  await seedActivityLog(connection, adminId, 'Payment Batch Prepared', 'PAYMENT_POST', 'Process payment module prepared a morning batch for cashier posting.', 7);
  await seedActivityLog(connection, adminId, 'Receipt Queue Refreshed', 'RECEIPT_RELEASE', 'Generate receipt module refreshed the queue for official receipt release.', 6);
  await seedActivityLog(connection, adminId, 'Transaction Export Prepared', 'TRANSACTION_EXPORT', 'Financial transactions module staged an export bundle for finance review.', 5);
  await seedActivityLog(connection, adminId, 'Report Snapshot Generated', 'REPORT_GENERATE', 'Reports module generated a daily collection snapshot for administration.', 4);
  await seedActivityLog(connection, adminId, 'Settings Snapshot Saved', 'SETTING_SAVE', 'Settings module stored a preview of cashier configuration changes.', 3);

  await connection.query(
    `INSERT INTO notifications (recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at)
     SELECT 'cashier', 'Cashier Team', 'in_app', 'billing_activated', 'Billing activated', 'BILL-1005 is now active in Student Portal & Billing.', 'billing', 5, 0, ?
     WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'billing_activated')`,
    [nowSql(8)]
  );
  await connection.query(
    `INSERT INTO notifications (recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at)
     SELECT 'cashier', 'Cashier Team', 'in_app', 'payment_successful', 'Payment successful', 'PAY-2026-0050 was posted and is waiting for compliance documentation.', 'payment', 3, 0, ?
     WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE type = 'payment_successful')`,
    [nowSql(5)]
  );

  await connection.query(
    `INSERT INTO audit_logs (
      actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
    )
    SELECT ?, 'Cashier System Administrator', 'Admin', 'billing_verification', 'billing', 5, 'Billing Activated', 'Draft', 'Active Billing', 'Seeded BPA billing activation sample.', ?
    WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'Billing Activated' AND entity_id = 5)`,
    [adminId, nowSql(8)]
  );
  await connection.query(
    `INSERT INTO audit_logs (
      actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
    )
    SELECT ?, 'Cashier System Administrator', 'Admin', 'process_payment', 'payment', 3, 'Payment Confirmed', 'Processing', 'Paid', 'Seeded BPA payment confirmation sample.', ?
    WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'Payment Confirmed' AND entity_id = 3)`,
    [adminId, nowSql(5)]
  );

  const [studentCountRows] = await connection.query('SELECT COUNT(*) AS total FROM students');
  const [billingCountRows] = await connection.query('SELECT COUNT(*) AS total FROM billing_records');
  const [paymentCountRows] = await connection.query('SELECT COUNT(*) AS total FROM payment_transactions');
  const [receiptCountRows] = await connection.query('SELECT COUNT(*) AS total FROM receipt_records');

  console.log('Cashier demo seed completed.');
  console.log(`Students: ${studentCountRows[0]?.total ?? 0}`);
  console.log(`Billing records: ${billingCountRows[0]?.total ?? 0}`);
  console.log(`Payment transactions: ${paymentCountRows[0]?.total ?? 0}`);
  console.log(`Receipt records: ${receiptCountRows[0]?.total ?? 0}`);

  await connection.end();
}

main().catch((error) => {
  console.error('Cashier demo seed failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
