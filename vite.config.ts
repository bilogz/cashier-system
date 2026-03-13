import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { neon } from '@neondatabase/serverless';
import vuetify from 'vite-plugin-vuetify';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

function normalizePathPrefix(value: string): string {
  if (!value) {
    return '';
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

type JsonRecord = Record<string, unknown>;
const patientAuthRateLimit = new Map<string, { count: number; resetAt: number }>();
const adminAuthRateLimit = new Map<string, { count: number; resetAt: number }>();

function writeJson(res: any, statusCode: number, payload: JsonRecord): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: any): Promise<JsonRecord> {
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer | string) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(typeof parsed === 'object' && parsed !== null ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function normalizeDoctorFilter(value: string): string {
  return value.replace(/^doctor:\s*/i, '').trim();
}

function hashPatientPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPatientPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== computed.length) return false;
  return timingSafeEqual(stored, computed);
}

function parseCookieHeader(rawCookie: string | undefined): Record<string, string> {
  if (!rawCookie) return {};
  return rawCookie.split(';').reduce<Record<string, string>>((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function stablePatientIdentity(name: string, email: string, phone: string): string {
  return createHash('sha256').update(`${name.toLowerCase()}|${email.toLowerCase()}|${phone}`).digest('hex');
}

function computeAgeFromDateOfBirth(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

async function ensurePatientWalkinsTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_walkins (
      id BIGSERIAL PRIMARY KEY,
      case_id VARCHAR(40) NOT NULL UNIQUE,
      patient_name VARCHAR(150) NOT NULL,
      age SMALLINT NULL,
      sex VARCHAR(12) NULL,
      date_of_birth DATE NULL,
      contact VARCHAR(80) NULL,
      address TEXT NULL,
      emergency_contact VARCHAR(120) NULL,
      patient_ref VARCHAR(60) NULL,
      visit_department VARCHAR(80) NULL,
      checkin_time TIMESTAMP NULL,
      pain_scale SMALLINT NULL,
      temperature_c NUMERIC(4, 1) NULL,
      blood_pressure VARCHAR(20) NULL,
      pulse_bpm SMALLINT NULL,
      weight_kg NUMERIC(5, 2) NULL,
      chief_complaint TEXT NULL,
      severity VARCHAR(20) NOT NULL DEFAULT 'Low',
      intake_time TIMESTAMP NOT NULL DEFAULT NOW(),
      assigned_doctor VARCHAR(120) NOT NULL DEFAULT 'Nurse Triage',
      status VARCHAR(30) NOT NULL DEFAULT 'waiting',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS sex VARCHAR(12) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS address TEXT NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS patient_ref VARCHAR(60) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS visit_department VARCHAR(80) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS checkin_time TIMESTAMP NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS pain_scale SMALLINT NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(4, 1) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS blood_pressure VARCHAR(20) NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS pulse_bpm SMALLINT NULL`);
  await sql.query(`ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5, 2) NULL`);
}

async function ensurePatientAppointmentsTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_appointments (
      id BIGSERIAL PRIMARY KEY,
      booking_id VARCHAR(40) NOT NULL UNIQUE,
      patient_id VARCHAR(60) NULL,
      patient_name VARCHAR(150) NOT NULL,
      patient_age SMALLINT NULL,
      patient_email VARCHAR(190) NULL,
      patient_gender VARCHAR(30) NULL,
      guardian_name VARCHAR(150) NULL,
      phone_number VARCHAR(60) NOT NULL,
      emergency_contact VARCHAR(120) NULL,
      insurance_provider VARCHAR(120) NULL,
      payment_method VARCHAR(40) NULL,
      appointment_priority VARCHAR(20) NOT NULL DEFAULT 'Routine',
      symptoms_summary TEXT NULL,
      doctor_notes TEXT NULL,
      doctor_name VARCHAR(120) NOT NULL,
      department_name VARCHAR(120) NOT NULL,
      visit_type VARCHAR(120) NOT NULL,
      appointment_date DATE NOT NULL,
      preferred_time VARCHAR(30) NULL,
      visit_reason TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS patient_id VARCHAR(60) NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(150) NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120) NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR(120) NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS appointment_priority VARCHAR(20) NOT NULL DEFAULT 'Routine'`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS symptoms_summary TEXT NULL`);
  await sql.query(`ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS doctor_notes TEXT NULL`);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_appointments_date ON patient_appointments(appointment_date ASC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_appointments_status ON patient_appointments(status)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_appointments_department ON patient_appointments(department_name)`);
}

async function ensurePharmacyInventoryTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_medicines (
      id BIGSERIAL PRIMARY KEY,
      medicine_code VARCHAR(40) NOT NULL UNIQUE,
      sku VARCHAR(60) NOT NULL UNIQUE,
      medicine_name VARCHAR(150) NOT NULL,
      brand_name VARCHAR(150) NOT NULL DEFAULT '',
      generic_name VARCHAR(150) NOT NULL DEFAULT '',
      category VARCHAR(50) NOT NULL DEFAULT 'Tablet',
      medicine_type VARCHAR(80) NOT NULL DEFAULT 'General',
      dosage_strength VARCHAR(60) NOT NULL DEFAULT '',
      unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'unit',
      supplier_name VARCHAR(120) NOT NULL DEFAULT '',
      purchase_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
      selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
      batch_lot_no VARCHAR(80) NOT NULL DEFAULT '',
      manufacturing_date DATE NULL,
      expiry_date DATE NOT NULL,
      storage_requirements TEXT NULL,
      reorder_level INT NOT NULL DEFAULT 20,
      low_stock_threshold INT NOT NULL DEFAULT 20,
      stock_capacity INT NOT NULL DEFAULT 100,
      stock_on_hand INT NOT NULL DEFAULT 0,
      stock_location VARCHAR(120) NULL,
      barcode VARCHAR(120) NULL,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_dispense_requests (
      id BIGSERIAL PRIMARY KEY,
      request_code VARCHAR(40) NOT NULL UNIQUE,
      medicine_id BIGINT NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE RESTRICT,
      patient_name VARCHAR(150) NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      notes TEXT NULL,
      prescription_reference VARCHAR(80) NOT NULL,
      dispense_reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Fulfilled', 'Cancelled')),
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      fulfilled_at TIMESTAMP NULL,
      fulfilled_by VARCHAR(120) NULL
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_stock_movements (
      id BIGSERIAL PRIMARY KEY,
      medicine_id BIGINT NOT NULL REFERENCES pharmacy_medicines(id) ON DELETE CASCADE,
      movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('add', 'restock', 'dispense', 'adjust', 'archive', 'alert')),
      quantity_change INT NOT NULL DEFAULT 0,
      quantity_before INT NOT NULL DEFAULT 0,
      quantity_after INT NOT NULL DEFAULT 0,
      reason TEXT NULL,
      batch_lot_no VARCHAR(80) NULL,
      stock_location VARCHAR(120) NULL,
      actor VARCHAR(120) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS pharmacy_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      module VARCHAR(40) NOT NULL DEFAULT 'pharmacy_inventory',
      action VARCHAR(80) NOT NULL,
      detail TEXT NOT NULL,
      actor VARCHAR(120) NOT NULL,
      tone VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (tone IN ('success', 'warning', 'info', 'error')),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS medicine_code VARCHAR(40)`);
  await sql.query(`ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS barcode VARCHAR(120)`);
  await sql.query(`ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS stock_location VARCHAR(120)`);
  await sql.query(`ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS storage_requirements TEXT`);
  await sql.query(`ALTER TABLE pharmacy_medicines ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE`);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_name ON pharmacy_medicines(medicine_name)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_stock ON pharmacy_medicines(stock_on_hand)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_expiry ON pharmacy_medicines(expiry_date)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_pharmacy_dispense_status ON pharmacy_dispense_requests(status)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_pharmacy_movements_med ON pharmacy_stock_movements(medicine_id, created_at DESC)`);
}

async function ensureMentalHealthTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS mental_health_patients (
      id BIGSERIAL PRIMARY KEY,
      patient_id VARCHAR(40) NOT NULL UNIQUE,
      patient_name VARCHAR(150) NOT NULL,
      date_of_birth DATE NULL,
      sex VARCHAR(20) NULL,
      contact_number VARCHAR(60) NULL,
      guardian_contact VARCHAR(150) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS mental_health_sessions (
      id BIGSERIAL PRIMARY KEY,
      case_reference VARCHAR(40) NOT NULL UNIQUE,
      patient_id VARCHAR(40) NOT NULL REFERENCES mental_health_patients(patient_id) ON DELETE RESTRICT,
      patient_name VARCHAR(150) NOT NULL,
      counselor VARCHAR(120) NOT NULL,
      session_type VARCHAR(60) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'create',
      risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
      diagnosis_condition TEXT NULL,
      treatment_plan TEXT NULL,
      session_goals TEXT NULL,
      session_duration_minutes INT NOT NULL DEFAULT 45,
      session_mode VARCHAR(20) NOT NULL DEFAULT 'in_person',
      location_room VARCHAR(120) NULL,
      guardian_contact VARCHAR(150) NULL,
      emergency_contact VARCHAR(150) NULL,
      medication_reference VARCHAR(150) NULL,
      follow_up_frequency VARCHAR(60) NULL,
      escalation_reason TEXT NULL,
      outcome_result TEXT NULL,
      assessment_score NUMERIC(6,2) NULL,
      assessment_tool VARCHAR(80) NULL,
      appointment_at TIMESTAMP NOT NULL DEFAULT NOW(),
      next_follow_up_at TIMESTAMP NULL,
      created_by_role VARCHAR(40) NOT NULL DEFAULT 'Admin',
      is_draft BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      archived_at TIMESTAMP NULL
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS mental_health_notes (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NOT NULL REFERENCES mental_health_sessions(id) ON DELETE CASCADE,
      note_type VARCHAR(40) NOT NULL DEFAULT 'Progress',
      note_content TEXT NOT NULL,
      clinical_score NUMERIC(6,2) NULL,
      attachment_name VARCHAR(190) NULL,
      attachment_url TEXT NULL,
      created_by_role VARCHAR(40) NOT NULL DEFAULT 'Counselor',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS mental_health_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      session_id BIGINT NULL REFERENCES mental_health_sessions(id) ON DELETE CASCADE,
      action VARCHAR(80) NOT NULL,
      detail TEXT NOT NULL,
      actor_role VARCHAR(40) NOT NULL DEFAULT 'System',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_mh_sessions_status ON mental_health_sessions(status)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_mh_sessions_patient ON mental_health_sessions(patient_id)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_mh_sessions_risk ON mental_health_sessions(risk_level)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_mh_notes_session ON mental_health_notes(session_id, created_at DESC)`);
}

async function ensureLaboratoryTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS laboratory_requests (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL UNIQUE,
      visit_id VARCHAR(60) NOT NULL,
      patient_id VARCHAR(60) NOT NULL,
      patient_name VARCHAR(150) NOT NULL,
      age SMALLINT NULL,
      sex VARCHAR(20) NULL,
      category VARCHAR(80) NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'Normal',
      status VARCHAR(20) NOT NULL DEFAULT 'Pending',
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      requested_by_doctor VARCHAR(120) NOT NULL,
      doctor_department VARCHAR(120) NOT NULL DEFAULT 'General Medicine',
      notes TEXT NULL,
      tests TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      specimen_type VARCHAR(80) NOT NULL DEFAULT 'Whole Blood',
      sample_source VARCHAR(80) NOT NULL DEFAULT 'Blood',
      collection_date_time TIMESTAMP NULL,
      clinical_diagnosis TEXT NOT NULL DEFAULT '',
      lab_instructions TEXT NOT NULL DEFAULT '',
      insurance_reference VARCHAR(120) NOT NULL DEFAULT '',
      billing_reference VARCHAR(120) NOT NULL DEFAULT '',
      assigned_lab_staff VARCHAR(120) NOT NULL DEFAULT 'Tech Anne',
      sample_collected BOOLEAN NOT NULL DEFAULT FALSE,
      sample_collected_at TIMESTAMP NULL,
      processing_started_at TIMESTAMP NULL,
      result_encoded_at TIMESTAMP NULL,
      result_reference_range TEXT NOT NULL DEFAULT '',
      verified_by VARCHAR(120) NOT NULL DEFAULT '',
      verified_at TIMESTAMP NULL,
      rejection_reason TEXT NOT NULL DEFAULT '',
      resample_flag BOOLEAN NOT NULL DEFAULT FALSE,
      released_at TIMESTAMP NULL,
      raw_attachment_name VARCHAR(240) NOT NULL DEFAULT '',
      encoded_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS laboratory_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      request_id BIGINT NOT NULL REFERENCES laboratory_requests(request_id) ON DELETE CASCADE,
      action VARCHAR(80) NOT NULL,
      details TEXT NOT NULL,
      actor VARCHAR(120) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON laboratory_requests(status)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_requested_at ON laboratory_requests(requested_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_patient ON laboratory_requests(patient_name)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_lab_requests_doctor ON laboratory_requests(requested_by_doctor)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_lab_logs_request ON laboratory_activity_logs(request_id, created_at DESC)`);
}

async function ensureDoctorAvailabilityTables(sql: ReturnType<typeof neon>): Promise<void> {
  await ensureDoctorsTable(sql);
  await sql.query(`
    CREATE TABLE IF NOT EXISTS doctor_availability (
      id BIGSERIAL PRIMARY KEY,
      doctor_name VARCHAR(120) NOT NULL,
      department_name VARCHAR(120) NOT NULL,
      day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      max_appointments INT NOT NULL DEFAULT 8 CHECK (max_appointments > 0),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (doctor_name, department_name, day_of_week, start_time, end_time)
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_doctor_availability_lookup ON doctor_availability(doctor_name, department_name, day_of_week, is_active)`);

  await sql.query(
    `INSERT INTO doctor_availability (doctor_name, department_name, day_of_week, start_time, end_time, max_appointments, is_active)
     VALUES
       ('Dr. Humour', 'General Medicine', 1, '08:00', '12:00', 8, TRUE),
       ('Dr. Humour', 'General Medicine', 3, '08:00', '12:00', 8, TRUE),
       ('Dr. Jenni', 'General Medicine', 2, '13:00', '17:00', 8, TRUE),
       ('Dr. Jenni', 'General Medicine', 4, '13:00', '17:00', 8, TRUE),
       ('Dr. Rivera', 'Pediatrics', 1, '09:00', '13:00', 10, TRUE),
       ('Dr. Rivera', 'Pediatrics', 3, '09:00', '13:00', 10, TRUE),
       ('Dr. Morco', 'Orthopedic', 2, '09:00', '12:00', 6, TRUE),
       ('Dr. Martinez', 'Orthopedic', 4, '09:00', '12:00', 6, TRUE),
       ('Dr. Santos', 'Dental', 1, '10:00', '15:00', 10, TRUE),
       ('Dr. Lim', 'Dental', 3, '10:00', '15:00', 10, TRUE),
       ('Dr. A. Rivera', 'Laboratory', 2, '08:00', '11:00', 5, TRUE),
       ('Dr. S. Villaraza', 'Mental Health', 5, '13:00', '18:00', 8, TRUE),
       ('Dr. B. Martinez', 'Check-Up', 2, '08:00', '12:00', 8, TRUE),
       ('Dr. B. Martinez', 'Check-Up', 5, '08:00', '12:00', 8, TRUE)
     ON CONFLICT (doctor_name, department_name, day_of_week, start_time, end_time) DO NOTHING`
  );
}

async function ensureDoctorsTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id BIGSERIAL PRIMARY KEY,
      doctor_name VARCHAR(120) NOT NULL UNIQUE,
      department_name VARCHAR(120) NOT NULL,
      specialization VARCHAR(160) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_doctors_department ON doctors(department_name, is_active)`);

  await sql.query(`
    INSERT INTO doctors (doctor_name, department_name, specialization, is_active)
    VALUES
      ('Dr. Humour', 'General Medicine', 'Internal Medicine', TRUE),
      ('Dr. Jenni', 'General Medicine', 'General Medicine', TRUE),
      ('Dr. Rivera', 'Pediatrics', 'Pediatrics', TRUE),
      ('Dr. Morco', 'Orthopedic', 'Orthopedics', TRUE),
      ('Dr. Martinez', 'Orthopedic', 'Orthopedics', TRUE),
      ('Dr. Santos', 'Dental', 'Dentistry', TRUE),
      ('Dr. Lim', 'Dental', 'Dentistry', TRUE),
      ('Dr. A. Rivera', 'Laboratory', 'Pathology', TRUE),
      ('Dr. S. Villaraza', 'Mental Health', 'Psychiatry', TRUE),
      ('Dr. B. Martinez', 'Check-Up', 'General Practice', TRUE)
    ON CONFLICT (doctor_name) DO NOTHING
  `);
}

async function ensureModuleActivityLogsTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS module_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      module VARCHAR(60) NOT NULL,
      action VARCHAR(120) NOT NULL,
      detail TEXT NOT NULL,
      actor VARCHAR(120) NOT NULL DEFAULT 'System',
      entity_type VARCHAR(60) NULL,
      entity_key VARCHAR(120) NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_module_activity_recent ON module_activity_logs(created_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_module_activity_module ON module_activity_logs(module, created_at DESC)`);
}

async function ensureAdminProfileTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
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
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(190) NOT NULL,
      action VARCHAR(100) NOT NULL,
      raw_action VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      ip_address VARCHAR(80) NOT NULL DEFAULT '127.0.0.1',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE`);
  await sql.query(`ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS password_hash TEXT NULL`);
  await sql.query(`ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS department VARCHAR(120) NOT NULL DEFAULT 'Administration'`);
  await sql.query(`ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS access_exemptions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_admin_profiles_role ON admin_profiles(role)`);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id BIGSERIAL PRIMARY KEY,
      session_token_hash VARCHAR(128) NOT NULL UNIQUE,
      admin_profile_id BIGINT NOT NULL REFERENCES admin_profiles(id) ON DELETE CASCADE,
      ip_address VARCHAR(80) NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_admin_sessions_profile ON admin_sessions(admin_profile_id, expires_at DESC)`);

  // Account seeding is managed via SQL seed files, not hardcoded in runtime.
}

async function ensurePatientMasterTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_master (
      id BIGSERIAL PRIMARY KEY,
      patient_code VARCHAR(60) NOT NULL,
      patient_name VARCHAR(150) NOT NULL,
      identity_key VARCHAR(260) NOT NULL UNIQUE,
      email VARCHAR(190) NULL,
      contact VARCHAR(80) NULL,
      sex VARCHAR(30) NULL,
      date_of_birth DATE NULL,
      age SMALLINT NULL,
      emergency_contact VARCHAR(150) NULL,
      guardian_contact VARCHAR(150) NULL,
      latest_status VARCHAR(80) NOT NULL DEFAULT 'active',
      risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
      appointment_count INT NOT NULL DEFAULT 0,
      walkin_count INT NOT NULL DEFAULT 0,
      checkup_count INT NOT NULL DEFAULT 0,
      mental_count INT NOT NULL DEFAULT 0,
      pharmacy_count INT NOT NULL DEFAULT 0,
      source_tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      last_seen_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE patient_master DROP CONSTRAINT IF EXISTS patient_master_patient_code_key`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_master_name ON patient_master(patient_name)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_master_last_seen ON patient_master(last_seen_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_master_risk ON patient_master(risk_level)`);
}

