CREATE DATABASE IF NOT EXISTS cashier_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cashier_system;

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
);

CREATE TABLE IF NOT EXISTS admin_profile_preferences (
  user_id INT NOT NULL PRIMARY KEY,
  email_notifications TINYINT(1) NOT NULL DEFAULT 1,
  in_app_notifications TINYINT(1) NOT NULL DEFAULT 1,
  dark_mode TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  action VARCHAR(100) NOT NULL,
  raw_action VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  ip_address VARCHAR(80) NOT NULL DEFAULT '127.0.0.1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS student_accounts (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL UNIQUE,
  username VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  workflow_stage VARCHAR(60) NOT NULL DEFAULT 'student_portal_billing',
  correction_reason VARCHAR(190) DEFAULT NULL,
  correction_notes TEXT DEFAULT NULL,
  previous_workflow_stage VARCHAR(60) DEFAULT NULL,
  action_by INT DEFAULT NULL,
  action_at DATETIME DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  audit_reference VARCHAR(120) DEFAULT NULL,
  returned_from VARCHAR(60) DEFAULT NULL,
  returned_to VARCHAR(60) DEFAULT NULL,
  returned_by INT DEFAULT NULL,
  returned_at DATETIME DEFAULT NULL,
  is_returned TINYINT(1) NOT NULL DEFAULT 0,
  needs_correction TINYINT(1) NOT NULL DEFAULT 0,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  item_code VARCHAR(60) DEFAULT NULL,
  item_name VARCHAR(190) NOT NULL,
  category VARCHAR(100) DEFAULT NULL,
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  sort_order INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fee_types (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fee_code VARCHAR(60) NOT NULL UNIQUE,
  fee_name VARCHAR(190) NOT NULL,
  category VARCHAR(100) DEFAULT NULL,
  priority_order INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  reference_number VARCHAR(50) NOT NULL UNIQUE,
  amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'Online',
  payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
  reporting_status VARCHAR(30) NOT NULL DEFAULT 'logged',
  workflow_stage VARCHAR(60) NOT NULL DEFAULT 'payment_processing_gateway',
  correction_reason VARCHAR(190) DEFAULT NULL,
  correction_notes TEXT DEFAULT NULL,
  previous_workflow_stage VARCHAR(60) DEFAULT NULL,
  action_by INT DEFAULT NULL,
  action_at DATETIME DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  audit_reference VARCHAR(120) DEFAULT NULL,
  returned_from VARCHAR(60) DEFAULT NULL,
  returned_to VARCHAR(60) DEFAULT NULL,
  returned_by INT DEFAULT NULL,
  returned_at DATETIME DEFAULT NULL,
  is_returned TINYINT(1) NOT NULL DEFAULT 0,
  needs_correction TINYINT(1) NOT NULL DEFAULT 0,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  payment_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_by INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  billing_id INT NOT NULL,
  billing_item_id INT NOT NULL,
  allocated_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  allocation_order INT NOT NULL DEFAULT 1,
  allocation_status VARCHAR(30) NOT NULL DEFAULT 'committed',
  remarks VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipt_records (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  receipt_number VARCHAR(50) NOT NULL UNIQUE,
  issued_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  receipt_status VARCHAR(30) NOT NULL DEFAULT 'queued',
  workflow_stage VARCHAR(60) NOT NULL DEFAULT 'compliance_documentation',
  correction_reason VARCHAR(190) DEFAULT NULL,
  correction_notes TEXT DEFAULT NULL,
  previous_workflow_stage VARCHAR(60) DEFAULT NULL,
  action_by INT DEFAULT NULL,
  action_at DATETIME DEFAULT NULL,
  audit_reference VARCHAR(120) DEFAULT NULL,
  returned_from VARCHAR(60) DEFAULT NULL,
  returned_to VARCHAR(60) DEFAULT NULL,
  returned_by INT DEFAULT NULL,
  returned_at DATETIME DEFAULT NULL,
  is_returned TINYINT(1) NOT NULL DEFAULT 0,
  needs_correction TINYINT(1) NOT NULL DEFAULT 0,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  remarks VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipt_items (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id INT NOT NULL,
  payment_id INT NOT NULL,
  billing_item_id INT NOT NULL,
  fee_type VARCHAR(190) NOT NULL,
  allocated_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

CREATE TABLE IF NOT EXISTS reconciliations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL UNIQUE,
  receipt_id INT DEFAULT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
  workflow_stage VARCHAR(60) NOT NULL DEFAULT 'reporting_reconciliation',
  discrepancy_note TEXT DEFAULT NULL,
  correction_reason VARCHAR(190) DEFAULT NULL,
  correction_notes TEXT DEFAULT NULL,
  previous_workflow_stage VARCHAR(60) DEFAULT NULL,
  action_by INT DEFAULT NULL,
  action_at DATETIME DEFAULT NULL,
  audit_reference VARCHAR(120) DEFAULT NULL,
  returned_from VARCHAR(60) DEFAULT NULL,
  returned_to VARCHAR(60) DEFAULT NULL,
  returned_by INT DEFAULT NULL,
  returned_at DATETIME DEFAULT NULL,
  is_returned TINYINT(1) NOT NULL DEFAULT 0,
  needs_correction TINYINT(1) NOT NULL DEFAULT 0,
  is_completed TINYINT(1) NOT NULL DEFAULT 0,
  reconciled_by INT DEFAULT NULL,
  reconciled_at DATETIME DEFAULT NULL,
  reported_at DATETIME DEFAULT NULL,
  archived_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

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
  before_stage VARCHAR(60) DEFAULT NULL,
  after_stage VARCHAR(60) DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
);

INSERT INTO admin_users (
  username,
  email,
  full_name,
  role,
  department,
  access_exemptions_json,
  is_super_admin,
  password_hash,
  status,
  phone
)
VALUES (
  'admin@cashier.local',
  'admin@cashier.local',
  'Cashier System Administrator',
  'Admin',
  'Cashier',
  JSON_ARRAY(
    'billing_verification',
    'manage_billing',
    'process_payment',
    'generate_receipt',
    'financial_transactions',
    'reports',
    'settings',
    'my_profile'
  ),
  1,
  'c61318148f8856c45d72d46c417a8118:73708f75315374d5f919dadc63e51a5c9c5b480dbfdc7756a5eb72f17f2f76d5fe2eed59fb7258f29523667002db0c11217ef870fc8fbe2bdcf2ac1e86594987',
  'active',
  '+63 912 345 6789'
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  full_name = VALUES(full_name),
  role = VALUES(role),
  department = VALUES(department),
  access_exemptions_json = VALUES(access_exemptions_json),
  is_super_admin = VALUES(is_super_admin),
  password_hash = VALUES(password_hash),
  status = VALUES(status),
  phone = VALUES(phone);

INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode, updated_at)
SELECT id, 1, 1, 0, NOW()
FROM admin_users
WHERE username = 'admin@cashier.local'
ON DUPLICATE KEY UPDATE
  email_notifications = VALUES(email_notifications),
  in_app_notifications = VALUES(in_app_notifications),
  dark_mode = VALUES(dark_mode),
  updated_at = VALUES(updated_at);

INSERT INTO admin_users (
  username,
  email,
  full_name,
  role,
  department,
  access_exemptions_json,
  is_super_admin,
  password_hash,
  status,
  phone
)
VALUES (
  'staff@cashier.local',
  'staff@cashier.local',
  'Faculty and Staff Finance Monitor',
  'Accounting Faculty Staff',
  'Transaction Reporting',
  JSON_ARRAY(
    'process_payment',
    'generate_receipt',
    'reports'
  ),
  0,
  'e91a1c8d1719eb76c0527c57cc879f45:3de871a6b958410d8555b4b42228a0fda998a6969096d678c3998cc875154c58ab303294bc7205724295b0e05f90407e3acdbff581300ff509af5bd8b87213b7',
  'active',
  '+63 912 555 0101'
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  full_name = VALUES(full_name),
  role = VALUES(role),
  department = VALUES(department),
  access_exemptions_json = VALUES(access_exemptions_json),
  is_super_admin = VALUES(is_super_admin),
  password_hash = VALUES(password_hash),
  status = VALUES(status),
  phone = VALUES(phone);

INSERT INTO admin_users (
  username,
  email,
  full_name,
  role,
  department,
  access_exemptions_json,
  is_super_admin,
  password_hash,
  status,
  phone
)
VALUES (
  'compliance@cashier.local',
  'compliance@cashier.local',
  'Compliance Documentation Officer',
  'Compliance Staff',
  'Compliance',
  JSON_ARRAY(
    'generate_receipt',
    'reports'
  ),
  0,
  '2393c289a09415c86f009a18754705b4:6a96bccdf0762b4e1a56640387a0f17e9e5573df82d8f253f4398f2311f5a564bb8640607f8b23f207ca049c5248df131ba9e8be140f045b6745603d17a27b15',
  'active',
  '+63 912 555 0102'
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  full_name = VALUES(full_name),
  role = VALUES(role),
  department = VALUES(department),
  access_exemptions_json = VALUES(access_exemptions_json),
  is_super_admin = VALUES(is_super_admin),
  password_hash = VALUES(password_hash),
  status = VALUES(status),
  phone = VALUES(phone);

INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode, updated_at)
SELECT id, 1, 1, 0, NOW()
FROM admin_users
WHERE username IN ('staff@cashier.local', 'compliance@cashier.local')
ON DUPLICATE KEY UPDATE
  email_notifications = VALUES(email_notifications),
  in_app_notifications = VALUES(in_app_notifications),
  dark_mode = VALUES(dark_mode),
  updated_at = VALUES(updated_at);

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
  status = VALUES(status);

INSERT INTO student_accounts (student_id, username, password_hash, status, created_at)
SELECT
  s.id,
  s.student_no,
  'e6d166f3f78455896dbb3fc7bf36d53c:61b664e4101038f35f5907d8299016b417e3521107fe3fde8f2eec815e1bb97f0a51f7e9c7db35bb5d081250f32f2cf2105a19fa2cc6f10f72d3d7ff8d4b289a',
  'active',
  NOW()
FROM students s
WHERE NOT EXISTS (
  SELECT 1 FROM student_accounts sa WHERE sa.student_id = s.id
);

INSERT INTO fee_types (fee_code, fee_name, category, priority_order, created_at)
VALUES
  ('TUITION', 'Tuition Fee', 'Academic', 1, NOW()),
  ('LAB', 'Laboratory Fee', 'Academic', 2, NOW()),
  ('MISC', 'Miscellaneous Fee', 'Assessment', 3, NOW()),
  ('RESEARCH', 'Research Fee', 'Academic', 4, NOW()),
  ('FOUNDATION', 'Foundation Fee', 'Assessment', 5, NOW()),
  ('BOOK', 'Book Fee', 'Academic', 6, NOW()),
  ('UNIFORM', 'Uniform Fee', 'Services', 7, NOW()),
  ('REGISTRATION', 'Registration Fee', 'Services', 8, NOW()),
  ('ID', 'ID Fee', 'Services', 9, NOW()),
  ('OTHER', 'Other School Fees', 'Other', 10, NOW())
ON DUPLICATE KEY UPDATE
  fee_name = VALUES(fee_name),
  category = VALUES(category),
  priority_order = VALUES(priority_order);

-- Student Portal & Billing seed
INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1001', '1st Semester', '2025-2026', 15000.00, 0.00, 15000.00, 'unpaid', DATE_SUB(NOW(), INTERVAL 10 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY)
FROM students s
WHERE s.student_no = '2024-0001'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1002', '1st Semester', '2025-2026', 12000.00, 0.00, 12000.00, 'verified', DATE_SUB(NOW(), INTERVAL 9 DAY), DATE_SUB(NOW(), INTERVAL 5 HOUR)
FROM students s
WHERE s.student_no = '2024-0002'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1003', '2nd Semester', '2025-2026', 12450.00, 4200.00, 8250.00, 'partial', DATE_SUB(NOW(), INTERVAL 8 DAY), DATE_SUB(NOW(), INTERVAL 4 HOUR)
FROM students s
WHERE s.student_no = '2024-0003'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1004', '2nd Semester', '2025-2026', 8960.00, 8960.00, 0.00, 'paid', DATE_SUB(NOW(), INTERVAL 7 DAY), DATE_SUB(NOW(), INTERVAL 3 HOUR)
FROM students s
WHERE s.student_no = '2024-0004'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1005', '2nd Semester', '2025-2026', 15300.00, 0.00, 15300.00, 'correction', DATE_SUB(NOW(), INTERVAL 6 DAY), DATE_SUB(NOW(), INTERVAL 2 HOUR)
FROM students s
WHERE s.student_no = '2024-0005'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1006', '2nd Semester', '2025-2026', 4520.00, 0.00, 4520.00, 'draft', DATE_SUB(NOW(), INTERVAL 5 DAY), DATE_SUB(NOW(), INTERVAL 1 HOUR)
FROM students s
WHERE s.student_no = '2024-0006'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1007', '1st Semester', '2025-2026', 9340.00, 0.00, 9340.00, 'failed', DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 7 HOUR)
FROM students s
WHERE s.student_no = '2024-0007'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1008', '1st Semester', '2025-2026', 11080.00, 11080.00, 0.00, 'archived', DATE_SUB(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 2 DAY)
FROM students s
WHERE s.student_no = '2024-0008'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1009', '2nd Semester', '2025-2026', 6780.00, 0.00, 6780.00, 'verified', DATE_SUB(NOW(), INTERVAL 3 DAY), DATE_SUB(NOW(), INTERVAL 20 MINUTE)
FROM students s
WHERE s.student_no = '2024-0009'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
)
SELECT s.id, 'BILL-1010', '2nd Semester', '2025-2026', 14200.00, 14200.00, 0.00, 'paid', DATE_SUB(NOW(), INTERVAL 2 DAY), DATE_SUB(NOW(), INTERVAL 15 MINUTE)
FROM students s
WHERE s.student_no = '2024-0010'
ON DUPLICATE KEY UPDATE
  semester = VALUES(semester),
  school_year = VALUES(school_year),
  total_amount = VALUES(total_amount),
  paid_amount = VALUES(paid_amount),
  balance_amount = VALUES(balance_amount),
  billing_status = VALUES(billing_status),
  updated_at = VALUES(updated_at);

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', ROUND(b.total_amount * 0.70, 2), 1, NOW()
FROM billing_records b
WHERE NOT EXISTS (
  SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'TUITION'
);

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'MISC', 'Miscellaneous Fee', 'Assessment', ROUND(b.total_amount * 0.20, 2), 2, NOW()
FROM billing_records b
WHERE NOT EXISTS (
  SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'MISC'
);

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'PORTAL', 'Portal and Service Fee', 'Services', ROUND(b.total_amount - ROUND(b.total_amount * 0.70, 2) - ROUND(b.total_amount * 0.20, 2), 2), 3, NOW()
FROM billing_records b
WHERE NOT EXISTS (
  SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'PORTAL'
);

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'LAB', 'Laboratory Fee', 'Academic', ROUND(b.total_amount * 0.08, 2), 4, NOW()
FROM billing_records b
WHERE b.billing_code IN ('BILL-1003', 'BILL-1004', 'BILL-1006', 'BILL-1009')
  AND NOT EXISTS (
    SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'LAB'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'BOOK', 'Book Fee', 'Academic', ROUND(b.total_amount * 0.05, 2), 5, NOW()
FROM billing_records b
WHERE b.billing_code IN ('BILL-1003', 'BILL-1008', 'BILL-1009')
  AND NOT EXISTS (
    SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'BOOK'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'UNIFORM', 'Uniform Fee', 'Services', ROUND(b.total_amount * 0.04, 2), 6, NOW()
FROM billing_records b
WHERE b.billing_code IN ('BILL-1003', 'BILL-1007', 'BILL-1009')
  AND NOT EXISTS (
    SELECT 1 FROM billing_items i WHERE i.billing_id = b.id AND i.item_code = 'UNIFORM'
  );

-- Pay Bills and Payment Processing seed
INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0040', 3000.00, 'Debit Card', 'cancelled', 'logged', DATE_SUB(NOW(), INTERVAL 18 HOUR), 1, DATE_SUB(NOW(), INTERVAL 18 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1001'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0041', 4200.00, 'GCash', 'paid', 'logged', DATE_SUB(NOW(), INTERVAL 16 HOUR), 1, DATE_SUB(NOW(), INTERVAL 16 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1003'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0042', 8960.00, 'Bank Transfer', 'paid', 'reconciled', DATE_SUB(NOW(), INTERVAL 12 HOUR), 1, DATE_SUB(NOW(), INTERVAL 12 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1004'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0043', 9340.00, 'Maya', 'failed', 'logged', DATE_SUB(NOW(), INTERVAL 10 HOUR), 1, DATE_SUB(NOW(), INTERVAL 10 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1007'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0044', 6780.00, 'Online Banking', 'processing', 'logged', DATE_SUB(NOW(), INTERVAL 7 HOUR), 1, DATE_SUB(NOW(), INTERVAL 7 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1009'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0045', 11080.00, 'Cash', 'paid', 'archived', DATE_SUB(NOW(), INTERVAL 3 DAY), 1, DATE_SUB(NOW(), INTERVAL 3 DAY)
FROM billing_records b
WHERE b.billing_code = 'BILL-1008'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0046', 4500.00, 'GCash', 'authorized', 'logged', DATE_SUB(NOW(), INTERVAL 2 HOUR), 1, DATE_SUB(NOW(), INTERVAL 2 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1002'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, payment_date, processed_by, created_at
)
SELECT b.id, 'PAY-2026-0047', 14200.00, 'Credit Card', 'paid', 'reported', DATE_SUB(NOW(), INTERVAL 90 MINUTE), 1, DATE_SUB(NOW(), INTERVAL 90 MINUTE)
FROM billing_records b
WHERE b.billing_code = 'BILL-1010'
ON DUPLICATE KEY UPDATE
  amount_paid = VALUES(amount_paid),
  payment_method = VALUES(payment_method),
  payment_status = VALUES(payment_status),
  reporting_status = VALUES(reporting_status),
  payment_date = VALUES(payment_date),
  processed_by = VALUES(processed_by);

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'cancelled',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'partial', 'billing_code', 'BILL-1001'),
  JSON_OBJECT('status', 'cancelled', 'code', 'USR_CANCELLED'),
  'Student cancelled the initial payment request.',
  1,
  DATE_SUB(NOW(), INTERVAL 18 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0040'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0040' AND a.attempt_status = 'cancelled'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'paid',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'installment', 'billing_code', 'BILL-1003'),
  JSON_OBJECT('status', 'paid', 'gateway_reference', 'GW-0041'),
  'Installment payment posted successfully.',
  1,
  DATE_SUB(NOW(), INTERVAL 16 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0041'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0041' AND a.attempt_status = 'paid'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'paid',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'full', 'billing_code', 'BILL-1004'),
  JSON_OBJECT('status', 'paid', 'gateway_reference', 'GW-0042'),
  'Full payment posted and ready for receipt generation.',
  1,
  DATE_SUB(NOW(), INTERVAL 12 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0042'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0042' AND a.attempt_status = 'paid'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'failed',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'full', 'billing_code', 'BILL-1007'),
  JSON_OBJECT('status', 'failed', 'code', 'DECLINED'),
  'Gateway declined the transaction and returned it for retry.',
  1,
  DATE_SUB(NOW(), INTERVAL 10 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0043'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0043' AND a.attempt_status = 'failed'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'processing',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'full', 'billing_code', 'BILL-1009'),
  JSON_OBJECT('status', 'processing'),
  'Gateway request is still being validated.',
  1,
  DATE_SUB(NOW(), INTERVAL 7 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0044'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0044' AND a.attempt_status = 'processing'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'paid',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'historical', 'billing_code', 'BILL-1008'),
  JSON_OBJECT('status', 'paid', 'gateway_reference', 'GW-0045'),
  'Archived payment history imported for reconciliation.',
  1,
  DATE_SUB(NOW(), INTERVAL 3 DAY)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0045'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0045' AND a.attempt_status = 'paid'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'authorized',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'full', 'billing_code', 'BILL-1002'),
  JSON_OBJECT('status', 'authorized', 'gateway_reference', 'GW-0046'),
  'Payment was authorized and is waiting for final capture.',
  1,
  DATE_SUB(NOW(), INTERVAL 2 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0046'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0046' AND a.attempt_status = 'authorized'
  );

INSERT INTO payment_attempts (
  payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
)
SELECT p.id, p.billing_id, p.reference_number, 'Mock Gateway', 'paid',
  JSON_OBJECT('source', 'pay-bills', 'mode', 'full', 'billing_code', 'BILL-1010'),
  JSON_OBJECT('status', 'paid', 'gateway_reference', 'GW-0047'),
  'Payment was captured and sent to compliance review.',
  1,
  DATE_SUB(NOW(), INTERVAL 90 MINUTE)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0047'
  AND NOT EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.reference_number = 'PAY-2026-0047' AND a.attempt_status = 'paid'
  );

INSERT INTO payment_allocations (
  payment_id, billing_id, billing_item_id, allocated_amount, allocation_order, allocation_status, remarks, created_at
)
SELECT
  p.id,
  p.billing_id,
  i.id,
  CASE
    WHEN p.reference_number = 'PAY-2026-0041' AND i.item_code = 'TUITION' THEN 3000.00
    WHEN p.reference_number = 'PAY-2026-0041' AND i.item_code = 'MISC' THEN 1200.00
    WHEN p.reference_number = 'PAY-2026-0042' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 6000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0042' AND i.item_code = 'MISC' THEN ROUND(LEAST(i.amount, 1800.00), 2)
    WHEN p.reference_number = 'PAY-2026-0042' AND i.item_code = 'PORTAL' THEN ROUND(LEAST(i.amount, 1160.00), 2)
    WHEN p.reference_number = 'PAY-2026-0043' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 6000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0043' AND i.item_code = 'MISC' THEN ROUND(LEAST(i.amount, 2500.00), 2)
    WHEN p.reference_number = 'PAY-2026-0043' AND i.item_code = 'UNIFORM' THEN ROUND(LEAST(i.amount, 840.00), 2)
    WHEN p.reference_number = 'PAY-2026-0044' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 5000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0044' AND i.item_code = 'LAB' THEN ROUND(LEAST(i.amount, 1200.00), 2)
    WHEN p.reference_number = 'PAY-2026-0044' AND i.item_code = 'BOOK' THEN ROUND(LEAST(i.amount, 580.00), 2)
    WHEN p.reference_number = 'PAY-2026-0045' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 8000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0045' AND i.item_code = 'MISC' THEN ROUND(LEAST(i.amount, 2200.00), 2)
    WHEN p.reference_number = 'PAY-2026-0045' AND i.item_code = 'BOOK' THEN ROUND(LEAST(i.amount, 880.00), 2)
    WHEN p.reference_number = 'PAY-2026-0046' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 4000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0046' AND i.item_code = 'PORTAL' THEN ROUND(LEAST(i.amount, 1100.00), 2)
    WHEN p.reference_number = 'PAY-2026-0047' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 9000.00), 2)
    WHEN p.reference_number = 'PAY-2026-0047' AND i.item_code = 'MISC' THEN ROUND(LEAST(i.amount, 3200.00), 2)
    WHEN p.reference_number = 'PAY-2026-0048' AND i.item_code = 'TUITION' THEN ROUND(LEAST(i.amount, 3500.00), 2)
    WHEN p.reference_number = 'PAY-2026-0048' AND i.item_code = 'MISC' THEN ROUND(LEAST(i.amount, 1500.00), 2)
    ELSE 0.00
  END,
  i.sort_order,
  CASE
    WHEN p.payment_status = 'paid' THEN 'finalized'
    WHEN p.payment_status IN ('processing', 'authorized', 'pending') THEN 'committed'
    ELSE 'cancelled'
  END,
  CONCAT('Seeded allocation for ', p.reference_number),
  p.created_at
