USE cashier_system;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS access_exemptions_json JSON NOT NULL AFTER department,
  ADD COLUMN IF NOT EXISTS is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER access_exemptions_json,
  MODIFY COLUMN password_hash VARCHAR(255) NOT NULL,
  MODIFY COLUMN role VARCHAR(120) NOT NULL DEFAULT 'Cashier Admin',
  MODIFY COLUMN department VARCHAR(120) DEFAULT 'Cashier',
  MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE admin_users
SET
  access_exemptions_json = JSON_ARRAY(
    'billing_verification',
    'manage_billing',
    'process_payment',
    'generate_receipt',
    'financial_transactions',
    'reports'
  )
WHERE access_exemptions_json IS NULL
   OR JSON_VALID(access_exemptions_json) = 0
   OR JSON_LENGTH(access_exemptions_json) = 0;

UPDATE admin_users
SET
  username = 'admin@cashier.local',
  email = 'admin@cashier.local',
  full_name = 'Cashier System Administrator',
  role = 'Admin',
  department = 'Cashier',
  access_exemptions_json = JSON_ARRAY(
    'billing_verification',
    'manage_billing',
    'process_payment',
    'generate_receipt',
    'financial_transactions',
    'reports'
  ),
  is_super_admin = 1,
  password_hash = 'c61318148f8856c45d72d46c417a8118:73708f75315374d5f919dadc63e51a5c9c5b480dbfdc7756a5eb72f17f2f76d5fe2eed59fb7258f29523667002db0c11217ef870fc8fbe2bdcf2ac1e86594987',
  status = 'active'
WHERE id = 1;

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
  created_at,
  last_login_at
)
SELECT
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
    'reports'
  ),
  1,
  'c61318148f8856c45d72d46c417a8118:73708f75315374d5f919dadc63e51a5c9c5b480dbfdc7756a5eb72f17f2f76d5fe2eed59fb7258f29523667002db0c11217ef870fc8fbe2bdcf2ac1e86594987',
  'active',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM admin_users
  WHERE username = 'admin@cashier.local'
);

CREATE TABLE IF NOT EXISTS admin_profile_preferences (
  user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  email_notifications TINYINT(1) NOT NULL DEFAULT 1,
  in_app_notifications TINYINT(1) NOT NULL DEFAULT 1,
  dark_mode TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_profile_preferences_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(100) NOT NULL,
  raw_action VARCHAR(100) NOT NULL,
  description TEXT NOT NULL,
  ip_address VARCHAR(80) NOT NULL DEFAULT '127.0.0.1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_admin_activity_logs_user
    FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode)
SELECT id, 1, 1, 0
FROM admin_users
WHERE username = 'admin@cashier.local'
ON DUPLICATE KEY UPDATE user_id = user_id;

INSERT INTO admin_activity_logs (user_id, action, raw_action, description, ip_address)
SELECT id, 'Seeded Account', 'SEEDED_ACCOUNT', 'Default Cashier System administrator account created or repaired.', '127.0.0.1'
FROM admin_users
WHERE username = 'admin@cashier.local'
  AND NOT EXISTS (
    SELECT 1
    FROM admin_activity_logs
    WHERE raw_action = 'SEEDED_ACCOUNT'
      AND user_id = admin_users.id
  );