async function ensurePatientAuthTables(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_accounts (
      id BIGSERIAL PRIMARY KEY,
      patient_code VARCHAR(60) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(190) NOT NULL UNIQUE,
      phone_number VARCHAR(60) NOT NULL,
      password_hash TEXT NOT NULL,
      sex VARCHAR(30) NULL,
      date_of_birth DATE NULL,
      guardian_name VARCHAR(150) NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      last_login_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_sessions (
      id BIGSERIAL PRIMARY KEY,
      session_token_hash VARCHAR(128) NOT NULL UNIQUE,
      patient_account_id BIGINT NOT NULL REFERENCES patient_accounts(id) ON DELETE CASCADE,
      ip_address VARCHAR(80) NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_auth_logs (
      id BIGSERIAL PRIMARY KEY,
      patient_account_id BIGINT NULL REFERENCES patient_accounts(id) ON DELETE SET NULL,
      action VARCHAR(40) NOT NULL,
      ip_address VARCHAR(80) NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`
    CREATE TABLE IF NOT EXISTS patient_auth_tokens (
      id BIGSERIAL PRIMARY KEY,
      patient_account_id BIGINT NOT NULL REFERENCES patient_accounts(id) ON DELETE CASCADE,
      token_type VARCHAR(30) NOT NULL CHECK (token_type IN ('verify_email', 'reset_password')),
      token_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE patient_accounts ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(150) NULL`);

  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_accounts_email ON patient_accounts(email)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_sessions_patient ON patient_sessions(patient_account_id, expires_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_patient_tokens_lookup ON patient_auth_tokens(patient_account_id, token_type, expires_at DESC)`);
}

function neonAppointmentsApiPlugin(databaseUrl?: string): Plugin {
  return {
    name: 'neon-appointments-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '', 'http://localhost');
        if (
          url.pathname !== '/api/appointments' &&
          url.pathname !== '/api/admin-auth' &&
          url.pathname !== '/api/admin-profile' &&
          url.pathname !== '/api/registrations' &&
          url.pathname !== '/api/walk-ins' &&
          url.pathname !== '/api/checkups' &&
          url.pathname !== '/api/laboratory' &&
          url.pathname !== '/api/pharmacy' &&
          url.pathname !== '/api/mental-health' &&
          url.pathname !== '/api/doctors' &&
          url.pathname !== '/api/doctor-availability' &&
          url.pathname !== '/api/module-activity' &&
          url.pathname !== '/api/patients' &&
          url.pathname !== '/api/reports' &&
          url.pathname !== '/api/dashboard' &&
          url.pathname !== '/api/patient-auth' &&
          url.pathname !== '/api/patient-portal'
        ) {
          next();
          return;
        }

        if (!databaseUrl) {
          writeJson(res, 500, { ok: false, message: 'DATABASE_URL is missing in admin_template/.env' });
          return;
        }

        const sql = neon(databaseUrl);
        const pharmacyAllowedActions: Record<string, string[]> = {
          Admin: ['create_medicine', 'update_medicine', 'archive_medicine', 'restock', 'dispense', 'adjust_stock', 'fulfill_request', 'save_draft'],
          Pharmacist: ['create_medicine', 'update_medicine', 'restock', 'dispense', 'adjust_stock', 'fulfill_request', 'save_draft'],
          'Pharmacy Staff': ['restock', 'dispense', 'fulfill_request', 'save_draft'],
          Nurse: ['dispense', 'fulfill_request', 'save_draft'],
          Doctor: ['save_draft']
        };
        const mentalHealthAllowedActions: Record<string, string[]> = {
          Admin: ['save_draft', 'create_session', 'update_session', 'record_note', 'schedule_followup', 'set_at_risk', 'complete_session', 'escalate_session', 'archive_session'],
          Counselor: ['save_draft', 'create_session', 'update_session', 'record_note', 'schedule_followup', 'set_at_risk', 'complete_session'],
          Nurse: ['save_draft', 'record_note', 'schedule_followup', 'set_at_risk'],
          Doctor: ['save_draft', 'record_note', 'set_at_risk', 'escalate_session'],
          Receptionist: ['save_draft', 'create_session', 'schedule_followup']
        };

        const toSafeText = (value: unknown): string => String(value ?? '').trim();
        const toSafeInt = (value: unknown, fallback = 0): number => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
        };
        const toSafeMoney = (value: unknown, fallback = 0): number => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed)) return fallback;
          return Math.max(0, Math.round(parsed * 100) / 100);
        };
        const toSafeIsoDate = (value: unknown): string | null => {
          const text = toSafeText(value);
          if (!text) return null;
          const parsed = new Date(text);
          if (Number.isNaN(parsed.getTime())) return null;
          return parsed.toISOString().slice(0, 10);
        };

        const toActionLabel = (value: string): string => {
          const raw = toSafeText(value);
          if (!raw) return 'Action';
          return raw
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, (ch) => ch.toUpperCase());
        };

        async function insertModuleActivity(
          moduleName: string,
          action: string,
          detail: string,
          actor: string,
          entityType: string | null = null,
          entityKey: string | null = null,
          metadata: Record<string, unknown> = {}
        ): Promise<void> {
          await ensureModuleActivityLogsTable(sql);
          await sql.query(
            `INSERT INTO module_activity_logs (module, action, detail, actor, entity_type, entity_key, metadata)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
            [
              toSafeText(moduleName) || 'general',
              toSafeText(action) || 'Action',
              toSafeText(detail) || 'No detail',
              toSafeText(actor) || 'System',
              entityType ? toSafeText(entityType) : null,
              entityKey ? toSafeText(entityKey) : null,
              JSON.stringify(metadata || {})
            ]
          );
        }

        async function getDoctorAvailabilitySnapshot(
          doctorName: string,
          departmentName: string,
          appointmentDate: string,
          preferredTime: string,
          excludeBookingId: string | null = null
        ): Promise<{
          isDoctorAvailable: boolean;
          reason: string;
          scheduleRows: Array<{ id: number; start_time: string; end_time: string; max_appointments: number }>;
          slots: Array<{ id: number; startTime: string; endTime: string; maxAppointments: number; bookedAppointments: number; remainingAppointments: number; isOpen: boolean }>;
          recommendedTimes: string[];
        }> {
          await ensureDoctorAvailabilityTables(sql);
          await ensurePatientAppointmentsTable(sql);

          const targetDate = toSafeIsoDate(appointmentDate);
          if (!targetDate) {
            return {
              isDoctorAvailable: false,
              reason: 'Invalid appointment date.',
              scheduleRows: [],
              slots: [],
              recommendedTimes: []
            };
          }

          const normalizedDoctor = toSafeText(doctorName);
          const normalizedDepartment = toSafeText(departmentName);
          if (!normalizedDoctor || !normalizedDepartment) {
            return {
              isDoctorAvailable: false,
              reason: 'Doctor and department are required.',
              scheduleRows: [],
              slots: [],
              recommendedTimes: []
            };
          }

          const dayRows = (await sql.query(
            `SELECT id, start_time::text AS start_time, end_time::text AS end_time, max_appointments
             FROM doctor_availability
             WHERE LOWER(doctor_name) = LOWER($1)
               AND LOWER(department_name) = LOWER($2)
               AND day_of_week = EXTRACT(DOW FROM $3::date)
               AND is_active = TRUE
             ORDER BY start_time ASC`,
            [normalizedDoctor, normalizedDepartment, targetDate]
          )) as Array<{ id: number; start_time: string; end_time: string; max_appointments: number }>;

          if (!dayRows.length) {
            return {
              isDoctorAvailable: false,
              reason: `${normalizedDoctor} has no active schedule for ${targetDate}.`,
              scheduleRows: [],
              slots: [],
              recommendedTimes: []
            };
          }

          const slotRows: Array<{ id: number; start_time: string; end_time: string; max_appointments: number; booked_count: number }> = [];
          for (const row of dayRows) {
            const counts = (await sql.query(
              `SELECT COUNT(*)::int AS total
               FROM patient_appointments
               WHERE LOWER(doctor_name) = LOWER($1)
                 AND appointment_date = $2::date
                 AND COALESCE(preferred_time, '') >= $3
                 AND COALESCE(preferred_time, '') < $4
                 AND LOWER(COALESCE(status, '')) <> 'canceled'
                 AND ($5::text IS NULL OR booking_id <> $5::text)`,
              [normalizedDoctor, targetDate, row.start_time.slice(0, 5), row.end_time.slice(0, 5), excludeBookingId || null]
            )) as Array<{ total: number }>;
            slotRows.push({
              id: Number(row.id),
              start_time: String(row.start_time || '').slice(0, 5),
              end_time: String(row.end_time || '').slice(0, 5),
              max_appointments: Number(row.max_appointments || 0),
              booked_count: Number(counts[0]?.total || 0)
            });
          }

          const slots = slotRows.map((slot) => {
            const remaining = Math.max(0, Number(slot.max_appointments || 0) - Number(slot.booked_count || 0));
            return {
              id: slot.id,
              startTime: slot.start_time,
              endTime: slot.end_time,
              maxAppointments: Number(slot.max_appointments || 0),
              bookedAppointments: Number(slot.booked_count || 0),
              remainingAppointments: remaining,
              isOpen: remaining > 0
            };
          });

          const recommendedTimes: string[] = [];
          for (const slot of slots) {
            if (!slot.isOpen) continue;
            const [hh, mm] = slot.startTime.split(':').map((x) => Number(x || 0));
            let pointer = hh * 60 + mm;
            const [endH, endM] = slot.endTime.split(':').map((x) => Number(x || 0));
            const endPointer = endH * 60 + endM;
            while (pointer < endPointer && recommendedTimes.length < 24) {
              const h = Math.floor(pointer / 60);
              const m = pointer % 60;
              recommendedTimes.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
              pointer += 30;
            }
          }

          const normalizedPreferred = toSafeText(preferredTime).slice(0, 5);
          if (normalizedPreferred) {
            const matched = slots.find((slot) => normalizedPreferred >= slot.startTime && normalizedPreferred < slot.endTime);
            if (!matched) {
              return {
                isDoctorAvailable: false,
                reason: `Preferred time ${normalizedPreferred} is outside the doctor's schedule.`,
                scheduleRows: dayRows,
                slots,
                recommendedTimes
              };
            }
            if (!matched.isOpen) {
              return {
                isDoctorAvailable: false,
                reason: `Doctor schedule is full for the ${matched.startTime}-${matched.endTime} slot.`,
                scheduleRows: dayRows,
                slots,
                recommendedTimes
              };
            }
          } else if (!slots.some((slot) => slot.isOpen)) {
            return {
              isDoctorAvailable: false,
              reason: `No remaining doctor slots for ${targetDate}.`,
              scheduleRows: dayRows,
              slots,
              recommendedTimes
            };
          }

          return {
            isDoctorAvailable: true,
            reason: 'Doctor is available.',
            scheduleRows: dayRows,
            slots,
            recommendedTimes
          };
        }

        async function insertPharmacyLog(action: string, detail: string, actor: string, tone: 'success' | 'warning' | 'info' | 'error' = 'info'): Promise<void> {
          await sql.query(
            `INSERT INTO pharmacy_activity_logs (action, detail, actor, tone)
             VALUES ($1, $2, $3, $4)`,
            [action, detail, actor, tone]
          );
          await insertModuleActivity('pharmacy', action, detail, actor, 'pharmacy', null, { tone });
        }

        async function insertPharmacyMovement(
          medicineId: number,
          movementType: 'add' | 'restock' | 'dispense' | 'adjust' | 'archive' | 'alert',
          quantityChange: number,
          quantityBefore: number,
          quantityAfter: number,
          reason: string | null,
          batchLotNo: string | null,
          stockLocation: string | null,
          actor: string
        ): Promise<void> {
          await sql.query(
            `INSERT INTO pharmacy_stock_movements (
                medicine_id, movement_type, quantity_change, quantity_before, quantity_after, reason, batch_lot_no, stock_location, actor
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [medicineId, movementType, quantityChange, quantityBefore, quantityAfter, reason, batchLotNo, stockLocation, actor]
          );
        }

        async function evaluatePharmacyAlerts(medicineId: number): Promise<void> {
          const rows = (await sql.query(
            `SELECT medicine_name, batch_lot_no, stock_on_hand, reorder_level, expiry_date, stock_location
             FROM pharmacy_medicines
             WHERE id = $1`,
            [medicineId]
          )) as Array<{
            medicine_name: string;
            batch_lot_no: string | null;
            stock_on_hand: number;
            reorder_level: number;
            expiry_date: string;
            stock_location: string | null;
          }>;
          const medicine = rows[0];
          if (!medicine) return;

          if (Number(medicine.stock_on_hand || 0) <= 0) {
            await insertPharmacyLog('ALERT', `${medicine.medicine_name} out-of-stock alert triggered`, 'System', 'warning');
            await insertPharmacyMovement(
              medicineId,
              'alert',
              0,
              Number(medicine.stock_on_hand || 0),
              Number(medicine.stock_on_hand || 0),
              'Out-of-stock threshold reached',
              medicine.batch_lot_no || null,
              medicine.stock_location || null,
              'System'
            );
            return;
          }

          if (Number(medicine.stock_on_hand || 0) <= Number(medicine.reorder_level || 0)) {
            await insertPharmacyLog('ALERT', `${medicine.medicine_name} low-stock alert triggered`, 'System', 'warning');
            await insertPharmacyMovement(
              medicineId,
              'alert',
              0,
              Number(medicine.stock_on_hand || 0),
              Number(medicine.stock_on_hand || 0),
              `Low stock reached (${medicine.stock_on_hand}/${medicine.reorder_level})`,
              medicine.batch_lot_no || null,
              medicine.stock_location || null,
              'System'
            );
          }

          const expiry = new Date(medicine.expiry_date);
          const now = new Date();
          const daysToExpiry = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (!Number.isNaN(daysToExpiry) && daysToExpiry <= 30) {
            await insertPharmacyLog('ALERT', `${medicine.medicine_name} expiry warning raised`, 'System', 'warning');
          }
        }

        try {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-Frame-Options', 'DENY');
          res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

          const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
          const remoteAddress = String(req.socket?.remoteAddress || '');
          const clientIp = forwardedFor || remoteAddress || '127.0.0.1';
          const cookies = parseCookieHeader(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined);
          const rawPatientSessionToken = String(cookies.patient_session || '');
          const rawAdminSessionToken = String(cookies.admin_session || '');
          const patientSessionTokenHash = rawPatientSessionToken ? createHash('sha256').update(rawPatientSessionToken).digest('hex') : '';
          const adminSessionTokenHash = rawAdminSessionToken ? createHash('sha256').update(rawAdminSessionToken).digest('hex') : '';

          const appendSetCookie = (cookieValue: string): void => {
            const existing = res.getHeader('Set-Cookie');
            if (!existing) {
              res.setHeader('Set-Cookie', cookieValue);
              return;
            }
            if (Array.isArray(existing)) {
              res.setHeader('Set-Cookie', [...existing, cookieValue]);
              return;
            }
            res.setHeader('Set-Cookie', [String(existing), cookieValue]);
          };

          const enforceRateLimit = (key: string, maxRequests: number, windowMs: number): boolean => {
            const now = Date.now();
            const entry = patientAuthRateLimit.get(key);
            if (!entry || entry.resetAt <= now) {
              patientAuthRateLimit.set(key, { count: 1, resetAt: now + windowMs });
              return true;
            }
            if (entry.count >= maxRequests) return false;
            entry.count += 1;
            patientAuthRateLimit.set(key, entry);
            return true;
          };

          const enforceAdminRateLimit = (key: string, maxRequests: number, windowMs: number): boolean => {
            const now = Date.now();
            const entry = adminAuthRateLimit.get(key);
            if (!entry || entry.resetAt <= now) {
              adminAuthRateLimit.set(key, { count: 1, resetAt: now + windowMs });
              return true;
            }
            if (entry.count >= maxRequests) return false;
            entry.count += 1;
            adminAuthRateLimit.set(key, entry);
            return true;
          };

          const resolvePatientSession = async (): Promise<
            | {
                patient_account_id: number;
                patient_code: string;
                full_name: string;
                email: string;
                phone_number: string;
                sex: string | null;
                date_of_birth: string | null;
                guardian_name: string | null;
                email_verified: boolean;
              }
            | null
          > => {
            if (!patientSessionTokenHash) return null;
            const rows = (await sql.query(
              `SELECT s.patient_account_id, a.patient_code, a.full_name, a.email, a.phone_number, a.sex, a.date_of_birth::text AS date_of_birth, a.guardian_name, a.email_verified
               FROM patient_sessions s
               JOIN patient_accounts a ON a.id = s.patient_account_id
               WHERE s.session_token_hash = $1
                 AND s.revoked_at IS NULL
                 AND s.expires_at > NOW()
                 AND a.is_active = TRUE
               LIMIT 1`,
              [patientSessionTokenHash]
            )) as Array<{
              patient_account_id: number;
              patient_code: string;
              full_name: string;
              email: string;
              phone_number: string;
              sex: string | null;
              date_of_birth: string | null;
              guardian_name: string | null;
              email_verified: boolean;
            }>;
            return rows[0] || null;
          };

          const resolveAdminSession = async (): Promise<
            | {
                admin_profile_id: number;
                username: string;
                full_name: string;
                email: string;
                role: string;
                department: string;
                access_exemptions: string[] | null;
                is_super_admin: boolean;
                status: string;
              }
            | null
          > => {
            if (!adminSessionTokenHash) return null;
            await ensureAdminProfileTables(sql);
            const rows = (await sql.query(
              `SELECT s.admin_profile_id, a.username, a.full_name, a.email, a.role, a.department, a.access_exemptions, a.is_super_admin, a.status
               FROM admin_sessions s
               JOIN admin_profiles a ON a.id = s.admin_profile_id
               WHERE s.session_token_hash = $1
                 AND s.revoked_at IS NULL
                 AND s.expires_at > NOW()
                 AND LOWER(a.status) = 'active'
               LIMIT 1`,
              [adminSessionTokenHash]
            )) as Array<{
              admin_profile_id: number;
              username: string;
              full_name: string;
              email: string;
              role: string;
              department: string;
              access_exemptions: string[] | null;
              is_super_admin: boolean;
              status: string;
            }>;
            return rows[0] || null;
          };

          const resolveModuleAccessForAdmin = (session: NonNullable<Awaited<ReturnType<typeof resolveAdminSession>>>): string[] => {
            const role = String(session.role || '').toLowerCase();
            const department = String(session.department || '').toLowerCase();
            const normalizeModule = (value: string): string | null => {
              const raw = String(value || '').trim().toLowerCase();
              if (!raw) return null;
              if (raw === 'appointments' || raw === 'appointment') return 'appointments';
              if (raw === 'patients' || raw === 'patient' || raw === 'patients_database') return 'patients';
              if (raw === 'registration' || raw === 'registrations') return 'registration';
              if (raw === 'walkin' || raw === 'walk-in' || raw === 'walk_in') return 'walkin';
              if (raw === 'checkup' || raw === 'check-up' || raw === 'check_up') return 'checkup';
              if (raw === 'laboratory' || raw === 'lab') return 'laboratory';
              if (raw === 'pharmacy' || raw === 'pharmacy_inventory' || raw === 'pharmacy-inventory') return 'pharmacy';
              if (raw === 'mental_health' || raw === 'mental-health' || raw === 'mentalhealth') return 'mental_health';
              if (raw === 'reports' || raw === 'report') return 'reports';
              return null;
            };
            if (session.is_super_admin || role === 'admin') {
              return ['appointments', 'patients', 'registration', 'walkin', 'checkup', 'laboratory', 'pharmacy', 'mental_health', 'reports'];
            }
            const allowed = new Set<string>();
            if (department.includes('appoint')) allowed.add('appointments');
            if (department.includes('patient')) allowed.add('patients');
            if (department.includes('registr')) allowed.add('registration');
            if (department.includes('walk')) allowed.add('walkin');
            if (department.includes('check')) allowed.add('checkup');
            if (department.includes('laboratory') || department === 'lab') allowed.add('laboratory');
            if (department.includes('pharmacy')) allowed.add('pharmacy');
            if (department.includes('mental')) allowed.add('mental_health');
            if (department.includes('report') || department.includes('finance')) allowed.add('reports');

            if (role.includes('appoint')) allowed.add('appointments');
            if (role.includes('patient') || role.includes('record')) allowed.add('patients');
            if (role.includes('registr')) allowed.add('registration');
            if (role.includes('walk')) allowed.add('walkin');
            if (role.includes('check') || role.includes('doctor')) allowed.add('checkup');
            if (role.includes('lab')) allowed.add('laboratory');
            if (role.includes('pharma')) allowed.add('pharmacy');
            if (role.includes('mental') || role.includes('counsel')) allowed.add('mental_health');
            if (role.includes('report') || role.includes('analyst') || role.includes('finance')) allowed.add('reports');

            const exemptions = Array.isArray(session.access_exemptions) ? session.access_exemptions : [];
            for (const exemption of exemptions) {
              const moduleName = normalizeModule(exemption);
              if (moduleName) {
                allowed.add(moduleName);
              }
            }
            return Array.from(allowed);
          };

          const moduleToApiPrefix: Record<string, string[]> = {
            patients: ['/api/patients'],
            registration: ['/api/registrations'],
            walkin: ['/api/walk-ins'],
            checkup: ['/api/checkups'],
            laboratory: ['/api/laboratory'],
            pharmacy: ['/api/pharmacy'],
            mental_health: ['/api/mental-health'],
            reports: ['/api/reports']
          };

          const isAdminProtectedApi = (path: string): boolean => {
            return (
              path === '/api/dashboard' ||
              path === '/api/module-activity' ||
              path === '/api/admin-profile' ||
              Object.values(moduleToApiPrefix).flat().some((prefix) => path.startsWith(prefix))
            );
          };

          const moduleFromPath = (path: string): string | null => {
            for (const [moduleKey, prefixes] of Object.entries(moduleToApiPrefix)) {
              if (prefixes.some((prefix) => path.startsWith(prefix))) {
                return moduleKey;
              }
            }
            return null;
          };

          const enforceAdminModuleAccess = async (): Promise<boolean> => {
            if (!isAdminProtectedApi(url.pathname)) return true;
            const session = await resolveAdminSession();
            if (!session) {
              writeJson(res, 401, { ok: false, message: 'Admin authentication required.' });
              return false;
            }
            const allowedModules = resolveModuleAccessForAdmin(session);
            if (session.is_super_admin || String(session.role || '').toLowerCase() === 'admin') {
              return true;
            }

            if (url.pathname === '/api/dashboard' || url.pathname === '/api/admin-profile') {
              return true;
            }

            if (url.pathname === '/api/module-activity') {
              const requestedModule = String(url.searchParams.get('module') || '').trim().toLowerCase();
              if (!requestedModule || requestedModule === 'all') {
                if (!allowedModules.includes('reports')) {
                  writeJson(res, 403, { ok: false, message: 'Access denied for module activity scope.' });
                  return false;
                }
                return true;
              }
              if (!allowedModules.includes(requestedModule)) {
                writeJson(res, 403, { ok: false, message: `Access denied for module: ${requestedModule}.` });
                return false;
              }
              return true;
            }

            const targetModule = moduleFromPath(url.pathname);
            if (!targetModule) return true;
            if (!allowedModules.includes(targetModule)) {
              writeJson(res, 403, { ok: false, message: `Access denied for ${targetModule} module.` });
              return false;
            }
            return true;
          };

          if (!(await enforceAdminModuleAccess())) {
            return;
          }

          if (url.pathname === '/api/patient-auth' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientAuthTables(sql);
            const session = await resolvePatientSession();
            writeJson(res, 200, {
              ok: true,
              data: {
                authenticated: Boolean(session),
                account: session
                  ? {
                      patientCode: session.patient_code,
                      fullName: session.full_name,
                      email: session.email,
                      phoneNumber: session.phone_number,
                      sex: session.sex,
                      dateOfBirth: session.date_of_birth,
                      guardianName: session.guardian_name,
                      emailVerified: Boolean(session.email_verified)
                    }
                  : null
              }
            });
            return;
          }

          if (url.pathname === '/api/patient-auth' && (req.method || '').toUpperCase() === 'POST') {
            await ensurePatientAuthTables(sql);
            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();

            if (!['signup', 'login', 'logout', 'request_email_verification', 'verify_email', 'request_password_reset', 'reset_password'].includes(action)) {
              writeJson(res, 422, { ok: false, message: 'Unsupported auth action.' });
              return;
            }

            if (!enforceRateLimit(`patient-auth:${action}:${clientIp}`, 8, 60_000)) {
              writeJson(res, 429, { ok: false, message: 'Too many requests. Please wait a minute and retry.' });
              return;
            }

            if (action === 'logout') {
              if (patientSessionTokenHash) {
                await sql.query(`UPDATE patient_sessions SET revoked_at = NOW() WHERE session_token_hash = $1 AND revoked_at IS NULL`, [patientSessionTokenHash]);
              }
              appendSetCookie('patient_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/');
              writeJson(res, 200, { ok: true, message: 'Signed out.' });
              return;
            }

            const email = String(body.email || '').trim().toLowerCase();
            const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

            if (!emailValid && action !== 'logout') {
              writeJson(res, 422, { ok: false, message: 'Enter a valid email address.' });
              return;
            }

            const createOtpCode = (): string => String(Math.floor(100000 + Math.random() * 900000));
            const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
            const issueAuthToken = async (patientAccountId: number, tokenType: 'verify_email' | 'reset_password'): Promise<string> => {
              const code = createOtpCode();
              await sql.query(
                `INSERT INTO patient_auth_tokens (patient_account_id, token_type, token_hash, expires_at)
                 VALUES ($1,$2,$3,NOW() + INTERVAL '15 minutes')`,
                [patientAccountId, tokenType, hashToken(code)]
              );
              return code;
            };

            const consumeAuthToken = async (
              patientAccountId: number,
              tokenType: 'verify_email' | 'reset_password',
              token: string
            ): Promise<boolean> => {
              const rows = (await sql.query(
                `SELECT id
                 FROM patient_auth_tokens
                 WHERE patient_account_id = $1
                   AND token_type = $2
                   AND token_hash = $3
                   AND used_at IS NULL
                   AND expires_at > NOW()
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [patientAccountId, tokenType, hashToken(token)]
              )) as Array<{ id: number }>;
              if (!rows.length) return false;
              await sql.query(`UPDATE patient_auth_tokens SET used_at = NOW() WHERE id = $1`, [rows[0].id]);
              return true;
            };

            const getAccountByEmail = async (): Promise<
              | {
                  id: number;
                  patient_code: string;
                  full_name: string;
                  email: string;
                  phone_number: string;
                  password_hash: string;
                  sex: string | null;
                  date_of_birth: string | null;
                  guardian_name: string | null;
                  email_verified: boolean;
                }
              | undefined
            > => {
              const rows = (await sql.query(
                `SELECT id, patient_code, full_name, email, phone_number, password_hash, sex, date_of_birth::text AS date_of_birth, guardian_name, email_verified
                 FROM patient_accounts
                 WHERE LOWER(email) = $1
                 LIMIT 1`,
                [email]
              )) as Array<{
                id: number;
                patient_code: string;
                full_name: string;
                email: string;
                phone_number: string;
                password_hash: string;
                sex: string | null;
                date_of_birth: string | null;
                guardian_name: string | null;
                email_verified: boolean;
              }>;
              return rows[0];
            };

            if (action === 'signup') {
              const password = String(body.password || '').trim();
              if (password.length < 8) {
                writeJson(res, 422, { ok: false, message: 'Password must be at least 8 characters.' });
                return;
              }
              const fullName = String(body.full_name || '').trim();
              const phoneNumber = String(body.phone_number || '').trim();
              const sex = String(body.sex || '').trim() || null;
              const dateOfBirth = String(body.date_of_birth || '').trim() || null;
              const guardianName = String(body.guardian_name || '').trim() || null;
              if (!fullName || !/^[0-9+\-\s()]{7,20}$/.test(phoneNumber)) {
                writeJson(res, 422, { ok: false, message: 'Full name and valid phone number are required.' });
                return;
              }
              const age = computeAgeFromDateOfBirth(dateOfBirth);
              if (age !== null && age < 18 && !guardianName) {
                writeJson(res, 422, { ok: false, message: 'Guardian name is required for minors.' });
                return;
              }

              const existing = await getAccountByEmail();
              if (existing) {
                writeJson(res, 409, { ok: false, message: 'Account already exists for this email.' });
                return;
              }

              await ensurePatientMasterTables(sql);
              const passwordHash = hashPatientPassword(password);
              const patientCode = `PAT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
              const createdRows = (await sql.query(
                `INSERT INTO patient_accounts (patient_code, full_name, email, phone_number, password_hash, sex, date_of_birth, guardian_name, email_verified)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,FALSE)
                 RETURNING id, patient_code, full_name, email, phone_number, sex, date_of_birth::text AS date_of_birth, guardian_name`,
                [patientCode, fullName, email, phoneNumber, passwordHash, sex, dateOfBirth, guardianName]
              )) as Array<{
                id: number;
                patient_code: string;
                full_name: string;
                email: string;
                phone_number: string;
                sex: string | null;
                date_of_birth: string | null;
                guardian_name: string | null;
              }>;
              const account = createdRows[0];

              await sql.query(
                `INSERT INTO patient_master (patient_code, patient_name, identity_key, email, contact, sex, date_of_birth, guardian_contact, latest_status, source_tags, last_seen_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8,'active',ARRAY['patient_portal'], NOW())
                 ON CONFLICT (identity_key) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     email = EXCLUDED.email,
                     contact = EXCLUDED.contact,
                     sex = COALESCE(EXCLUDED.sex, patient_master.sex),
                     date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_master.date_of_birth),
                     guardian_contact = COALESCE(EXCLUDED.guardian_contact, patient_master.guardian_contact),
                     last_seen_at = NOW(),
                     updated_at = NOW()`,
                [
                  account.patient_code,
                  account.full_name,
                  stablePatientIdentity(account.full_name, account.email, account.phone_number),
                  account.email,
                  account.phone_number,
                  account.sex,
                  account.date_of_birth,
                  account.guardian_name
                ]
              );

              const verifyCode = await issueAuthToken(account.id, 'verify_email');
              await sql.query(
                `INSERT INTO patient_auth_logs (patient_account_id, action, ip_address, detail)
                 VALUES ($1,'SIGNUP',$2,'Patient account created. Verification pending.')`,
                [account.id, clientIp]
              );
              writeJson(res, 200, {
                ok: true,
                message: 'Account created. Please verify your email.',
                data: {
                  authenticated: false,
                  account: null,
                  verificationRequired: true,
                  verificationEmail: account.email,
                  devVerificationCode: verifyCode
                }
              });
              return;
            }

            if (action === 'request_email_verification') {
              const account = await getAccountByEmail();
              if (!account) {
                writeJson(res, 404, { ok: false, message: 'No patient account found for this email.' });
                return;
              }
              if (account.email_verified) {
                writeJson(res, 200, { ok: true, message: 'Email is already verified.' });
                return;
              }
              const verifyCode = await issueAuthToken(account.id, 'verify_email');
              writeJson(res, 200, {
                ok: true,
                message: 'Verification code issued.',
                data: {
                  verificationRequired: true,
                  verificationEmail: account.email,
                  devVerificationCode: verifyCode
                }
              });
              return;
            }

            if (action === 'verify_email') {
              const code = String(body.code || '').trim();
              if (!/^\d{6}$/.test(code)) {
                writeJson(res, 422, { ok: false, message: 'Enter a valid 6-digit verification code.' });
                return;
              }
              const account = await getAccountByEmail();
              if (!account) {
                writeJson(res, 404, { ok: false, message: 'No patient account found for this email.' });
                return;
              }
              const valid = await consumeAuthToken(account.id, 'verify_email', code);
              if (!valid) {
                writeJson(res, 422, { ok: false, message: 'Invalid or expired verification code.' });
                return;
              }

              await sql.query(`UPDATE patient_accounts SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`, [account.id]);
              const sessionToken = randomBytes(32).toString('hex');
              const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
              await sql.query(
                `INSERT INTO patient_sessions (session_token_hash, patient_account_id, ip_address, user_agent, expires_at)
                 VALUES ($1,$2,$3,$4,NOW() + INTERVAL '7 days')`,
                [sessionHash, account.id, clientIp, String(req.headers['user-agent'] || '').slice(0, 300)]
              );
              appendSetCookie(`patient_session=${sessionToken}; Max-Age=604800; HttpOnly; SameSite=Lax; Path=/`);
              writeJson(res, 200, {
                ok: true,
                message: 'Email verified and login successful.',
                data: {
                  authenticated: true,
                  account: {
                    patientCode: account.patient_code,
                    fullName: account.full_name,
                    email: account.email,
                    phoneNumber: account.phone_number,
                    sex: account.sex,
                    dateOfBirth: account.date_of_birth,
                    guardianName: account.guardian_name,
                    emailVerified: true
                  }
                }
              });
              return;
            }

            if (action === 'request_password_reset') {
              const account = await getAccountByEmail();
              if (!account) {
                writeJson(res, 404, { ok: false, message: 'No patient account found for this email.' });
                return;
              }
              const resetCode = await issueAuthToken(account.id, 'reset_password');
              writeJson(res, 200, {
                ok: true,
                message: 'Password reset code issued.',
                data: {
                  resetEmail: account.email,
                  devResetCode: resetCode
                }
              });
              return;
            }

            if (action === 'reset_password') {
              const code = String(body.code || '').trim();
              const newPassword = String(body.new_password || '').trim();
              if (!/^\d{6}$/.test(code) || newPassword.length < 8) {
                writeJson(res, 422, { ok: false, message: 'Valid reset code and new password (8+ chars) are required.' });
                return;
              }
              const account = await getAccountByEmail();
              if (!account) {
                writeJson(res, 404, { ok: false, message: 'No patient account found for this email.' });
                return;
              }
              const valid = await consumeAuthToken(account.id, 'reset_password', code);
              if (!valid) {
                writeJson(res, 422, { ok: false, message: 'Invalid or expired reset code.' });
                return;
              }
              await sql.query(`UPDATE patient_accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hashPatientPassword(newPassword), account.id]);
              writeJson(res, 200, { ok: true, message: 'Password reset successful. You can now login.' });
              return;
            }

            const password = String(body.password || '').trim();
            if (password.length < 8) {
              writeJson(res, 422, { ok: false, message: 'Enter a valid password (minimum 8 characters).' });
              return;
            }

            const account = await getAccountByEmail();
            if (!account || !verifyPatientPassword(password, account.password_hash)) {
              writeJson(res, 401, { ok: false, message: 'Invalid email or password.' });
              return;
            }
            if (!account.email_verified) {
              writeJson(res, 403, {
                ok: false,
                message: 'Email not verified. Verify your account before login.',
                data: {
                  verificationRequired: true,
                  verificationEmail: account.email
                }
              });
              return;
            }

            const sessionToken = randomBytes(32).toString('hex');
            const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
            await sql.query(
              `INSERT INTO patient_sessions (session_token_hash, patient_account_id, ip_address, user_agent, expires_at)
               VALUES ($1,$2,$3,$4,NOW() + INTERVAL '7 days')`,
              [sessionHash, account.id, clientIp, String(req.headers['user-agent'] || '').slice(0, 300)]
            );
            await sql.query(`UPDATE patient_accounts SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [account.id]);
            await sql.query(
              `INSERT INTO patient_auth_logs (patient_account_id, action, ip_address, detail)
               VALUES ($1,'LOGIN',$2,'Patient signed in')`,
              [account.id, clientIp]
            );
            appendSetCookie(`patient_session=${sessionToken}; Max-Age=604800; HttpOnly; SameSite=Lax; Path=/`);
            writeJson(res, 200, {
              ok: true,
              message: 'Login success.',
              data: {
                authenticated: true,
                account: {
                  patientCode: account.patient_code,
                  fullName: account.full_name,
                  email: account.email,
                  phoneNumber: account.phone_number,
                  sex: account.sex,
                  dateOfBirth: account.date_of_birth,
                  guardianName: account.guardian_name,
                  emailVerified: true
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/patient-portal' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientAuthTables(sql);
            const session = await resolvePatientSession();
            if (!session) {
              writeJson(res, 401, { ok: false, message: 'Please log in to view patient portal.' });
              return;
            }

            await ensurePatientAppointmentsTable(sql);
            const appointments = (await sql.query(
              `SELECT booking_id, doctor_name, department_name, appointment_date::text AS appointment_date, preferred_time, status, visit_reason
               FROM patient_appointments
               WHERE LOWER(COALESCE(patient_email, '')) = LOWER($1)
                  OR phone_number = $2
               ORDER BY appointment_date DESC, created_at DESC
               LIMIT 20`,
              [session.email, session.phone_number]
            )) as Array<{
              booking_id: string;
              doctor_name: string;
              department_name: string;
              appointment_date: string;
              preferred_time: string | null;
              status: string;
              visit_reason: string | null;
            }>;
            const analyticsRows = (await sql.query(
              `SELECT
                  COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE appointment_date >= CURRENT_DATE)::int AS upcoming,
                  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('pending', 'new', 'awaiting'))::int AS pending,
                  COUNT(*) FILTER (WHERE LOWER(COALESCE(status, '')) IN ('confirmed', 'accepted'))::int AS confirmed
               FROM patient_appointments
               WHERE LOWER(COALESCE(patient_email, '')) = LOWER($1)
                  OR phone_number = $2`,
              [session.email, session.phone_number]
            )) as Array<{ total: number; upcoming: number; pending: number; confirmed: number }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                profile: {
                  patientCode: session.patient_code,
                  fullName: session.full_name,
                  email: session.email,
                  phoneNumber: session.phone_number,
                  sex: session.sex,
                  dateOfBirth: session.date_of_birth,
                  guardianName: session.guardian_name,
                  emailVerified: Boolean(session.email_verified)
                },
                analytics: analyticsRows[0] || { total: 0, upcoming: 0, pending: 0, confirmed: 0 },
                appointments: appointments.map((item) => ({
                  bookingId: item.booking_id,
                  doctorName: item.doctor_name,
                  department: item.department_name,
                  appointmentDate: item.appointment_date,
                  preferredTime: item.preferred_time || '--',
                  status: item.status,
                  reason: item.visit_reason || '--'
                }))
              }
            });
            return;
          }

          if (url.pathname === '/api/patient-portal' && (req.method || '').toUpperCase() === 'POST') {
            await ensurePatientAuthTables(sql);
            await ensurePatientMasterTables(sql);
            const session = await resolvePatientSession();
            if (!session) {
              writeJson(res, 401, { ok: false, message: 'Please log in to update your profile.' });
              return;
            }
            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            if (action !== 'update_profile') {
              writeJson(res, 422, { ok: false, message: 'Unsupported patient portal action.' });
              return;
            }

            const fullName = String(body.full_name || '').trim();
            const phoneNumber = String(body.phone_number || '').trim();
            const sex = String(body.sex || '').trim() || null;
            const dateOfBirth = String(body.date_of_birth || '').trim() || null;
            const guardianName = String(body.guardian_name || '').trim() || null;
            if (!fullName || !/^[0-9+\-\s()]{7,20}$/.test(phoneNumber)) {
              writeJson(res, 422, { ok: false, message: 'Full name and valid phone number are required.' });
              return;
            }
            const age = computeAgeFromDateOfBirth(dateOfBirth);
            if (age !== null && age < 18 && !guardianName) {
              writeJson(res, 422, { ok: false, message: 'Guardian name is required for minors.' });
              return;
            }

            const updatedRows = (await sql.query(
              `UPDATE patient_accounts
               SET full_name = $1,
                   phone_number = $2,
                   sex = $3,
                   date_of_birth = $4::date,
                   guardian_name = $5,
                   updated_at = NOW()
               WHERE id = $6
               RETURNING patient_code, full_name, email, phone_number, sex, date_of_birth::text AS date_of_birth, guardian_name, email_verified`,
              [fullName, phoneNumber, sex, dateOfBirth, guardianName, session.patient_account_id]
            )) as Array<{
              patient_code: string;
              full_name: string;
              email: string;
              phone_number: string;
              sex: string | null;
              date_of_birth: string | null;
              guardian_name: string | null;
              email_verified: boolean;
            }>;
            const account = updatedRows[0];

            await sql.query(
              `UPDATE patient_master
               SET patient_name = $1,
                   contact = $2,
                   sex = $3,
                   date_of_birth = $4::date,
                   guardian_contact = $5,
                   updated_at = NOW()
               WHERE patient_code = $6
                  OR LOWER(COALESCE(email, '')) = LOWER($7)`,
              [account.full_name, account.phone_number, account.sex, account.date_of_birth, account.guardian_name, account.patient_code, account.email]
            );

            writeJson(res, 200, {
              ok: true,
              message: 'Profile updated.',
              data: {
                authenticated: true,
                account: {
                  patientCode: account.patient_code,
                  fullName: account.full_name,
                  email: account.email,
                  phoneNumber: account.phone_number,
                  sex: account.sex,
                  dateOfBirth: account.date_of_birth,
                  guardianName: account.guardian_name,
                  emailVerified: Boolean(account.email_verified)
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/registrations' && (req.method || 'GET').toUpperCase() === 'GET') {
            await sql.query(`
              CREATE TABLE IF NOT EXISTS patient_registrations (
                id BIGSERIAL PRIMARY KEY,
                case_id VARCHAR(40) NOT NULL UNIQUE,
                patient_name VARCHAR(150) NOT NULL,
                patient_email VARCHAR(190) NULL,
                age SMALLINT NULL,
                concern TEXT NULL,
                intake_time TIMESTAMP NOT NULL DEFAULT NOW(),
                booked_time TIMESTAMP NOT NULL DEFAULT NOW(),
                status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                assigned_to VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
              )
            `);

            const search = (url.searchParams.get('search') || '').trim();
            const status = (url.searchParams.get('status') || '').trim();
            const sort = (url.searchParams.get('sort') || 'Sort Latest Intake').trim();
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let paramIndex = 1;

            if (search) {
              params.push(`%${search}%`);
              where.push(`(patient_name ILIKE $${paramIndex} OR COALESCE(patient_email, '') ILIKE $${paramIndex} OR COALESCE(concern, '') ILIKE $${paramIndex} OR COALESCE(assigned_to, '') ILIKE $${paramIndex} OR case_id ILIKE $${paramIndex})`);
              paramIndex += 1;
            }

            if (status && status.toLowerCase() !== 'all statuses') {
              params.push(status.toLowerCase());
              where.push(`LOWER(status) = $${paramIndex}`);
              paramIndex += 1;
            }

            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
            let orderBy = ' ORDER BY intake_time DESC';
            if (sort === 'Sort Name A-Z') orderBy = ' ORDER BY patient_name ASC';
            if (sort === 'Sort Name Z-A') orderBy = ' ORDER BY patient_name DESC';

            const countRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM patient_registrations${whereSql}`, params)) as Array<{ total: number }>;
            const total = Number(countRows[0]?.total || 0);

            const items = await sql.query(
              `SELECT id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to
               FROM patient_registrations${whereSql}${orderBy}
               LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
              [...params, perPage, offset]
            );

            const [pendingRows, activeRows, concernRows, totalRows] = await Promise.all([
              sql.query(`SELECT COUNT(*)::int AS total FROM patient_registrations WHERE LOWER(status) = 'pending'`),
              sql.query(`SELECT COUNT(*)::int AS total FROM patient_registrations WHERE LOWER(status) = 'active'`),
              sql.query(`SELECT COUNT(*)::int AS total FROM patient_registrations WHERE COALESCE(TRIM(concern), '') <> ''`),
              sql.query(`SELECT COUNT(*)::int AS total FROM patient_registrations`)
            ]);

            const pending = Number((pendingRows as Array<{ total: number }>)[0]?.total || 0);
            const active = Number((activeRows as Array<{ total: number }>)[0]?.total || 0);
            const concerns = Number((concernRows as Array<{ total: number }>)[0]?.total || 0);
            const totalAll = Number((totalRows as Array<{ total: number }>)[0]?.total || 0);
            const approvalRate = totalAll > 0 ? Math.round((active / totalAll) * 100) : 0;

            writeJson(res, 200, {
              ok: true,
              data: {
                analytics: {
                  pending,
                  active,
                  concerns,
                  approvalRate
                },
                items: Array.isArray(items) ? items : [],
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/checkups' && (req.method || 'GET').toUpperCase() === 'GET') {
            await sql.query(`
              CREATE TABLE IF NOT EXISTS checkup_visits (
                id BIGSERIAL PRIMARY KEY,
                visit_id VARCHAR(40) NOT NULL UNIQUE,
                patient_name VARCHAR(150) NOT NULL,
                assigned_doctor VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
                source VARCHAR(50) NOT NULL DEFAULT 'appointment_confirmed',
                status VARCHAR(40) NOT NULL DEFAULT 'intake',
                chief_complaint TEXT NULL,
                diagnosis TEXT NULL,
                clinical_notes TEXT NULL,
                consultation_started_at TIMESTAMP NULL,
                lab_requested BOOLEAN NOT NULL DEFAULT FALSE,
                lab_result_ready BOOLEAN NOT NULL DEFAULT FALSE,
                prescription_created BOOLEAN NOT NULL DEFAULT FALSE,
                prescription_dispensed BOOLEAN NOT NULL DEFAULT FALSE,
                follow_up_date DATE NULL,
                is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
                version INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
              )
            `);

            const seededRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits`)) as Array<{ total: number }>;
            if (Number(seededRows[0]?.total || 0) === 0) {
              await sql.query(
                `INSERT INTO checkup_visits (visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, lab_requested, lab_result_ready, prescription_created, prescription_dispensed)
                 VALUES
                  ('VISIT-2026-2001', 'Maria Santos', 'Dr. Humour', 'appointment_confirmed', 'queue', 'Fever with sore throat', NULL, NULL, FALSE, FALSE, FALSE, FALSE),
                  ('VISIT-2026-2002', 'Rico Dela Cruz', 'Dr. Humour', 'walkin_triage_completed', 'doctor_assigned', 'Persistent headache', NULL, NULL, FALSE, FALSE, FALSE, FALSE),
                  ('VISIT-2026-2003', 'Juana Reyes', 'Dr. Jenni', 'waiting_for_doctor', 'in_consultation', 'Back pain', 'Muscle strain', 'Pain localized at lower back, no neuro deficits.', TRUE, FALSE, FALSE, FALSE)
                 ON CONFLICT (visit_id) DO NOTHING`
              );
            }

            const search = (url.searchParams.get('search') || '').trim();
            const status = (url.searchParams.get('status') || '').trim();
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;

            if (search) {
              params.push(`%${search}%`);
              where.push(`(visit_id ILIKE $${idx} OR patient_name ILIKE $${idx} OR COALESCE(chief_complaint, '') ILIKE $${idx} OR COALESCE(assigned_doctor, '') ILIKE $${idx})`);
              idx += 1;
            }

            if (status && status.toLowerCase() !== 'all') {
              params.push(status.toLowerCase());
              where.push(`LOWER(status) = $${idx}`);
              idx += 1;
            }

            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
            const totalRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits${whereSql}`, params)) as Array<{ total: number }>;
            const total = Number(totalRows[0]?.total || 0);

            const items = await sql.query(
              `SELECT id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                      lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at
               FROM checkup_visits${whereSql}
               ORDER BY
                 CASE WHEN is_emergency THEN 0 ELSE 1 END ASC,
                 updated_at DESC
               LIMIT $${idx} OFFSET $${idx + 1}`,
              [...params, perPage, offset]
            );

            const [intakeRows, queueRows, assignedRows, consultRows, labRows, pharmacyRows, completedRows, emergencyRows] = await Promise.all([
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'intake' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'queue' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'doctor_assigned' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'in_consultation' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'lab_requested' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'pharmacy' AND is_emergency = FALSE`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE status = 'completed'`),
              sql.query(`SELECT COUNT(*)::int AS total FROM checkup_visits WHERE is_emergency = TRUE AND status <> 'archived'`)
            ]);

            writeJson(res, 200, {
              ok: true,
              data: {
                items: Array.isArray(items) ? items : [],
                analytics: {
                  intake: Number((intakeRows as Array<{ total: number }>)[0]?.total || 0),
                  queue: Number((queueRows as Array<{ total: number }>)[0]?.total || 0),
                  doctorAssigned: Number((assignedRows as Array<{ total: number }>)[0]?.total || 0),
                  inConsultation: Number((consultRows as Array<{ total: number }>)[0]?.total || 0),
                  labRequested: Number((labRows as Array<{ total: number }>)[0]?.total || 0),
                  pharmacy: Number((pharmacyRows as Array<{ total: number }>)[0]?.total || 0),
                  completed: Number((completedRows as Array<{ total: number }>)[0]?.total || 0),
                  emergency: Number((emergencyRows as Array<{ total: number }>)[0]?.total || 0)
                },
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/pharmacy' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePharmacyInventoryTables(sql);

            const seededRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM pharmacy_medicines WHERE is_archived = FALSE`)) as Array<{ total: number }>;
            if (Number(seededRows[0]?.total || 0) === 0) {
              await sql.query(
                `INSERT INTO pharmacy_medicines (
                  medicine_code, sku, medicine_name, brand_name, generic_name, category, medicine_type, dosage_strength,
                  unit_of_measure, supplier_name, purchase_cost, selling_price, batch_lot_no, manufacturing_date, expiry_date,
                  storage_requirements, reorder_level, low_stock_threshold, stock_capacity, stock_on_hand, stock_location, barcode
                 )
                 VALUES
                  ('MED-00043', 'MED-OMP-043', 'Omeprazole', 'Losec', 'Omeprazole', 'Capsule', 'Antacid', '20mg', 'caps', 'MediCore Supply', 4.80, 8.50, 'OMP-52', '2025-01-05', '2026-05-01', 'Store below 25C, dry area', 35, 30, 200, 23, 'Warehouse A / Shelf C2', '4800010000432'),
                  ('MED-00036', 'MED-MTF-036', 'Metformin', 'Glucophage', 'Metformin', 'Tablet', 'Diabetes', '500mg', 'tabs', 'Healix Pharma', 2.20, 4.70, 'MTF-11', '2025-02-18', '2026-11-22', 'Room temperature', 40, 35, 150, 0, 'Warehouse A / Shelf A1', '4800010000364'),
                  ('MED-00024', 'MED-ALV-024', 'Aleve', 'Aleve', 'Naproxen', 'Tablet', 'Painkiller', '220mg', 'tabs', 'Healix Pharma', 1.30, 3.90, 'ALV-27', '2025-04-04', '2026-05-20', 'Room temperature', 65, 50, 300, 180, 'Warehouse C / Shelf B4', '4800010000243'),
                  ('MED-00017', 'MED-AML-017', 'Amlodipine', 'Norvasc', 'Amlodipine', 'Tablet', 'Antihypertensive', '5mg', 'tabs', 'AxisMed Trading', 1.80, 4.10, 'AML-44', '2025-01-22', '2027-02-07', 'Store below 30C', 70, 60, 300, 150, 'Warehouse B / Shelf A3', '4800010000175')
                 ON CONFLICT (sku) DO NOTHING`
              );
            }

            const medicines = await sql.query(
              `SELECT id, medicine_code, sku, medicine_name, brand_name, generic_name, category, medicine_type, dosage_strength,
                      unit_of_measure, supplier_name, purchase_cost, selling_price, batch_lot_no, manufacturing_date, expiry_date,
                      storage_requirements, reorder_level, low_stock_threshold, stock_capacity, stock_on_hand, stock_location, barcode,
                      created_at, updated_at
               FROM pharmacy_medicines
               WHERE is_archived = FALSE
               ORDER BY medicine_name ASC`
            );

            const requests = await sql.query(
              `SELECT r.id, r.request_code, r.medicine_id, m.medicine_name, r.patient_name, r.quantity, r.notes,
                      r.prescription_reference, r.dispense_reason, r.status, r.requested_at, r.fulfilled_at, r.fulfilled_by
               FROM pharmacy_dispense_requests r
               JOIN pharmacy_medicines m ON m.id = r.medicine_id
               ORDER BY r.requested_at DESC`
            );

            const logs = await sql.query(
              `SELECT id, detail, actor, tone, created_at
               FROM pharmacy_activity_logs
               ORDER BY created_at DESC
               LIMIT 200`
            );

            const movements = await sql.query(
              `SELECT id, medicine_id, movement_type, quantity_change, quantity_before, quantity_after, reason, batch_lot_no, stock_location, actor, created_at
               FROM pharmacy_stock_movements
               ORDER BY created_at DESC
               LIMIT 600`
            );

            writeJson(res, 200, {
              ok: true,
              data: {
                medicines: Array.isArray(medicines) ? medicines : [],
                requests: Array.isArray(requests) ? requests : [],
                logs: Array.isArray(logs) ? logs : [],
                movements: Array.isArray(movements) ? movements : []
              }
            });
            return;
          }

          if (url.pathname === '/api/pharmacy' && (req.method || '').toUpperCase() === 'POST') {
            await ensurePharmacyInventoryTables(sql);

            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();
            const role = toSafeText(body.role) || 'Pharmacist';
            const actor = role;
            const allowedActions = pharmacyAllowedActions[role] || [];
            if (!allowedActions.includes(action)) {
              writeJson(res, 403, { ok: false, message: `Role ${role} cannot perform ${action || 'this action'}.` });
              return;
            }

            const medicineId = toSafeInt(body.medicine_id, 0);

            if (action === 'save_draft') {
              const draftType = toSafeText(body.draft_type) || 'general';
              const notes = toSafeText(body.notes) || 'Draft saved';
              await insertPharmacyLog('DRAFT', `${draftType}: ${notes}`, actor, 'info');
              writeJson(res, 200, { ok: true, message: 'Draft saved.' });
              return;
            }

            if (action === 'create_medicine') {
              const sku = toSafeText(body.sku);
              const medicineName = toSafeText(body.medicine_name);
              const batchLotNo = toSafeText(body.batch_lot_no);
              const expiryDate = toSafeIsoDate(body.expiry_date);
              if (!sku || !medicineName || !batchLotNo || !expiryDate) {
                writeJson(res, 422, { ok: false, message: 'sku, medicine_name, batch_lot_no, and expiry_date are required.' });
                return;
              }

              const duplicateRows = (await sql.query(`SELECT id FROM pharmacy_medicines WHERE sku = $1 LIMIT 1`, [sku])) as Array<{ id: number }>;
              if (duplicateRows.length > 0) {
                writeJson(res, 409, { ok: false, message: 'SKU already exists.' });
                return;
              }

              const codeSeed = Math.floor(10000 + Math.random() * 89999);
              const medicineCode = `MED-${codeSeed}`;
              const initialStock = Math.max(0, toSafeInt(body.stock_on_hand, 0));

              const inserted = (await sql.query(
                `INSERT INTO pharmacy_medicines (
                    medicine_code, sku, medicine_name, brand_name, generic_name, category, medicine_type, dosage_strength,
                    unit_of_measure, supplier_name, purchase_cost, selling_price, batch_lot_no, manufacturing_date, expiry_date,
                    storage_requirements, reorder_level, low_stock_threshold, stock_capacity, stock_on_hand, stock_location, barcode
                 ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,
                    $9,$10,$11,$12,$13,$14,$15,
                    $16,$17,$18,$19,$20,$21,$22
                 )
                 RETURNING id, medicine_name, stock_on_hand, batch_lot_no, stock_location`,
                [
                  medicineCode,
                  sku,
                  medicineName,
                  toSafeText(body.brand_name),
                  toSafeText(body.generic_name),
                  toSafeText(body.category) || 'Tablet',
                  toSafeText(body.medicine_type) || 'General',
                  toSafeText(body.dosage_strength),
                  toSafeText(body.unit_of_measure) || 'unit',
                  toSafeText(body.supplier_name),
                  toSafeMoney(body.purchase_cost, 0),
                  toSafeMoney(body.selling_price, 0),
                  batchLotNo,
                  toSafeIsoDate(body.manufacturing_date),
                  expiryDate,
                  toSafeText(body.storage_requirements) || null,
                  Math.max(0, toSafeInt(body.reorder_level, 20)),
                  Math.max(0, toSafeInt(body.low_stock_threshold, 20)),
                  Math.max(0, toSafeInt(body.stock_capacity, 100)),
                  initialStock,
                  toSafeText(body.stock_location) || null,
                  toSafeText(body.barcode) || null
                ]
              )) as Array<{ id: number; medicine_name: string; stock_on_hand: number; batch_lot_no: string; stock_location: string | null }>;
              const created = inserted[0];
              await insertPharmacyMovement(
                created.id,
                'add',
                initialStock,
                0,
                Number(created.stock_on_hand || 0),
                'Initial stock added',
                created.batch_lot_no || null,
                created.stock_location || null,
                actor
              );
              await insertPharmacyLog('ADD_MEDICINE', `${created.medicine_name} created with stock ${initialStock}`, actor, 'success');
              await evaluatePharmacyAlerts(created.id);
              writeJson(res, 200, { ok: true, message: 'Medicine created.' });
              return;
            }

            if (action === 'update_medicine') {
              if (!medicineId) {
                writeJson(res, 422, { ok: false, message: 'medicine_id is required.' });
                return;
              }
              const updatedRows = await sql.query(
                `UPDATE pharmacy_medicines
                 SET category = COALESCE($1, category),
                     medicine_type = COALESCE($2, medicine_type),
                     supplier_name = COALESCE($3, supplier_name),
                     dosage_strength = COALESCE($4, dosage_strength),
                     unit_of_measure = COALESCE($5, unit_of_measure),
                     stock_capacity = COALESCE($6, stock_capacity),
                     low_stock_threshold = COALESCE($7, low_stock_threshold),
                     reorder_level = COALESCE($8, reorder_level),
                     expiry_date = COALESCE($9::date, expiry_date),
                     stock_location = COALESCE($10, stock_location),
                     storage_requirements = COALESCE($11, storage_requirements),
                     updated_at = NOW()
                 WHERE id = $12 AND is_archived = FALSE
                 RETURNING id, medicine_name`,
                [
                  toSafeText(body.category) || null,
                  toSafeText(body.medicine_type) || null,
                  toSafeText(body.supplier_name) || null,
                  toSafeText(body.dosage_strength) || null,
                  toSafeText(body.unit_of_measure) || null,
                  Math.max(0, toSafeInt(body.stock_capacity, 0)) || null,
                  Math.max(0, toSafeInt(body.low_stock_threshold, 0)) || null,
                  Math.max(0, toSafeInt(body.reorder_level, 0)) || null,
                  toSafeIsoDate(body.expiry_date),
                  toSafeText(body.stock_location) || null,
                  toSafeText(body.storage_requirements) || null,
                  medicineId
                ]
              );
              if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                writeJson(res, 404, { ok: false, message: 'Medicine not found.' });
                return;
              }
              await insertPharmacyLog('UPDATE_MEDICINE', `${String((updatedRows as Array<{ medicine_name: string }>)[0].medicine_name)} updated`, actor, 'success');
              await evaluatePharmacyAlerts(medicineId);
              writeJson(res, 200, { ok: true, message: 'Medicine updated.' });
              return;
            }

            if (action === 'archive_medicine') {
              if (!medicineId) {
                writeJson(res, 422, { ok: false, message: 'medicine_id is required.' });
                return;
              }
              const rows = (await sql.query(
                `UPDATE pharmacy_medicines
                 SET is_archived = TRUE, updated_at = NOW()
                 WHERE id = $1 AND is_archived = FALSE
                 RETURNING id, medicine_name, stock_on_hand, batch_lot_no, stock_location`,
                [medicineId]
              )) as Array<{ id: number; medicine_name: string; stock_on_hand: number; batch_lot_no: string | null; stock_location: string | null }>;
              const archived = rows[0];
              if (!archived) {
                writeJson(res, 404, { ok: false, message: 'Medicine not found.' });
                return;
              }
              await insertPharmacyMovement(
                archived.id,
                'archive',
                0,
                Number(archived.stock_on_hand || 0),
                Number(archived.stock_on_hand || 0),
                'Medicine archived',
                archived.batch_lot_no || null,
                archived.stock_location || null,
                actor
              );
              await insertPharmacyLog('ARCHIVE_MEDICINE', `${archived.medicine_name} archived`, actor, 'info');
              writeJson(res, 200, { ok: true, message: 'Medicine archived.' });
              return;
            }

            if (action === 'restock') {
              if (!medicineId) {
                writeJson(res, 422, { ok: false, message: 'medicine_id is required.' });
                return;
              }
              const quantity = Math.max(0, toSafeInt(body.quantity, 0));
              if (!quantity) {
                writeJson(res, 422, { ok: false, message: 'quantity must be greater than 0.' });
                return;
              }
              const reason = toSafeText(body.reason);
              if (!reason) {
                writeJson(res, 422, { ok: false, message: 'reason is required.' });
                return;
              }

              await sql.query('BEGIN');
              try {
                const rows = (await sql.query(
                  `SELECT id, medicine_name, stock_on_hand, batch_lot_no, stock_location
                   FROM pharmacy_medicines
                   WHERE id = $1 AND is_archived = FALSE
                   LIMIT 1`,
                  [medicineId]
                )) as Array<{ id: number; medicine_name: string; stock_on_hand: number; batch_lot_no: string | null; stock_location: string | null }>;
                const medicine = rows[0];
                if (!medicine) {
                  await sql.query('ROLLBACK');
                  writeJson(res, 404, { ok: false, message: 'Medicine not found.' });
                  return;
                }
                const before = Number(medicine.stock_on_hand || 0);
                const after = before + quantity;
                await sql.query(
                  `UPDATE pharmacy_medicines
                   SET stock_on_hand = $1,
                       supplier_name = COALESCE($2, supplier_name),
                       batch_lot_no = COALESCE($3, batch_lot_no),
                       expiry_date = COALESCE($4::date, expiry_date),
                       purchase_cost = COALESCE($5, purchase_cost),
                       stock_location = COALESCE($6, stock_location),
                       updated_at = NOW()
                   WHERE id = $7`,
                  [
                    after,
                    toSafeText(body.supplier_name) || null,
                    toSafeText(body.batch_lot_no) || null,
                    toSafeIsoDate(body.expiry_date),
                    toSafeMoney(body.purchase_cost, 0) || null,
                    toSafeText(body.stock_location) || null,
                    medicineId
                  ]
                );
                await insertPharmacyMovement(
                  medicineId,
                  'restock',
                  quantity,
                  before,
                  after,
                  reason,
                  toSafeText(body.batch_lot_no) || medicine.batch_lot_no || null,
                  toSafeText(body.stock_location) || medicine.stock_location || null,
                  actor
                );
                await insertPharmacyLog('RESTOCK', `${medicine.medicine_name} restocked +${quantity}`, actor, 'success');
                await sql.query('COMMIT');
              } catch (error) {
                await sql.query('ROLLBACK');
                throw error;
              }

              await evaluatePharmacyAlerts(medicineId);
              writeJson(res, 200, { ok: true, message: 'Medicine restocked.' });
              return;
            }

            if (action === 'dispense') {
              if (!medicineId) {
                writeJson(res, 422, { ok: false, message: 'medicine_id is required.' });
                return;
              }
              const patientName = toSafeText(body.patient_name);
              const prescriptionReference = toSafeText(body.prescription_reference);
              const dispenseReason = toSafeText(body.dispense_reason);
              const quantity = Math.max(0, toSafeInt(body.quantity, 0));
              if (!patientName || !prescriptionReference || !dispenseReason || !quantity) {
                writeJson(res, 422, { ok: false, message: 'patient_name, quantity, prescription_reference, and dispense_reason are required.' });
                return;
              }

              await sql.query('BEGIN');
              try {
                const rows = (await sql.query(
                  `SELECT id, medicine_name, stock_on_hand, batch_lot_no, stock_location
                   FROM pharmacy_medicines
                   WHERE id = $1 AND is_archived = FALSE
                   LIMIT 1`,
                  [medicineId]
                )) as Array<{ id: number; medicine_name: string; stock_on_hand: number; batch_lot_no: string | null; stock_location: string | null }>;
                const medicine = rows[0];
                if (!medicine) {
                  await sql.query('ROLLBACK');
                  writeJson(res, 404, { ok: false, message: 'Medicine not found.' });
                  return;
                }

                const before = Number(medicine.stock_on_hand || 0);
                if (before < quantity) {
                  await sql.query('ROLLBACK');
                  writeJson(res, 422, { ok: false, message: `Insufficient stock. Available: ${before}` });
                  return;
                }
                const after = before - quantity;
                await sql.query(
                  `UPDATE pharmacy_medicines
                   SET stock_on_hand = $1, updated_at = NOW()
                   WHERE id = $2`,
                  [after, medicineId]
                );

                const requestCode = `DSP-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;
                await sql.query(
                  `INSERT INTO pharmacy_dispense_requests (
                      request_code, medicine_id, patient_name, quantity, notes, prescription_reference, dispense_reason, status, requested_at, fulfilled_at, fulfilled_by
                   )
                   VALUES ($1,$2,$3,$4,$5,$6,$7,'Fulfilled', NOW(), NOW(), $8)`,
                  [
                    requestCode,
                    medicineId,
                    patientName,
                    quantity,
                    toSafeText(body.notes) || null,
                    prescriptionReference,
                    dispenseReason,
                    actor
                  ]
                );

                await insertPharmacyMovement(
                  medicineId,
                  'dispense',
                  -quantity,
                  before,
                  after,
                  `Dispensed for ${patientName}`,
                  medicine.batch_lot_no || null,
                  medicine.stock_location || null,
                  actor
                );
                await insertPharmacyLog('DISPENSE', `${medicine.medicine_name} dispensed -${quantity} for ${patientName}`, actor, 'info');
                await sql.query('COMMIT');
              } catch (error) {
                await sql.query('ROLLBACK');
                throw error;
              }

              await evaluatePharmacyAlerts(medicineId);
              writeJson(res, 200, { ok: true, message: 'Medicine dispensed.' });
              return;
            }

            if (action === 'adjust_stock') {
              if (!medicineId) {
                writeJson(res, 422, { ok: false, message: 'medicine_id is required.' });
                return;
              }
              const mode = toSafeText(body.mode).toLowerCase();
              const quantity = Math.max(0, toSafeInt(body.quantity, 0));
              const reason = toSafeText(body.reason);
              if (!['increase', 'decrease', 'set'].includes(mode) || !reason) {
                writeJson(res, 422, { ok: false, message: 'mode and reason are required.' });
                return;
              }

              const rows = (await sql.query(
                `SELECT id, medicine_name, stock_on_hand, batch_lot_no, stock_location
                 FROM pharmacy_medicines
                 WHERE id = $1 AND is_archived = FALSE
                 LIMIT 1`,
                [medicineId]
              )) as Array<{ id: number; medicine_name: string; stock_on_hand: number; batch_lot_no: string | null; stock_location: string | null }>;
              const medicine = rows[0];
              if (!medicine) {
                writeJson(res, 404, { ok: false, message: 'Medicine not found.' });
                return;
              }

              const before = Number(medicine.stock_on_hand || 0);
              let after = before;
              if (mode === 'increase') after = before + quantity;
              if (mode === 'decrease') after = Math.max(0, before - quantity);
              if (mode === 'set') after = quantity;
              const delta = after - before;

              await sql.query(
                `UPDATE pharmacy_medicines
                 SET stock_on_hand = $1, updated_at = NOW()
                 WHERE id = $2`,
                [after, medicineId]
              );
              await insertPharmacyMovement(
                medicineId,
                'adjust',
                delta,
                before,
                after,
                reason,
                medicine.batch_lot_no || null,
                medicine.stock_location || null,
                actor
              );
              await insertPharmacyLog('ADJUST', `${medicine.medicine_name} adjusted ${before} -> ${after} (${reason})`, actor, 'info');
              await evaluatePharmacyAlerts(medicineId);
              writeJson(res, 200, { ok: true, message: 'Stock adjusted.' });
              return;
            }

            if (action === 'fulfill_request') {
              const requestId = toSafeInt(body.request_id, 0);
              if (!requestId) {
                writeJson(res, 422, { ok: false, message: 'request_id is required.' });
                return;
              }

              await sql.query('BEGIN');
              try {
                const requestRows = (await sql.query(
                  `SELECT r.id, r.medicine_id, r.quantity, r.patient_name, r.status, m.medicine_name, m.stock_on_hand, m.batch_lot_no, m.stock_location
                   FROM pharmacy_dispense_requests r
                   JOIN pharmacy_medicines m ON m.id = r.medicine_id
                   WHERE r.id = $1
                   LIMIT 1`,
                  [requestId]
                )) as Array<{
                  id: number;
                  medicine_id: number;
                  quantity: number;
                  patient_name: string;
                  status: string;
                  medicine_name: string;
                  stock_on_hand: number;
                  batch_lot_no: string | null;
                  stock_location: string | null;
                }>;
                const request = requestRows[0];
                if (!request) {
                  await sql.query('ROLLBACK');
                  writeJson(res, 404, { ok: false, message: 'Request not found.' });
                  return;
                }
                if (String(request.status) !== 'Pending') {
                  await sql.query('ROLLBACK');
                  writeJson(res, 422, { ok: false, message: 'Only pending requests can be fulfilled.' });
                  return;
                }
                const before = Number(request.stock_on_hand || 0);
                const qty = Math.max(0, Number(request.quantity || 0));
                if (before < qty) {
                  await sql.query('ROLLBACK');
                  writeJson(res, 422, { ok: false, message: `Insufficient stock. Available: ${before}` });
                  return;
                }
                const after = before - qty;

                await sql.query(`UPDATE pharmacy_medicines SET stock_on_hand = $1, updated_at = NOW() WHERE id = $2`, [after, request.medicine_id]);
                await sql.query(
                  `UPDATE pharmacy_dispense_requests
                   SET status = 'Fulfilled', fulfilled_at = NOW(), fulfilled_by = $1
                   WHERE id = $2`,
                  [actor, request.id]
                );
                await insertPharmacyMovement(
                  request.medicine_id,
                  'dispense',
                  -qty,
                  before,
                  after,
                  `Request #${request.id} fulfilled for ${request.patient_name}`,
                  request.batch_lot_no || null,
                  request.stock_location || null,
                  actor
                );
                await insertPharmacyLog('FULFILL_REQUEST', `Request #${request.id} fulfilled (${request.medicine_name} -${qty})`, actor, 'success');
                await sql.query('COMMIT');
                await evaluatePharmacyAlerts(request.medicine_id);
                writeJson(res, 200, { ok: true, message: 'Request fulfilled.' });
                return;
              } catch (error) {
                await sql.query('ROLLBACK');
                throw error;
              }
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported pharmacy action.' });
            return;
          }

          if (url.pathname === '/api/mental-health' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureMentalHealthTables(sql);

            const seededRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM mental_health_sessions`)) as Array<{ total: number }>;
            if (Number(seededRows[0]?.total || 0) === 0) {
              await sql.query(
                `INSERT INTO mental_health_patients (patient_id, patient_name, date_of_birth, sex, contact_number, guardian_contact)
                 VALUES
                  ('PAT-3401', 'Maria Santos', '1990-03-14', 'Female', '0917-123-4411', NULL),
                  ('PAT-3119', 'John Reyes', '1989-10-05', 'Male', '0918-223-8842', 'Luz Reyes - 0917-992-1113'),
                  ('PAT-2977', 'Emma Tan', '1997-07-21', 'Female', '0919-664-9012', NULL),
                  ('PAT-2509', 'Lara Gomez', '1995-12-09', 'Female', '0921-441-0023', NULL)
                 ON CONFLICT (patient_id) DO NOTHING`
              );

              await sql.query(
                `INSERT INTO mental_health_sessions (
                    case_reference, patient_id, patient_name, counselor, session_type, status, risk_level, diagnosis_condition, treatment_plan,
                    session_goals, session_duration_minutes, session_mode, location_room, guardian_contact, emergency_contact, medication_reference,
                    follow_up_frequency, escalation_reason, outcome_result, assessment_score, assessment_tool, appointment_at, next_follow_up_at, created_by_role
                 ) VALUES
                    ('MHS-2026-2401', 'PAT-3401', 'Maria Santos', 'Dr. Rivera', 'Individual Counseling', 'active', 'medium', 'Generalized anxiety', 'CBT + sleep hygiene', 'Reduce panic episodes', 50, 'in_person', 'Room MH-2', NULL, 'Mario Santos - 0917-223-1201', 'Sertraline 25mg OD', 'Weekly', NULL, NULL, 14, 'GAD-7', NOW() - INTERVAL '2 day', NOW() + INTERVAL '5 day', 'Counselor'),
                    ('MHS-2026-2397', 'PAT-3119', 'John Reyes', 'Dr. Molina', 'Substance Recovery', 'at_risk', 'high', 'Alcohol use disorder', 'Relapse prevention counseling', 'Prevent relapse in 30 days', 60, 'in_person', 'Recovery Room 1', 'Luz Reyes - 0917-992-1113', 'Luz Reyes - 0917-992-1113', 'Naltrexone 50mg', 'Twice Weekly', 'Withdrawal warning signs reported by family', NULL, 19, 'PHQ-9', NOW() - INTERVAL '1 day', NOW() + INTERVAL '2 day', 'Counselor'),
                    ('MHS-2026-2389', 'PAT-2977', 'Emma Tan', 'Dr. Rivera', 'Family Session', 'follow_up', 'low', 'Adjustment disorder', 'Family support mapping', 'Improve family communication', 45, 'online', NULL, 'Angela Tan - 0917-991-5511', 'Angela Tan - 0917-991-5511', NULL, 'Bi-weekly', NULL, 'Improved self-report mood', 7, 'PHQ-9', NOW() - INTERVAL '4 day', NOW() + INTERVAL '6 day', 'Counselor')
                 ON CONFLICT (case_reference) DO NOTHING`
              );

              await sql.query(
                `INSERT INTO mental_health_notes (session_id, note_type, note_content, clinical_score, attachment_name, attachment_url, created_by_role)
                 SELECT s.id, 'Progress', 'Patient reports improved sleep and reduced anxiety episodes.', 12, 'sleep-journal.pdf', '/files/sleep-journal.pdf', 'Counselor'
                 FROM mental_health_sessions s
                 WHERE s.case_reference = 'MHS-2026-2401'
                 ON CONFLICT DO NOTHING`
              );

              await sql.query(
                `INSERT INTO mental_health_activity_logs (session_id, action, detail, actor_role)
                 SELECT s.id, 'SESSION_CREATED', 'Session created and set to active workflow.', 'Counselor'
                 FROM mental_health_sessions s
                 WHERE s.case_reference = 'MHS-2026-2401'
                 ON CONFLICT DO NOTHING`
              );
            }

            const sessions = await sql.query(
              `SELECT id, case_reference, patient_id, patient_name, counselor, session_type, status, risk_level, diagnosis_condition, treatment_plan,
                      session_goals, session_duration_minutes, session_mode, location_room, guardian_contact, emergency_contact, medication_reference,
                      follow_up_frequency, escalation_reason, outcome_result, assessment_score, assessment_tool, appointment_at, next_follow_up_at,
                      created_by_role, is_draft, created_at, updated_at
               FROM mental_health_sessions
               ORDER BY updated_at DESC`
            );

            const patients = await sql.query(
              `SELECT p.patient_id, p.patient_name,
                      COUNT(s.id)::int AS previous_sessions,
                      MAX(s.case_reference) AS latest_case_reference
               FROM mental_health_patients p
               LEFT JOIN mental_health_sessions s ON s.patient_id = p.patient_id
               GROUP BY p.patient_id, p.patient_name
               ORDER BY p.patient_name ASC`
            );

            const notes = await sql.query(
              `SELECT id, session_id, note_type, note_content, clinical_score, attachment_name, attachment_url, created_by_role, created_at
               FROM mental_health_notes
               ORDER BY created_at DESC
               LIMIT 500`
            );

            const activities = await sql.query(
              `SELECT id, session_id, action, detail, actor_role, created_at
               FROM mental_health_activity_logs
               ORDER BY created_at DESC
               LIMIT 500`
            );

            const analyticsRows = (await sql.query(`
              SELECT
                COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                COUNT(*) FILTER (WHERE status = 'follow_up')::int AS follow_up,
                COUNT(*) FILTER (WHERE status = 'at_risk')::int AS at_risk,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'escalated')::int AS escalated,
                COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
              FROM mental_health_sessions
            `)) as Array<{ active: number; follow_up: number; at_risk: number; completed: number; escalated: number; archived: number }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                sessions: Array.isArray(sessions) ? sessions : [],
                patients: Array.isArray(patients) ? patients : [],
                notes: Array.isArray(notes) ? notes : [],
                activities: Array.isArray(activities) ? activities : [],
                analytics: analyticsRows[0] || { active: 0, follow_up: 0, at_risk: 0, completed: 0, escalated: 0, archived: 0 }
              }
            });
            return;
          }

          if (url.pathname === '/api/mental-health' && (req.method || '').toUpperCase() === 'POST') {
            await ensureMentalHealthTables(sql);

            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();
            const role = toSafeText(body.role) || 'Counselor';
            const allowedActions = mentalHealthAllowedActions[role] || [];
            if (!allowedActions.includes(action)) {
              writeJson(res, 403, { ok: false, message: `Role ${role} cannot perform ${action || 'this action'}.` });
              return;
            }

            const sessionId = toSafeInt(body.session_id, 0);
            const saveActivity = async (id: number | null, name: string, detail: string): Promise<void> => {
              await sql.query(
                `INSERT INTO mental_health_activity_logs (session_id, action, detail, actor_role)
                 VALUES ($1, $2, $3, $4)`,
                [id, name, detail, role]
              );
              await insertModuleActivity('mental_health', name, detail, role, 'mental_session', id ? String(id) : null);
            };

            if (action === 'save_draft') {
              await saveActivity(sessionId || null, 'DRAFT_SAVED', toSafeText(body.detail) || 'Draft saved');
              writeJson(res, 200, { ok: true, message: 'Draft saved.' });
              return;
            }

            if (action === 'create_session') {
              const patientId = toSafeText(body.patient_id);
              const patientName = toSafeText(body.patient_name);
              const counselor = toSafeText(body.counselor);
              const sessionType = toSafeText(body.session_type);
              const appointmentAt = toSafeText(body.appointment_at);
              const sessionMode = (toSafeText(body.session_mode) || 'in_person').toLowerCase();
              const riskLevel = (toSafeText(body.risk_level) || 'low').toLowerCase();
              const isDraft = Boolean(body.is_draft);

              if (!patientId || !patientName || !sessionType || !counselor || !appointmentAt) {
                writeJson(res, 422, { ok: false, message: 'patient_id, patient_name, session_type, counselor, and appointment_at are required.' });
                return;
              }
              if (!['in_person', 'online'].includes(sessionMode)) {
                writeJson(res, 422, { ok: false, message: 'session_mode must be in_person or online.' });
                return;
              }
              if (!['low', 'medium', 'high'].includes(riskLevel)) {
                writeJson(res, 422, { ok: false, message: 'risk_level must be low, medium, or high.' });
                return;
              }
              const locationRoom = toSafeText(body.location_room);
              if (sessionMode === 'in_person' && !locationRoom) {
                writeJson(res, 422, { ok: false, message: 'location_room is required for in-person sessions.' });
                return;
              }
              const guardianContact = toSafeText(body.guardian_contact);
              if ((sessionType.toLowerCase().includes('family') || sessionType.toLowerCase().includes('youth')) && !guardianContact) {
                writeJson(res, 422, { ok: false, message: 'guardian_contact is required for family or youth sessions.' });
                return;
              }

              await sql.query(
                `INSERT INTO mental_health_patients (patient_id, patient_name, guardian_contact)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (patient_id) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     guardian_contact = COALESCE(EXCLUDED.guardian_contact, mental_health_patients.guardian_contact),
                     updated_at = NOW()`,
                [patientId, patientName, guardianContact || null]
              );

              const serial = Math.floor(1000 + Math.random() * 9000);
              const caseReference = `MHS-${new Date().getFullYear()}-${serial}`;
              const status = isDraft ? 'create' : riskLevel === 'high' ? 'at_risk' : 'active';

              const created = (await sql.query(
                `INSERT INTO mental_health_sessions (
                    case_reference, patient_id, patient_name, counselor, session_type, status, risk_level, diagnosis_condition, treatment_plan, session_goals,
                    session_duration_minutes, session_mode, location_room, guardian_contact, emergency_contact, medication_reference, follow_up_frequency,
                    escalation_reason, outcome_result, assessment_score, assessment_tool, appointment_at, next_follow_up_at, created_by_role, is_draft
                 )
                 VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    $11,$12,$13,$14,$15,$16,$17,
                    $18,$19,$20,$21,$22::timestamp,$23::timestamp,$24,$25
                 )
                 RETURNING id, case_reference`,
                [
                  caseReference,
                  patientId,
                  patientName,
                  counselor,
                  sessionType,
                  status,
                  riskLevel,
                  toSafeText(body.diagnosis_condition) || null,
                  toSafeText(body.treatment_plan) || null,
                  toSafeText(body.session_goals) || null,
                  Math.max(15, toSafeInt(body.session_duration_minutes, 45)),
                  sessionMode,
                  locationRoom || null,
                  guardianContact || null,
                  toSafeText(body.emergency_contact) || null,
                  toSafeText(body.medication_reference) || null,
                  toSafeText(body.follow_up_frequency) || null,
                  toSafeText(body.escalation_reason) || null,
                  toSafeText(body.outcome_result) || null,
                  Number(body.assessment_score ?? null),
                  toSafeText(body.assessment_tool) || null,
                  appointmentAt,
                  toSafeText(body.next_follow_up_at) || null,
                  role,
                  isDraft
                ]
              )) as Array<{ id: number; case_reference: string }>;
              const row = created[0];
              await saveActivity(row.id, 'SESSION_CREATED', `Session ${row.case_reference} created with status ${status}.`);
              if (riskLevel === 'high') {
                await saveActivity(row.id, 'RISK_AUTO_UPDATE', 'Risk level high; status auto-updated to at_risk.');
              }
              writeJson(res, 200, { ok: true, message: 'Session created.' });
              return;
            }

            const existingRows = (await sql.query(
              `SELECT id, case_reference, status, risk_level
               FROM mental_health_sessions
               WHERE id = $1
               LIMIT 1`,
              [sessionId]
            )) as Array<{ id: number; case_reference: string; status: string; risk_level: string }>;
            const existing = existingRows[0];
            if (!existing && action !== 'create_session') {
              writeJson(res, 404, { ok: false, message: 'Session not found.' });
              return;
            }

            if (action === 'update_session') {
              const nextRisk = (toSafeText(body.risk_level) || existing.risk_level || 'low').toLowerCase();
              const nextStatus =
                toSafeText(body.status) ||
                (nextRisk === 'high' && ['create', 'active', 'follow_up'].includes(existing.status) ? 'at_risk' : existing.status);

              await sql.query(
                `UPDATE mental_health_sessions
                 SET counselor = COALESCE($1, counselor),
                     session_type = COALESCE($2, session_type),
                     status = COALESCE($3, status),
                     risk_level = COALESCE($4, risk_level),
                     diagnosis_condition = COALESCE($5, diagnosis_condition),
                     treatment_plan = COALESCE($6, treatment_plan),
                     session_goals = COALESCE($7, session_goals),
                     session_duration_minutes = COALESCE($8, session_duration_minutes),
                     session_mode = COALESCE($9, session_mode),
                     location_room = COALESCE($10, location_room),
                     guardian_contact = COALESCE($11, guardian_contact),
                     emergency_contact = COALESCE($12, emergency_contact),
                     medication_reference = COALESCE($13, medication_reference),
                     follow_up_frequency = COALESCE($14, follow_up_frequency),
                     assessment_score = COALESCE($15, assessment_score),
                     assessment_tool = COALESCE($16, assessment_tool),
                     escalation_reason = COALESCE($17, escalation_reason),
                     outcome_result = COALESCE($18, outcome_result),
                     appointment_at = COALESCE($19::timestamp, appointment_at),
                     updated_at = NOW()
                 WHERE id = $20`,
                [
                  toSafeText(body.counselor) || null,
                  toSafeText(body.session_type) || null,
                  toSafeText(nextStatus) || null,
                  toSafeText(nextRisk) || null,
                  toSafeText(body.diagnosis_condition) || null,
                  toSafeText(body.treatment_plan) || null,
                  toSafeText(body.session_goals) || null,
                  toSafeInt(body.session_duration_minutes, 0) || null,
                  toSafeText(body.session_mode) || null,
                  toSafeText(body.location_room) || null,
                  toSafeText(body.guardian_contact) || null,
                  toSafeText(body.emergency_contact) || null,
                  toSafeText(body.medication_reference) || null,
                  toSafeText(body.follow_up_frequency) || null,
                  Number(body.assessment_score ?? null),
                  toSafeText(body.assessment_tool) || null,
                  toSafeText(body.escalation_reason) || null,
                  toSafeText(body.outcome_result) || null,
                  toSafeText(body.appointment_at) || null,
                  sessionId
                ]
              );
              await saveActivity(sessionId, 'SESSION_UPDATED', `Session ${existing.case_reference} updated.`);
              if (nextRisk === 'high') {
                await saveActivity(sessionId, 'RISK_AUTO_UPDATE', 'Risk level high; status set to at_risk.');
              }
              writeJson(res, 200, { ok: true, message: 'Session updated.' });
              return;
            }

            if (action === 'record_note') {
              const noteContent = toSafeText(body.note_content);
              if (!noteContent) {
                writeJson(res, 422, { ok: false, message: 'note_content is required.' });
                return;
              }
              await sql.query(
                `INSERT INTO mental_health_notes (session_id, note_type, note_content, clinical_score, attachment_name, attachment_url, created_by_role)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                [
                  sessionId,
                  toSafeText(body.note_type) || 'Progress',
                  noteContent,
                  Number(body.clinical_score ?? null),
                  toSafeText(body.attachment_name) || null,
                  toSafeText(body.attachment_url) || null,
                  role
                ]
              );

              if (Boolean(body.mark_at_risk)) {
                await sql.query(
                  `UPDATE mental_health_sessions
                   SET status = 'at_risk',
                       risk_level = 'high',
                       updated_at = NOW()
                   WHERE id = $1`,
                  [sessionId]
                );
                await saveActivity(sessionId, 'RISK_FLAGGED', `Marked at risk from note entry (${role}).`);
              }

              await saveActivity(sessionId, 'NOTE_RECORDED', `Structured note recorded: ${toSafeText(body.note_type) || 'Progress'}.`);
              writeJson(res, 200, { ok: true, message: 'Note recorded.' });
              return;
            }

            if (action === 'schedule_followup') {
              const nextFollowUp = toSafeText(body.next_follow_up_at);
              const followUpFrequency = toSafeText(body.follow_up_frequency);
              if (!nextFollowUp || !followUpFrequency) {
                writeJson(res, 422, { ok: false, message: 'next_follow_up_at and follow_up_frequency are required.' });
                return;
              }
              await sql.query(
                `UPDATE mental_health_sessions
                 SET status = CASE WHEN status IN ('completed', 'archived') THEN status ELSE 'follow_up' END,
                     next_follow_up_at = $1::timestamp,
                     follow_up_frequency = $2,
                     updated_at = NOW()
                 WHERE id = $3`,
                [nextFollowUp, followUpFrequency, sessionId]
              );
              await saveActivity(sessionId, 'FOLLOW_UP_PLANNED', `Follow-up scheduled (${followUpFrequency}).`);
              writeJson(res, 200, { ok: true, message: 'Follow-up scheduled.' });
              return;
            }

            if (action === 'set_at_risk') {
              const escalationReason = toSafeText(body.escalation_reason);
              await sql.query(
                `UPDATE mental_health_sessions
                 SET status = 'at_risk',
                     risk_level = 'high',
                     escalation_reason = COALESCE($1, escalation_reason),
                     updated_at = NOW()
                 WHERE id = $2`,
                [escalationReason || null, sessionId]
              );
              await saveActivity(sessionId, 'AT_RISK', 'Session flagged as at_risk.');
              writeJson(res, 200, { ok: true, message: 'Session marked as at risk.' });
              return;
            }

            if (action === 'complete_session') {
              const outcomeResult = toSafeText(body.outcome_result);
              if (!outcomeResult) {
                writeJson(res, 422, { ok: false, message: 'outcome_result is required before completion.' });
                return;
              }
              await sql.query(
                `UPDATE mental_health_sessions
                 SET status = 'completed',
                     outcome_result = $1,
                     is_draft = FALSE,
                     updated_at = NOW()
                 WHERE id = $2`,
                [outcomeResult, sessionId]
              );
              await saveActivity(sessionId, 'SESSION_COMPLETED', 'Session completed.');
              writeJson(res, 200, { ok: true, message: 'Session completed.' });
              return;
            }

            if (action === 'escalate_session') {
              const escalationReason = toSafeText(body.escalation_reason);
              if (!escalationReason) {
                writeJson(res, 422, { ok: false, message: 'escalation_reason is required.' });
                return;
              }
              await sql.query(
                `UPDATE mental_health_sessions
                 SET status = 'escalated',
                     risk_level = 'high',
                     escalation_reason = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [escalationReason, sessionId]
              );
              await saveActivity(sessionId, 'SESSION_ESCALATED', 'Session escalated for urgent intervention.');
              writeJson(res, 200, { ok: true, message: 'Session escalated.' });
              return;
            }

            if (action === 'archive_session') {
              if (!['completed', 'escalated'].includes(existing.status)) {
                writeJson(res, 422, { ok: false, message: 'Only completed or escalated sessions can be archived.' });
                return;
              }
              await sql.query(
                `UPDATE mental_health_sessions
                 SET status = 'archived',
                     archived_at = NOW(),
                     updated_at = NOW()
                 WHERE id = $1`,
                [sessionId]
              );
              await saveActivity(sessionId, 'SESSION_ARCHIVED', 'Session archived.');
              writeJson(res, 200, { ok: true, message: 'Session archived.' });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported mental health action.' });
            return;
          }

          if (url.pathname === '/api/patients' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientMasterTables(sql);

            const tableExists = async (tableName: string): Promise<boolean> => {
              const rows = (await sql.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`])) as Array<{ reg: string | null }>;
              return Boolean(rows[0]?.reg);
            };

            const forceSync = toSafeText(url.searchParams.get('sync')) === '1';
            const masterCountRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM patient_master`)) as Array<{ total: number }>;
            const masterCount = Number(masterCountRows[0]?.total || 0);
            const shouldSync = forceSync || masterCount === 0;

            if (shouldSync) {
              const mergeTags = `ARRAY(SELECT DISTINCT tag FROM unnest(COALESCE(patient_master.source_tags, ARRAY[]::TEXT[]) || EXCLUDED.source_tags) AS tag)`;

              if (await tableExists('patient_appointments')) {
                await sql.query(
                  `INSERT INTO patient_master (
                    patient_code, patient_name, identity_key, email, contact, sex, age, emergency_contact, latest_status, risk_level, source_tags, last_seen_at
                 )
                 SELECT
                    COALESCE(NULLIF(TRIM(COALESCE(patient_id, '')), ''), 'PAT-A-' || id::text),
                    patient_name,
                    LOWER(TRIM(patient_name)) || '|' || COALESCE(regexp_replace(phone_number, '[^0-9]', '', 'g'), ''),
                    NULLIF(TRIM(COALESCE(patient_email, '')), ''),
                    NULLIF(TRIM(COALESCE(phone_number, '')), ''),
                    NULLIF(TRIM(COALESCE(patient_gender, '')), ''),
                    patient_age,
                    NULLIF(TRIM(COALESCE(emergency_contact, '')), ''),
                    LOWER(COALESCE(status, 'pending')),
                    CASE WHEN LOWER(COALESCE(appointment_priority, 'routine')) = 'urgent' THEN 'medium' ELSE 'low' END,
                    ARRAY['appointments'],
                    COALESCE(updated_at, created_at, NOW())
                 FROM patient_appointments
                 WHERE COALESCE(TRIM(patient_name), '') <> ''
                 ON CONFLICT (identity_key) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     email = COALESCE(EXCLUDED.email, patient_master.email),
                     contact = COALESCE(EXCLUDED.contact, patient_master.contact),
                     sex = COALESCE(EXCLUDED.sex, patient_master.sex),
                     age = COALESCE(EXCLUDED.age, patient_master.age),
                     emergency_contact = COALESCE(EXCLUDED.emergency_contact, patient_master.emergency_contact),
                     latest_status = EXCLUDED.latest_status,
                     risk_level = CASE
                       WHEN EXCLUDED.risk_level = 'high' OR patient_master.risk_level = 'high' THEN 'high'
                       WHEN EXCLUDED.risk_level = 'medium' OR patient_master.risk_level = 'medium' THEN 'medium'
                       ELSE 'low'
                     END,
                     source_tags = ${mergeTags},
                     last_seen_at = GREATEST(COALESCE(patient_master.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                     updated_at = NOW()`
                );
              }

              if (await tableExists('patient_walkins')) {
                await sql.query(
                  `INSERT INTO patient_master (
                    patient_code, patient_name, identity_key, contact, sex, date_of_birth, age, emergency_contact, latest_status, risk_level, source_tags, last_seen_at
                 )
                 SELECT
                    COALESCE(NULLIF(TRIM(COALESCE(patient_ref, '')), ''), 'PAT-W-' || id::text),
                    patient_name,
                    LOWER(TRIM(patient_name)) || '|' || COALESCE(regexp_replace(contact, '[^0-9]', '', 'g'), ''),
                    NULLIF(TRIM(COALESCE(contact, '')), ''),
                    NULLIF(TRIM(COALESCE(sex, '')), ''),
                    date_of_birth,
                    age,
                    NULLIF(TRIM(COALESCE(emergency_contact, '')), ''),
                    LOWER(COALESCE(status, 'waiting')),
                    CASE WHEN LOWER(COALESCE(severity, 'low')) = 'emergency' THEN 'high' WHEN LOWER(COALESCE(severity, 'low')) = 'moderate' THEN 'medium' ELSE 'low' END,
                    ARRAY['walkin'],
                    COALESCE(updated_at, created_at, NOW())
                 FROM patient_walkins
                 WHERE COALESCE(TRIM(patient_name), '') <> ''
                 ON CONFLICT (identity_key) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     contact = COALESCE(EXCLUDED.contact, patient_master.contact),
                     sex = COALESCE(EXCLUDED.sex, patient_master.sex),
                     date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_master.date_of_birth),
                     age = COALESCE(EXCLUDED.age, patient_master.age),
                     emergency_contact = COALESCE(EXCLUDED.emergency_contact, patient_master.emergency_contact),
                     latest_status = EXCLUDED.latest_status,
                     risk_level = CASE
                       WHEN EXCLUDED.risk_level = 'high' OR patient_master.risk_level = 'high' THEN 'high'
                       WHEN EXCLUDED.risk_level = 'medium' OR patient_master.risk_level = 'medium' THEN 'medium'
                       ELSE 'low'
                     END,
                     source_tags = ${mergeTags},
                     last_seen_at = GREATEST(COALESCE(patient_master.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                     updated_at = NOW()`
                );
              }

              if (await tableExists('checkup_visits')) {
                await sql.query(
                  `INSERT INTO patient_master (
                    patient_code, patient_name, identity_key, latest_status, risk_level, source_tags, last_seen_at
                 )
                 SELECT
                    'PAT-C-' || id::text,
                    patient_name,
                    LOWER(TRIM(patient_name)) || '|',
                    LOWER(COALESCE(status, 'intake')),
                    CASE WHEN is_emergency THEN 'high' ELSE 'low' END,
                    ARRAY['checkup'],
                    COALESCE(updated_at, created_at, NOW())
                 FROM checkup_visits
                 WHERE COALESCE(TRIM(patient_name), '') <> ''
                 ON CONFLICT (identity_key) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     latest_status = EXCLUDED.latest_status,
                     risk_level = CASE WHEN EXCLUDED.risk_level = 'high' OR patient_master.risk_level = 'high' THEN 'high' ELSE patient_master.risk_level END,
                     source_tags = ${mergeTags},
                     last_seen_at = GREATEST(COALESCE(patient_master.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                     updated_at = NOW()`
                );
              }

              if (await tableExists('mental_health_patients')) {
                await sql.query(
                  `INSERT INTO patient_master (
                    patient_code, patient_name, identity_key, contact, sex, date_of_birth, guardian_contact, latest_status, risk_level, source_tags, last_seen_at
                 )
                 SELECT
                    patient_id,
                    patient_name,
                    LOWER(TRIM(patient_name)) || '|' || COALESCE(regexp_replace(contact_number, '[^0-9]', '', 'g'), ''),
                    NULLIF(TRIM(COALESCE(contact_number, '')), ''),
                    NULLIF(TRIM(COALESCE(sex, '')), ''),
                    date_of_birth,
                    NULLIF(TRIM(COALESCE(guardian_contact, '')), ''),
                    'active',
                    'low',
                    ARRAY['mental'],
                    NOW()
                 FROM mental_health_patients
                 WHERE COALESCE(TRIM(patient_name), '') <> ''
                 ON CONFLICT (identity_key) DO UPDATE
                 SET patient_name = EXCLUDED.patient_name,
                     contact = COALESCE(EXCLUDED.contact, patient_master.contact),
                     sex = COALESCE(EXCLUDED.sex, patient_master.sex),
                     date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_master.date_of_birth),
                     guardian_contact = COALESCE(EXCLUDED.guardian_contact, patient_master.guardian_contact),
                     source_tags = ${mergeTags},
                     last_seen_at = GREATEST(COALESCE(patient_master.last_seen_at, EXCLUDED.last_seen_at), EXCLUDED.last_seen_at),
                     updated_at = NOW()`
                );
              }

              if (await tableExists('mental_health_sessions')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET risk_level = CASE
                   WHEN ms.max_risk = 'high' THEN 'high'
                   WHEN ms.max_risk = 'medium' AND pm.risk_level <> 'high' THEN 'medium'
                   ELSE pm.risk_level
                 END,
                 latest_status = COALESCE(ms.latest_status, pm.latest_status),
                 updated_at = NOW()
                 FROM (
                   SELECT
                     LOWER(TRIM(patient_name)) || '|' AS identity_key_name,
                     MAX(risk_level) FILTER (WHERE risk_level IN ('low', 'medium', 'high')) AS max_risk,
                     (ARRAY_AGG(status ORDER BY updated_at DESC))[1] AS latest_status
                   FROM mental_health_sessions
                   GROUP BY LOWER(TRIM(patient_name))
                 ) ms
                 WHERE pm.identity_key = ms.identity_key_name`
                );
              }

              await sql.query(`UPDATE patient_master SET appointment_count = 0, walkin_count = 0, checkup_count = 0, mental_count = 0, pharmacy_count = 0`);

              if (await tableExists('patient_appointments')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET appointment_count = sub.total
                 FROM (
                   SELECT LOWER(TRIM(patient_name)) || '|' || COALESCE(regexp_replace(phone_number, '[^0-9]', '', 'g'), '') AS identity_key, COUNT(*)::int AS total
                   FROM patient_appointments
                   GROUP BY 1
                 ) sub
                 WHERE pm.identity_key = sub.identity_key`
                );
              }
              if (await tableExists('patient_walkins')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET walkin_count = sub.total
                 FROM (
                   SELECT LOWER(TRIM(patient_name)) || '|' || COALESCE(regexp_replace(contact, '[^0-9]', '', 'g'), '') AS identity_key, COUNT(*)::int AS total
                   FROM patient_walkins
                   GROUP BY 1
                 ) sub
                 WHERE pm.identity_key = sub.identity_key`
                );
              }
              if (await tableExists('checkup_visits')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET checkup_count = sub.total
                 FROM (
                   SELECT LOWER(TRIM(patient_name)) || '|' AS identity_key, COUNT(*)::int AS total
                   FROM checkup_visits
                   GROUP BY 1
                 ) sub
                 WHERE pm.identity_key = sub.identity_key`
                );
              }
              if (await tableExists('mental_health_sessions')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET mental_count = sub.total
                 FROM (
                   SELECT LOWER(TRIM(patient_name)) || '|' AS identity_key, COUNT(*)::int AS total
                   FROM mental_health_sessions
                   GROUP BY 1
                 ) sub
                 WHERE pm.identity_key = sub.identity_key`
                );
              }
              if (await tableExists('pharmacy_dispense_requests')) {
                await sql.query(
                  `UPDATE patient_master pm
                 SET pharmacy_count = sub.total
                 FROM (
                   SELECT LOWER(TRIM(patient_name)) || '|' AS identity_key, COUNT(*)::int AS total
                   FROM pharmacy_dispense_requests
                   GROUP BY 1
                 ) sub
                 WHERE pm.identity_key = sub.identity_key`
                );
              }
            }

            const search = toSafeText(url.searchParams.get('search'));
            const moduleFilter = toSafeText(url.searchParams.get('module')).toLowerCase() || 'all';
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;

            if (search) {
              params.push(`%${search}%`);
              where.push(`(patient_name ILIKE $${idx} OR COALESCE(patient_code,'') ILIKE $${idx} OR COALESCE(contact,'') ILIKE $${idx} OR COALESCE(email,'') ILIKE $${idx})`);
              idx += 1;
            }

            if (moduleFilter === 'appointments') where.push(`appointment_count > 0`);
            if (moduleFilter === 'walkin') where.push(`walkin_count > 0`);
            if (moduleFilter === 'checkup') where.push(`checkup_count > 0`);
            if (moduleFilter === 'mental') where.push(`mental_count > 0`);
            if (moduleFilter === 'pharmacy') where.push(`pharmacy_count > 0`);

            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
            const totalRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM patient_master${whereSql}`, params)) as Array<{ total: number }>;
            const total = Number(totalRows[0]?.total || 0);

            const items = await sql.query(
              `SELECT id, patient_code, patient_name, email, contact, sex, date_of_birth, age, emergency_contact, guardian_contact,
                      latest_status, risk_level, appointment_count, walkin_count, checkup_count, mental_count, pharmacy_count,
                      source_tags, last_seen_at, created_at, updated_at
               FROM patient_master${whereSql}
               ORDER BY COALESCE(last_seen_at, updated_at, created_at) DESC
               LIMIT $${idx} OFFSET $${idx + 1}`,
              [...params, perPage, offset]
            );

            const analytics = (await sql.query(
              `SELECT
                 COUNT(*)::int AS total_patients,
                 COUNT(*) FILTER (WHERE risk_level = 'high')::int AS high_risk,
                 COUNT(*) FILTER (WHERE appointment_count > 0 OR walkin_count > 0 OR checkup_count > 0 OR mental_count > 0 OR pharmacy_count > 0)::int AS active_profiles,
                 COUNT(*) FILTER (WHERE COALESCE(last_seen_at, updated_at, created_at) >= NOW() - INTERVAL '30 day')::int AS active_30_days
               FROM patient_master`
            )) as Array<{ total_patients: number; high_risk: number; active_profiles: number; active_30_days: number }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                analytics: analytics[0] || { total_patients: 0, high_risk: 0, active_profiles: 0, active_30_days: 0 },
                items: Array.isArray(items) ? items : [],
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/patients' && (req.method || '').toUpperCase() === 'POST') {
            await ensurePatientMasterTables(sql);
            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();
            if (action !== 'sync') {
              writeJson(res, 422, { ok: false, message: 'Unsupported patients action.' });
              return;
            }
            await insertModuleActivity(
              'patients',
              'Patient Master Sync Requested',
              'Patient profile sync requested from modules.',
              toSafeText(body.actor) || 'System',
              'patient_master',
              null
            );
            writeJson(res, 200, { ok: true, message: 'Sync requested. Use GET /api/patients to refresh merged profiles.' });
            return;
          }

          if (url.pathname === '/api/module-activity' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureModuleActivityLogsTable(sql);

            const moduleFilter = toSafeText(url.searchParams.get('module')).toLowerCase();
            const actorFilter = toSafeText(url.searchParams.get('actor'));
            const search = toSafeText(url.searchParams.get('search'));
            const page = Math.max(1, toSafeInt(url.searchParams.get('page'), 1));
            const perPage = Math.min(100, Math.max(1, toSafeInt(url.searchParams.get('per_page'), 12)));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;

            if (moduleFilter && moduleFilter !== 'all') {
              params.push(moduleFilter);
              where.push(`LOWER(module) = $${idx}`);
              idx += 1;
            }
            if (actorFilter) {
              params.push(`%${actorFilter}%`);
              where.push(`actor ILIKE $${idx}`);
              idx += 1;
            }
            if (search) {
              params.push(`%${search}%`);
              where.push(`(action ILIKE $${idx} OR detail ILIKE $${idx} OR COALESCE(entity_key, '') ILIKE $${idx})`);
              idx += 1;
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const totalRows = (await sql.query(
              `SELECT COUNT(*)::int AS total FROM module_activity_logs ${whereSql}`,
              params
            )) as Array<{ total: number }>;
            let total = Number(totalRows[0]?.total || 0);

            let rows = await sql.query(
              `SELECT id, module, action, detail, actor, entity_type, entity_key, metadata, created_at::text AS created_at
               FROM module_activity_logs
               ${whereSql}
               ORDER BY created_at DESC
               LIMIT $${idx} OFFSET $${idx + 1}`,
              [...params, perPage, offset]
            );

            // Backward-compatible fallback: show laboratory activity logs even if
            // module_activity_logs has not been populated yet.
            if ((!Array.isArray(rows) || rows.length === 0) && moduleFilter === 'laboratory') {
              await ensureLaboratoryTables(sql);

              const fallbackWhere: string[] = [];
              const fallbackParams: unknown[] = [];
              let fallbackIdx = 1;

              if (actorFilter) {
                fallbackParams.push(`%${actorFilter}%`);
                fallbackWhere.push(`l.actor ILIKE $${fallbackIdx}`);
                fallbackIdx += 1;
              }
              if (search) {
                fallbackParams.push(`%${search}%`);
                fallbackWhere.push(`(l.action ILIKE $${fallbackIdx} OR l.details ILIKE $${fallbackIdx} OR l.request_id::text ILIKE $${fallbackIdx})`);
                fallbackIdx += 1;
              }

              const fallbackWhereSql = fallbackWhere.length ? `WHERE ${fallbackWhere.join(' AND ')}` : '';

              const fallbackTotalRows = (await sql.query(
                `SELECT COUNT(*)::int AS total
                 FROM laboratory_activity_logs l
                 ${fallbackWhereSql}`,
                fallbackParams
              )) as Array<{ total: number }>;
              total = Number(fallbackTotalRows[0]?.total || 0);

              const fallbackRows = await sql.query(
                `SELECT
                   l.id,
                   'laboratory'::text AS module,
                   l.action,
                   l.details AS detail,
                   l.actor,
                   'lab_request'::text AS entity_type,
                   l.request_id::text AS entity_key,
                   '{}'::jsonb AS metadata,
                   l.created_at::text AS created_at
                 FROM laboratory_activity_logs l
                 ${fallbackWhereSql}
                 ORDER BY l.created_at DESC
                 LIMIT $${fallbackIdx} OFFSET $${fallbackIdx + 1}`,
                [...fallbackParams, perPage, offset]
              );
              rows = Array.isArray(fallbackRows) ? fallbackRows : [];
            }

            writeJson(res, 200, {
              ok: true,
              data: {
                items: Array.isArray(rows) ? rows : [],
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/reports' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureModuleActivityLogsTable(sql);
            const tableExists = async (tableName: string): Promise<boolean> => {
              const rows = (await sql.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`])) as Array<{ reg: string | null }>;
              return Boolean(rows[0]?.reg);
            };
            const hasPatientMaster = await tableExists('patient_master');
            const hasAppointments = await tableExists('patient_appointments');
            const hasWalkins = await tableExists('patient_walkins');
            const hasCheckups = await tableExists('checkup_visits');
            const hasMentalSessions = await tableExists('mental_health_sessions');
            const hasPharmacyDispense = await tableExists('pharmacy_dispense_requests');
            const hasModuleActivity = await tableExists('module_activity_logs');

            const requestedFrom = toSafeIsoDate(url.searchParams.get('from'));
            const requestedTo = toSafeIsoDate(url.searchParams.get('to'));
            const endDate = requestedTo ? new Date(requestedTo) : new Date();
            const startDate = requestedFrom
              ? new Date(requestedFrom)
              : new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 29);

            const fromDate = startDate.toISOString().slice(0, 10);
            const toDate = endDate.toISOString().slice(0, 10);

            let totalPatients = 0;
            let highRiskPatients = 0;
            let activeProfiles = 0;
            if (hasPatientMaster) {
              const rows = (await sql.query(
                `SELECT
                    COUNT(*)::int AS total_patients,
                    COUNT(*) FILTER (WHERE risk_level = 'high')::int AS high_risk,
                    COUNT(*) FILTER (WHERE appointment_count > 0 OR walkin_count > 0 OR checkup_count > 0 OR mental_count > 0 OR pharmacy_count > 0)::int AS active_profiles
                 FROM patient_master`
              )) as Array<{ total_patients: number; high_risk: number; active_profiles: number }>;
              totalPatients = Number(rows[0]?.total_patients || 0);
              highRiskPatients = Number(rows[0]?.high_risk || 0);
              activeProfiles = Number(rows[0]?.active_profiles || 0);
            }

            let appointmentsTotal = 0;
            let appointmentsPending = 0;
            if (hasAppointments) {
              const rows = (await sql.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('pending', 'new'))::int AS pending
                 FROM patient_appointments
                 WHERE appointment_date BETWEEN $1::date AND $2::date`,
                [fromDate, toDate]
              )) as Array<{ total: number; pending: number }>;
              appointmentsTotal = Number(rows[0]?.total || 0);
              appointmentsPending = Number(rows[0]?.pending || 0);
            }

            let walkinTotal = 0;
            let walkinEmergency = 0;
            if (hasWalkins) {
              const rows = (await sql.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (
                      WHERE LOWER(COALESCE(status,'')) = 'emergency'
                      OR LOWER(COALESCE(severity,'')) = 'emergency'
                    )::int AS emergency
                 FROM patient_walkins
                 WHERE COALESCE(checkin_time, intake_time, created_at)::date BETWEEN $1::date AND $2::date`,
                [fromDate, toDate]
              )) as Array<{ total: number; emergency: number }>;
              walkinTotal = Number(rows[0]?.total || 0);
              walkinEmergency = Number(rows[0]?.emergency || 0);
            }

            let checkupTotal = 0;
            let checkupInConsultation = 0;
            if (hasCheckups) {
              const rows = (await sql.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'in_consultation')::int AS in_consultation
                 FROM checkup_visits
                 WHERE created_at::date BETWEEN $1::date AND $2::date`,
                [fromDate, toDate]
              )) as Array<{ total: number; in_consultation: number }>;
              checkupTotal = Number(rows[0]?.total || 0);
              checkupInConsultation = Number(rows[0]?.in_consultation || 0);
            }

            let mentalTotal = 0;
            let mentalAtRisk = 0;
            if (hasMentalSessions) {
              const rows = (await sql.query(
                `SELECT
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE risk_level = 'high' OR status IN ('at_risk', 'escalated'))::int AS at_risk
                 FROM mental_health_sessions
                 WHERE created_at::date BETWEEN $1::date AND $2::date`,
                [fromDate, toDate]
              )) as Array<{ total: number; at_risk: number }>;
              mentalTotal = Number(rows[0]?.total || 0);
              mentalAtRisk = Number(rows[0]?.at_risk || 0);
            }

            let pharmacyDispense = 0;
            if (hasPharmacyDispense) {
              const rows = (await sql.query(
                `SELECT COUNT(*)::int AS total
                 FROM pharmacy_dispense_requests
                 WHERE requested_at::date BETWEEN $1::date AND $2::date`,
                [fromDate, toDate]
              )) as Array<{ total: number }>;
              pharmacyDispense = Number(rows[0]?.total || 0);
            }

            const dateRows = (await sql.query(
              `SELECT to_char(day::date, 'YYYY-MM-DD') AS day
               FROM generate_series($1::date, $2::date, interval '1 day') AS day`,
              [fromDate, toDate]
            )) as Array<{ day: string }>;
            const baseTrend = dateRows.map((item) => ({
              day: item.day,
              appointments: 0,
              walkin: 0,
              checkup: 0,
              mental: 0,
              pharmacy: 0
            }));
            const trendMap = new Map(baseTrend.map((item) => [item.day, item]));

            const applyTrend = async (
              exists: boolean,
              query: string,
              metricKey: 'appointments' | 'walkin' | 'checkup' | 'mental' | 'pharmacy'
            ): Promise<void> => {
              if (!exists) return;
              const rows = (await sql.query(query, [fromDate, toDate])) as Array<{ day: string; total: number }>;
              for (const row of rows) {
                const dayRow = trendMap.get(row.day);
                if (!dayRow) continue;
                dayRow[metricKey] = Number(row.total || 0);
              }
            };

            await applyTrend(
              hasAppointments,
              `SELECT to_char(appointment_date::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total
               FROM patient_appointments
               WHERE appointment_date BETWEEN $1::date AND $2::date
               GROUP BY 1`,
              'appointments'
            );
            await applyTrend(
              hasWalkins,
              `SELECT to_char(COALESCE(checkin_time, intake_time, created_at)::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total
               FROM patient_walkins
               WHERE COALESCE(checkin_time, intake_time, created_at)::date BETWEEN $1::date AND $2::date
               GROUP BY 1`,
              'walkin'
            );
            await applyTrend(
              hasCheckups,
              `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total
               FROM checkup_visits
               WHERE created_at::date BETWEEN $1::date AND $2::date
               GROUP BY 1`,
              'checkup'
            );
            await applyTrend(
              hasMentalSessions,
              `SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total
               FROM mental_health_sessions
               WHERE created_at::date BETWEEN $1::date AND $2::date
               GROUP BY 1`,
              'mental'
            );
            await applyTrend(
              hasPharmacyDispense,
              `SELECT to_char(requested_at::date, 'YYYY-MM-DD') AS day, COUNT(*)::int AS total
               FROM pharmacy_dispense_requests
               WHERE requested_at::date BETWEEN $1::date AND $2::date
               GROUP BY 1`,
              'pharmacy'
            );

            const activityLogs: Array<{ module: string; action: string; detail: string; actor: string; created_at: string }> = hasModuleActivity
              ? ((await sql.query(
                  `SELECT module, action, detail, actor, created_at::text AS created_at
                   FROM module_activity_logs
                   ORDER BY created_at DESC
                   LIMIT 20`
                )) as Array<{ module: string; action: string; detail: string; actor: string; created_at: string }>)
              : [];

            writeJson(res, 200, {
              ok: true,
              data: {
                window: { from: fromDate, to: toDate },
                kpis: {
                  totalPatients,
                  activeProfiles,
                  highRiskPatients,
                  totalVisits: appointmentsTotal + walkinTotal + checkupTotal + mentalTotal,
                  pendingQueue: appointmentsPending + checkupInConsultation,
                  emergencyCases: walkinEmergency + mentalAtRisk,
                  dispensedItems: pharmacyDispense
                },
                moduleTotals: [
                  { module: 'Appointments', total: appointmentsTotal },
                  { module: 'Walk-In', total: walkinTotal },
                  { module: 'Check-Up', total: checkupTotal },
                  { module: 'Mental Health', total: mentalTotal },
                  { module: 'Pharmacy', total: pharmacyDispense }
                ],
                dailyTrend: baseTrend,
                recentActivity: activityLogs.slice(0, 10)
              }
            });
            return;
          }

          if (url.pathname === '/api/dashboard' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientAppointmentsTable(sql);
            await ensurePatientMasterTables(sql);

            const summaryRows = (await sql.query(
              `SELECT
                 (SELECT COUNT(*)::int FROM patient_master) AS total_patients,
                 (SELECT COUNT(*)::int FROM patient_appointments) AS total_appointments,
                 (SELECT COUNT(*)::int FROM patient_appointments WHERE appointment_date = CURRENT_DATE) AS today_appointments,
                 (SELECT COUNT(*)::int FROM patient_appointments WHERE LOWER(COALESCE(status,'')) IN ('pending', 'new', 'awaiting')) AS pending_appointments,
                 (SELECT COUNT(*)::int FROM patient_appointments WHERE LOWER(COALESCE(status,'')) = 'completed' AND updated_at::date = CURRENT_DATE) AS completed_today,
                 (SELECT COUNT(*)::int FROM patient_master WHERE created_at >= date_trunc('month', NOW())) AS new_patients_month`
            )) as Array<{
              total_patients: number;
              total_appointments: number;
              today_appointments: number;
              pending_appointments: number;
              completed_today: number;
              new_patients_month: number;
            }>;
            const summary = summaryRows[0] || {
              total_patients: 0,
              total_appointments: 0,
              today_appointments: 0,
              pending_appointments: 0,
              completed_today: 0,
              new_patients_month: 0
            };

            const trendRows = (await sql.query(
              `WITH months AS (
                 SELECT date_trunc('month', NOW()) - ((5 - gs.i) * interval '1 month') AS month_start
                 FROM generate_series(0, 5) AS gs(i)
               )
               SELECT
                 to_char(m.month_start, 'Mon') AS label,
                 LOWER(to_char(m.month_start, 'Mon')) AS key,
                 COALESCE(COUNT(a.id), 0)::int AS total
               FROM months m
               LEFT JOIN patient_appointments a
                 ON date_trunc('month', a.appointment_date::timestamp) = m.month_start
               GROUP BY m.month_start
               ORDER BY m.month_start`
            )) as Array<{ label: string; key: string; total: number }>;

            const statusRows = (await sql.query(
              `SELECT
                 COALESCE(NULLIF(TRIM(status), ''), 'Pending') AS label,
                 COUNT(*)::int AS total
               FROM patient_appointments
               GROUP BY 1
               ORDER BY total DESC`
            )) as Array<{ label: string; total: number }>;

            const deptRows = (await sql.query(
              `SELECT
                 COALESCE(NULLIF(TRIM(department_name), ''), 'General') AS label,
                 COUNT(*)::int AS total
               FROM patient_appointments
               GROUP BY 1
               ORDER BY total DESC
               LIMIT 6`
            )) as Array<{ label: string; total: number }>;

            const upcomingRows = (await sql.query(
              `SELECT booking_id, patient_name, doctor_name, department_name, appointment_date::text AS appointment_date, preferred_time, status
               FROM patient_appointments
               WHERE appointment_date >= CURRENT_DATE
               ORDER BY appointment_date ASC, COALESCE(preferred_time, '99:99') ASC
               LIMIT 8`
            )) as Array<{
              booking_id: string;
              patient_name: string;
              doctor_name: string;
              department_name: string;
              appointment_date: string;
              preferred_time: string | null;
              status: string;
            }>;

            const recentRows = (await sql.query(
              `SELECT patient_code, patient_name, COALESCE(sex, '') AS sex, created_at::text AS created_at
               FROM patient_master
               ORDER BY created_at DESC
               LIMIT 8`
            )) as Array<{ patient_code: string; patient_name: string; sex: string; created_at: string }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                generatedAt: new Date().toISOString(),
                summary: {
                  totalPatients: Number(summary.total_patients || 0),
                  totalAppointments: Number(summary.total_appointments || 0),
                  todayAppointments: Number(summary.today_appointments || 0),
                  pendingAppointments: Number(summary.pending_appointments || 0),
                  completedToday: Number(summary.completed_today || 0),
                  newPatientsThisMonth: Number(summary.new_patients_month || 0)
                },
                appointmentsTrend: trendRows.map((item) => ({ key: item.key, label: item.label, total: Number(item.total || 0) })),
                statusBreakdown: statusRows.map((item) => ({ label: item.label, total: Number(item.total || 0) })),
                departmentBreakdown: deptRows.map((item) => ({ label: item.label, total: Number(item.total || 0) })),
                upcomingAppointments: upcomingRows.map((item) => ({
                  bookingId: item.booking_id,
                  patientName: item.patient_name,
                  doctorName: item.doctor_name,
                  department: item.department_name,
                  appointmentDate: item.appointment_date,
                  preferredTime: item.preferred_time || '',
                  status: item.status
                })),
                recentPatients: recentRows.map((item) => ({
                  patientId: item.patient_code,
                  patientName: item.patient_name,
                  patientGender: item.sex,
                  createdAt: item.created_at
                }))
              }
            });
            return;
          }

          if (url.pathname === '/api/admin-auth' && (req.method || 'GET').toUpperCase() === 'GET') {
            const session = await resolveAdminSession();
            writeJson(res, 200, {
              ok: true,
              data: {
                authenticated: Boolean(session),
                user: session
                  ? {
                      id: session.admin_profile_id,
                      username: session.username,
                      fullName: session.full_name,
                      email: session.email,
                      role: session.role,
                      department: session.department,
                      accessExemptions: Array.isArray(session.access_exemptions) ? session.access_exemptions : [],
                      isSuperAdmin: Boolean(session.is_super_admin)
                    }
                  : null
              }
            });
            return;
          }

          if (url.pathname === '/api/admin-auth' && (req.method || '').toUpperCase() === 'POST') {
            await ensureAdminProfileTables(sql);
            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();

            if (!['login', 'logout', 'create_account'].includes(action)) {
              writeJson(res, 422, { ok: false, message: 'Unsupported admin auth action.' });
              return;
            }

            if (!enforceAdminRateLimit(`admin-auth:${action}:${clientIp}`, 10, 60_000)) {
              writeJson(res, 429, { ok: false, message: 'Too many admin auth requests. Please retry in a minute.' });
              return;
            }

            if (action === 'logout') {
              if (adminSessionTokenHash) {
                await sql.query(`UPDATE admin_sessions SET revoked_at = NOW() WHERE session_token_hash = $1 AND revoked_at IS NULL`, [adminSessionTokenHash]);
              }
              appendSetCookie('admin_session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/');
              writeJson(res, 200, { ok: true, message: 'Signed out.' });
              return;
            }

            if (action === 'login') {
              const username = toSafeText(body.username).toLowerCase();
              const password = toSafeText(body.password);
              if (!username || !password) {
                writeJson(res, 422, { ok: false, message: 'Username and password are required.' });
                return;
              }

              const rows = (await sql.query(
                `SELECT id, username, full_name, email, role, department, access_exemptions, is_super_admin, status, password_hash
                 FROM admin_profiles
                 WHERE LOWER(username) = $1 OR LOWER(email) = $1
                 LIMIT 1`,
                [username]
              )) as Array<{
                id: number;
                username: string;
                full_name: string;
                email: string;
                role: string;
                department: string;
                access_exemptions: string[] | null;
                is_super_admin: boolean;
                status: string;
                password_hash: string | null;
              }>;
              const account = rows[0];
              if (!account || String(account.status || '').toLowerCase() !== 'active') {
                writeJson(res, 401, { ok: false, message: 'Invalid credentials.' });
                return;
              }
              if (!account.password_hash || !verifyPatientPassword(password, account.password_hash)) {
                writeJson(res, 401, { ok: false, message: 'Invalid credentials.' });
                return;
              }

              const sessionToken = randomBytes(32).toString('hex');
              const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
              await sql.query(
                `INSERT INTO admin_sessions (session_token_hash, admin_profile_id, ip_address, user_agent, expires_at)
                 VALUES ($1,$2,$3,$4,NOW() + INTERVAL '12 hours')`,
                [sessionHash, account.id, clientIp, String(req.headers['user-agent'] || '')]
              );
              await sql.query(`UPDATE admin_profiles SET last_login_at = NOW() WHERE id = $1`, [account.id]);
              await sql.query(
                `INSERT INTO admin_activity_logs (username, action, raw_action, description, ip_address)
                 VALUES ($1, 'Login', 'LOGIN', 'Admin signed in.', $2)`,
                [account.username, clientIp]
              );
              appendSetCookie(`admin_session=${sessionToken}; Max-Age=${60 * 60 * 12}; HttpOnly; SameSite=Lax; Path=/`);
              writeJson(res, 200, {
                ok: true,
                data: {
                  user: {
                    id: account.id,
                    username: account.username,
                    fullName: account.full_name,
                    email: account.email,
                    role: account.role,
                    department: account.department,
                    accessExemptions: Array.isArray(account.access_exemptions) ? account.access_exemptions : [],
                    isSuperAdmin: Boolean(account.is_super_admin)
                  }
                }
              });
              return;
            }

            const actor = await resolveAdminSession();
            if (!actor) {
              writeJson(res, 401, { ok: false, message: 'Admin authentication required.' });
              return;
            }
            if (!actor.is_super_admin) {
              writeJson(res, 403, { ok: false, message: 'Only super admin can create admin accounts.' });
              return;
            }

            const username = toSafeText(body.username).toLowerCase();
            const email = toSafeText(body.email).toLowerCase();
            const fullName = toSafeText(body.full_name);
            const role = toSafeText(body.role) || 'Admin';
            const department = toSafeText(body.department) || 'Administration';
            const accessExemptionsInput = Array.isArray(body.access_exemptions)
              ? body.access_exemptions.map((value) => toSafeText(value).toLowerCase()).filter(Boolean)
              : [];
            const phone = toSafeText(body.phone);
            const status = toSafeText(body.status) || 'active';
            const password = toSafeText(body.password);
            const isSuperAdmin = Boolean(body.is_super_admin);

            if (!username || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
              writeJson(res, 422, { ok: false, message: 'A valid username email is required.' });
              return;
            }
            if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
              writeJson(res, 422, { ok: false, message: 'A valid email is required.' });
              return;
            }
            if (!fullName || password.length < 8) {
              writeJson(res, 422, { ok: false, message: 'Full name and password (min 8 chars) are required.' });
              return;
            }

            const existing = (await sql.query(
              `SELECT id FROM admin_profiles WHERE LOWER(username) = $1 OR LOWER(email) = $2 LIMIT 1`,
              [username, email]
            )) as Array<{ id: number }>;
            if (existing.length) {
              writeJson(res, 409, { ok: false, message: 'Admin account already exists for this username/email.' });
              return;
            }

            await sql.query(
              `INSERT INTO admin_profiles (username, full_name, email, role, department, access_exemptions, is_super_admin, password_hash, status, phone)
               VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10)`,
              [username, fullName, email, role, department, accessExemptionsInput, isSuperAdmin, hashPatientPassword(password), status, phone]
            );
            await sql.query(
              `INSERT INTO admin_activity_logs (username, action, raw_action, description, ip_address)
               VALUES ($1, 'Account Created', 'ACCOUNT_CREATED', $2, $3)`,
              [actor.username, `Created admin account ${username} (${role})`, clientIp]
            );
            writeJson(res, 200, { ok: true, message: 'Admin account created.' });
            return;
          }

          if (url.pathname === '/api/admin-profile' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureAdminProfileTables(sql);
            const adminSession = await resolveAdminSession();
            if (!adminSession) {
              writeJson(res, 401, { ok: false, message: 'Admin authentication required.' });
              return;
            }
            const requestedUsername = toSafeText(url.searchParams.get('username')).toLowerCase();
            const username = requestedUsername && adminSession.is_super_admin ? requestedUsername : adminSession.username.toLowerCase();
            const profileRows = (await sql.query(
              `SELECT username, full_name, email, role, department, is_super_admin, status, phone, created_at::text AS created_at, last_login_at::text AS last_login_at,
                      email_notifications, in_app_notifications, dark_mode
               FROM admin_profiles
               WHERE username = $1
               LIMIT 1`,
              [username]
            )) as Array<Record<string, unknown>>;
            const profile = profileRows[0];
            if (!profile) {
              writeJson(res, 404, { ok: false, message: 'Admin profile not found.' });
              return;
            }

            const logs = (await sql.query(
              `SELECT action, raw_action, description, ip_address, created_at::text AS created_at
               FROM admin_activity_logs
               WHERE username = $1
               ORDER BY created_at DESC
               LIMIT 50`,
              [username]
            )) as Array<Record<string, unknown>>;

            writeJson(res, 200, {
              ok: true,
              data: {
                profile: {
                  fullName: String(profile.full_name || ''),
                  username: String(profile.username || ''),
                  email: String(profile.email || ''),
                  role: String(profile.role || ''),
                  department: String(profile.department || 'Administration'),
                  isSuperAdmin: Boolean(profile.is_super_admin),
                  status: String(profile.status || ''),
                  phone: String(profile.phone || ''),
                  createdAt: String(profile.created_at || ''),
                  lastLoginAt: String(profile.last_login_at || '')
                },
                preferences: {
                  emailNotifications: Boolean(profile.email_notifications),
                  inAppNotifications: Boolean(profile.in_app_notifications),
                  darkMode: Boolean(profile.dark_mode)
                },
                stats: {
                  totalLogins: logs.filter((item) => String(item.raw_action || '') === 'LOGIN').length,
                  status: String(profile.status || '').toUpperCase()
                },
                activityLogs: logs.map((item) => ({
                  dateTime: String(item.created_at || ''),
                  action: String(item.action || ''),
                  rawAction: String(item.raw_action || ''),
                  description: String(item.description || ''),
                  ipAddress: String(item.ip_address || '')
                })),
                loginHistory: logs
                  .filter((item) => ['LOGIN', 'LOGOUT'].includes(String(item.raw_action || '')))
                  .map((item) => ({
                    dateTime: String(item.created_at || ''),
                    action: String(item.action || ''),
                    rawAction: String(item.raw_action || ''),
                    description: String(item.description || ''),
                    ipAddress: String(item.ip_address || '')
                  }))
              }
            });
            return;
          }

          if (url.pathname === '/api/admin-profile' && (req.method || '').toUpperCase() === 'POST') {
            await ensureAdminProfileTables(sql);
            const adminSession = await resolveAdminSession();
            if (!adminSession) {
              writeJson(res, 401, { ok: false, message: 'Admin authentication required.' });
              return;
            }
            const body = await readJsonBody(req);
            const requestedUsername = toSafeText(body.username).toLowerCase();
            const username = requestedUsername && adminSession.is_super_admin ? requestedUsername : adminSession.username.toLowerCase();
            const fullName = toSafeText(body.full_name);
            const phone = toSafeText(body.phone);
            const preferences = (body.preferences || {}) as Record<string, unknown>;

            await sql.query(
              `UPDATE admin_profiles
               SET full_name = COALESCE(NULLIF($1, ''), full_name),
                   phone = COALESCE(NULLIF($2, ''), phone),
                   email_notifications = COALESCE($3::boolean, email_notifications),
                   in_app_notifications = COALESCE($4::boolean, in_app_notifications),
                   dark_mode = COALESCE($5::boolean, dark_mode)
               WHERE username = $6`,
              [
                fullName || null,
                phone || null,
                preferences.emailNotifications == null ? null : Boolean(preferences.emailNotifications),
                preferences.inAppNotifications == null ? null : Boolean(preferences.inAppNotifications),
                preferences.darkMode == null ? null : Boolean(preferences.darkMode),
                username
              ]
            );
            await sql.query(
              `INSERT INTO admin_activity_logs (username, action, raw_action, description, ip_address)
               VALUES ($1, 'Profile Updated', 'PROFILE_UPDATED', 'Profile settings updated.', '127.0.0.1')`,
              [username]
            );
            writeJson(res, 200, { ok: true });
            return;
          }

          if (url.pathname === '/api/laboratory' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureLaboratoryTables(sql);
            const requestId = toSafeInt(url.searchParams.get('request_id'), 0);
            const mode = toSafeText(url.searchParams.get('mode')).toLowerCase();

            if (requestId > 0 && mode === 'detail') {
              const rows = (await sql.query(`SELECT * FROM laboratory_requests WHERE request_id = $1 LIMIT 1`, [requestId])) as Array<Record<string, unknown>>;
              if (!rows[0]) {
                writeJson(res, 404, { ok: false, message: 'Laboratory request not found.' });
                return;
              }
              writeJson(res, 200, { ok: true, data: rows[0] });
              return;
            }

            if (requestId > 0 && mode === 'activity') {
              const logs = (await sql.query(
                `SELECT id, request_id, action, details, actor, created_at::text AS created_at
                 FROM laboratory_activity_logs
                 WHERE request_id = $1
                 ORDER BY created_at DESC`,
                [requestId]
              )) as Array<Record<string, unknown>>;
              writeJson(res, 200, { ok: true, data: logs });
              return;
            }

            const search = toSafeText(url.searchParams.get('search')).toLowerCase();
            const status = toSafeText(url.searchParams.get('status')).toLowerCase();
            const category = toSafeText(url.searchParams.get('category')).toLowerCase();
            const priority = toSafeText(url.searchParams.get('priority')).toLowerCase();
            const doctor = toSafeText(url.searchParams.get('doctor')).toLowerCase();
            const fromDate = toSafeIsoDate(url.searchParams.get('fromDate'));
            const toDate = toSafeIsoDate(url.searchParams.get('toDate'));

            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;
            if (search) {
              params.push(`%${search}%`);
              where.push(`(
                request_id::text ILIKE $${idx}
                OR patient_name ILIKE $${idx}
                OR visit_id ILIKE $${idx}
                OR patient_id ILIKE $${idx}
                OR category ILIKE $${idx}
                OR requested_by_doctor ILIKE $${idx}
              )`);
              idx += 1;
            }
            if (status && status !== 'all') {
              if (status === 'in_progress') {
                where.push(`status IN ('In Progress', 'Result Ready')`);
              } else if (status === 'completed') {
                where.push(`status = 'Completed'`);
              } else if (status === 'pending') {
                where.push(`status = 'Pending'`);
              }
            }
            if (category && category !== 'all') {
              params.push(category);
              where.push(`LOWER(category) = $${idx}`);
              idx += 1;
            }
            if (priority && priority !== 'all') {
              params.push(priority);
              where.push(`LOWER(priority) = $${idx}`);
              idx += 1;
            }
            if (doctor && doctor !== 'all') {
              params.push(doctor);
              where.push(`LOWER(requested_by_doctor) = $${idx}`);
              idx += 1;
            }
            if (fromDate) {
              params.push(fromDate);
              where.push(`requested_at::date >= $${idx}::date`);
              idx += 1;
            }
            if (toDate) {
              params.push(toDate);
              where.push(`requested_at::date <= $${idx}::date`);
              idx += 1;
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const rows = await sql.query(
              `SELECT request_id, visit_id, patient_id, patient_name, category, priority, status, requested_at::text AS requested_at, requested_by_doctor
               FROM laboratory_requests
               ${whereSql}
               ORDER BY requested_at DESC`,
              params
            );
            writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows : [] });
            return;
          }

          if (url.pathname === '/api/laboratory' && (req.method || '').toUpperCase() === 'POST') {
            await ensureLaboratoryTables(sql);
            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();

            const toJson = (value: unknown): Record<string, unknown> => {
              if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
              return {};
            };

            const saveActivity = async (requestId: number, actionLabel: string, details: string, actor: string): Promise<void> => {
              await sql.query(
                `INSERT INTO laboratory_activity_logs (request_id, action, details, actor)
                 VALUES ($1, $2, $3, $4)`,
                [requestId, actionLabel, details, actor || 'Lab Staff']
              );
              await insertModuleActivity(
                'laboratory',
                actionLabel,
                details,
                actor || 'Lab Staff',
                'lab_request',
                String(requestId)
              );
            };

            if (action === 'create') {
              const patientName = toSafeText(body.patient_name);
              const categoryText = toSafeText(body.category);
              const requestedByDoctor = toSafeText(body.requested_by_doctor);
              if (!patientName || !categoryText || !requestedByDoctor) {
                writeJson(res, 422, { ok: false, message: 'patient_name, category, requested_by_doctor are required.' });
                return;
              }

              const nextRows = (await sql.query(`SELECT COALESCE(MAX(request_id), 1200)::bigint + 1 AS next_id FROM laboratory_requests`)) as Array<{ next_id: number }>;
              const nextId = Number(nextRows[0]?.next_id || 1201);
              const now = new Date().toISOString();
              const testsInput = Array.isArray(body.tests) ? body.tests.map((x) => toSafeText(x)).filter(Boolean) : [];
              const tests = testsInput.length ? testsInput : [`${categoryText} request`];

              const inserted = (await sql.query(
                `INSERT INTO laboratory_requests (
                    request_id, visit_id, patient_id, patient_name, age, sex, category, priority, status, requested_at,
                    requested_by_doctor, doctor_department, notes, tests, specimen_type, sample_source, collection_date_time,
                    clinical_diagnosis, lab_instructions, insurance_reference, billing_reference, assigned_lab_staff,
                    sample_collected, sample_collected_at, processing_started_at, result_encoded_at, result_reference_range,
                    verified_by, verified_at, rejection_reason, resample_flag, released_at, raw_attachment_name, encoded_values, created_at, updated_at
                 ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,'Pending',$9,
                    $10,$11,$12,$13::text[],$14,$15,$16,
                    $17,$18,$19,$20,$21,
                    FALSE,NULL,NULL,NULL,'',
                    '',NULL,'',FALSE,NULL,'','{}'::jsonb,NOW(),NOW()
                 )
                 RETURNING *`,
                [
                  nextId,
                  toSafeText(body.visit_id) || `VISIT-${new Date().getFullYear()}-${nextId}`,
                  toSafeText(body.patient_id) || `PAT-${nextId}`,
                  patientName,
                  toSafeInt(body.age, 0) || null,
                  toSafeText(body.sex) || null,
                  categoryText,
                  toSafeText(body.priority) || 'Normal',
                  now,
                  requestedByDoctor,
                  toSafeText(body.doctor_department) || 'General Medicine',
                  toSafeText(body.notes),
                  tests,
                  toSafeText(body.specimen_type) || 'Whole Blood',
                  toSafeText(body.sample_source) || 'Blood',
                  toSafeText(body.collection_date_time) || null,
                  toSafeText(body.clinical_diagnosis),
                  toSafeText(body.lab_instructions),
                  toSafeText(body.insurance_reference),
                  toSafeText(body.billing_reference),
                  toSafeText(body.assigned_lab_staff) || 'Tech Anne'
                ]
              )) as Array<Record<string, unknown>>;

              await saveActivity(nextId, 'Request Created', 'New lab request created from laboratory queue dashboard.', 'Lab Staff');
              writeJson(res, 200, { ok: true, data: inserted[0] || null });
              return;
            }

            const requestId = toSafeInt(body.request_id, 0);
            if (requestId <= 0) {
              writeJson(res, 422, { ok: false, message: 'request_id is required.' });
              return;
            }
            const existingRows = (await sql.query(`SELECT * FROM laboratory_requests WHERE request_id = $1 LIMIT 1`, [requestId])) as Array<Record<string, unknown>>;
            const existing = existingRows[0];
            if (!existing) {
              writeJson(res, 404, { ok: false, message: 'Laboratory request not found.' });
              return;
            }

            if (action === 'start_processing') {
              const staff = toSafeText(body.lab_staff) || toSafeText(existing.assigned_lab_staff) || 'Lab Staff';
              const updated = (await sql.query(
                `UPDATE laboratory_requests
                 SET status = 'In Progress',
                     assigned_lab_staff = $1,
                     sample_collected = $2,
                     sample_collected_at = CASE WHEN $2 THEN COALESCE($3::timestamp, NOW()) ELSE NULL END,
                     processing_started_at = COALESCE($4::timestamp, NOW()),
                     specimen_type = COALESCE(NULLIF($5, ''), specimen_type),
                     sample_source = COALESCE(NULLIF($6, ''), sample_source),
                     collection_date_time = COALESCE($7::timestamp, collection_date_time),
                     updated_at = NOW()
                 WHERE request_id = $8
                 RETURNING *`,
                [
                  staff,
                  Boolean(body.sample_collected),
                  toSafeText(body.sample_collected_at) || null,
                  toSafeText(body.processing_started_at) || null,
                  toSafeText(body.specimen_type),
                  toSafeText(body.sample_source),
                  toSafeText(body.collection_date_time) || null,
                  requestId
                ]
              )) as Array<Record<string, unknown>>;
              await saveActivity(requestId, 'Processing Started', 'Sample collected and processing started.', staff);
              writeJson(res, 200, { ok: true, data: updated[0] || null });
              return;
            }

            if (action === 'save_results') {
              const finalize = Boolean(body.finalize);
              const summary = toSafeText(body.summary) || (finalize ? 'Result is now ready for release.' : 'Encoded result draft saved.');
              const encodedValues = toJson(body.encoded_values);
              const currentStaff = toSafeText(existing.assigned_lab_staff) || 'Lab Staff';
              const updated = (await sql.query(
                `UPDATE laboratory_requests
                 SET status = CASE WHEN $1 THEN 'Result Ready' ELSE 'In Progress' END,
                     raw_attachment_name = COALESCE(NULLIF($2, ''), raw_attachment_name),
                     encoded_values = $3::jsonb,
                     result_encoded_at = CASE WHEN $1 THEN COALESCE($4::timestamp, NOW()) ELSE result_encoded_at END,
                     result_reference_range = COALESCE(NULLIF($5, ''), result_reference_range),
                     verified_by = CASE WHEN $1 THEN COALESCE(NULLIF($6, ''), verified_by, assigned_lab_staff) ELSE verified_by END,
                     verified_at = CASE WHEN $1 THEN COALESCE($7::timestamp, NOW()) ELSE verified_at END,
                     updated_at = NOW()
                 WHERE request_id = $8
                 RETURNING *`,
                [
                  finalize,
                  toSafeText(body.attachment_name),
                  JSON.stringify(encodedValues),
                  toSafeText(body.result_encoded_at) || null,
                  toSafeText(body.result_reference_range),
                  toSafeText(body.verified_by),
                  toSafeText(body.verified_at) || null,
                  requestId
                ]
              )) as Array<Record<string, unknown>>;
              await saveActivity(requestId, finalize ? 'Result Finalized' : 'Draft Saved', summary, currentStaff);
              writeJson(res, 200, { ok: true, data: updated[0] || null });
              return;
            }

            if (action === 'release') {
              if (toSafeText(existing.status) !== 'Result Ready') {
                writeJson(res, 422, { ok: false, message: 'Only Result Ready requests can be released.' });
                return;
              }
              const updated = (await sql.query(
                `UPDATE laboratory_requests
                 SET status = 'Completed',
                     released_at = COALESCE($1::timestamp, NOW()),
                     updated_at = NOW()
                 WHERE request_id = $2
                 RETURNING *`,
                [toSafeText(body.released_at) || null, requestId]
              )) as Array<Record<string, unknown>>;
              await saveActivity(requestId, 'Report Released', 'Lab report released to doctor/check-up.', toSafeText(body.released_by) || 'Lab Staff');
              writeJson(res, 200, { ok: true, data: updated[0] || null });
              return;
            }

            if (action === 'reject') {
              const reason = toSafeText(body.reason);
              if (!reason) {
                writeJson(res, 422, { ok: false, message: 'reason is required.' });
                return;
              }
              const updated = (await sql.query(
                `UPDATE laboratory_requests
                 SET status = 'Cancelled',
                     rejection_reason = $1,
                     resample_flag = $2,
                     updated_at = NOW()
                 WHERE request_id = $3
                 RETURNING *`,
                [reason, Boolean(body.resample_flag), requestId]
              )) as Array<Record<string, unknown>>;
              await saveActivity(
                requestId,
                Boolean(body.resample_flag) ? 'Resample Requested' : 'Request Rejected',
                reason,
                toSafeText(body.actor) || 'Lab Staff'
              );
              writeJson(res, 200, { ok: true, data: updated[0] || null });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported laboratory action.' });
            return;
          }

          if (url.pathname === '/api/walk-ins' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientWalkinsTable(sql);

            const search = (url.searchParams.get('search') || '').trim();
            const status = (url.searchParams.get('status') || '').trim();
            const severity = (url.searchParams.get('severity') || '').trim();
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let paramIndex = 1;

            if (search) {
              params.push(`%${search}%`);
              where.push(`(case_id ILIKE $${paramIndex} OR patient_name ILIKE $${paramIndex} OR COALESCE(contact, '') ILIKE $${paramIndex} OR COALESCE(chief_complaint, '') ILIKE $${paramIndex} OR COALESCE(assigned_doctor, '') ILIKE $${paramIndex})`);
              paramIndex += 1;
            }

            if (status && status.toLowerCase() !== 'all') {
              params.push(status.toLowerCase());
              where.push(`LOWER(status) = $${paramIndex}`);
              paramIndex += 1;
            }

            if (severity && severity.toLowerCase() !== 'all') {
              params.push(severity.toLowerCase());
              where.push(`LOWER(severity) = $${paramIndex}`);
              paramIndex += 1;
            }

            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
            const countRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM patient_walkins${whereSql}`, params)) as Array<{ total: number }>;
            const total = Number(countRows[0]?.total || 0);

            const items = await sql.query(
              `SELECT id, case_id, patient_name, age, sex, date_of_birth, contact, address, emergency_contact, patient_ref, visit_department, checkin_time,
                      pain_scale, temperature_c, blood_pressure, pulse_bpm, weight_kg, chief_complaint, severity, intake_time, assigned_doctor, status
               FROM patient_walkins${whereSql}
               ORDER BY
                 CASE WHEN status = 'emergency' OR severity = 'Emergency' THEN 0 ELSE 1 END ASC,
                 CASE severity WHEN 'Emergency' THEN 0 WHEN 'Moderate' THEN 1 ELSE 2 END ASC,
                 intake_time ASC
               LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
              [...params, perPage, offset]
            );

            const analyticsRows = await sql.query(`
              SELECT
                COUNT(*)::int AS all,
                COUNT(*) FILTER (WHERE status = 'triage_pending')::int AS triage,
                COUNT(*) FILTER (WHERE status = 'waiting_for_doctor')::int AS doctor,
                COUNT(*) FILTER (WHERE status = 'emergency')::int AS emergency,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
              FROM patient_walkins
            `) as Array<{ all: number; triage: number; doctor: number; emergency: number; completed: number }>;
            const analytics = analyticsRows[0] || { all: 0, triage: 0, doctor: 0, emergency: 0, completed: 0 };

            writeJson(res, 200, {
              ok: true,
              data: {
                analytics: {
                  all: Number(analytics.all || 0),
                  triage: Number(analytics.triage || 0),
                  doctor: Number(analytics.doctor || 0),
                  emergency: Number(analytics.emergency || 0),
                  completed: Number(analytics.completed || 0)
                },
                items: Array.isArray(items) ? items : [],
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/walk-ins' && (req.method || '').toUpperCase() === 'POST') {
            await ensurePatientWalkinsTable(sql);

            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            const actor = toSafeText(body.actor) || 'System';
            const logWalkIn = async (actionLabel: string, detail: string, caseKey: string): Promise<void> => {
              await insertModuleActivity('walkin', actionLabel, detail, actor, 'walkin_case', caseKey);
            };

            if (action === 'create') {
              const patientName = String(body.patient_name || '').trim();
              if (!patientName) {
                writeJson(res, 422, { ok: false, message: 'patient_name is required.' });
                return;
              }

              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const serial = Math.floor(100 + Math.random() * 900);
              const caseId = `WALK-${yyyy}-${mm}${serial}`;

              const createdRows = await sql.query(
                `INSERT INTO patient_walkins (
                    case_id, patient_name, age, sex, date_of_birth, contact, address, emergency_contact, patient_ref, visit_department,
                    checkin_time, pain_scale, temperature_c, blood_pressure, pulse_bpm, weight_kg,
                    chief_complaint, severity, intake_time, assigned_doctor, status
                 )
                 VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    COALESCE($11::timestamp, NOW()),$12,$13,$14,$15,$16,
                    $17,$18,COALESCE($11::timestamp, NOW()),$19,'waiting'
                 )
                 RETURNING id, case_id, patient_name, age, sex, date_of_birth, contact, address, emergency_contact, patient_ref, visit_department,
                           checkin_time, pain_scale, temperature_c, blood_pressure, pulse_bpm, weight_kg,
                           chief_complaint, severity, intake_time, assigned_doctor, status`,
                [
                  caseId,
                  patientName,
                  body.age ?? null,
                  String(body.sex || '').trim() || null,
                  String(body.date_of_birth || '').trim() || null,
                  String(body.contact || '').trim() || null,
                  String(body.address || '').trim() || null,
                  String(body.emergency_contact || '').trim() || null,
                  String(body.patient_ref || '').trim() || null,
                  String(body.visit_department || '').trim() || null,
                  String(body.checkin_time || '').trim() || null,
                  body.pain_scale ?? null,
                  body.temperature_c ?? null,
                  String(body.blood_pressure || '').trim() || null,
                  body.pulse_bpm ?? null,
                  body.weight_kg ?? null,
                  String(body.chief_complaint || '').trim() || null,
                  String(body.severity || 'Low').trim() || 'Low',
                  String(body.assigned_doctor || 'Nurse Triage').trim() || 'Nurse Triage'
                ]
              );
              const created = (Array.isArray(createdRows) ? createdRows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Walk-In Created', `Walk-in case ${caseId} created for ${patientName}.`, toSafeText(created?.case_id || caseId));
              writeJson(res, 200, { ok: true, message: 'Walk-in created.', data: Array.isArray(createdRows) ? createdRows[0] : null });
              return;
            }

            const id = Number(body.id || 0);
            if (!id) {
              writeJson(res, 422, { ok: false, message: 'id is required.' });
              return;
            }

            const currentRows = await sql.query(
              `SELECT id, status, severity FROM patient_walkins WHERE id = $1 LIMIT 1`,
              [id]
            ) as Array<{ id: number; status: string; severity: string }>;

            if (!Array.isArray(currentRows) || currentRows.length === 0) {
              writeJson(res, 404, { ok: false, message: 'Walk-in case not found.' });
              return;
            }

            const currentStatus = String(currentRows[0].status || '');

            if (action === 'identify') {
              if (currentStatus !== 'waiting') {
                writeJson(res, 422, { ok: false, message: 'Only waiting patients can be identified.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins SET status = 'identified', updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Patient Identified', 'Case moved to identified status.', toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'queue_triage') {
              if (currentStatus !== 'identified') {
                writeJson(res, 422, { ok: false, message: 'Only identified patients can be moved to triage_pending.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins SET status = 'triage_pending', updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Queued To Triage', 'Case queued for triage.', toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'start_triage') {
              if (currentStatus !== 'triage_pending') {
                writeJson(res, 422, { ok: false, message: 'Start triage is only allowed from triage_pending.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins
                 SET status = 'in_triage', updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Triage Started', 'Case triage started.', toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'triage') {
              if (currentStatus !== 'in_triage') {
                writeJson(res, 422, { ok: false, message: 'Save triage is only allowed from in_triage.' });
                return;
              }
              const severityValue = String(body.severity || 'Low').trim();
              const nextStatus = severityValue === 'Emergency' ? 'emergency' : 'waiting_for_doctor';
              const rows = await sql.query(
                `UPDATE patient_walkins
                 SET chief_complaint = COALESCE($1, chief_complaint),
                     severity = $2,
                     status = $3,
                     updated_at = NOW()
                 WHERE id = $4
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [String(body.chief_complaint || '').trim() || null, severityValue, nextStatus, id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Triage Saved', `Triage saved with severity ${severityValue}.`, toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'assign') {
              if (currentStatus !== 'waiting_for_doctor') {
                writeJson(res, 422, { ok: false, message: 'Doctor assignment requires waiting_for_doctor status.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins
                 SET assigned_doctor = COALESCE($1, assigned_doctor),
                     status = 'waiting_for_doctor',
                     updated_at = NOW()
                 WHERE id = $2
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [String(body.assigned_doctor || '').trim() || null, id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Doctor Assigned', `Doctor assigned: ${toSafeText(body.assigned_doctor) || 'Unchanged'}.`, toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'complete') {
              if (currentStatus !== 'waiting_for_doctor') {
                writeJson(res, 422, { ok: false, message: 'Case can only be completed after doctor queue stage.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins SET status = 'completed', updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Case Completed', 'Walk-in case marked as completed.', toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'emergency') {
              if (currentStatus === 'completed') {
                writeJson(res, 422, { ok: false, message: 'Completed case cannot be escalated to emergency.' });
                return;
              }
              const rows = await sql.query(
                `UPDATE patient_walkins
                 SET status = 'emergency', severity = 'Emergency', assigned_doctor = 'ER Team', updated_at = NOW()
                 WHERE id = $1
                 RETURNING id, case_id, patient_name, age, contact, chief_complaint, severity, intake_time, assigned_doctor, status`,
                [id]
              );
              const updated = (Array.isArray(rows) ? rows[0] : null) as Record<string, unknown> | null;
              await logWalkIn('Emergency Escalated', 'Case escalated to emergency queue.', toSafeText(updated?.case_id || id));
              writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported action.' });
            return;
          }

          if (url.pathname === '/api/doctors' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureDoctorsTable(sql);
            const departmentName = toSafeText(url.searchParams.get('department'));
            const includeInactive = toSafeText(url.searchParams.get('include_inactive')).toLowerCase() === 'true';
            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;

            if (departmentName) {
              where.push(`LOWER(department_name) = LOWER($${idx})`);
              params.push(departmentName);
              idx += 1;
            }
            if (!includeInactive) {
              where.push(`is_active = TRUE`);
            }

            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const rows = await sql.query(
              `SELECT id, doctor_name, department_name, specialization, is_active, created_at::text AS created_at, updated_at::text AS updated_at
               FROM doctors
               ${whereSql}
               ORDER BY doctor_name ASC`,
              params
            );
            writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows : [] });
            return;
          }

          if (url.pathname === '/api/doctors' && (req.method || '').toUpperCase() === 'POST') {
            await ensureDoctorsTable(sql);
            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase() || 'upsert';
            const actor = toSafeText(body.actor) || 'Admin';

            if (action === 'upsert') {
              const doctorName = toSafeText(body.doctor_name);
              const departmentName = toSafeText(body.department_name);
              const specialization = toSafeText(body.specialization) || null;
              const isActive = body.is_active == null ? true : Boolean(body.is_active);
              if (!doctorName || !departmentName) {
                writeJson(res, 422, { ok: false, message: 'doctor_name and department_name are required.' });
                return;
              }

              const rows = await sql.query(
                `INSERT INTO doctors (doctor_name, department_name, specialization, is_active, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (doctor_name)
                 DO UPDATE SET
                   department_name = EXCLUDED.department_name,
                   specialization = EXCLUDED.specialization,
                   is_active = EXCLUDED.is_active,
                   updated_at = NOW()
                 RETURNING id, doctor_name, department_name, specialization, is_active, created_at::text AS created_at, updated_at::text AS updated_at`,
                [doctorName, departmentName, specialization, isActive]
              );

              await insertModuleActivity(
                'doctors',
                'Doctor Upserted',
                `${doctorName} profile saved under ${departmentName}.`,
                actor,
                'doctor',
                doctorName,
                { departmentName, specialization, isActive }
              );
              writeJson(res, 200, { ok: true, message: 'Doctor saved successfully.', data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'delete') {
              const id = toSafeInt(body.id, 0);
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }
              const rows = await sql.query(
                `DELETE FROM doctors
                 WHERE id = $1
                 RETURNING id, doctor_name, department_name, specialization, is_active`,
                [id]
              );
              if (!Array.isArray(rows) || !rows.length) {
                writeJson(res, 404, { ok: false, message: 'Doctor not found.' });
                return;
              }
              const removed = rows[0] as Record<string, unknown>;
              await insertModuleActivity(
                'doctors',
                'Doctor Deleted',
                `${toSafeText(removed.doctor_name)} was removed from doctor master list.`,
                actor,
                'doctor',
                toSafeText(removed.doctor_name),
                { id }
              );
              writeJson(res, 200, { ok: true, message: 'Doctor deleted.', data: removed });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported action.' });
            return;
          }

          if (url.pathname === '/api/doctor-availability' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureDoctorAvailabilityTables(sql);
            const doctorName = toSafeText(url.searchParams.get('doctor'));
            const departmentName = toSafeText(url.searchParams.get('department'));
            const appointmentDate = toSafeText(url.searchParams.get('date'));
            const preferredTime = toSafeText(url.searchParams.get('preferred_time'));
            const mode = toSafeText(url.searchParams.get('mode')).toLowerCase();

            if (mode === 'times') {
              const targetDate = toSafeIsoDate(appointmentDate);
              if (!targetDate) {
                writeJson(res, 422, { ok: false, message: 'Valid date is required for mode=times.' });
                return;
              }
              if (!departmentName) {
                writeJson(res, 422, { ok: false, message: 'department is required for mode=times.' });
                return;
              }

              const doctorRows = (await sql.query(
                `SELECT doctor_name, department_name
                 FROM doctors
                 WHERE is_active = TRUE
                   AND LOWER(department_name) = LOWER($1)
                   AND ($2::text = '' OR LOWER(doctor_name) = LOWER($2))
                 ORDER BY doctor_name ASC`,
                [departmentName, doctorName || '']
              )) as Array<{ doctor_name: string; department_name: string }>;

              const doctorSnapshots = await Promise.all(
                doctorRows.map(async (row) => {
                  const snapshot = await getDoctorAvailabilitySnapshot(
                    toSafeText(row.doctor_name),
                    toSafeText(row.department_name),
                    targetDate,
                    ''
                  );
                  return {
                    doctorName: toSafeText(row.doctor_name),
                    departmentName: toSafeText(row.department_name),
                    isDoctorAvailable: snapshot.isDoctorAvailable,
                    reason: snapshot.reason,
                    slots: snapshot.slots,
                    recommendedTimes: snapshot.recommendedTimes
                  };
                })
              );

              const allowedTimes = Array.from(
                new Set(
                  doctorSnapshots
                    .flatMap((item) => item.recommendedTimes || [])
                    .map((value) => String(value || '').slice(0, 5))
                    .filter((value) => /^\d{2}:\d{2}$/.test(value))
                )
              ).sort();

              writeJson(res, 200, {
                ok: true,
                data: {
                  appointmentDate: targetDate,
                  departmentName,
                  allowedTimes,
                  doctors: doctorSnapshots
                }
              });
              return;
            }

            if (appointmentDate && doctorName && departmentName && mode !== 'raw') {
              const snapshot = await getDoctorAvailabilitySnapshot(doctorName, departmentName, appointmentDate, preferredTime);
              writeJson(res, 200, {
                ok: true,
                data: {
                  doctorName,
                  departmentName,
                  appointmentDate,
                  isDoctorAvailable: snapshot.isDoctorAvailable,
                  reason: snapshot.reason,
                  slots: snapshot.slots,
                  recommendedTimes: snapshot.recommendedTimes
                }
              });
              return;
            }

            const where: string[] = [];
            const params: unknown[] = [];
            let idx = 1;
            if (doctorName) {
              params.push(doctorName.toLowerCase());
              where.push(`LOWER(doctor_name) = $${idx}`);
              idx += 1;
            }
            if (departmentName) {
              params.push(departmentName.toLowerCase());
              where.push(`LOWER(department_name) = $${idx}`);
              idx += 1;
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const rows = await sql.query(
              `SELECT id, doctor_name, department_name, day_of_week, start_time::text AS start_time, end_time::text AS end_time, max_appointments, is_active, created_at::text AS created_at, updated_at::text AS updated_at
               FROM doctor_availability
               ${whereSql}
               ORDER BY doctor_name ASC, department_name ASC, day_of_week ASC, start_time ASC`,
              params
            );
            writeJson(res, 200, { ok: true, data: Array.isArray(rows) ? rows : [] });
            return;
          }

          if (url.pathname === '/api/doctor-availability' && (req.method || '').toUpperCase() === 'POST') {
            await ensureDoctorAvailabilityTables(sql);
            await ensureDoctorsTable(sql);
            const body = await readJsonBody(req);
            const action = toSafeText(body.action).toLowerCase();
            const actor = toSafeText(body.actor) || 'Admin';

            if (action === 'upsert') {
              const doctorName = toSafeText(body.doctor_name);
              const departmentName = toSafeText(body.department_name);
              const dayOfWeek = toSafeInt(body.day_of_week, -1);
              const startTime = toSafeText(body.start_time).slice(0, 5);
              const endTime = toSafeText(body.end_time).slice(0, 5);
              const maxAppointments = Math.max(1, toSafeInt(body.max_appointments, 8));
              const isActive = body.is_active == null ? true : Boolean(body.is_active);

              if (!doctorName || !departmentName || dayOfWeek < 0 || dayOfWeek > 6 || !startTime || !endTime) {
                writeJson(res, 422, { ok: false, message: 'doctor_name, department_name, day_of_week, start_time, end_time are required.' });
                return;
              }
              if (startTime >= endTime) {
                writeJson(res, 422, { ok: false, message: 'end_time must be later than start_time.' });
                return;
              }

              await sql.query(
                `INSERT INTO doctors (doctor_name, department_name, is_active, updated_at)
                 VALUES ($1, $2, TRUE, NOW())
                 ON CONFLICT (doctor_name)
                 DO UPDATE SET
                    department_name = EXCLUDED.department_name,
                    updated_at = NOW()`,
                [doctorName, departmentName]
              );

              const rows = await sql.query(
                `INSERT INTO doctor_availability (doctor_name, department_name, day_of_week, start_time, end_time, max_appointments, is_active, updated_at)
                 VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,NOW())
                 ON CONFLICT (doctor_name, department_name, day_of_week, start_time, end_time)
                 DO UPDATE SET
                    max_appointments = EXCLUDED.max_appointments,
                    is_active = EXCLUDED.is_active,
                    updated_at = NOW()
                 RETURNING id, doctor_name, department_name, day_of_week, start_time::text AS start_time, end_time::text AS end_time, max_appointments, is_active, updated_at::text AS updated_at`,
                [doctorName, departmentName, dayOfWeek, startTime, endTime, maxAppointments, isActive]
              );

              await insertModuleActivity(
                'doctor_availability',
                'Schedule Upserted',
                `${doctorName} ${departmentName} schedule updated for day ${dayOfWeek} (${startTime}-${endTime}).`,
                actor,
                'doctor',
                doctorName,
                { departmentName, dayOfWeek, startTime, endTime, maxAppointments, isActive }
              );
              writeJson(res, 200, { ok: true, message: 'Doctor availability updated.', data: Array.isArray(rows) ? rows[0] : null });
              return;
            }

            if (action === 'delete') {
              const id = toSafeInt(body.id, 0);
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }
              const rows = await sql.query(
                `DELETE FROM doctor_availability
                 WHERE id = $1
                 RETURNING id, doctor_name, department_name, day_of_week, start_time::text AS start_time, end_time::text AS end_time, max_appointments, is_active`,
                [id]
              );
              if (!Array.isArray(rows) || !rows.length) {
                writeJson(res, 404, { ok: false, message: 'Schedule row not found.' });
                return;
              }
              const deleted = rows[0] as Record<string, unknown>;
              await insertModuleActivity(
                'doctor_availability',
                'Schedule Deleted',
                `${toSafeText(deleted.doctor_name)} ${toSafeText(deleted.department_name)} schedule row removed.`,
                actor,
                'doctor',
                toSafeText(deleted.doctor_name),
                { id }
              );
              writeJson(res, 200, { ok: true, message: 'Doctor availability deleted.', data: deleted });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported action.' });
            return;
          }

          if (url.pathname === '/api/checkups' && (req.method || '').toUpperCase() === 'POST') {
            await sql.query(`
              CREATE TABLE IF NOT EXISTS checkup_visits (
                id BIGSERIAL PRIMARY KEY,
                visit_id VARCHAR(40) NOT NULL UNIQUE,
                patient_name VARCHAR(150) NOT NULL,
                assigned_doctor VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
                source VARCHAR(50) NOT NULL DEFAULT 'appointment_confirmed',
                status VARCHAR(40) NOT NULL DEFAULT 'intake',
                chief_complaint TEXT NULL,
                diagnosis TEXT NULL,
                clinical_notes TEXT NULL,
                consultation_started_at TIMESTAMP NULL,
                lab_requested BOOLEAN NOT NULL DEFAULT FALSE,
                lab_result_ready BOOLEAN NOT NULL DEFAULT FALSE,
                prescription_created BOOLEAN NOT NULL DEFAULT FALSE,
                prescription_dispensed BOOLEAN NOT NULL DEFAULT FALSE,
                follow_up_date DATE NULL,
                is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
                version INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
              )
            `);

            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            const id = Number(body.id || 0);
            const expectedVersion = Number(body.expectedVersion || 0);

            if (!id) {
              writeJson(res, 422, { ok: false, message: 'id is required.' });
              return;
            }

            const rows = (await sql.query(
              `SELECT id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                      lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at
               FROM checkup_visits WHERE id = $1 LIMIT 1`,
              [id]
            )) as Array<Record<string, unknown>>;

            if (!Array.isArray(rows) || rows.length === 0) {
              writeJson(res, 404, { ok: false, message: 'Visit not found.' });
              return;
            }

            const current = rows[0];
            const currentStatus = String(current.status || 'intake').toLowerCase();
            const currentVersion = Number(current.version || 1);
            if (expectedVersion > 0 && expectedVersion !== currentVersion) {
              writeJson(res, 409, { ok: false, message: 'Visit has been updated by another user. Please refresh.' });
              return;
            }

            function fail(message: string): void {
              writeJson(res, 422, { ok: false, message });
            }

            let query = '';
            let params: unknown[] = [];

            if (action === 'queue') {
              if (currentStatus !== 'intake') {
                fail('Only intake visits can be queued.');
                return;
              }
              query = `UPDATE checkup_visits SET status = 'queue', version = version + 1, updated_at = NOW() WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'assign_doctor') {
              const assignedDoctor = String(body.assigned_doctor || '').trim();
              if (!assignedDoctor) {
                fail('assigned_doctor is required.');
                return;
              }
              if (!['queue', 'doctor_assigned', 'in_consultation'].includes(currentStatus)) {
                fail('Doctor assignment is allowed only for queue/assigned/in_consultation states.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET assigned_doctor = $1,
                           status = CASE WHEN status = 'queue' THEN 'doctor_assigned' ELSE status END,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $2
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [assignedDoctor, id];
            } else if (action === 'start_consultation') {
              if (!['doctor_assigned', 'queue'].includes(currentStatus)) {
                fail('Consultation can start only from doctor_assigned or queue.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'in_consultation', consultation_started_at = NOW(), version = version + 1, updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'save_consultation') {
              const diagnosis = String(body.diagnosis || '').trim();
              const notes = String(body.clinical_notes || '').trim();
              if (!diagnosis || !notes) {
                fail('diagnosis and clinical_notes are required.');
                return;
              }
              if (!['in_consultation', 'lab_requested'].includes(currentStatus)) {
                fail('Consultation save is allowed only during consultation/lab stage.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET diagnosis = $1,
                           clinical_notes = $2,
                           follow_up_date = $3,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $4
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [diagnosis, notes, String(body.follow_up_date || '').trim() || null, id];
            } else if (action === 'request_lab') {
              if (!['in_consultation', 'doctor_assigned'].includes(currentStatus)) {
                fail('Lab can only be requested during doctor consultation flow.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'lab_requested',
                           lab_requested = TRUE,
                           lab_result_ready = FALSE,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'mark_lab_ready') {
              if (currentStatus !== 'lab_requested') {
                fail('Only lab_requested visits can be marked as lab ready.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'in_consultation',
                           lab_result_ready = TRUE,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'send_pharmacy') {
              if (!['in_consultation', 'doctor_assigned'].includes(currentStatus)) {
                fail('Pharmacy routing requires active consultation.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'pharmacy',
                           prescription_created = TRUE,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'mark_dispensed') {
              if (currentStatus !== 'pharmacy') {
                fail('Only pharmacy state can be dispensed.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET prescription_dispensed = TRUE,
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'complete') {
              if (currentStatus !== 'in_consultation' && currentStatus !== 'pharmacy') {
                fail('Only in_consultation or pharmacy visits can be completed.');
                return;
              }
              if (!String(current.diagnosis || '').trim() || !String(current.clinical_notes || '').trim()) {
                fail('Diagnosis and clinical notes are required before completion.');
                return;
              }
              if (Boolean(current.lab_requested) && !Boolean(current.lab_result_ready)) {
                fail('Lab result must be ready before completion.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'completed',
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'archive') {
              if (currentStatus !== 'completed') {
                fail('Only completed visits can be archived.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'archived',
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'reopen') {
              if (currentStatus !== 'completed' && currentStatus !== 'archived') {
                fail('Only completed or archived visits can be reopened.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET status = 'in_consultation',
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else if (action === 'escalate_emergency') {
              if (currentStatus === 'archived') {
                fail('Archived visits cannot be escalated.');
                return;
              }
              query = `UPDATE checkup_visits
                       SET is_emergency = TRUE,
                           status = 'in_consultation',
                           version = version + 1,
                           updated_at = NOW()
                       WHERE id = $1
                       RETURNING id, visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes, consultation_started_at,
                                 lab_requested, lab_result_ready, prescription_created, prescription_dispensed, follow_up_date, is_emergency, version, created_at, updated_at`;
              params = [id];
            } else {
              fail('Unsupported check-up action.');
              return;
            }

            const updated = await sql.query(query, params);
            const updatedRow = (Array.isArray(updated) ? updated[0] : null) as Record<string, unknown> | null;
            await insertModuleActivity(
              'checkup',
              toActionLabel(action),
              `Check-up action ${toActionLabel(action)} applied to visit ${toSafeText(updatedRow?.visit_id || id)}.`,
              toSafeText(body.actor) || 'System',
              'checkup_visit',
              toSafeText(updatedRow?.visit_id || id),
              { action, id }
            );
            writeJson(res, 200, { ok: true, data: Array.isArray(updated) ? updated[0] : null });
            return;
          }

          if (url.pathname === '/api/registrations' && (req.method || '').toUpperCase() === 'POST') {
            await sql.query(`
              CREATE TABLE IF NOT EXISTS patient_registrations (
                id BIGSERIAL PRIMARY KEY,
                case_id VARCHAR(40) NOT NULL UNIQUE,
                patient_name VARCHAR(150) NOT NULL,
                patient_email VARCHAR(190) NULL,
                age SMALLINT NULL,
                concern TEXT NULL,
                intake_time TIMESTAMP NOT NULL DEFAULT NOW(),
                booked_time TIMESTAMP NOT NULL DEFAULT NOW(),
                status VARCHAR(20) NOT NULL DEFAULT 'Pending',
                assigned_to VARCHAR(120) NOT NULL DEFAULT 'Unassigned',
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
              )
            `);

            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            const id = Number(body.id || 0);
            const updateStatusSql = `
              UPDATE patient_registrations
              SET status = $1, updated_at = NOW()
              WHERE id = $2
              RETURNING id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to
            `;
            const selectRegistrationSql = `
              SELECT concern
              FROM patient_registrations
              WHERE id = $1
              LIMIT 1
            `;

            if (action === 'create') {
              const patientName = String(body.patient_name || '').trim();
              if (!patientName) {
                writeJson(res, 422, { ok: false, message: 'patient_name is required.' });
                return;
              }

              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const dd = String(now.getDate()).padStart(2, '0');
              const serial = Math.floor(1000 + Math.random() * 9000);
              const caseId = `REG-${yyyy}${mm}${dd}-${serial}`;

              const createdRows = await sql.query(
                `INSERT INTO patient_registrations (case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to)
                 VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamp, NOW()),COALESCE($7::timestamp, NOW()),$8,$9)
                 RETURNING id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to`,
                [
                  caseId,
                  patientName,
                  String(body.patient_email || '').trim() || null,
                  body.age ?? null,
                  String(body.concern || '').trim() || null,
                  String(body.intake_time || '').trim() || null,
                  String(body.booked_time || '').trim() || null,
                  String(body.status || 'Pending').trim() || 'Pending',
                  String(body.assigned_to || 'Unassigned').trim() || 'Unassigned'
                ]
              );
              const created = (Array.isArray(createdRows) ? createdRows[0] : null) as Record<string, unknown> | null;
              await insertModuleActivity(
                'registration',
                'Registration Created',
                `Registration ${toSafeText(created?.case_id || caseId)} created for ${patientName}.`,
                toSafeText(body.actor) || 'System',
                'registration',
                toSafeText(created?.case_id || caseId)
              );

              writeJson(res, 200, { ok: true, message: 'Registration created.', data: Array.isArray(createdRows) ? createdRows[0] : null });
              return;
            }

            if (action === 'update') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }

              const updatedRows = await sql.query(
                `UPDATE patient_registrations SET
                    patient_name = COALESCE($1, patient_name),
                    patient_email = $2,
                    age = $3,
                    concern = $4,
                    intake_time = COALESCE($5::timestamp, intake_time),
                    booked_time = COALESCE($6::timestamp, booked_time),
                    status = COALESCE($7, status),
                    assigned_to = COALESCE($8, assigned_to),
                    updated_at = NOW()
                 WHERE id = $9
                 RETURNING id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to`,
                [
                  String(body.patient_name || '').trim() || null,
                  String(body.patient_email || '').trim() || null,
                  body.age ?? null,
                  String(body.concern || '').trim() || null,
                  String(body.intake_time || '').trim() || null,
                  String(body.booked_time || '').trim() || null,
                  String(body.status || '').trim() || null,
                  String(body.assigned_to || '').trim() || null,
                  id
                ]
              );

              if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                writeJson(res, 404, { ok: false, message: 'Registration not found.' });
                return;
              }
              const updated = updatedRows[0] as Record<string, unknown>;
              await insertModuleActivity(
                'registration',
                'Registration Updated',
                `Registration ${toSafeText(updated.case_id || id)} updated.`,
                toSafeText(body.actor) || 'System',
                'registration',
                toSafeText(updated.case_id || id)
              );

              writeJson(res, 200, { ok: true, message: 'Registration updated.', data: updatedRows[0] });
              return;
            }

            if (action === 'approve' || action === 'set_status') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }

              const targetStatus = action === 'approve' ? 'Active' : String(body.status || '').trim();
              const allowedStatus = ['pending', 'review', 'active', 'archived'];
              if (!targetStatus || !allowedStatus.includes(targetStatus.toLowerCase())) {
                writeJson(res, 422, { ok: false, message: 'Invalid status transition target.' });
                return;
              }

              const approvedRows = await sql.query(updateStatusSql, [targetStatus, id]);

              if (!Array.isArray(approvedRows) || approvedRows.length === 0) {
                writeJson(res, 404, { ok: false, message: 'Registration not found.' });
                return;
              }
              const approved = approvedRows[0] as Record<string, unknown>;
              await insertModuleActivity(
                'registration',
                action === 'approve' ? 'Registration Approved' : 'Registration Status Updated',
                `Registration ${toSafeText(approved.case_id || id)} status set to ${targetStatus}.`,
                toSafeText(body.actor) || 'System',
                'registration',
                toSafeText(approved.case_id || id)
              );

              writeJson(res, 200, { ok: true, message: `Registration status updated to ${targetStatus}.`, data: approvedRows[0] });
              return;
            }

            if (action === 'assign') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }

              const assignedTo = String(body.assigned_to || '').trim();
              if (!assignedTo) {
                writeJson(res, 422, { ok: false, message: 'assigned_to is required.' });
                return;
              }

              const updatedRows = await sql.query(
                `UPDATE patient_registrations
                 SET assigned_to = $1, updated_at = NOW()
                 WHERE id = $2
                 RETURNING id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to`,
                [assignedTo, id]
              );

              if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
                writeJson(res, 404, { ok: false, message: 'Registration not found.' });
                return;
              }
              const updated = updatedRows[0] as Record<string, unknown>;
              await insertModuleActivity(
                'registration',
                'Registration Assigned',
                `Registration ${toSafeText(updated.case_id || id)} assigned to ${assignedTo}.`,
                toSafeText(body.actor) || 'System',
                'registration',
                toSafeText(updated.case_id || id)
              );

              writeJson(res, 200, { ok: true, message: 'Registration reassigned.', data: updatedRows[0] });
              return;
            }

            if (action === 'reject' || action === 'archive') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'id is required.' });
                return;
              }

              const reason = String(body.reason || '').trim();
              if (!reason) {
                writeJson(res, 422, { ok: false, message: 'reason is required.' });
                return;
              }

              const existingRows = (await sql.query(selectRegistrationSql, [id])) as Array<{ concern: string | null }>;
              if (!Array.isArray(existingRows) || existingRows.length === 0) {
                writeJson(res, 404, { ok: false, message: 'Registration not found.' });
                return;
              }

              const reasonLabel = action === 'reject' ? 'Rejection' : 'Archive';
              const nextConcern = `${String(existingRows[0].concern || 'No concern')} | ${reasonLabel}: ${reason}`;
              const updatedRows = await sql.query(
                `UPDATE patient_registrations
                 SET status = 'Archived',
                     concern = $1,
                     updated_at = NOW()
                 WHERE id = $2
                 RETURNING id, case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to`,
                [nextConcern, id]
              );

              const actionMessage = action === 'reject' ? 'Registration rejected.' : 'Registration archived.';
              const updated = (Array.isArray(updatedRows) ? updatedRows[0] : null) as Record<string, unknown> | null;
              await insertModuleActivity(
                'registration',
                action === 'reject' ? 'Registration Rejected' : 'Registration Archived',
                `${action === 'reject' ? 'Rejected' : 'Archived'} registration ${toSafeText(updated?.case_id || id)}. Reason: ${reason}`,
                toSafeText(body.actor) || 'System',
                'registration',
                toSafeText(updated?.case_id || id)
              );
              writeJson(res, 200, { ok: true, message: actionMessage, data: Array.isArray(updatedRows) ? updatedRows[0] : null });
              return;
            }

            writeJson(res, 422, { ok: false, message: 'Unsupported action.' });
            return;
          }

          if ((req.method || 'GET').toUpperCase() === 'GET') {
            await ensurePatientAppointmentsTable(sql);

            const search = (url.searchParams.get('search') || '').trim();
            const status = (url.searchParams.get('status') || '').trim();
            const service = (url.searchParams.get('service') || '').trim();
            const doctor = normalizeDoctorFilter((url.searchParams.get('doctor') || '').trim());
            const period = (url.searchParams.get('period') || '').trim().toLowerCase();
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || '10')));
            const offset = (page - 1) * perPage;

            const where: string[] = [];
            const params: unknown[] = [];
            let paramIndex = 1;

            if (search) {
              params.push(`%${search}%`);
              where.push(`(
                patient_name ILIKE $${paramIndex}
                OR patient_email ILIKE $${paramIndex}
                OR phone_number ILIKE $${paramIndex}
                OR booking_id ILIKE $${paramIndex}
                OR COALESCE(patient_id, '') ILIKE $${paramIndex}
                OR COALESCE(symptoms_summary, '') ILIKE $${paramIndex}
              )`);
              paramIndex += 1;
            }

            if (status && status.toLowerCase() !== 'all statuses') {
              params.push(status.toLowerCase());
              where.push(`LOWER(status) = $${paramIndex}`);
              paramIndex += 1;
            }

            if (service && service.toLowerCase() !== 'all services') {
              params.push(service.toLowerCase());
              where.push(`(LOWER(COALESCE(visit_type, department_name, '')) = $${paramIndex} OR LOWER(department_name) = $${paramIndex})`);
              paramIndex += 1;
            }

            if (doctor && doctor.toLowerCase() !== 'any') {
              params.push(doctor.toLowerCase());
              where.push(`LOWER(doctor_name) = $${paramIndex}`);
              paramIndex += 1;
            }

            if (period === 'today') {
              where.push('appointment_date = CURRENT_DATE');
            } else if (period === 'this week') {
              where.push("appointment_date >= DATE_TRUNC('week', CURRENT_DATE)::date AND appointment_date < (DATE_TRUNC('week', CURRENT_DATE)::date + INTERVAL '7 days')");
            } else if (period === 'this month') {
              where.push("appointment_date >= DATE_TRUNC('month', CURRENT_DATE)::date AND appointment_date < (DATE_TRUNC('month', CURRENT_DATE)::date + INTERVAL '1 month')");
            } else if (period === 'period: upcoming' || period === 'upcoming') {
              where.push('appointment_date >= CURRENT_DATE');
            }

            const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';

            const countQuery = `SELECT COUNT(*)::int AS total FROM patient_appointments${whereSql}`;
            const countRows = (await sql.query(countQuery, params)) as Array<{ total: number }>;
            const total = Number(countRows[0]?.total || 0);

            const dataQuery = `
              SELECT
                id,
                booking_id,
                patient_id,
                patient_name,
                patient_email,
                phone_number,
                emergency_contact,
                insurance_provider,
                payment_method,
                appointment_priority,
                doctor_name,
                COALESCE(NULLIF(visit_type, ''), department_name, 'General Check-Up') AS service_name,
                department_name,
                appointment_date,
                preferred_time,
                status,
                symptoms_summary,
                doctor_notes,
                visit_reason,
                created_at,
                updated_at
              FROM patient_appointments
              ${whereSql}
              ORDER BY appointment_date ASC, preferred_time ASC NULLS LAST
              LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
            `;
            const items = await sql.query(dataQuery, [...params, perPage, offset]);

            const [totalAppointmentsRows, todayRows, pendingRows, totalPatientsRows] = await Promise.all([
              sql.query('SELECT COUNT(*)::int AS total FROM patient_appointments'),
              sql.query('SELECT COUNT(*)::int AS total FROM patient_appointments WHERE appointment_date = CURRENT_DATE'),
              sql.query("SELECT COUNT(*)::int AS total FROM patient_appointments WHERE LOWER(COALESCE(status, '')) IN ('new', 'pending', 'awaiting')"),
              sql.query("SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(patient_email), ''), NULLIF(TRIM(phone_number), ''), patient_name))::int AS total FROM patient_appointments")
            ]);

            writeJson(res, 200, {
              ok: true,
              data: {
                analytics: {
                  totalPatients: Number((totalPatientsRows as Array<{ total: number }>)[0]?.total || 0),
                  totalAppointments: Number((totalAppointmentsRows as Array<{ total: number }>)[0]?.total || 0),
                  todayAppointments: Number((todayRows as Array<{ total: number }>)[0]?.total || 0),
                  pendingQueue: Number((pendingRows as Array<{ total: number }>)[0]?.total || 0)
                },
                items: Array.isArray(items) ? items : [],
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if ((req.method || '').toUpperCase() === 'POST') {
            await ensurePatientAppointmentsTable(sql);

            const body = await readJsonBody(req);
            const action = String(body.action || 'update').trim().toLowerCase();

            if (action === 'create') {
              const patientName = String(body.patient_name || '').trim();
              const phoneNumber = String(body.phone_number || '').trim();
              const doctorName = String(body.doctor_name || '').trim();
              const departmentName = String(body.department_name || '').trim();
              const visitType = String(body.visit_type || '').trim();
              const appointmentDate = String(body.appointment_date || '').trim();
              const preferredTime = String(body.preferred_time || '').trim();
              const status = String(body.status || 'Pending').trim() || 'Pending';
              const priority = String(body.appointment_priority || 'Routine').trim() || 'Routine';
              const patientId = String(body.patient_id || '').trim();
              const patientSex = String(body.patient_sex || body.patient_gender || '').trim() || null;
              const guardianName = String(body.guardian_name || '').trim() || null;
              const patientAge = Number(body.patient_age ?? 0);

              if (!patientName || !phoneNumber || !doctorName || !departmentName || !visitType || !appointmentDate) {
                writeJson(res, 422, { ok: false, message: 'Missing required create fields.' });
                return;
              }
              if (Number.isFinite(patientAge) && patientAge > 0 && patientAge < 18 && !guardianName) {
                writeJson(res, 422, { ok: false, message: 'guardian_name is required for minors.' });
                return;
              }
              if (!['Routine', 'Urgent'].includes(priority)) {
                writeJson(res, 422, { ok: false, message: 'appointment_priority must be Routine or Urgent.' });
                return;
              }
              if (!['Pending', 'Confirmed', 'Accepted', 'Awaiting', 'Canceled', 'New'].includes(status)) {
                writeJson(res, 422, { ok: false, message: 'Invalid appointment status.' });
                return;
              }
              const availability = await getDoctorAvailabilitySnapshot(doctorName, departmentName, appointmentDate, preferredTime);
              if (!availability.isDoctorAvailable) {
                writeJson(res, 422, { ok: false, message: availability.reason });
                return;
              }

              const now = new Date();
              const yyyy = now.getFullYear();
              const mm = String(now.getMonth() + 1).padStart(2, '0');
              const dd = String(now.getDate()).padStart(2, '0');
              const serial = Math.floor(1000 + Math.random() * 9000);
              const bookingId = `APT-${yyyy}${mm}${dd}-${serial}`;

              const insertQuery = `
                INSERT INTO patient_appointments (
                  booking_id,
                  patient_id,
                  patient_name,
                  patient_age,
                  patient_email,
                  patient_gender,
                  guardian_name,
                  phone_number,
                  emergency_contact,
                  insurance_provider,
                  payment_method,
                  appointment_priority,
                  symptoms_summary,
                  doctor_notes,
                  doctor_name,
                  department_name,
                  visit_type,
                  appointment_date,
                  preferred_time,
                  visit_reason,
                  status
                ) VALUES (
                  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                )
                RETURNING
                  id,
                  booking_id,
                  patient_id,
                  patient_name,
                  patient_email,
                  phone_number,
                  emergency_contact,
                  insurance_provider,
                  payment_method,
                  appointment_priority,
                  doctor_name,
                  COALESCE(NULLIF(visit_type, ''), department_name, 'General Check-Up') AS service_name,
                  department_name,
                  appointment_date,
                  preferred_time,
                  status,
                  symptoms_summary,
                  doctor_notes,
                  visit_reason,
                  created_at,
                  updated_at
              `;

              const createdRows = await sql.query(insertQuery, [
                bookingId,
                patientId || null,
                patientName,
                body.patient_age ?? null,
                String(body.patient_email || '').trim() || null,
                patientSex,
                guardianName,
                phoneNumber,
                String(body.emergency_contact || '').trim() || null,
                String(body.insurance_provider || '').trim() || null,
                String(body.payment_method || '').trim() || null,
                priority,
                String(body.symptoms_summary || '').trim() || null,
                String(body.doctor_notes || '').trim() || null,
                doctorName,
                departmentName,
                visitType,
                appointmentDate,
                preferredTime || null,
                String(body.visit_reason || '').trim() || null,
                status
              ]);

              writeJson(res, 200, {
                ok: true,
                message: 'Appointment created.',
                data: Array.isArray(createdRows) ? createdRows[0] : null
              });
              const created = (Array.isArray(createdRows) ? createdRows[0] : null) as Record<string, unknown> | null;
              await insertModuleActivity(
                'appointments',
                'Appointment Created',
                `Created appointment ${toSafeText(created?.booking_id || bookingId)} for ${patientName} with ${doctorName}.`,
                toSafeText(body.actor) || 'System',
                'appointment',
                toSafeText(created?.booking_id || bookingId),
                { doctorName, departmentName, appointmentDate, preferredTime: preferredTime || null, status }
              );
              return;
            }

            const bookingId = String(body.booking_id || '').trim();
            if (!bookingId) {
              writeJson(res, 422, { ok: false, message: 'booking_id is required.' });
              return;
            }

            const existingRows = (await sql.query(
              `SELECT booking_id, doctor_name, department_name, appointment_date::text AS appointment_date, preferred_time
               FROM patient_appointments
               WHERE booking_id = $1
               LIMIT 1`,
              [bookingId]
            )) as Array<{
              booking_id: string;
              doctor_name: string;
              department_name: string;
              appointment_date: string;
              preferred_time: string | null;
            }>;
            const existingAppointment = existingRows[0];
            if (!existingAppointment) {
              writeJson(res, 404, { ok: false, message: 'Appointment not found.' });
              return;
            }

            if (!('patient_gender' in body) && 'patient_sex' in body) {
              body.patient_gender = body.patient_sex;
            }

            const fieldMap: Record<string, string> = {
              status: 'status',
              patient_id: 'patient_id',
              patient_gender: 'patient_gender',
              guardian_name: 'guardian_name',
              emergency_contact: 'emergency_contact',
              insurance_provider: 'insurance_provider',
              payment_method: 'payment_method',
              appointment_priority: 'appointment_priority',
              symptoms_summary: 'symptoms_summary',
              doctor_notes: 'doctor_notes',
              doctor_name: 'doctor_name',
              department_name: 'department_name',
              visit_type: 'visit_type',
              appointment_date: 'appointment_date',
              preferred_time: 'preferred_time',
              visit_reason: 'visit_reason'
            };

            const setParts: string[] = [];
            const values: unknown[] = [];

            Object.entries(fieldMap).forEach(([key, column]) => {
              if (!(key in body)) return;
              const value = typeof body[key] === 'string' ? String(body[key]).trim() : body[key];
              values.push(value === '' ? null : value);
              setParts.push(`${column} = $${values.length}`);
            });

            if (!setParts.length) {
              writeJson(res, 422, { ok: false, message: 'No fields to update.' });
              return;
            }

            const nextDoctorName = 'doctor_name' in body ? toSafeText(body.doctor_name) : toSafeText(existingAppointment.doctor_name);
            const nextDepartmentName = 'department_name' in body ? toSafeText(body.department_name) : toSafeText(existingAppointment.department_name);
            const nextAppointmentDate = 'appointment_date' in body ? toSafeText(body.appointment_date) : toSafeText(existingAppointment.appointment_date);
            const nextPreferredTime = 'preferred_time' in body ? toSafeText(body.preferred_time) : toSafeText(existingAppointment.preferred_time);
            const nextStatus = 'status' in body ? toSafeText(body.status).toLowerCase() : '';
            if (nextStatus !== 'canceled') {
              const availability = await getDoctorAvailabilitySnapshot(
                nextDoctorName,
                nextDepartmentName,
                nextAppointmentDate,
                nextPreferredTime,
                bookingId
              );
              if (!availability.isDoctorAvailable) {
                writeJson(res, 422, { ok: false, message: availability.reason });
                return;
              }
            }

            values.push(bookingId);
            const bookingIndex = values.length;
            const updateQuery = `
              UPDATE patient_appointments
              SET ${setParts.join(', ')}, updated_at = NOW()
              WHERE booking_id = $${bookingIndex}
              RETURNING
                id,
                booking_id,
                patient_id,
                patient_name,
                patient_email,
                phone_number,
                emergency_contact,
                insurance_provider,
                payment_method,
                appointment_priority,
                doctor_name,
                COALESCE(NULLIF(visit_type, ''), department_name, 'General Check-Up') AS service_name,
                department_name,
                appointment_date,
                preferred_time,
                status,
                symptoms_summary,
                doctor_notes,
                visit_reason,
                created_at,
                updated_at
            `;

            const updatedRows = await sql.query(updateQuery, values);
            if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
              writeJson(res, 404, { ok: false, message: 'Appointment not found.' });
              return;
            }

            writeJson(res, 200, {
              ok: true,
              message: 'Appointment updated.',
              data: updatedRows[0]
            });
            await insertModuleActivity(
              'appointments',
              'Appointment Updated',
              `Updated appointment ${bookingId}.`,
              toSafeText(body.actor) || 'System',
              'appointment',
              bookingId,
              {
                doctorName: nextDoctorName || null,
                departmentName: nextDepartmentName || null,
                appointmentDate: nextAppointmentDate || null,
                preferredTime: nextPreferredTime || null
              }
            );
            return;
          }

          writeJson(res, 405, { ok: false, message: 'Method not allowed.' });
        } catch (error) {
          writeJson(res, 500, {
            ok: false,
            message: error instanceof Error ? error.message : 'Failed to query appointments.'
          });
        }
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || 'http://localhost';
  const devBackendRoot = normalizePathPrefix(env.VITE_DEV_BACKEND_ROOT || '/Clinic%20System');
  const databaseUrl = env.DATABASE_URL?.trim();

  return {
    plugins: [
      neonAppointmentsApiPlugin(databaseUrl),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => ['v-list-recognize-title'].includes(tag)
          }
        }
      }),
      vuetify({
        autoImport: true
      })
    ],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    css: {
      preprocessorOptions: {
        scss: {}
      }
    },
    server: {
      proxy: {
        '/backend': {
          target: devProxyTarget,
          changeOrigin: true,
          rewrite: (path) => `${devBackendRoot}${path}`
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 1024 * 1024 // Set the limit to 1 MB
    },
    optimizeDeps: {
      exclude: ['vuetify'],
      entries: ['./src/**/*.vue']
    }
  };
});