FROM payment_transactions p
INNER JOIN billing_items i ON i.billing_id = p.billing_id
WHERE NOT EXISTS (
  SELECT 1 FROM payment_allocations a WHERE a.payment_id = p.id
)
HAVING allocated_amount > 0;

-- Compliance & Documentation seed
INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
SELECT p.id, 'OR-2026-0088', DATE_SUB(NOW(), INTERVAL 15 HOUR), 'generated', 'Installment receipt generated and waiting for proof verification.', DATE_SUB(NOW(), INTERVAL 15 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0041'
ON DUPLICATE KEY UPDATE
  issued_date = VALUES(issued_date),
  receipt_status = VALUES(receipt_status),
  remarks = VALUES(remarks);

INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
SELECT p.id, 'OR-2026-0089', DATE_SUB(NOW(), INTERVAL 11 HOUR), 'completed', 'Official receipt completed and archived for release.', DATE_SUB(NOW(), INTERVAL 11 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0042'
ON DUPLICATE KEY UPDATE
  issued_date = VALUES(issued_date),
  receipt_status = VALUES(receipt_status),
  remarks = VALUES(remarks);

INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
SELECT p.id, 'OR-2026-0090', DATE_SUB(NOW(), INTERVAL 70 HOUR), 'completed', 'Historical receipt completed for archived payment batch.', DATE_SUB(NOW(), INTERVAL 70 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0045'
ON DUPLICATE KEY UPDATE
  issued_date = VALUES(issued_date),
  receipt_status = VALUES(receipt_status),
  remarks = VALUES(remarks);

INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
SELECT p.id, 'OR-2026-0091', DATE_SUB(NOW(), INTERVAL 60 MINUTE), 'verified', 'Receipt generated and proof already checked by compliance staff.', DATE_SUB(NOW(), INTERVAL 60 MINUTE)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0047'
ON DUPLICATE KEY UPDATE
  issued_date = VALUES(issued_date),
  receipt_status = VALUES(receipt_status),
  remarks = VALUES(remarks);

INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
SELECT r.id, r.payment_id, 'proof_of_payment', 'proof-pay-2026-0041.pdf', 'pending', NULL, NULL, DATE_SUB(NOW(), INTERVAL 15 HOUR)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0088'
  AND NOT EXISTS (
    SELECT 1 FROM proof_documents d WHERE d.receipt_id = r.id
  );

INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
SELECT r.id, r.payment_id, 'proof_of_payment', 'proof-pay-2026-0042.pdf', 'verified', 1, DATE_SUB(NOW(), INTERVAL 10 HOUR), DATE_SUB(NOW(), INTERVAL 11 HOUR)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0089'
  AND NOT EXISTS (
    SELECT 1 FROM proof_documents d WHERE d.receipt_id = r.id
  );

INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
SELECT r.id, r.payment_id, 'proof_of_payment', 'proof-pay-2026-0045.pdf', 'verified', 1, DATE_SUB(NOW(), INTERVAL 60 HOUR), DATE_SUB(NOW(), INTERVAL 70 HOUR)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0090'
  AND NOT EXISTS (
    SELECT 1 FROM proof_documents d WHERE d.receipt_id = r.id
  );

INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
SELECT r.id, r.payment_id, 'proof_of_payment', 'proof-pay-2026-0047.pdf', 'verified', 1, DATE_SUB(NOW(), INTERVAL 30 MINUTE), DATE_SUB(NOW(), INTERVAL 60 MINUTE)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0091'
  AND NOT EXISTS (
    SELECT 1 FROM proof_documents d WHERE d.receipt_id = r.id
  );

INSERT INTO receipt_items (receipt_id, payment_id, billing_item_id, fee_type, allocated_amount, created_at)
SELECT
  r.id,
  r.payment_id,
  a.billing_item_id,
  i.item_name,
  a.allocated_amount,
  r.created_at
FROM receipt_records r
INNER JOIN payment_allocations a ON a.payment_id = r.payment_id
INNER JOIN billing_items i ON i.id = a.billing_item_id
WHERE a.allocation_status = 'finalized'
  AND NOT EXISTS (
    SELECT 1 FROM receipt_items ri WHERE ri.receipt_id = r.id
  );

-- Reporting & Reconciliation seed
INSERT INTO reconciliations (
  payment_id, receipt_id, status, discrepancy_note, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
)
SELECT p.id, r.id, 'pending_review', NULL, NULL, NULL, NULL, NULL, DATE_SUB(NOW(), INTERVAL 14 HOUR), DATE_SUB(NOW(), INTERVAL 14 HOUR)
FROM payment_transactions p
INNER JOIN receipt_records r ON r.payment_id = p.id
WHERE p.reference_number = 'PAY-2026-0041'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  status = VALUES(status),
  discrepancy_note = VALUES(discrepancy_note),
  reconciled_by = VALUES(reconciled_by),
  reconciled_at = VALUES(reconciled_at),
  reported_at = VALUES(reported_at),
  archived_at = VALUES(archived_at),
  updated_at = VALUES(updated_at);

INSERT INTO reconciliations (
  payment_id, receipt_id, status, discrepancy_note, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
)
SELECT p.id, r.id, 'reconciled', NULL, 1, DATE_SUB(NOW(), INTERVAL 9 HOUR), NULL, NULL, DATE_SUB(NOW(), INTERVAL 11 HOUR), DATE_SUB(NOW(), INTERVAL 9 HOUR)
FROM payment_transactions p
INNER JOIN receipt_records r ON r.payment_id = p.id
WHERE p.reference_number = 'PAY-2026-0042'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  status = VALUES(status),
  discrepancy_note = VALUES(discrepancy_note),
  reconciled_by = VALUES(reconciled_by),
  reconciled_at = VALUES(reconciled_at),
  reported_at = VALUES(reported_at),
  archived_at = VALUES(archived_at),
  updated_at = VALUES(updated_at);

INSERT INTO reconciliations (
  payment_id, receipt_id, status, discrepancy_note, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
)
SELECT p.id, NULL, 'discrepancy', 'Gateway request is still processing and has no documentation package yet.', 1, NULL, NULL, NULL, DATE_SUB(NOW(), INTERVAL 6 HOUR), DATE_SUB(NOW(), INTERVAL 30 MINUTE)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0044'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  status = VALUES(status),
  discrepancy_note = VALUES(discrepancy_note),
  reconciled_by = VALUES(reconciled_by),
  reconciled_at = VALUES(reconciled_at),
  reported_at = VALUES(reported_at),
  archived_at = VALUES(archived_at),
  updated_at = VALUES(updated_at);

INSERT INTO reconciliations (
  payment_id, receipt_id, status, discrepancy_note, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
)
SELECT p.id, r.id, 'archived', NULL, 1, DATE_SUB(NOW(), INTERVAL 55 HOUR), DATE_SUB(NOW(), INTERVAL 54 HOUR), DATE_SUB(NOW(), INTERVAL 48 HOUR), DATE_SUB(NOW(), INTERVAL 70 HOUR), DATE_SUB(NOW(), INTERVAL 48 HOUR)
FROM payment_transactions p
INNER JOIN receipt_records r ON r.payment_id = p.id
WHERE p.reference_number = 'PAY-2026-0045'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  status = VALUES(status),
  discrepancy_note = VALUES(discrepancy_note),
  reconciled_by = VALUES(reconciled_by),
  reconciled_at = VALUES(reconciled_at),
  reported_at = VALUES(reported_at),
  archived_at = VALUES(archived_at),
  updated_at = VALUES(updated_at);

INSERT INTO reconciliations (
  payment_id, receipt_id, status, discrepancy_note, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
)
SELECT p.id, r.id, 'reported', NULL, 1, DATE_SUB(NOW(), INTERVAL 40 MINUTE), DATE_SUB(NOW(), INTERVAL 20 MINUTE), NULL, DATE_SUB(NOW(), INTERVAL 60 MINUTE), DATE_SUB(NOW(), INTERVAL 20 MINUTE)
FROM payment_transactions p
INNER JOIN receipt_records r ON r.payment_id = p.id
WHERE p.reference_number = 'PAY-2026-0047'
ON DUPLICATE KEY UPDATE
  receipt_id = VALUES(receipt_id),
  status = VALUES(status),
  discrepancy_note = VALUES(discrepancy_note),
  reconciled_by = VALUES(reconciled_by),
  reconciled_at = VALUES(reconciled_at),
  reported_at = VALUES(reported_at),
  archived_at = VALUES(archived_at),
  updated_at = VALUES(updated_at);

-- Module notifications
INSERT INTO billing_notifications (
  billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
)
SELECT b.id, s.id, 'billing_verified', 'Billing Verified', 'BILL-1002 is verified and ready to move to Pay Bills.', s.full_name, s.email, 'sent', 1, DATE_SUB(NOW(), INTERVAL 5 HOUR)
FROM billing_records b
INNER JOIN students s ON s.id = b.student_id
WHERE b.billing_code = 'BILL-1002'
  AND NOT EXISTS (
    SELECT 1 FROM billing_notifications n WHERE n.billing_id = b.id AND n.subject = 'Billing Verified'
  );

INSERT INTO billing_notifications (
  billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
)
SELECT b.id, s.id, 'correction_required', 'Correction Required', 'BILL-1005 was returned for correction before payment can continue.', s.full_name, s.email, 'sent', 1, DATE_SUB(NOW(), INTERVAL 2 HOUR)
FROM billing_records b
INNER JOIN students s ON s.id = b.student_id
WHERE b.billing_code = 'BILL-1005'
  AND NOT EXISTS (
    SELECT 1 FROM billing_notifications n WHERE n.billing_id = b.id AND n.subject = 'Correction Required'
  );

INSERT INTO billing_notifications (
  billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
)
SELECT b.id, s.id, 'payment_reminder', 'Payment Reminder', 'BILL-1009 is active in Pay Bills and waiting for payment posting.', s.full_name, s.email, 'sent', 1, DATE_SUB(NOW(), INTERVAL 1 HOUR)
FROM billing_records b
INNER JOIN students s ON s.id = b.student_id
WHERE b.billing_code = 'BILL-1009'
  AND NOT EXISTS (
    SELECT 1 FROM billing_notifications n WHERE n.billing_id = b.id AND n.subject = 'Payment Reminder'
  );

INSERT INTO billing_notifications (
  billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
)
SELECT b.id, s.id, 'payment_failed', 'Payment Failed', 'BILL-1007 payment attempt failed and was returned for follow-up.', s.full_name, s.email, 'sent', 1, DATE_SUB(NOW(), INTERVAL 9 HOUR)
FROM billing_records b
INNER JOIN students s ON s.id = b.student_id
WHERE b.billing_code = 'BILL-1007'
  AND NOT EXISTS (
    SELECT 1 FROM billing_notifications n WHERE n.billing_id = b.id AND n.subject = 'Payment Failed'
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'cashier', 'Cashier Team', 'in_app', 'billing_activated', 'Billing activated', 'BILL-1002 is ready for settlement in Pay Bills.', 'billing', b.id, 0, DATE_SUB(NOW(), INTERVAL 5 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1002'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'billing_activated' AND n.entity_type = 'billing' AND n.entity_id = b.id
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'cashier', 'Cashier Team', 'in_app', 'payment_pending', 'Payment pending', 'PAY-2026-0044 is still processing in the payment gateway.', 'payment', p.id, 0, DATE_SUB(NOW(), INTERVAL 7 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0044'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'payment_pending' AND n.entity_type = 'payment' AND n.entity_id = p.id
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'cashier', 'Cashier Team', 'in_app', 'payment_successful', 'Payment successful', 'PAY-2026-0042 was posted and forwarded to Compliance & Documentation.', 'payment', p.id, 1, DATE_SUB(NOW(), INTERVAL 12 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0042'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'payment_successful' AND n.entity_type = 'payment' AND n.entity_id = p.id
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'cashier', 'Cashier Team', 'in_app', 'payment_failed', 'Payment failed', 'PAY-2026-0043 failed validation and can be retried from Pay Bills.', 'payment', p.id, 0, DATE_SUB(NOW(), INTERVAL 10 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0043'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'payment_failed' AND n.entity_type = 'payment' AND n.entity_id = p.id
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'cashier', 'Cashier Team', 'in_app', 'receipt_generated', 'Receipt generated', 'OR-2026-0088 is ready for proof verification.', 'receipt', r.id, 0, DATE_SUB(NOW(), INTERVAL 15 HOUR)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0088'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'receipt_generated' AND n.entity_type = 'receipt' AND n.entity_id = r.id
  );

INSERT INTO notifications (
  recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
)
SELECT 'admin', 'Accounting Review', 'in_app', 'discrepancy_flagged', 'Discrepancy flagged', 'PAY-2026-0044 is missing documentation and needs reconciliation review.', 'payment', p.id, 0, DATE_SUB(NOW(), INTERVAL 30 MINUTE)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0044'
  AND NOT EXISTS (
    SELECT 1 FROM notifications n WHERE n.type = 'discrepancy_flagged' AND n.entity_type = 'payment' AND n.entity_id = p.id
  );

-- Audit trail
INSERT INTO audit_logs (
  actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
)
SELECT 1, 'Cashier System Administrator', 'Admin', 'student_portal_billing', 'billing', b.id, 'Billing Activated', 'Active Billing', 'Pending Payment', 'Billing record was verified and forwarded to Pay Bills.', DATE_SUB(NOW(), INTERVAL 5 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1002'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.module_key = 'student_portal_billing' AND a.action = 'Billing Activated' AND a.entity_id = b.id
  );

INSERT INTO audit_logs (
  actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
)
SELECT 1, 'Cashier System Administrator', 'Cashier', 'pay_bills', 'billing', b.id, 'Installment Accepted', 'Pending Payment', 'Partially Paid', 'A partial payment was accepted and remaining balance was carried forward.', DATE_SUB(NOW(), INTERVAL 16 HOUR)
FROM billing_records b
WHERE b.billing_code = 'BILL-1003'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.module_key = 'pay_bills' AND a.action = 'Installment Accepted' AND a.entity_id = b.id
  );

INSERT INTO audit_logs (
  actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
)
SELECT 1, 'Cashier System Administrator', 'Cashier', 'payment_processing_gateway', 'payment', p.id, 'Payment Confirmed', 'Processing', 'Paid', 'Gateway returned a successful paid status.', DATE_SUB(NOW(), INTERVAL 12 HOUR)
FROM payment_transactions p
WHERE p.reference_number = 'PAY-2026-0042'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.module_key = 'payment_processing_gateway' AND a.action = 'Payment Confirmed' AND a.entity_id = p.id
  );

INSERT INTO audit_logs (
  actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
)
SELECT 1, 'Cashier System Administrator', 'Compliance Staff', 'compliance_documentation', 'receipt', r.id, 'Receipt Generated', 'Receipt Pending', 'Proof Verified', 'Receipt was generated and proof documents were validated.', DATE_SUB(NOW(), INTERVAL 60 MINUTE)
FROM receipt_records r
WHERE r.receipt_number = 'OR-2026-0091'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.module_key = 'compliance_documentation' AND a.action = 'Receipt Generated' AND a.entity_id = r.id
  );

INSERT INTO audit_logs (
  actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
)
SELECT 1, 'Cashier System Administrator', 'Admin', 'reporting_reconciliation', 'reconciliation', rc.id, 'Reconciliation Archived', 'Reconciled', 'Archived', 'Historical payment batch was archived after reporting cycle completion.', DATE_SUB(NOW(), INTERVAL 48 HOUR)
FROM reconciliations rc
INNER JOIN payment_transactions p ON p.id = rc.payment_id
WHERE p.reference_number = 'PAY-2026-0045'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a WHERE a.module_key = 'reporting_reconciliation' AND a.action = 'Reconciliation Archived' AND a.entity_id = rc.id
  );

-- Admin activity feed
INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
SELECT 1, 'Student Portal Queue Seeded', 'BILLING_SEEDED', 'Student Portal & Billing was seeded with active, draft, correction, and archived records.', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 8 HOUR)
WHERE NOT EXISTS (
  SELECT 1 FROM admin_activity_logs WHERE raw_action = 'BILLING_SEEDED'
);

INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
SELECT 1, 'Pay Bills Queue Seeded', 'PAY_BILLS_SEEDED', 'Pay Bills was seeded with pending, installment, failed, and settled payment scenarios.', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 7 HOUR)
WHERE NOT EXISTS (
  SELECT 1 FROM admin_activity_logs WHERE raw_action = 'PAY_BILLS_SEEDED'
);

INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
SELECT 1, 'Gateway Queue Seeded', 'GATEWAY_SEEDED', 'Payment Processing & Gateway received authorized, processing, cancelled, and failed transactions.', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 6 HOUR)
WHERE NOT EXISTS (
  SELECT 1 FROM admin_activity_logs WHERE raw_action = 'GATEWAY_SEEDED'
);

INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
SELECT 1, 'Compliance Queue Seeded', 'COMPLIANCE_SEEDED', 'Compliance & Documentation was seeded with generated, verified, and completed receipts.', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 5 HOUR)
WHERE NOT EXISTS (
  SELECT 1 FROM admin_activity_logs WHERE raw_action = 'COMPLIANCE_SEEDED'
);

INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address, created_at)
SELECT 1, 'Reporting Queue Seeded', 'REPORTING_SEEDED', 'Reporting & Reconciliation was seeded with pending, reconciled, reported, archived, and discrepancy samples.', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 4 HOUR)
WHERE NOT EXISTS (
  SELECT 1 FROM admin_activity_logs WHERE raw_action = 'REPORTING_SEEDED'
);

INSERT INTO auto_debit_arrangements (
  billing_id, account_name, bank_name, account_mask, frequency, status, created_by, created_at
)
SELECT b.id, 'Angela Dela Cruz', 'Metrobank', '****-0321', 'monthly', 'active', 1, DATE_SUB(NOW(), INTERVAL 1 DAY)
FROM billing_records b
WHERE b.billing_code = 'BILL-1003'
  AND NOT EXISTS (
    SELECT 1 FROM auto_debit_arrangements a WHERE a.billing_id = b.id
  );
