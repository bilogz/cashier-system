-- Admin accounts seed (role + department)
-- Run manually:
-- psql "$DATABASE_URL" -f sql_dump/admin_accounts_seed.sql
-- (or use database/seeds/admin_accounts_seed.sql)

CREATE TABLE IF NOT EXISTS admin_profiles (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(190) NOT NULL UNIQUE,
  full_name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  role VARCHAR(80) NOT NULL DEFAULT 'admin',
  department VARCHAR(120) NOT NULL DEFAULT 'Administration',
  access_exemptions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash TEXT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  phone VARCHAR(80) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMP NOT NULL DEFAULT NOW(),
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  dark_mode BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_admin_profiles_role ON admin_profiles(role);

-- Password for all seeded users: Admin#123
INSERT INTO admin_profiles (username, full_name, email, role, department, access_exemptions, is_super_admin, password_hash, status, phone)
VALUES
  ('joecelgarcia1@gmail.com', 'Nexora Super Admin', 'joecelgarcia1@gmail.com', 'Admin', 'Administration', ARRAY['appointments','patients','registration','walkin','checkup','laboratory','pharmacy','mental_health','reports'], TRUE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 345 6789'),
  ('appointments.admin@nexora.local', 'Appointments Admin', 'appointments.admin@nexora.local', 'Appointments Staff', 'Appointment', ARRAY['patients','reports'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1001'),
  ('patients.admin@nexora.local', 'Patients Database Admin', 'patients.admin@nexora.local', 'Patient Records Staff', 'Patients Database', ARRAY['registration','appointments'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1002'),
  ('registration.admin@nexora.local', 'Registration Admin', 'registration.admin@nexora.local', 'Registration Staff', 'Registration', ARRAY['patients','appointments'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1003'),
  ('walkin.admin@nexora.local', 'Walk-In Admin', 'walkin.admin@nexora.local', 'Walk-In Staff', 'Walk-In', ARRAY['checkup','patients'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1004'),
  ('checkup.admin@nexora.local', 'Check-Up Admin', 'checkup.admin@nexora.local', 'Check-Up Staff', 'Check-Up', ARRAY['laboratory','pharmacy','patients'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1005'),
  ('lab.admin@nexora.local', 'Laboratory Admin', 'lab.admin@nexora.local', 'Lab Technician', 'Laboratory', ARRAY['checkup','reports'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1006'),
  ('pharmacy.admin@nexora.local', 'Pharmacy Admin', 'pharmacy.admin@nexora.local', 'Pharmacist', 'Pharmacy & Inventory', ARRAY['checkup','reports'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1007'),
  ('mental.admin@nexora.local', 'Mental Health Admin', 'mental.admin@nexora.local', 'Counselor', 'Mental Health & Addiction', ARRAY['reports','patients'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1008'),
  ('reports.admin@nexora.local', 'Reports Admin', 'reports.admin@nexora.local', 'Reports Analyst', 'Reports', ARRAY['appointments','patients','registration','walkin','checkup','laboratory','pharmacy','mental_health'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1009'),
  ('finance.admin@nexora.local', 'Finance Admin', 'finance.admin@nexora.local', 'Manager', 'Finance', ARRAY['reports'], FALSE, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1010')
ON CONFLICT (username) DO UPDATE
SET
  full_name = EXCLUDED.full_name,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  department = EXCLUDED.department,
  access_exemptions = EXCLUDED.access_exemptions,
  is_super_admin = EXCLUDED.is_super_admin,
  password_hash = EXCLUDED.password_hash,
  status = EXCLUDED.status,
  phone = EXCLUDED.phone;
