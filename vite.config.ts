import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { neon } from '@neondatabase/serverless';
import pg from 'pg';
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
const sqlPoolByConnection = new Map<string, pg.Pool>();

function writeJson(res: any, statusCode: number, payload: JsonRecord): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function shouldUseNeonHttpDriver(connectionString: string): boolean {
  const value = String(connectionString || '').toLowerCase();
  return value.includes('.neon.tech') || value.includes('.neon.build');
}

function shouldUseSsl(connectionString: string): boolean {
  const value = String(connectionString || '').toLowerCase();
  return value.includes('supabase.co') || value.includes('supabase.net') || value.includes('pooler.supabase.com');
}

function createSqlClient(connectionString: string): { query: (sql: string, params?: unknown[]) => Promise<any[]> } {
  if (shouldUseNeonHttpDriver(connectionString)) {
    return neon(connectionString);
  }

  let pool = sqlPoolByConnection.get(connectionString);
  if (!pool) {
    const { Pool } = pg;
    pool = new Pool({
      connectionString,
      max: Number(process.env.DB_POOL_MAX || 2),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 10_000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8_000),
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 20_000),
      ...(shouldUseSsl(connectionString) ? { ssl: { rejectUnauthorized: false } } : {})
    });
    // Prevent Vite dev server from crashing on transient idle pool errors.
    pool.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown SQL pool error');
      console.error(`[cashier] SQL pool idle error: ${message}`);
    });
    sqlPoolByConnection.set(connectionString, pool);
  }

  return {
    async query(sql: string, params: unknown[] = []): Promise<any[]> {
      const result = await pool.query(sql, params);
      return result.rows;
    }
  };
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

async function ensureCashierEnrollmentFeedTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS public.cashier_registrar_student_enrollment_feed (
      id BIGSERIAL PRIMARY KEY,
      source_enrollment_id BIGINT UNIQUE,
      batch_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Registrar',
      office TEXT NOT NULL DEFAULT 'Registrar',
      student_no TEXT NOT NULL,
      student_name TEXT NOT NULL,
      class_code TEXT DEFAULT NULL,
      subject TEXT DEFAULT NULL,
      academic_year TEXT DEFAULT NULL,
      semester TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      downpayment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      payload JSONB DEFAULT NULL,
      decision_notes TEXT DEFAULT NULL,
      linked_billing_id INT DEFAULT NULL,
      linked_billing_code VARCHAR(80) DEFAULT NULL,
      last_action VARCHAR(60) DEFAULT NULL,
      action_by INT DEFAULT NULL,
      action_at TIMESTAMPTZ DEFAULT NULL,
      sent_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS decision_notes TEXT NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS linked_billing_id INT NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS linked_billing_code VARCHAR(80) NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS last_action VARCHAR(60) NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS action_at TIMESTAMPTZ NULL`);
  await sql.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS source_enrollment_id BIGINT NULL`);
  await sql.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cashier_registrar_student_enrollment_feed_source_enrollment_id
     ON public.cashier_registrar_student_enrollment_feed (source_enrollment_id)
     WHERE source_enrollment_id IS NOT NULL`
  );
}

async function ensureNotificationsTable(sql: ReturnType<typeof neon>): Promise<void> {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,
      recipient_role VARCHAR(60) NOT NULL DEFAULT 'admin',
      recipient_name VARCHAR(190) NULL,
      channel VARCHAR(40) NOT NULL DEFAULT 'in_app',
      type VARCHAR(80) NOT NULL DEFAULT 'general',
      title VARCHAR(190) NOT NULL,
      message TEXT NOT NULL,
      entity_type VARCHAR(80) NULL,
      entity_id BIGINT NULL,
      is_read SMALLINT NOT NULL DEFAULT 0,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_notifications_recent ON notifications(created_at DESC)`);
  await sql.query(`CREATE INDEX IF NOT EXISTS idx_notifications_role_read ON notifications(recipient_role, is_read, created_at DESC)`);
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
      const realtimeClients = new Set<any>();
      let realtimeClientSeq = 0;
      let realtimeHeartbeat: ReturnType<typeof setInterval> | null = null;
      let databaseInitializationPromise: Promise<void> | null = null;
      let databaseReady = false;
      let lastStableEnrollmentFeedRows: any[] = [];
      let lastPmedReportSyncAt = 0;
      const PMED_REPORT_SYNC_MIN_INTERVAL_MS = 90_000;

      const writeRealtimeEvent = (res: any, payload: Record<string, unknown>): void => {
        res.write(`data: ${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n\n`);
      };

      const broadcastRealtimeEvent = (payload: Record<string, unknown>): void => {
        for (const client of realtimeClients) {
          try {
            writeRealtimeEvent(client.res, payload);
          } catch {
            realtimeClients.delete(client);
          }
        }
      };

      const ensureRealtimeHeartbeat = (): void => {
        if (realtimeHeartbeat) return;
        realtimeHeartbeat = setInterval(() => {
          for (const client of realtimeClients) {
            try {
              client.res.write(`: heartbeat ${Date.now()}\n\n`);
            } catch {
              realtimeClients.delete(client);
            }
          }
          if (!realtimeClients.size && realtimeHeartbeat) {
            clearInterval(realtimeHeartbeat);
            realtimeHeartbeat = null;
          }
        }, 20000);
      };

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '', 'http://localhost');
        const isBillingVerifyRoute = /^\/api\/billings\/\d+\/verify$/.test(url.pathname);
        const isPaymentsApproveRoute = url.pathname === '/api/payments/approve';
        const isPaymentsMarkFailedRoute = /^\/api\/payments\/\d+\/mark-failed$/.test(url.pathname);
        const isInstallmentsRoute = url.pathname === '/api/installments';
        const isPaymentAuthorizeRoute = /^\/api\/payment-transactions\/\d+\/authorize$/.test(url.pathname);
        const isPaymentConfirmPaidRoute = /^\/api\/payment-transactions\/\d+\/confirm-paid$/.test(url.pathname);
        const isReceiptsGenerateRoute = url.pathname === '/api/receipts/generate';
        const isComplianceVerifyRoute = /^\/api\/compliance\/\d+\/verify-proof$/.test(url.pathname);
        const isComplianceCompleteRoute = /^\/api\/compliance\/\d+\/complete$/.test(url.pathname);
        const isReconciliationActionRoute = /^\/api\/reconciliation\/\d+\/(reconcile|archive|flag-discrepancy)$/.test(url.pathname);
        const isWorkflowCorrectionRoute = /^\/api\/workflow\/\d+\/return-for-correction$/.test(url.pathname);
        const isNotificationsSendRoute = url.pathname === '/api/notifications/send';
        const isNotificationsRoute = url.pathname === '/api/notifications';
        const isNotificationReadRoute = /^\/api\/notifications\/\d+\/read$/.test(url.pathname);
        const isNotificationsReadAllRoute = url.pathname === '/api/notifications/read-all';
        if (
          url.pathname !== '/api/realtime-stream' &&
          url.pathname !== '/api/clinic-sync/status' &&
          url.pathname !== '/api/report-center' &&
          url.pathname !== '/api/dashboard/hr-requests' &&
          url.pathname !== '/api/cashier/department-handoffs' &&
          url.pathname !== '/api/appointments' &&
          url.pathname !== '/api/admin-auth' &&
          url.pathname !== '/api/admin-profile' &&
          url.pathname !== '/api/student-billing' &&
          url.pathname !== '/api/cashier-registrar-student-enrollment-feed' &&
          url.pathname !== '/api/crad-student-list-feed' &&
          url.pathname !== '/api/process-payment' &&
          url.pathname !== '/api/generate-receipt' &&
          url.pathname !== '/api/reporting-reconciliation' &&
          url.pathname !== '/api/reports/transactions' &&
          url.pathname !== '/api/reports/export' &&
          url.pathname !== '/api/integrated-flow' &&
          !isBillingVerifyRoute &&
          !isPaymentsApproveRoute &&
          !isPaymentsMarkFailedRoute &&
          !isInstallmentsRoute &&
          !isPaymentAuthorizeRoute &&
          !isPaymentConfirmPaidRoute &&
          !isReceiptsGenerateRoute &&
          !isComplianceVerifyRoute &&
          !isComplianceCompleteRoute &&
          !isReconciliationActionRoute &&
          !isWorkflowCorrectionRoute &&
          !isNotificationsSendRoute &&
          !isNotificationsRoute &&
          !isNotificationReadRoute &&
          !isNotificationsReadAllRoute &&
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

        if (url.pathname === '/api/realtime-stream' && (req.method || 'GET').toUpperCase() === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
          res.write(`retry: 2000\n\n`);

          const client = { id: ++realtimeClientSeq, res };
          realtimeClients.add(client);
          ensureRealtimeHeartbeat();
          writeRealtimeEvent(res, { type: 'connected', module: 'system', action: 'Realtime Connected' });

          req.on('close', () => {
            realtimeClients.delete(client);
            if (!realtimeClients.size && realtimeHeartbeat) {
              clearInterval(realtimeHeartbeat);
              realtimeHeartbeat = null;
            }
          });
          return;
        }

        if (!databaseUrl) {
          writeJson(res, 500, { ok: false, message: 'DATABASE_URL is missing in admin_template/.env' });
          return;
        }

        const sql = createSqlClient(databaseUrl) as ReturnType<typeof neon>;

        // Ensure database tables are set up on server startup
        const initializeDatabase = async () => {
          let retries = 0;
          const maxRetries = 5;
          const baseDelayMs = 500;

          while (retries < maxRetries) {
            try {
              console.log(`[cashier] Initializing database, attempt ${retries + 1}/${maxRetries}...`);
              await ensureAdminProfileTables(sql);
              await ensureCashierEnrollmentFeedTable(sql);
              await ensureNotificationsTable(sql);
              await ensureModuleActivityLogsTable(sql);
              // Keep startup initialization lightweight to avoid DB timeouts.
              // Feature-specific tables are ensured lazily in their own routes.
              console.log('[cashier] Database initialized successfully.');
              databaseReady = true;
              return;
            } catch (error) {
              databaseReady = false;
              retries++;
              const delay = baseDelayMs * Math.pow(2, retries - 1);
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error(`[cashier] Database initialization failed (attempt ${retries}):`, errorMessage);
              if (retries < maxRetries) {
                console.log(`[cashier] Retrying database initialization in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
              } else {
                console.error('[cashier] Failed to initialize database after multiple retries. The application may not function correctly.');
              }
            }
          }
        };

        if (!databaseInitializationPromise) {
          databaseInitializationPromise = initializeDatabase().catch((error) => {
            databaseReady = false;
            console.error('[cashier] Database initialization promise failed:', error);
          });
        }

        if (!databaseReady) {
          if (url.pathname === '/api/admin-auth' && (req.method || 'GET').toUpperCase() === 'GET') {
            writeJson(res, 200, {
              ok: true,
              data: {
                authenticated: false,
                user: null
              },
              message: 'Database connection is warming up.'
            });
            return;
          }

          if (url.pathname === '/api/module-activity' && (req.method || 'GET').toUpperCase() === 'GET') {
            writeJson(res, 200, {
              ok: true,
              data: { items: [], meta: { page: 1, perPage: 20, total: 0, totalPages: 1 } },
              message: 'Database connection is warming up.'
            });
            return;
          }

          if (url.pathname === '/api/notifications' && (req.method || 'GET').toUpperCase() === 'GET') {
            writeJson(res, 200, {
              ok: true,
              data: { items: [], meta: { page: 1, perPage: 0, total: 0, totalPages: 1, unreadCount: 0, totalUnread: 0 } },
              message: 'Database connection is warming up.'
            });
            return;
          }

          if (url.pathname === '/api/cashier/department-handoffs' && (req.method || 'GET').toUpperCase() === 'GET') {
            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'Registrar Linked', value: '0', subtitle: 'Cashier records ready for registrar visibility', icon: 'mdi-school-outline', tone: 'blue' },
                  { title: 'PMED / Admin', value: '0', subtitle: 'Reporting-facing records for PMED and admin reports', icon: 'mdi-domain', tone: 'purple' },
                  { title: 'Cleared', value: '0', subtitle: 'Payment and official receipt already complete', icon: 'mdi-check-decagram-outline', tone: 'green' },
                  { title: 'Not Cleared', value: '0', subtitle: 'Records still waiting on payment or receipt completion', icon: 'mdi-alert-circle-outline', tone: 'orange' }
                ],
                matrix: [],
                items: [],
                latestItems: []
              },
              message: 'Database connection is warming up.'
            });
            return;
          }
        }
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

        const formatCurrency = (value: unknown): string => {
          const amount = Number(value || 0);
          return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number.isFinite(amount) ? amount : 0);
        };

        const mapPaymentStatus = (raw: string): 'Processing' | 'Authorized' | 'Paid' | 'Failed' | 'Cancelled' => {
          const value = String(raw || '').trim().toLowerCase();
          if (value === 'authorized') return 'Authorized';
          if (value === 'paid' || value === 'posted') return 'Paid';
          if (value === 'failed') return 'Failed';
          if (value === 'cancelled' || value === 'canceled') return 'Cancelled';
          return 'Processing';
        };

        const mapReportingStatus = (raw: string): 'Logged' | 'Reconciled' | 'Reported' | 'Archived' | 'With Discrepancy' => {
          const value = String(raw || '').trim().toLowerCase();
          if (value === 'reconciled') return 'Reconciled';
          if (value === 'reported') return 'Reported';
          if (value === 'archived') return 'Archived';
          if (value === 'with_discrepancy' || value === 'with discrepancy' || value === 'discrepancy') return 'With Discrepancy';
          return 'Logged';
        };

        const mapReceiptStatus = (raw: string): 'Receipt Pending' | 'Receipt Generated' | 'Proof Verified' | 'Documentation Completed' => {
          const value = String(raw || '').trim().toLowerCase();
          if (value === 'proof_verified' || value === 'verified') return 'Proof Verified';
          if (value === 'documentation_completed' || value === 'completed') return 'Documentation Completed';
          if (value) return 'Receipt Generated';
          return 'Receipt Pending';
        };

        const mapBillingStatusForVerification = (raw: string): 'Draft' | 'Active Billing' | 'Pending Payment' | 'Needs Correction' => {
          const value = String(raw || '').trim().toLowerCase();
          if (value.includes('correction') || value.includes('hold') || value.includes('reject') || value.includes('failed')) return 'Needs Correction';
          if (value === 'draft') return 'Draft';
          if (value === 'active' || value === 'active billing' || value === 'unpaid') return 'Active Billing';
          if (value === 'verified' || value === 'partial') return 'Pending Payment';
          return 'Pending Payment';
        };

        const mapBillingStatusForManagement = (balance: number, paid: number, raw: string): 'Pending Payment' | 'Partially Paid' | 'Fully Paid' | 'Payment Failed' => {
          if (Number(balance || 0) <= 0) return 'Fully Paid';
          if (String(raw || '').toLowerCase().includes('failed')) return 'Payment Failed';
          if (Number(paid || 0) > 0) return 'Partially Paid';
          return 'Pending Payment';
        };

        const workflowLabel = (stage: string): string => toActionLabel(String(stage || '').replace(/\./g, ' '));

        const integratedFlow = {
          nodes: [
            'Cashier',
            'Clinic',
            'HR Department',
            'PMED Department'
          ],
          edges: [
            { from: 'HR Department', to: 'Cashier', artifact: 'Payroll data' },
            { from: 'Cashier', to: 'HR Department', artifact: 'Financial summaries' },
            { from: 'Clinic', to: 'Cashier', artifact: 'Medical fee assessment' },
            { from: 'Clinic', to: 'Cashier', artifact: 'Service charges' },
            { from: 'Cashier', to: 'Clinic', artifact: 'Payment confirmation (medical fees)' },
            { from: 'PMED Department', to: 'Cashier', artifact: 'Financial report requests' },
            { from: 'Cashier', to: 'PMED Department', artifact: 'Payment status' },
            { from: 'Cashier', to: 'PMED Department', artifact: 'Financial reports' }
          ],
          functions: {
            getIncomingByDepartment: (department: string) =>
              (integratedFlow.edges || []).filter((edge) => String(edge.to).toLowerCase() === String(department || '').toLowerCase()),
            getOutgoingByDepartment: (department: string) =>
              (integratedFlow.edges || []).filter((edge) => String(edge.from).toLowerCase() === String(department || '').toLowerCase())
          }
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

        const normalizeEnrollmentFeedStatus = (rawStatus: unknown, linkedBillingId: number | null = null): string => {
          const normalized = toSafeText(rawStatus).toLowerCase();
          if (!normalized && linkedBillingId) return 'Approved';
          if (!normalized) return 'Pending Review';
          if (['pending', 'matched', 'sent to cashier', 'for verification'].includes(normalized)) return 'Pending Review';
          if (['cleared', 'approved', 'billing created', 'billing ready'].includes(normalized)) return 'Approved';
          if (normalized.includes('hold')) return 'On Hold';
          if (normalized.includes('return') || normalized.includes('reject')) return 'Returned To Registrar';
          if (normalized.includes('approve') || normalized.includes('billing')) return 'Approved';
          return toSafeText(rawStatus) || 'Pending Review';
        };

        const resolveEnrollmentFeedBucket = (status: unknown, linkedBillingId: number | null = null): 'pending' | 'approved' | 'hold' | 'returned' => {
          const normalized = normalizeEnrollmentFeedStatus(status, linkedBillingId).toLowerCase();
          if (normalized.includes('approve')) return 'approved';
          if (normalized.includes('hold')) return 'hold';
          if (normalized.includes('return') || normalized.includes('reject')) return 'returned';
          return 'pending';
        };

        const mapEnrollmentBillingStatus = (rawStatus: unknown, balanceAmount: unknown): string => {
          const value = String(rawStatus || '').trim().toLowerCase();
          const balance = Number(balanceAmount || 0);
          if (value === 'paid' || balance <= 0) return 'Fully Paid';
          if (value === 'partial') return 'Partially Paid';
          if (value === 'verified') return 'Pending Payment';
          if (value.includes('correction') || value.includes('hold') || value.includes('reject') || value.includes('failed')) return 'Needs Correction';
          return 'Active Billing';
        };

        const resolveEnrollmentFeedNextStep = (status: string, billingCode: string, billingStage: string): string => {
          if (billingCode) return `${billingCode} is available in ${workflowLabel(billingStage || 'student_portal_billing')}.`;
          const bucket = resolveEnrollmentFeedBucket(status);
          if (bucket === 'hold') return 'Await cashier validation before billing activation.';
          if (bucket === 'returned') return 'Await registrar correction and resend.';
          return 'Review the registrar submission and decide whether to create billing.';
        };

        const numberToOrdinalText = (value: number): string => {
          const normalized = Number(value || 0);
          if (!normalized) return '';
          const mod100 = normalized % 100;
          if (mod100 >= 11 && mod100 <= 13) return `${normalized}th`;
          const mod10 = normalized % 10;
          if (mod10 === 1) return `${normalized}st`;
          if (mod10 === 2) return `${normalized}nd`;
          if (mod10 === 3) return `${normalized}rd`;
          return `${normalized}th`;
        };

        const resolveEnrollmentCourse = (row: Record<string, unknown>): string => {
          const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
          const payloadCourse = toSafeText(payload.course);
          if (payloadCourse) return payloadCourse;
          const classCode = toSafeText(row.class_code);
          if (classCode.includes('-')) return classCode.split('-')[0];
          return classCode || toSafeText(row.subject) || 'General Enrollment';
        };

        const resolveEnrollmentYearLevel = (row: Record<string, unknown>): string => {
          const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
          const payloadYear = toSafeText(payload.year_level);
          if (payloadYear) return payloadYear;
          const classCode = toSafeText(row.class_code);
          const match = classCode.match(/-(\d)/);
          if (match?.[1]) return `${numberToOrdinalText(Number(match[1]))} Year`;
          return 'Enrolled';
        };

        const buildEnrollmentBillingCode = (feedId: number): string => `BILL-ENR-${new Date().getFullYear()}-${String(feedId).padStart(4, '0')}`;

        const buildEnrollmentBillingItems = (row: Record<string, unknown>, totalAmount: number) => {
          if (!(Number(totalAmount || 0) > 0)) return [] as Array<{ code: string; name: string; category: string; amount: number }>;
          const processingFee = Number(Math.min(Math.max(totalAmount * 0.18, 250), totalAmount).toFixed(2));
          const reservationAmount = Number(Math.max(0, totalAmount - processingFee).toFixed(2));
          const termLabel = [toSafeText(row.semester), toSafeText(row.academic_year)].filter(Boolean).join(' ');
          const subjectLabel = toSafeText(row.subject) || toSafeText(row.class_code) || 'Enrollment';
          const items: Array<{ code: string; name: string; category: string; amount: number }> = [];
          if (reservationAmount > 0) {
            items.push({
              code: 'ENR-DP',
              name: `${subjectLabel} Downpayment${termLabel ? ` - ${termLabel}` : ''}`,
              category: 'Enrollment',
              amount: reservationAmount
            });
          }
          if (processingFee > 0) {
            items.push({
              code: 'REG-PROC',
              name: 'Registrar Processing Fee',
              category: 'Registrar',
              amount: processingFee
            });
          }
          return items;
        };

        const buildEnrollmentDecisionPayload = (
          row: Record<string, unknown>,
          overrides: {
            action?: string;
            status?: string;
            remarks?: string;
            actorName?: string;
            actionAt?: string;
            linkedBillingId?: number | null;
            linkedBillingCode?: string | null;
          } = {}
        ): Record<string, unknown> => {
          const payload = row.payload && typeof row.payload === 'object' ? ({ ...(row.payload as Record<string, unknown>) } as Record<string, unknown>) : {};
          const previousDecision =
            payload.cashier_decision && typeof payload.cashier_decision === 'object'
              ? ({ ...(payload.cashier_decision as Record<string, unknown>) } as Record<string, unknown>)
              : {};
          payload.batch_id = toSafeText(row.batch_id);
          payload.source = toSafeText(row.source) || 'Registrar';
          payload.office = toSafeText(row.office) || 'Registrar';
          payload.student_no = toSafeText(row.student_no);
          payload.student_name = toSafeText(row.student_name);
          payload.class_code = toSafeText(row.class_code) || null;
          payload.subject = toSafeText(row.subject) || null;
          payload.academic_year = toSafeText(row.academic_year) || null;
          payload.semester = toSafeText(row.semester) || null;
          const resolvedLinkedBillingId =
            overrides.linkedBillingId != null ? Number(overrides.linkedBillingId) : Number(row.linked_billing_id || 0) || null;
          payload.status = normalizeEnrollmentFeedStatus(overrides.status || row.status, resolvedLinkedBillingId);
          payload.downpayment_amount = Number(row.downpayment_amount || 0);
          payload.cashier_decision = {
            ...previousDecision,
            action: overrides.action || toSafeText(previousDecision.action),
            remarks: overrides.remarks || toSafeText(previousDecision.remarks),
            actor_name: overrides.actorName || toSafeText(previousDecision.actor_name),
            action_at: overrides.actionAt || toSafeText(previousDecision.action_at) || null,
            linked_billing_id:
              overrides.linkedBillingId != null
                ? Number(overrides.linkedBillingId)
                : previousDecision.linked_billing_id != null
                  ? Number(previousDecision.linked_billing_id)
                  : null,
            linked_billing_code: overrides.linkedBillingCode || toSafeText(previousDecision.linked_billing_code) || null
          };
          return payload;
        };

        const isEnrollmentBillingLocked = (row: {
          workflow_stage?: string | null;
          billing_status?: string | null;
          balance_amount?: number | string | null;
          paid_amount?: number | string | null;
        }): boolean => {
          const stage = String(row.workflow_stage || '').trim().toLowerCase();
          return (
            Number(row.paid_amount || 0) > 0 ||
            ['payment_processing_gateway', 'compliance_documentation', 'reporting_reconciliation', 'completed'].includes(stage)
          );
        };

        const fetchEnrollmentFeedRecordById = async (feedId: number) => {
          if (!feedId) return null;
          const rows = (await sql.query(
            `SELECT
                f.id,
                f.batch_id,
                f.source,
                f.office,
                f.student_no,
                f.student_name,
                f.class_code,
                f.subject,
                f.academic_year,
                f.semester,
                f.status,
                f.downpayment_amount,
                f.payload,
                f.decision_notes,
                f.linked_billing_id,
                f.linked_billing_code,
                f.last_action,
                f.action_by,
                f.action_at::text AS action_at,
                f.sent_at::text AS sent_at,
                f.created_at::text AS created_at,
                b.id AS billing_id,
                b.billing_code,
                b.billing_status,
                b.workflow_stage AS billing_workflow_stage,
                b.balance_amount AS billing_balance_amount,
                p.full_name AS action_by_name,
                p.username AS action_by_username
             FROM public.cashier_registrar_student_enrollment_feed f
             LEFT JOIN billing_records b ON b.id = f.linked_billing_id
             LEFT JOIN admin_profiles p ON p.id = f.action_by
             WHERE f.id = $1
             LIMIT 1`,
            [feedId]
          )) as Array<Record<string, unknown>>;
          const row = rows[0];
          if (!row) return null;
          const linkedBillingId = Number(row.linked_billing_id || row.billing_id || 0) || null;
          const billingStage = linkedBillingId ? String(row.billing_workflow_stage || '') || 'student_portal_billing' : '';
          const status = normalizeEnrollmentFeedStatus(row.status, linkedBillingId);
          return {
            id: Number(row.id || 0),
            batchId: toSafeText(row.batch_id),
            source: toSafeText(row.source) || 'Registrar',
            office: toSafeText(row.office) || 'Registrar',
            studentNo: toSafeText(row.student_no),
            studentName: toSafeText(row.student_name) || 'Unknown Student',
            classCode: toSafeText(row.class_code),
            subject: toSafeText(row.subject),
            academicYear: toSafeText(row.academic_year),
            semester: toSafeText(row.semester),
            status,
            downpaymentAmount: Number(row.downpayment_amount || 0),
            downpaymentAmountFormatted: formatCurrency(row.downpayment_amount || 0),
            payload: row.payload && typeof row.payload === 'object' ? row.payload : null,
            decisionNotes: toSafeText(row.decision_notes),
            actionBy: toSafeText(row.action_by_name) || toSafeText(row.action_by_username),
            actionAt: row.action_at ? new Date(String(row.action_at)).toISOString() : null,
            lastAction: toSafeText(row.last_action),
            billingId: linkedBillingId,
            billingCode: toSafeText(row.linked_billing_code) || toSafeText(row.billing_code),
            billingStatus: linkedBillingId ? mapEnrollmentBillingStatus(row.billing_status, row.billing_balance_amount) : '',
            billingWorkflowStage: billingStage || null,
            billingWorkflowStageLabel: billingStage ? workflowLabel(billingStage) : '',
            nextStep: resolveEnrollmentFeedNextStep(status, toSafeText(row.linked_billing_code) || toSafeText(row.billing_code), billingStage),
            queueBucket: resolveEnrollmentFeedBucket(status, linkedBillingId),
            sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
            createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null
          };
        };

        const upsertEnrollmentFeedBilling = async (
          row: Record<string, unknown>,
          actor: { admin_profile_id?: number; full_name?: string; username?: string } | null,
          remarks: string
        ) => {
          const totalAmount = Number(row.downpayment_amount || 0);
          if (!(totalAmount > 0)) {
            throw new Error('Downpayment amount must be greater than zero before approval.');
          }

          const payload = row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {};
          const studentNo = toSafeText(row.student_no);
          const studentName = toSafeText(row.student_name);
          const course = resolveEnrollmentCourse(row);
          const yearLevel = resolveEnrollmentYearLevel(row);
          const email = toSafeText(payload.contact_email) || null;
          const phone = toSafeText(payload.contact_phone) || null;
          const semester = toSafeText(row.semester) || 'Current Semester';
          const schoolYear = toSafeText(row.academic_year) || String(new Date().getFullYear());
          const items = buildEnrollmentBillingItems(row, totalAmount);

          if (!studentNo || !studentName) {
            throw new Error('Student number and student name are required before approval.');
          }
          if (!items.length) {
            throw new Error('Unable to build billing items from the enrollment feed.');
          }

          const studentRows = (await sql.query(
            `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'active')
             ON CONFLICT (student_no) DO UPDATE
             SET full_name = EXCLUDED.full_name,
                 course = EXCLUDED.course,
                 year_level = EXCLUDED.year_level,
                 email = COALESCE(EXCLUDED.email, students.email),
                 phone = COALESCE(EXCLUDED.phone, students.phone),
                 status = 'active'
             RETURNING id`,
            [studentNo, studentName, course || null, yearLevel || null, email, phone]
          )) as Array<{ id: number }>;
          const studentId = Number(studentRows[0]?.id || 0);
          if (!studentId) {
            throw new Error('Unable to prepare the linked student record.');
          }

          let existingBilling:
            | {
                id: number;
                billing_code: string;
                billing_status: string;
                workflow_stage: string;
                paid_amount: number;
                balance_amount: number;
              }
            | null = null;

          const linkedBillingId = Number(row.linked_billing_id || 0) || null;
          const linkedBillingCode = toSafeText(row.linked_billing_code);
          if (linkedBillingId) {
            const rows = (await sql.query(
              `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
               FROM billing_records
               WHERE id = $1
               LIMIT 1`,
              [linkedBillingId]
            )) as Array<{ id: number; billing_code: string; billing_status: string; workflow_stage: string; paid_amount: number; balance_amount: number }>;
            existingBilling = rows[0] || null;
          } else if (linkedBillingCode) {
            const rows = (await sql.query(
              `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
               FROM billing_records
               WHERE billing_code = $1
               LIMIT 1`,
              [linkedBillingCode]
            )) as Array<{ id: number; billing_code: string; billing_status: string; workflow_stage: string; paid_amount: number; balance_amount: number }>;
            existingBilling = rows[0] || null;
          }

          if (!existingBilling) {
            const rows = (await sql.query(
              `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
               FROM billing_records
               WHERE student_id = $1
                 AND semester = $2
                 AND school_year = $3
                 AND integration_profile = 'registrar_enrollment_feed'
               ORDER BY id DESC
               LIMIT 1`,
              [studentId, semester, schoolYear]
            )) as Array<{ id: number; billing_code: string; billing_status: string; workflow_stage: string; paid_amount: number; balance_amount: number }>;
            existingBilling = rows[0] || null;
          }

          if (existingBilling && isEnrollmentBillingLocked(existingBilling)) {
            return {
              billingId: Number(existingBilling.id),
              billingCode: toSafeText(existingBilling.billing_code),
              workflowStage: toSafeText(existingBilling.workflow_stage) || 'student_portal_billing',
              reused: true,
              locked: true
            };
          }

          const billingCode = toSafeText(existingBilling?.billing_code) || buildEnrollmentBillingCode(Number(row.id || 0));
          const targetStage = toSafeText(existingBilling?.workflow_stage) === 'pay_bills' ? 'pay_bills' : 'student_portal_billing';
          let billingId = Number(existingBilling?.id || 0);

          if (!billingId) {
            const rows = (await sql.query(
              `INSERT INTO billing_records (
                 student_id,
                 billing_code,
                 source_module,
                 source_department,
                 source_category,
                 integration_profile,
                 target_department,
                 semester,
                 school_year,
                 total_amount,
                 paid_amount,
                 balance_amount,
                 billing_status,
                 workflow_stage,
                 remarks,
                 action_by,
                 action_at,
                 audit_reference,
                 created_at,
                 updated_at
               ) VALUES (
                 $1, $2, 'Registrar Enrollment Feed', $3, 'Enrollment Downpayment', 'registrar_enrollment_feed', 'Cashier',
                 $4, $5, $6, 0, $6, 'active', $7, $8, $9, NOW(), $10, NOW(), NOW()
               )
               RETURNING id`,
              [
                studentId,
                billingCode,
                toSafeText(row.office) || 'Registrar',
                semester,
                schoolYear,
                totalAmount,
                targetStage,
                remarks || 'Created from registrar enrollment feed approval.',
                actor?.admin_profile_id || null,
                `ENR-FEED-${Number(row.id || 0)}-${Date.now()}`
              ]
            )) as Array<{ id: number }>;
            billingId = Number(rows[0]?.id || 0);
          } else {
            await sql.query(
              `UPDATE billing_records
               SET student_id = $2,
                   source_module = 'Registrar Enrollment Feed',
                   source_department = $3,
                   source_category = 'Enrollment Downpayment',
                   integration_profile = 'registrar_enrollment_feed',
                   target_department = 'Cashier',
                   semester = $4,
                   school_year = $5,
                   balance_amount = $6,
                   billing_status = 'active',
                   workflow_stage = $7,
                   remarks = $8,
                   action_by = $9,
                   action_at = NOW(),
                   audit_reference = $10,
                   is_returned = 0,
                   needs_correction = 0,
                   correction_reason = NULL,
                   correction_notes = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [
                billingId,
                studentId,
                toSafeText(row.office) || 'Registrar',
                semester,
                schoolYear,
                totalAmount,
                targetStage,
                remarks || 'Updated from registrar enrollment feed approval.',
                actor?.admin_profile_id || null,
                `ENR-FEED-${Number(row.id || 0)}-${Date.now()}`
              ]
            );
            await sql.query(`DELETE FROM billing_items WHERE billing_id = $1`, [billingId]);
          }

          for (const [index, item] of items.entries()) {
            await sql.query(
              `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [billingId, item.code, item.name, item.category, item.amount, index + 1]
            );
          }

          await sql.query(
            `UPDATE billing_records
             SET total_amount = $2,
                 paid_amount = 0,
                 balance_amount = $2,
                 billing_status = 'active',
                 workflow_stage = $3,
                 updated_at = NOW()
             WHERE id = $1`,
            [billingId, totalAmount, targetStage]
          );

          return {
            billingId,
            billingCode,
            workflowStage: targetStage,
            reused: Boolean(existingBilling),
            locked: false
          };
        };

        async function ensureCashierWorkflowDemoData(): Promise<void> {
          await ensureModuleActivityLogsTable(sql);

          const demoStudents = [
            {
              studentNo: '2026-CT-1001',
              fullName: 'Mira Castillo',
              course: 'BS Accountancy',
              yearLevel: '3rd Year',
              email: 'mira.castillo@example.com',
              phone: '09171111001'
            },
            {
              studentNo: 'CLINIC-PHR-DEMO-2001',
              fullName: 'Emma Tan',
              course: 'Clinic Services',
              yearLevel: 'Clinic',
              email: 'emma.tan@clinic.local',
              phone: '09172222001'
            }
          ];

          for (const student of demoStudents) {
            await sql.query(
              `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
               VALUES ($1, $2, $3, $4, $5, $6, 'active')
               ON CONFLICT (student_no) DO UPDATE
               SET full_name = EXCLUDED.full_name,
                   course = EXCLUDED.course,
                   year_level = EXCLUDED.year_level,
                   email = EXCLUDED.email,
                   phone = EXCLUDED.phone,
                   status = 'active'`,
              [student.studentNo, student.fullName, student.course, student.yearLevel, student.email, student.phone]
            );
          }

          const completedSeeds = [
            {
              studentNo: '2026-CT-1001',
              billingCode: 'BILL-COMP-2001',
              totalAmount: 8750,
              paidAmount: 8750,
              billingStatus: 'paid',
              paymentReference: 'PAY-COMP-2026-2001',
              paymentMethod: 'Cash',
              paymentRemarks: 'Completed cashier seed for archived reporting.',
              receiptNumber: 'OR-COMP-2026-2001',
              receiptStatus: 'released',
              feeItems: [
                { code: 'TUITION', name: 'Tuition Fee', category: 'Tuition', amount: 7000 },
                { code: 'MISC', name: 'Miscellaneous Fee', category: 'Assessment', amount: 1750 }
              ]
            },
            {
              studentNo: 'CLINIC-PHR-DEMO-2001',
              billingCode: 'DSP-2026-0902',
              totalAmount: 1470,
              paidAmount: 1470,
              billingStatus: 'paid',
              paymentReference: 'PAY-COMP-2026-2002',
              paymentMethod: 'Cash',
              paymentRemarks: 'Clinic-origin completed cashier seed for archived reporting.',
              receiptNumber: 'OR-COMP-2026-2002',
              receiptStatus: 'released',
              feeItems: [
                { code: 'DSP-MED', name: 'Dispense Request', category: 'Pharmacy & Inventory', amount: 1250 },
                { code: 'DSP-SVC', name: 'Dispensing Service Fee', category: 'Clinic', amount: 220 }
              ]
            }
          ];

          for (const seed of completedSeeds) {
            const billingRows = (await sql.query(
              `INSERT INTO billing_records (
                 student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, remarks, created_at, updated_at
               )
               SELECT id, $2, '2nd Semester', '2025-2026', $3, $4, 0, $5, 'completed', $6, NOW() - INTERVAL '3 day', NOW() - INTERVAL '1 day'
               FROM students
               WHERE student_no = $1
               ON CONFLICT (billing_code) DO UPDATE
               SET total_amount = EXCLUDED.total_amount,
                   paid_amount = EXCLUDED.paid_amount,
                   balance_amount = EXCLUDED.balance_amount,
                   billing_status = EXCLUDED.billing_status,
                   workflow_stage = EXCLUDED.workflow_stage,
                   remarks = EXCLUDED.remarks,
                   updated_at = EXCLUDED.updated_at
               RETURNING id`,
              [seed.studentNo, seed.billingCode, seed.totalAmount, seed.paidAmount, seed.billingStatus, seed.paymentRemarks]
            )) as Array<{ id: number }>;

            const billingId = Number(billingRows[0]?.id || 0);
            if (!billingId) continue;

            const billingItemRows = (await sql.query(
              `SELECT COUNT(*)::int AS total FROM billing_items WHERE billing_id = $1`,
              [billingId]
            )) as Array<{ total: number }>;
            if (!Number(billingItemRows[0]?.total || 0)) {
              for (const [index, fee] of seed.feeItems.entries()) {
                await sql.query(
                  `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '3 day')`,
                  [billingId, fee.code, fee.name, fee.category, fee.amount, index + 1]
                );
              }
            }

            await sql.query(
              `INSERT INTO payment_transactions (
                 billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage,
                 payment_date, processed_by, remarks, created_at
               )
               VALUES ($1, $2, $3, $4, 'posted', 'archived', 'completed', NOW() - INTERVAL '2 day', NULL, $5, NOW() - INTERVAL '2 day')
               ON CONFLICT (reference_number) DO UPDATE
               SET amount_paid = EXCLUDED.amount_paid,
                   payment_method = EXCLUDED.payment_method,
                   payment_status = EXCLUDED.payment_status,
                   reporting_status = EXCLUDED.reporting_status,
                   workflow_stage = EXCLUDED.workflow_stage,
                   payment_date = EXCLUDED.payment_date,
                   remarks = EXCLUDED.remarks`,
              [billingId, seed.paymentReference, seed.paidAmount, seed.paymentMethod, seed.paymentRemarks]
            );

            const paymentRows = (await sql.query(
              `SELECT id FROM payment_transactions WHERE reference_number = $1 LIMIT 1`,
              [seed.paymentReference]
            )) as Array<{ id: number }>;
            const paymentId = Number(paymentRows[0]?.id || 0);
            if (!paymentId) continue;

            const receiptRows = (await sql.query(
              `SELECT id FROM receipt_records WHERE payment_id = $1 LIMIT 1`,
              [paymentId]
            )) as Array<{ id: number }>;

            if (receiptRows[0]?.id) {
              await sql.query(
                `UPDATE receipt_records
                 SET receipt_number = $2,
                     issued_date = NOW() - INTERVAL '2 day',
                     receipt_status = $3,
                     workflow_stage = 'completed',
                     remarks = 'Completed transaction seed receipt.'
                 WHERE id = $1`,
                [receiptRows[0].id, seed.receiptNumber, seed.receiptStatus]
              );
            } else {
              await sql.query(
                `INSERT INTO receipt_records (
                   payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, created_at
                 )
                 VALUES ($1, $2, NOW() - INTERVAL '2 day', $3, 'completed', 'Completed transaction seed receipt.', NOW() - INTERVAL '2 day')`,
                [paymentId, seed.receiptNumber, seed.receiptStatus]
              );
            }
          }

          const demoLogs = [
            {
              module: 'process_payment',
              action: 'Gateway Validation Passed',
              detail: 'PAY-773942380343-440 was validated and prepared for authorization in Payment Processing & Gateway.',
              actor: 'Cashier Gateway Officer',
              entityType: 'payment',
              entityKey: 'PAY-773942380343-440'
            },
            {
              module: 'process_payment',
              action: 'Paid Confirmation Routed',
              detail: 'PAY-COMP-2026-2002 was confirmed as paid and moved to Compliance & Documentation.',
              actor: 'Cashier Gateway Officer',
              entityType: 'payment',
              entityKey: 'PAY-COMP-2026-2002'
            },
            {
              module: 'reports',
              action: 'Completed Transaction Archived',
              detail: 'PAY-COMP-2026-2001 was archived into completed transaction history for final reporting.',
              actor: 'Cashier Reports Analyst',
              entityType: 'payment',
              entityKey: 'PAY-COMP-2026-2001'
            },
            {
              module: 'reports',
              action: 'Official Receipt Released',
              detail: 'OR-COMP-2026-2002 is available as the official receipt for the archived completed transaction.',
              actor: 'Compliance Documentation Officer',
              entityType: 'receipt',
              entityKey: 'OR-COMP-2026-2002'
            }
          ];

          for (const log of demoLogs) {
            const existing = (await sql.query(
              `SELECT id
               FROM module_activity_logs
               WHERE LOWER(module) = LOWER($1)
                 AND LOWER(action) = LOWER($2)
                 AND COALESCE(entity_key, '') = $3
               LIMIT 1`,
              [log.module, log.action, log.entityKey]
            )) as Array<{ id: number }>;

            if (existing.length) continue;

            await insertModuleActivity(log.module, log.action, log.detail, log.actor, log.entityType, log.entityKey, {
              seeded: true
            });
          }
        }

        function formatRelativeTime(value: string | Date | null | undefined): string {
          if (!value) return 'Just now';
          const date = value instanceof Date ? value : new Date(value);
          if (Number.isNaN(date.getTime())) return 'Just now';
          const diffMs = Date.now() - date.getTime();
          const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
          if (diffMinutes < 1) return 'Just now';
          if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`;
          const diffHours = Math.floor(diffMinutes / 60);
          if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
          const diffDays = Math.floor(diffHours / 24);
          if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
          return date.toLocaleDateString();
        }

        function formatDateTimeLabel(value: string | Date | null | undefined): string {
          if (!value) return '--';
          const date = value instanceof Date ? value : new Date(value);
          if (Number.isNaN(date.getTime())) return '--';
          return new Intl.DateTimeFormat('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'Asia/Manila'
          }).format(date) + ' GMT+8';
        }

        async function resolveDepartmentClearanceRelation(): Promise<string> {
          const rows = (await sql.query(
            `SELECT CASE
               WHEN to_regclass('clinic.department_clearance_records') IS NOT NULL THEN 'clinic.department_clearance_records'
               WHEN to_regclass('pmed.department_clearance_records') IS NOT NULL THEN 'pmed.department_clearance_records'
               WHEN to_regclass('public.department_clearance_records') IS NOT NULL THEN 'public.department_clearance_records'
               ELSE ''
             END AS relation`
          )) as Array<{ relation: string | null }>;
          return toSafeText(rows[0]?.relation);
        }

        async function fetchPmedCashierRequestRows(limit = 50): Promise<Array<{
          id: number;
          action: string;
          detail: string;
          actor: string;
          entity_key: string | null;
          metadata: Record<string, unknown> | string | null;
          created_at: string;
        }>> {
          const maxRows = Math.max(1, Math.trunc(limit));
          await ensureModuleActivityLogsTable(sql);
          const activityRows = (await sql.query(
            `SELECT id, action, detail, actor, entity_key, metadata, created_at
             FROM module_activity_logs
             WHERE LOWER(module) = 'department_reports'
               AND LOWER(COALESCE(metadata->>'source_department', '')) = 'pmed'
               AND (
                 LOWER(COALESCE(metadata->>'target_department', metadata->>'target_key', '')) IN ('cashier', 'reports')
                 OR LOWER(COALESCE(metadata->>'target_department_name', '')) = 'cashier'
               )
               AND (
                 LOWER(action) LIKE '%report requested%'
                 OR LOWER(COALESCE(metadata->>'request_status', '')) = 'requested'
                 OR LOWER(COALESCE(metadata->>'delivery_status', '')) = 'awaiting department'
               )
             ORDER BY created_at DESC
             LIMIT ${maxRows}`
          )) as Array<{
            id: number;
            action: string;
            detail: string;
            actor: string;
            entity_key: string | null;
            metadata: Record<string, unknown> | string | null;
            created_at: string;
          }>;

          const unifiedRows = [...activityRows];
          const seenReferences = new Set(
            activityRows.map((row) => {
              const metadata = typeof row.metadata === 'string'
                ? (() => {
                    try {
                      return JSON.parse(row.metadata) as Record<string, unknown>;
                    } catch {
                      return {} as Record<string, unknown>;
                    }
                  })()
                : ((row.metadata || {}) as Record<string, unknown>);
              return (
                toSafeText(metadata.report_reference) ||
                toSafeText(row.entity_key) ||
                String(row.id)
              ).toLowerCase();
            })
          );

          const clearanceRelation = await resolveDepartmentClearanceRelation();
          if (clearanceRelation) {
            const clearanceRows = (await sql.query(
              `SELECT id, clearance_reference, department_key, department_name, status, remarks, requested_by, external_reference,
                      metadata, created_at::text AS created_at, updated_at::text AS updated_at
               FROM ${clearanceRelation}
               WHERE LOWER(COALESCE(department_key, '')) = 'cashier'
                 AND LOWER(COALESCE(status, '')) = 'pending'
                 AND LOWER(COALESCE(metadata->>'source_department', '')) = 'pmed'
                 AND (
                   LOWER(COALESCE(metadata->>'requested_department', '')) = 'cashier'
                   OR LOWER(COALESCE(metadata->>'requested_department_name', '')) = 'cashier'
                 )
                 AND (
                   LOWER(COALESCE(metadata->>'request_status', '')) = 'requested'
                   OR LOWER(COALESCE(metadata->>'delivery_status', '')) = 'awaiting department'
                 )
               ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
               LIMIT ${maxRows}`
            )) as Array<{
              id: number;
              clearance_reference: string;
              department_key: string;
              department_name: string;
              status: string;
              remarks: string | null;
              requested_by: string | null;
              external_reference: string | null;
              metadata: Record<string, unknown> | string | null;
              created_at: string;
              updated_at: string | null;
            }>;

            for (const row of clearanceRows) {
              const metadata = typeof row.metadata === 'string'
                ? (() => {
                    try {
                      return JSON.parse(row.metadata) as Record<string, unknown>;
                    } catch {
                      return {} as Record<string, unknown>;
                    }
                  })()
                : ((row.metadata || {}) as Record<string, unknown>);
              const reportReference =
                toSafeText(metadata.report_reference) ||
                toSafeText(row.external_reference) ||
                toSafeText(row.clearance_reference);
              const dedupeKey = (reportReference || String(row.id)).toLowerCase();
              if (seenReferences.has(dedupeKey)) continue;
              seenReferences.add(dedupeKey);
              unifiedRows.push({
                id: -Math.abs(Number(row.id || 0)),
                action: 'PMED Report Requested',
                detail: toSafeText(row.remarks) || `PMED requested ${toSafeText(row.department_name) || 'Cashier'} to submit ${toSafeText(metadata.report_name) || 'a report'}.`,
                actor: toSafeText(row.requested_by) || 'PMED Reports Desk',
                entity_key: reportReference || null,
                metadata: {
                  ...metadata,
                  source_department: 'pmed',
                  source_department_name: 'PMED',
                  target_department: 'cashier',
                  target_department_name: 'Cashier',
                  target_key: 'cashier',
                  request_status: toSafeText(metadata.request_status) || 'requested',
                  report_reference: reportReference || null,
                  report_name: toSafeText(metadata.report_name) || toSafeText(row.clearance_reference) || 'Requested Cashier Report',
                  report_type: toSafeText(metadata.report_type) || 'Cashier Report',
                  plan_reference: toSafeText(metadata.plan_reference) || null
                },
                created_at: toSafeText(row.updated_at) || toSafeText(row.created_at)
              });
            }
          }

          return unifiedRows
            .sort((left, right) => new Date(String(right.created_at || '')).getTime() - new Date(String(left.created_at || '')).getTime())
            .slice(0, maxRows);
        }

        async function syncPmedReportRequestNotifications(): Promise<void> {
          const now = Date.now();
          if (now - lastPmedReportSyncAt < PMED_REPORT_SYNC_MIN_INTERVAL_MS) {
            return;
          }
          lastPmedReportSyncAt = now;
          try {
            await ensureNotificationsTable(sql);
            const requestRows = await fetchPmedCashierRequestRows(50);
            for (const row of requestRows) {
              const metadata = typeof row.metadata === 'string'
                ? (() => {
                    try {
                      return JSON.parse(row.metadata) as Record<string, unknown>;
                    } catch {
                      return {} as Record<string, unknown>;
                    }
                  })()
                : ((row.metadata || {}) as Record<string, unknown>);
              const existing = (await sql.query(
                `SELECT id
                 FROM notifications
                 WHERE entity_type = 'department_report_request'
                   AND entity_id = $1
                 LIMIT 1`,
                [row.id]
              )) as Array<{ id: number }>;
              if (existing.length) continue;
              const reportName = toSafeText(metadata.report_name) || toSafeText(row.entity_key) || 'Requested Cashier Report';
              const reportReference = toSafeText(metadata.report_reference) || toSafeText(row.entity_key);
              await sql.query(
                `INSERT INTO notifications (
                   recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
                 )
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9)`,
                [
                  'cashier',
                  'Cashier Reports Desk',
                  'in_app',
                  'pmed_report_request',
                  `PMED requested ${reportName}`,
                  `${toSafeText(row.detail) || 'PMED requested a cashier financial report.'}${reportReference ? ` Reference: ${reportReference}.` : ''}`,
                  'department_report_request',
                  row.id,
                  row.created_at || new Date().toISOString()
                ]
              );
            }
          } catch (error) {
            console.warn('[cashier] Unable to sync PMED request notifications:', error);
          }
        }

        async function syncPatientMasterProfiles(): Promise<void> {
          await ensurePatientMasterTables(sql);

          const tableExists = async (tableName: string): Promise<boolean> => {
            const rows = (await sql.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`])) as Array<{ reg: string | null }>;
            return Boolean(rows[0]?.reg);
          };

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
            await syncPatientMasterProfiles();
            broadcastRealtimeEvent({
              type: 'clinic_sync',
              module: 'patients',
              action: 'Patient Master Sync Requested',
              detail: 'Patient profile sync requested from modules.'
            });
            writeJson(res, 200, { ok: true, message: 'Sync requested. Use GET /api/patients to refresh merged profiles.' });
            return;
          }

          if (url.pathname === '/api/module-activity' && (req.method || 'GET').toUpperCase() === 'GET') {
            try {
              await ensureCashierWorkflowDemoData();
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
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const isConnectivityTimeout = /timeout exceeded when trying to connect|connect etimedout|econnrefused|failed to query database after multiple retries/i.test(
                message
              );
              if (!isConnectivityTimeout) {
                writeJson(res, 200, {
                  ok: true,
                  data: {
                    items: [],
                    meta: {
                      page: Math.max(1, toSafeInt(url.searchParams.get('page'), 1)),
                      perPage: Math.min(100, Math.max(1, toSafeInt(url.searchParams.get('per_page'), 12))),
                      total: 0,
                      totalPages: 1
                    }
                  },
                  message: 'Activity logs are temporarily unavailable right now.'
                });
                return;
              }

              const page = Math.max(1, toSafeInt(url.searchParams.get('page'), 1));
              const perPage = Math.min(100, Math.max(1, toSafeInt(url.searchParams.get('per_page'), 12)));
              writeJson(res, 200, {
                ok: true,
                data: {
                  items: [],
                  meta: {
                    page,
                    perPage,
                    total: 0,
                    totalPages: 1
                  }
                },
                message: 'Activity logs are temporarily unavailable while database connectivity recovers.'
              });
              return;
            }
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

          const sanitizeCashierStudentKey = (value: string): string =>
            value
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '') || 'clinic-record';

          const deriveBillingConnectionMeta = (row: {
            billing_code?: string | null;
            student_no?: string | null;
            student_email?: string | null;
            course?: string | null;
          }) => {
            const billingCode = String(row.billing_code || '').toUpperCase();
            const studentNo = String(row.student_no || '').toUpperCase();
            const studentEmail = String(row.student_email || '').toLowerCase();
            const course = String(row.course || '').trim();
            const normalizedCourse = course && course.toLowerCase() !== 'clinic services' ? course : '';
            const isClinicOrigin =
              studentNo.startsWith('CLINIC-') ||
              studentEmail.endsWith('@clinic.local') ||
              billingCode.startsWith('BK-') ||
              billingCode.startsWith('WALK-') ||
              billingCode.startsWith('VISIT-') ||
              billingCode.startsWith('LAB-') ||
              billingCode.startsWith('DSP-') ||
              billingCode.startsWith('MHS-');

            if (!isClinicOrigin) {
              return {
                isClinicOrigin: false,
                sourceModule: 'Cashier',
                sourceDepartment: 'Cashier',
                sourceCategory: 'Standard Billing'
              };
            }

            if (studentNo.startsWith('CLINIC-APPT-') || billingCode.startsWith('BK-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Appointment Booking'
              };
            }

            if (studentNo.startsWith('CLINIC-WALK-') || billingCode.startsWith('WALK-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Walk-In Visit'
              };
            }

            if (studentNo.startsWith('CLINIC-CHK-') || billingCode.startsWith('VISIT-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Check-Up Visit'
              };
            }

            if (studentNo.startsWith('CLINIC-LAB-') || billingCode.startsWith('LAB-') || billingCode.startsWith('BILL-LAB-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Lab Request'
              };
            }

            if (studentNo.startsWith('CLINIC-MH-') || billingCode.startsWith('MHS-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Counseling Session'
              };
            }

            if (studentNo.startsWith('CLINIC-PHR-') || billingCode.startsWith('DSP-')) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: 'Dispense Request'
              };
            }

            if (normalizedCourse) {
              return {
                isClinicOrigin: true,
                sourceModule: 'Clinic',
                sourceDepartment: 'Clinic',
                sourceCategory: normalizedCourse
              };
            }

            return {
              isClinicOrigin: true,
              sourceModule: 'Clinic',
              sourceDepartment: 'Clinic',
              sourceCategory: 'Clinic Booking'
            };
          };

          const buildDepartmentServiceMatrix = () => [
            {
              department: 'Registrar',
              incomingToCashier: ['Student and billing info'],
              outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'],
              usage: 'Enrollment validation and student clearance release'
            },
            {
              department: 'PMED Department',
              incomingToCashier: ['Financial report requests'],
              outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status', 'Financial reports'],
              usage: 'Financial monitoring, planning, and evaluation'
            },
            {
              department: 'HR Department',
              incomingToCashier: ['Payroll data'],
              outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'],
              usage: 'Payroll validation and employee settlement tracking'
            },
            {
              department: 'Admin Reports',
              incomingToCashier: ['Completed transaction report requests'],
              outgoingFromCashier: ['Official receipt records', 'Cleared / Not Cleared status', 'Completed transaction reports'],
              usage: 'Audit, executive dashboards, and institutional reporting'
            }
          ];

          const resolveCashierDepartmentTargets = (connectionMeta: {
            sourceDepartment: string;
            sourceCategory: string;
          }) => {
            const department = String(connectionMeta.sourceDepartment || '').toLowerCase();
            const category = String(connectionMeta.sourceCategory || '').toLowerCase();

            if (department.includes('clinic')) {
              return {
                operationalTargetDepartment: 'Clinic',
                reportingDepartment: 'PMED Department',
                reportingArtifact: 'Financial reports'
              };
            }

            if (category.includes('payroll') || department.includes('hr')) {
              return {
                operationalTargetDepartment: 'HR Department',
                reportingDepartment: 'Admin Reports',
                reportingArtifact: 'Payroll financial reports'
              };
            }

            return {
              operationalTargetDepartment: 'Registrar',
              reportingDepartment: 'Admin Reports',
              reportingArtifact: 'Completed transaction reports'
            };
          };

          const deriveCashierClearance = (paymentStatus: string, receiptStatus: string) => {
            const normalizedPayment = String(paymentStatus || '').toLowerCase();
            const normalizedReceipt = String(receiptStatus || '').toLowerCase();
            const hasSuccessfulPayment = ['paid', 'posted'].includes(normalizedPayment);
            const hasOfficialReceipt = ['generated', 'verified', 'completed', 'released'].includes(normalizedReceipt);

            if (hasSuccessfulPayment && hasOfficialReceipt) {
              return {
                status: 'Cleared',
                note: 'Payment is settled and an official receipt record is available.'
              };
            }

            if (hasSuccessfulPayment) {
              return {
                status: 'Not Cleared',
                note: 'Payment is posted, but the official receipt record is still pending.'
              };
            }

            if (['failed', 'cancelled'].includes(normalizedPayment)) {
              return {
                status: 'Not Cleared',
                note: 'The cashier payment did not complete successfully.'
              };
            }

            return {
              status: 'Not Cleared',
              note: 'Cashier is still processing the payment status for this record.'
            };
          };

          async function ensureClinicBookingsSyncedToCashier(): Promise<void> {
            const tableExists = async (tableName: string): Promise<boolean> => {
              const rows = (await sql.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`])) as Array<{ reg: string | null }>;
              return Boolean(rows[0]?.reg);
            };

            const year = new Date().getFullYear();
            const schoolYear = `${year}-${year + 1}`;
            const semester = 'Clinic Services';

            const upsertClinicStudent = async (
              studentNo: string,
              patientName: string,
              departmentName: string,
              emailHint = '',
              phone: string | null = null
            ): Promise<number> => {
              const safeEmail = emailHint && emailHint.includes('@') ? emailHint : `${sanitizeCashierStudentKey(studentNo)}@clinic.local`;
              const rows = (await sql.query(
                `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'active')
                 ON CONFLICT (student_no) DO UPDATE
                 SET full_name = EXCLUDED.full_name,
                     course = EXCLUDED.course,
                     year_level = EXCLUDED.year_level,
                     email = EXCLUDED.email,
                     phone = COALESCE(EXCLUDED.phone, students.phone),
                     status = 'active'
                 RETURNING id`,
                [studentNo, patientName, departmentName, 'Clinic', safeEmail, phone]
              )) as Array<{ id: number }>;
              return Number(rows[0]?.id || 0);
            };

            const ensureBillingRecord = async (payload: {
              billingCode: string;
              patientName: string;
              departmentName: string;
              studentNo: string;
              emailHint?: string;
              phone?: string | null;
              items: Array<{ code: string; name: string; category: string; amount: number }>;
            }): Promise<void> => {
              if (!payload.billingCode || !payload.patientName || !payload.items.length) return;

              const totalAmount = payload.items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
              if (totalAmount <= 0) return;

              const studentId = await upsertClinicStudent(
                payload.studentNo,
                payload.patientName,
                payload.departmentName,
                payload.emailHint || '',
                payload.phone ?? null
              );
              if (!studentId) return;

              const existingRows = (await sql.query(
                `SELECT id FROM billing_records WHERE billing_code = $1 LIMIT 1`,
                [payload.billingCode]
              )) as Array<{ id: number }>;
              if (existingRows[0]?.id) return;

              const billingRows = (await sql.query(
                `INSERT INTO billing_records (
                   student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
                 ) VALUES (
                   $1, $2, $3, $4, $5, 0, $5, 'pending_payment', 'student_portal_billing', NOW(), NOW()
                 )
                 RETURNING id`,
                [studentId, payload.billingCode, semester, schoolYear, totalAmount]
              )) as Array<{ id: number }>;
              const billingId = Number(billingRows[0]?.id || 0);
              if (!billingId) return;

              for (const [index, item] of payload.items.entries()) {
                await sql.query(
                  `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                  [billingId, item.code, item.name, item.category, item.amount, index + 1]
                );
              }
            };

            if (await tableExists('patient_appointments')) {
              const appointmentRows = (await sql.query(
                `SELECT booking_id, patient_name, department_name, appointment_priority, visit_type, visit_reason, patient_email, phone_number
                 FROM patient_appointments
                 ORDER BY created_at DESC
                 LIMIT 120`
              )) as Array<{
                booking_id: string;
                patient_name: string;
                department_name: string | null;
                appointment_priority: string | null;
                visit_type: string | null;
                visit_reason: string | null;
                patient_email: string | null;
                phone_number: string | null;
              }>;

              for (const row of appointmentRows) {
                const departmentName = toSafeText(row.department_name) || 'Appointments';
                const consultationFee = departmentName.toLowerCase().includes('dental') ? 700 : departmentName.toLowerCase().includes('pedia') ? 650 : 550;
                const priorityFee = String(row.appointment_priority || '').toLowerCase() === 'urgent' ? 250 : 100;
                await ensureBillingRecord({
                  billingCode: toSafeText(row.booking_id),
                  patientName: toSafeText(row.patient_name),
                  departmentName,
                  studentNo: `CLINIC-APPT-${sanitizeCashierStudentKey(toSafeText(row.booking_id))}`,
                  emailHint: toSafeText(row.patient_email),
                  phone: toSafeText(row.phone_number) || null,
                  items: [
                    { code: 'APPT-CONSULT', name: `${departmentName} Consultation`, category: departmentName, amount: consultationFee },
                    { code: 'APPT-SVC', name: toSafeText(row.visit_type) || toSafeText(row.visit_reason) || 'Clinic Booking Fee', category: 'Appointment Booking', amount: priorityFee }
                  ]
                });
              }
            }

            if (await tableExists('patient_walkins')) {
              const walkinRows = (await sql.query(
                `SELECT case_id, patient_name, visit_department, severity, chief_complaint, contact
                 FROM patient_walkins
                 ORDER BY created_at DESC
                 LIMIT 120`
              )) as Array<{
                case_id: string;
                patient_name: string;
                visit_department: string | null;
                severity: string | null;
                chief_complaint: string | null;
                contact: string | null;
              }>;

              for (const row of walkinRows) {
                const severity = String(row.severity || '').toLowerCase();
                const intakeFee = severity === 'emergency' ? 900 : severity === 'moderate' ? 650 : 420;
                const departmentName = toSafeText(row.visit_department) || 'General OPD';
                await ensureBillingRecord({
                  billingCode: toSafeText(row.case_id),
                  patientName: toSafeText(row.patient_name),
                  departmentName,
                  studentNo: `CLINIC-WALK-${sanitizeCashierStudentKey(toSafeText(row.case_id))}`,
                  phone: toSafeText(row.contact) || null,
                  items: [
                    { code: 'WALK-TRIAGE', name: `${departmentName} Triage`, category: departmentName, amount: intakeFee },
                    { code: 'WALK-CARE', name: toSafeText(row.chief_complaint) || 'Walk-In Care', category: 'Walk-In Visit', amount: 120 }
                  ]
                });
              }
            }

            if (await tableExists('checkup_visits')) {
              const checkupRows = (await sql.query(
                `SELECT visit_id, patient_name, lab_requested, prescription_created, is_emergency
                 FROM checkup_visits
                 ORDER BY created_at DESC
                 LIMIT 120`
              )) as Array<{
                visit_id: string;
                patient_name: string;
                lab_requested: boolean | number | null;
                prescription_created: boolean | number | null;
                is_emergency: boolean | number | null;
              }>;

              for (const row of checkupRows) {
                const departmentName = 'General Check-Up';
                const items = [
                  { code: 'CHK-CONSULT', name: 'Check-Up Consultation', category: departmentName, amount: Number(row.is_emergency) ? 950 : 600 }
                ];
                if (Number(row.lab_requested)) items.push({ code: 'CHK-LAB', name: 'Diagnostic Workup Coordination', category: 'Lab Support', amount: 220 });
                if (Number(row.prescription_created)) items.push({ code: 'CHK-RX', name: 'Prescription Processing', category: 'Medication Support', amount: 90 });
                await ensureBillingRecord({
                  billingCode: toSafeText(row.visit_id),
                  patientName: toSafeText(row.patient_name),
                  departmentName,
                  studentNo: `CLINIC-CHK-${sanitizeCashierStudentKey(toSafeText(row.visit_id))}`,
                  items
                });
              }
            }

            if (await tableExists('mental_health_sessions')) {
              const mentalRows = (await sql.query(
                `SELECT s.case_reference, s.patient_name, s.session_type, s.session_mode, p.contact_number
                 FROM mental_health_sessions s
                 LEFT JOIN mental_health_patients p ON p.patient_id = s.patient_id
                 ORDER BY s.created_at DESC
                 LIMIT 120`
              )) as Array<{
                case_reference: string;
                patient_name: string;
                session_type: string | null;
                session_mode: string | null;
                contact_number: string | null;
              }>;

              for (const row of mentalRows) {
                const sessionFee = String(row.session_mode || '').toLowerCase() === 'online' ? 700 : 850;
                const departmentName = 'Mental Health & Addiction';
                await ensureBillingRecord({
                  billingCode: toSafeText(row.case_reference),
                  patientName: toSafeText(row.patient_name),
                  departmentName,
                  studentNo: `CLINIC-MH-${sanitizeCashierStudentKey(toSafeText(row.case_reference))}`,
                  phone: toSafeText(row.contact_number) || null,
                  items: [
                    { code: 'MH-SESSION', name: toSafeText(row.session_type) || 'Mental Health Session', category: departmentName, amount: sessionFee }
                  ]
                });
              }
            }

            if (await tableExists('pharmacy_dispense_requests') && await tableExists('pharmacy_medicines')) {
              const pharmacyRows = (await sql.query(
                `SELECT r.request_code, r.patient_name, r.quantity, COALESCE(m.medicine_name, 'Medicine') AS medicine_name, COALESCE(m.selling_price, 0) AS selling_price
                 FROM pharmacy_dispense_requests r
                 LEFT JOIN pharmacy_medicines m ON m.id = r.medicine_id
                 ORDER BY r.requested_at DESC, r.id DESC
                 LIMIT 120`
              )) as Array<{
                request_code: string;
                patient_name: string;
                quantity: number;
                medicine_name: string;
                selling_price: number;
              }>;

              for (const row of pharmacyRows) {
                const unitPrice = Number(row.selling_price || 0);
                const quantity = Math.max(1, Number(row.quantity || 0));
                const totalPrice = unitPrice > 0 ? Number((unitPrice * quantity).toFixed(2)) : 120;
                const departmentName = 'Pharmacy & Inventory';
                await ensureBillingRecord({
                  billingCode: toSafeText(row.request_code),
                  patientName: toSafeText(row.patient_name),
                  departmentName,
                  studentNo: `CLINIC-PHR-${sanitizeCashierStudentKey(toSafeText(row.request_code))}`,
                  items: [
                    { code: 'PHR-DISPENSE', name: `${toSafeText(row.medicine_name)} x${quantity}`, category: departmentName, amount: totalPrice }
                  ]
                });
              }
            }
          }

          if (url.pathname === '/api/clinic-cashier/lab-billing' && (req.method || 'GET').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const requestId = toSafeInt(body.request_id, 0);
            const patientName = toSafeText(body.patient_name);
            const patientId = toSafeText(body.patient_id);
            const visitId = toSafeText(body.visit_id);
            const category = toSafeText(body.category) || 'Laboratory';
            const requestedByDoctor = toSafeText(body.requested_by_doctor) || 'Clinic';
            const doctorDepartment = toSafeText(body.doctor_department) || 'Laboratory';
            const billingCode = toSafeText(body.billing_reference) || `BILL-LAB-${requestId || Date.now()}`;
            const rawTests = Array.isArray(body.tests) ? body.tests.map((item) => toSafeText(item)).filter(Boolean) : [];
            const tests = rawTests.length ? rawTests : [category];

            if (!patientName) {
              writeJson(res, 422, { ok: false, message: 'patient_name is required.' });
              return;
            }

            const sanitizeEmailKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'clinic.patient';
            const studentNo = patientId || `CLINIC-LAB-${requestId || Date.now()}`;
            const studentEmail = `${sanitizeEmailKey(studentNo)}@clinic.local`;

            const priceFromTestName = (label: string): number => {
              const text = label.toLowerCase();
              if (text.includes('cbc')) return 350;
              if (text.includes('metabolic')) return 650;
              if (text.includes('lipid')) return 550;
              if (text.includes('urinalysis')) return 220;
              if (text.includes('microscopy')) return 180;
              if (text.includes('culture')) return 900;
              if (text.includes('ecg')) return 450;
              if (text.includes('x-ray')) return 700;
              if (text.includes('covid')) return 600;
              if (text.includes('serology')) return 800;
              if (text.includes('dengue')) return 950;
              if (text.includes('hbsag')) return 500;
              if (text.includes('histopathology')) return 1500;
              if (text.includes('stool')) return 250;
              return 400;
            };

            const labItems = tests.map((test, index) => ({
              code: `LAB-${index + 1}`,
              name: test,
              category: 'Laboratory',
              amount: priceFromTestName(test)
            }));
            const totalAmount = labItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
            if (totalAmount <= 0) {
              writeJson(res, 422, { ok: false, message: 'Unable to build a valid cashier billing from this laboratory request.' });
              return;
            }

            const year = new Date().getFullYear();
            const schoolYear = `${year}-${year + 1}`;
            const semester = 'Clinic Services';

            const studentRows = (await sql.query(
              `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
               VALUES ($1, $2, $3, $4, $5, NULL, 'active')
               ON CONFLICT (student_no) DO UPDATE
               SET full_name = EXCLUDED.full_name,
                   course = EXCLUDED.course,
                   year_level = EXCLUDED.year_level,
                   email = EXCLUDED.email,
                   status = 'active'
               RETURNING id`,
              [studentNo, patientName, doctorDepartment, 'Clinic', studentEmail]
            )) as Array<{ id: number }>;
            const studentId = Number(studentRows[0]?.id || 0);
            if (!studentId) {
              writeJson(res, 500, { ok: false, message: 'Unable to create or sync clinic patient in cashier students list.' });
              return;
            }

            const existingRows = (await sql.query(
              `SELECT id, workflow_stage, paid_amount
               FROM billing_records
               WHERE billing_code = $1
               LIMIT 1`,
              [billingCode]
            )) as Array<{ id: number; workflow_stage: string; paid_amount: number }>;
            const existingBilling = existingRows[0];

            let billingId = Number(existingBilling?.id || 0);
            let actionMessage = '';

            if (existingBilling && String(existingBilling.workflow_stage || '') !== 'student_portal_billing') {
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${billingCode} already exists in Cashier under ${workflowLabel(String(existingBilling.workflow_stage || 'student_portal_billing'))}.`,
                  billingId,
                  billingCode,
                  studentNumber: studentNo,
                  workflowStage: String(existingBilling.workflow_stage || 'student_portal_billing')
                }
              });
              return;
            }

            if (!billingId) {
              const createdRows = (await sql.query(
                `INSERT INTO billing_records (
                   student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
                 ) VALUES (
                   $1, $2, $3, $4, $5, 0, $5, 'pending_payment', 'student_portal_billing', NOW(), NOW()
                 )
                 RETURNING id`,
                [studentId, billingCode, semester, schoolYear, totalAmount]
              )) as Array<{ id: number }>;
              billingId = Number(createdRows[0]?.id || 0);
              actionMessage = `${billingCode} was created in Student Portal & Billing from the clinic laboratory queue.`;
            } else {
              await sql.query(
                `UPDATE billing_records
                 SET student_id = $2,
                     semester = $3,
                     school_year = $4,
                     total_amount = $5,
                     balance_amount = GREATEST($5 - COALESCE(paid_amount, 0), 0),
                     billing_status = CASE WHEN COALESCE(paid_amount, 0) > 0 THEN billing_status ELSE 'pending_payment' END,
                     workflow_stage = 'student_portal_billing',
                     updated_at = NOW()
                 WHERE id = $1`,
                [billingId, studentId, semester, schoolYear, totalAmount]
              );
              await sql.query(`DELETE FROM billing_items WHERE billing_id = $1`, [billingId]);
              actionMessage = `${billingCode} was refreshed in Student Portal & Billing from the clinic laboratory queue.`;
            }

            for (const [index, item] of labItems.entries()) {
              await sql.query(
                `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                [billingId, item.code, item.name, item.category, item.amount, index + 1]
              );
            }

            await ensureModuleActivityLogsTable(sql);
            await sql.query(
              `INSERT INTO module_activity_logs (module, action, detail, actor, entity_type, entity_key)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                'laboratory',
                'Forwarded To Cashier',
                `${patientName} (${billingCode}) was forwarded to Cashier from Clinic Laboratory. Visit: ${visitId || '--'}. Doctor: ${requestedByDoctor}.`,
                'Clinic Laboratory',
                'billing',
                billingCode
              ]
            );
            await sql.query(
              `INSERT INTO module_activity_logs (module, action, detail, actor, entity_type, entity_key)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [
                'billing_verification',
                'Clinic Billing Synced',
                `${billingCode} was prepared from clinic laboratory services for ${patientName}.`,
                'Clinic',
                'billing',
                billingCode
              ]
            );
            await syncPatientMasterProfiles();
            broadcastRealtimeEvent({
              type: 'clinic_cashier_sync',
              module: 'billing_verification',
              action: 'Clinic Billing Synced',
              detail: `${billingCode} was prepared from clinic laboratory services for ${patientName}.`,
              entityKey: billingCode
            });

            writeJson(res, 200, {
              ok: true,
              data: {
                message: actionMessage,
                billingId,
                billingCode,
                studentNumber: studentNo,
                workflowStage: 'student_portal_billing'
              }
            });
            return;
          }

          if (url.pathname === '/api/student-billing' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureClinicBookingsSyncedToCashier();
            const view = (url.searchParams.get('view') || 'verification').trim().toLowerCase();
            const rows = (await sql.query(
              `SELECT b.id, b.billing_code, b.billing_status, b.workflow_stage, b.total_amount, b.paid_amount, b.balance_amount,
                      b.created_at::text AS created_at, s.full_name, s.student_no, s.course, COALESCE(s.email, '') AS student_email
               FROM billing_records b
               LEFT JOIN students s ON s.id = b.student_id
               ORDER BY b.created_at DESC, b.id DESC
               LIMIT 100`
            )) as Array<{
              id: number;
              billing_code: string;
              billing_status: string;
              workflow_stage: string;
              total_amount: number;
              paid_amount: number;
              balance_amount: number;
              created_at: string;
              full_name: string | null;
              student_no: string | null;
              course: string | null;
              student_email: string | null;
            }>;
            const feeRows = (await sql.query(
              `SELECT id, billing_id, item_code, item_name, category, amount
               FROM billing_items
               ORDER BY billing_id ASC, sort_order ASC, id ASC`
            )) as Array<{
              id: number;
              billing_id: number;
              item_code: string | null;
              item_name: string;
              category: string | null;
              amount: number;
            }>;
            const feeMap = new Map<number, Array<{
              id: number;
              feeCode: string;
              feeType: string;
              feeName: string;
              category: string;
              amount: number;
              amountFormatted: string;
              paidAmount: number;
              paidAmountFormatted: string;
              pendingAmount: number;
              pendingAmountFormatted: string;
              committedAmount: number;
              committedAmountFormatted: string;
              remainingAmount: number;
              remainingAmountFormatted: string;
              status: 'Paid' | 'Partially Paid' | 'Unpaid';
            }>>();
            for (const feeRow of feeRows) {
              const amount = Number(feeRow.amount || 0);
              const existing = feeMap.get(Number(feeRow.billing_id)) || [];
              existing.push({
                id: Number(feeRow.id),
                feeCode: String(feeRow.item_code || `FEE-${feeRow.id}`),
                feeType: String(feeRow.category || 'Assessment'),
                feeName: String(feeRow.item_name || 'Fee Item'),
                category: String(feeRow.category || 'Assessment'),
                amount,
                amountFormatted: formatCurrency(amount),
                paidAmount: 0,
                paidAmountFormatted: formatCurrency(0),
                pendingAmount: amount,
                pendingAmountFormatted: formatCurrency(amount),
                committedAmount: 0,
                committedAmountFormatted: formatCurrency(0),
                remainingAmount: amount,
                remainingAmountFormatted: formatCurrency(amount),
                status: 'Unpaid'
              });
              feeMap.set(Number(feeRow.billing_id), existing);
            }
            const isClinicOriginBilling = (row: { billing_code?: string | null; student_no: string | null; student_email?: string | null; course?: string | null }): boolean =>
              deriveBillingConnectionMeta(row).isClinicOrigin;
            const verificationRows = rows.filter((row) => String(row.workflow_stage || 'student_portal_billing') === 'student_portal_billing');
            const managementRows = rows.filter((row) => {
              const stage = String(row.workflow_stage || '');
              return stage === 'pay_bills' || (stage === 'student_portal_billing' && isClinicOriginBilling(row));
            });

            if (view === 'management') {
              const items = managementRows.map((row) => {
                const feeItems = feeMap.get(Number(row.id)) || [];
                const remainingAmount = Number(row.balance_amount || 0);
                const paidAmount = Number(row.paid_amount || 0);
                const paidCount = feeItems.filter((item) => item.remainingAmount <= 0).length;
                const partialCount = feeItems.filter((item) => item.remainingAmount > 0 && item.remainingAmount < item.amount).length;
                const unpaidCount = feeItems.filter((item) => item.remainingAmount >= item.amount).length;
                const connectionMeta = deriveBillingConnectionMeta(row);
                const clinicOrigin = connectionMeta.isClinicOrigin;
                const stage = String(row.workflow_stage || 'pay_bills');
                return {
                  id: Number(row.id),
                  billingCode: String(row.billing_code || `BILL-${row.id}`),
                  studentName: String(row.full_name || 'Unknown Student'),
                  semester: clinicOrigin && stage === 'student_portal_billing' ? 'Clinic Services' : '',
                  category: clinicOrigin ? connectionMeta.sourceDepartment : String(row.course || 'General'),
                  sourceModule: connectionMeta.sourceModule,
                  sourceDepartment: connectionMeta.sourceDepartment,
                  sourceCategory: connectionMeta.sourceCategory,
                  total: formatCurrency(row.total_amount),
                  balance: formatCurrency(row.balance_amount),
                  status: mapBillingStatusForManagement(Number(row.balance_amount || 0), Number(row.paid_amount || 0), String(row.billing_status || '')),
                  workflowStage: stage,
                  workflowStageLabel: clinicOrigin && stage === 'student_portal_billing' ? 'Clinic Sync Ready' : workflowLabel(stage),
                  remarks:
                    clinicOrigin && stage === 'student_portal_billing'
                      ? `${connectionMeta.sourceDepartment} billing synced and ready for cashier settlement in Pay Bills.`
                      : '',
                  feeItems,
                  feeSummary: {
                    totalFees: feeItems.length,
                    paidCount,
                    partialCount,
                    unpaidCount,
                    committedAmount: paidAmount,
                    committedAmountFormatted: formatCurrency(paidAmount),
                    finalizedAmount: paidAmount,
                    finalizedAmountFormatted: formatCurrency(paidAmount),
                    remainingAmount,
                    remainingAmountFormatted: formatCurrency(remainingAmount),
                    label: `${paidCount} Paid | ${partialCount} Partial | ${unpaidCount} Unpaid`
                  }
                };
              });
              const pending = items.filter((item) => item.status === 'Pending Payment').length;
              const partial = items.filter((item) => item.status === 'Partially Paid').length;
              const full = items.filter((item) => item.status === 'Fully Paid').length;
              const clinicReady = items.filter((item) => item.workflowStage === 'student_portal_billing').length;
              writeJson(res, 200, {
                ok: true,
                data: {
                  stats: [
                    { title: 'Pending Payment', value: String(pending), subtitle: 'Awaiting settlement', icon: 'mdi-timer-sand', tone: 'blue' },
                    { title: 'Clinic Ready', value: String(clinicReady), subtitle: 'Synced from clinic into Pay Bills', icon: 'mdi-hospital-box-outline', tone: 'purple' },
                    { title: 'Partially Paid', value: String(partial), subtitle: 'With balance', icon: 'mdi-cash-multiple', tone: 'orange' },
                    { title: 'Fully Paid', value: String(full), subtitle: 'Settled records', icon: 'mdi-check-decagram-outline', tone: 'green' }
                  ],
                  items,
                  activityFeed: []
                }
              });
              return;
            }

            const items = verificationRows.map((row) => {
              const feeItems = feeMap.get(Number(row.id)) || [];
              const remainingAmount = Number(row.balance_amount || 0);
              const paidAmount = Number(row.paid_amount || 0);
              const paidCount = feeItems.filter((item) => item.remainingAmount <= 0).length;
              const partialCount = feeItems.filter((item) => item.remainingAmount > 0 && item.remainingAmount < item.amount).length;
              const unpaidCount = feeItems.filter((item) => item.remainingAmount >= item.amount).length;
              const connectionMeta = deriveBillingConnectionMeta(row);
              return {
                id: Number(row.id),
                reference: String(row.billing_code || `BILL-${row.id}`),
                studentName: String(row.full_name || 'Unknown Student'),
                studentNumber: String(row.student_no || ''),
                program: String(row.course || 'General'),
                sourceModule: connectionMeta.sourceModule,
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                amount: formatCurrency(row.total_amount),
                totalPaid: formatCurrency(row.paid_amount),
                dueDate: String(row.created_at || '').slice(0, 10),
                status: mapBillingStatusForVerification(String(row.billing_status || '')),
                workflowStage: String(row.workflow_stage || 'student_portal_billing'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'student_portal_billing')),
                note: connectionMeta.isClinicOrigin
                  ? `${connectionMeta.sourceDepartment} record synced from clinic and ready for cashier verification.`
                  : '',
                feeItems,
                feeSummary: {
                  totalFees: feeItems.length,
                  paidCount,
                  partialCount,
                  unpaidCount,
                  committedAmount: paidAmount,
                  committedAmountFormatted: formatCurrency(paidAmount),
                  finalizedAmount: paidAmount,
                  finalizedAmountFormatted: formatCurrency(paidAmount),
                  remainingAmount,
                  remainingAmountFormatted: formatCurrency(remainingAmount),
                  label: `${paidCount} Paid | ${partialCount} Partial | ${unpaidCount} Unpaid`
                }
              };
            });
            const forVerification = items.filter((item) => item.status === 'Pending Payment' || item.status === 'Draft').length;
            const needsCorrection = items.filter((item) => item.status === 'Needs Correction').length;
            const activeBilling = items.filter((item) => item.status === 'Active Billing').length;
            const clinicLinked = items.filter((item) => item.sourceModule === 'Clinic').length;
            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'For Verification', value: String(forVerification), subtitle: 'Pending review', icon: 'mdi-clipboard-check-outline', tone: 'blue' },
                  { title: 'Needs Correction', value: String(needsCorrection), subtitle: 'Returned records', icon: 'mdi-alert-circle-outline', tone: 'orange' },
                  { title: 'Active Billing', value: String(activeBilling), subtitle: 'Eligible for payment', icon: 'mdi-cash-check', tone: 'green' },
                  { title: 'Clinic Linked', value: String(clinicLinked), subtitle: 'Integrated clinic-origin records', icon: 'mdi-hospital-box-outline', tone: 'purple' }
                ],
                items,
                activityFeed: []
              }
            });
            return;
          }

          if (url.pathname === '/api/cashier-registrar-student-enrollment-feed' && (req.method || 'GET').toUpperCase() === 'GET') {
            const buildRegistrarApiSnapshotRows = async () => {
              const registrarApiBase = String(process.env.REGISTRAR_INTEGRATION_URL || 'http://localhost:3000/api/integrations').trim();
              const integrationKey = String(process.env.INTEGRATION_API_KEY || process.env.REGISTRAR_INTEGRATION_API_KEY || '').trim();
              const integrationHeaders: Record<string, string> = { Accept: 'application/json' };
              if (integrationKey) integrationHeaders['x-integration-key'] = integrationKey;

              const safeFetchJson = async (inputUrl: string) => {
                try {
                  const response = await Promise.race([
                    fetch(inputUrl, { method: 'GET', headers: integrationHeaders }),
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Registrar integration request timed out.')), 25000))
                  ]);
                  if (!response.ok) return null;
                  return (await response.json()) as Record<string, unknown>;
                } catch {
                  return null;
                }
              };

              const rows: Array<{
                id: number;
                batchId: string;
                source: string;
                office: string;
                studentNo: string;
                studentName: string;
                classCode: string;
                subject: string;
                academicYear: string;
                semester: string;
                status: string;
                downpaymentAmount: number;
                downpaymentAmountFormatted: string;
                payload: Record<string, unknown> | null;
                decisionNotes: string;
                actionBy: string;
                actionAt: string | null;
                lastAction: string;
                billingId: number | null;
                billingCode: string;
                billingStatus: string;
                billingWorkflowStage: string | null;
                billingWorkflowStageLabel: string;
                nextStep: string;
                queueBucket: 'pending' | 'approved' | 'hold' | 'returned';
                sentAt: string | null;
                createdAt: string | null;
              }> = [];

              const bulkFeedJson = await safeFetchJson(`${registrarApiBase}?resource=enrollment-feed`);
              const bulkRows = Array.isArray((bulkFeedJson?.data as Record<string, unknown> | undefined)?.rows)
                ? (((bulkFeedJson?.data as Record<string, unknown>).rows as unknown[]) || [])
                : [];

              for (const rawRow of bulkRows) {
                const row = (rawRow || {}) as Record<string, unknown>;
                const sourceEnrollmentId = Number(row.enrollment_id || 0);
                if (!sourceEnrollmentId) continue;
                const studentNo = toSafeText(row.student_no);
                const studentName =
                  [toSafeText(row.first_name), toSafeText(row.last_name)].filter(Boolean).join(' ') ||
                  toSafeText(row.full_name) ||
                  studentNo ||
                  'Unknown Student';
                const classCode = toSafeText(row.class_code);
                const subject = toSafeText(row.title);
                const academicYear = toSafeText(row.academic_year);
                const semester = toSafeText(row.semester);
                const enrollmentStatus = toSafeText(row.enrollment_status) || 'Pending';
                const downpaymentAmount = Number(row.downpayment_amount || 0);
                const createdAt = toSafeText(row.created_at) || new Date().toISOString();
                const batchSuffix = academicYear ? academicYear.replace(/[^0-9]/g, '').slice(-4) : String(new Date().getFullYear());
                const batchId = `REG-LIVE-${batchSuffix || String(new Date().getFullYear())}`;
                const normalizedStatus = normalizeEnrollmentFeedStatus(enrollmentStatus);

                rows.push({
                  id: sourceEnrollmentId,
                  batchId,
                  source: 'Registrar',
                  office: 'Registrar',
                  studentNo,
                  studentName,
                  classCode,
                  subject,
                  academicYear,
                  semester,
                  status: normalizedStatus,
                  downpaymentAmount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                  downpaymentAmountFormatted: formatCurrency(downpaymentAmount || 0),
                  payload: {
                    source: 'registrar.api.enrollment-feed',
                    enrollment_id: sourceEnrollmentId,
                    student_no: studentNo,
                    student_name: studentName,
                    class_code: classCode,
                    subject,
                    academic_year: academicYear,
                    semester,
                    status: enrollmentStatus,
                    downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
                  },
                  decisionNotes: '',
                  actionBy: '',
                  actionAt: null,
                  lastAction: '',
                  billingId: null,
                  billingCode: '',
                  billingStatus: '',
                  billingWorkflowStage: null,
                  billingWorkflowStageLabel: '',
                  nextStep: resolveEnrollmentFeedNextStep(normalizedStatus, '', ''),
                  queueBucket: resolveEnrollmentFeedBucket(normalizedStatus, null),
                  sentAt: null,
                  createdAt
                });
              }

              if (rows.length > 0) {
                return rows;
              }

              const studentListJson = await safeFetchJson(`${registrarApiBase}?resource=student-list`);
              const studentRows = Array.isArray((studentListJson?.data as Record<string, unknown> | undefined)?.students)
                ? (((studentListJson?.data as Record<string, unknown>).students as unknown[]) || [])
                : [];

              for (const studentRow of studentRows.slice(0, 120)) {
                const studentNo = toSafeText((studentRow as Record<string, unknown>)?.student_no);
                if (!studentNo) continue;
                const enrollmentJson = await safeFetchJson(`${registrarApiBase}?resource=enrollment-data&student_no=${encodeURIComponent(studentNo)}`);
                const payloadData = (enrollmentJson?.data as Record<string, unknown> | undefined) || {};
                const enrollments = Array.isArray(payloadData.enrollments) ? (payloadData.enrollments as Array<Record<string, unknown>>) : [];
                const studentData = (payloadData.student as Record<string, unknown> | undefined) || (studentRow as Record<string, unknown>);
                const studentName =
                  [toSafeText(studentData.first_name), toSafeText(studentData.last_name)].filter(Boolean).join(' ') ||
                  toSafeText(studentData.full_name) ||
                  studentNo ||
                  'Unknown Student';

                for (const enrollment of enrollments.slice(0, 6)) {
                  const sourceEnrollmentId = Number(enrollment.id || 0);
                  if (!sourceEnrollmentId) continue;
                  const classCode = toSafeText(enrollment.class_code);
                  const subject = toSafeText(enrollment.title);
                  const academicYear = toSafeText(enrollment.academic_year);
                  const semester = toSafeText(enrollment.semester);
                  const enrollmentStatus = toSafeText(enrollment.status) || 'Pending';
                  const downpaymentAmount = Number(enrollment.downpayment_amount || 0);
                  const createdAt = toSafeText(enrollment.created_at) || new Date().toISOString();
                  const batchSuffix = academicYear ? academicYear.replace(/[^0-9]/g, '').slice(-4) : String(new Date().getFullYear());
                  const batchId = `REG-LIVE-${batchSuffix || String(new Date().getFullYear())}`;
                  const normalizedStatus = normalizeEnrollmentFeedStatus(enrollmentStatus);

                  rows.push({
                    id: sourceEnrollmentId,
                    batchId,
                    source: 'Registrar',
                    office: 'Registrar',
                    studentNo,
                    studentName,
                    classCode,
                    subject,
                    academicYear,
                    semester,
                    status: normalizedStatus,
                    downpaymentAmount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                    downpaymentAmountFormatted: formatCurrency(downpaymentAmount || 0),
                    payload: {
                      source: 'registrar.api.enrollment-data',
                      enrollment_id: sourceEnrollmentId,
                      student_no: studentNo,
                      student_name: studentName,
                      class_code: classCode,
                      subject,
                      academic_year: academicYear,
                      semester,
                      status: enrollmentStatus,
                      downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
                    },
                    decisionNotes: '',
                    actionBy: '',
                    actionAt: null,
                    lastAction: '',
                    billingId: null,
                    billingCode: '',
                    billingStatus: '',
                    billingWorkflowStage: null,
                    billingWorkflowStageLabel: '',
                    nextStep: resolveEnrollmentFeedNextStep(normalizedStatus, '', ''),
                    queueBucket: resolveEnrollmentFeedBucket(normalizedStatus, null),
                    sentAt: null,
                    createdAt
                  });
                }
              }

              return rows;
            };

            if (!databaseReady) {
              const apiRows = await buildRegistrarApiSnapshotRows();
              const fallbackRows = apiRows.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
              const stableRows = fallbackRows.length ? fallbackRows : lastStableEnrollmentFeedRows;
              if (fallbackRows.length) lastStableEnrollmentFeedRows = fallbackRows;
              writeJson(res, 200, {
                ok: true,
                data: {
                  stats: [
                    { title: 'Pending Review', value: String(stableRows.filter((row) => row.queueBucket === 'pending').length), subtitle: 'Registrar submissions waiting on cashier action', icon: 'mdi-clipboard-check-outline', tone: 'blue' },
                    { title: 'Billing Created', value: String(stableRows.filter((row) => row.queueBucket === 'approved').length), subtitle: 'Approved rows already linked to real billing records', icon: 'mdi-file-document-check-outline', tone: 'green' },
                    { title: 'On Hold', value: String(stableRows.filter((row) => row.queueBucket === 'hold').length), subtitle: 'Rows paused for validation or missing registrar details', icon: 'mdi-pause-circle-outline', tone: 'orange' },
                    { title: 'Returned', value: String(stableRows.filter((row) => row.queueBucket === 'returned').length), subtitle: 'Rows sent back to registrar for correction', icon: 'mdi-undo-variant', tone: 'purple' }
                  ],
                  items: stableRows,
                  meta: { page: 1, perPage: stableRows.length || 10, total: stableRows.length, totalPages: 1 },
                  filters: {
                    statuses: Array.from(new Set(stableRows.map((row) => row.status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                    semesters: Array.from(new Set(stableRows.map((row) => row.semester).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                    sources: Array.from(new Set(stableRows.map((row) => row.source).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                    offices: Array.from(new Set(stableRows.map((row) => row.office).filter(Boolean))).sort((left, right) => left.localeCompare(right))
                  }
                },
                message: fallbackRows.length
                  ? 'Showing live registrar enrollment feed while cashier database reconnects.'
                  : 'Showing last stable registrar snapshot while live sync retries.'
              });
              return;
            }

            try {
            const queryWithTimeout = async <T>(promise: Promise<T>, ms = 2500): Promise<T> =>
              await Promise.race([
                promise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`Enrollment feed route timed out after ${ms}ms`)), ms)
                )
              ]);
            await queryWithTimeout(sql.query('SELECT 1'), 2500);
            await ensureCashierEnrollmentFeedTable(sql);

            const resolveExistingTable = async (candidates: string[]): Promise<string | null> => {
              for (const candidate of candidates) {
                const rows = (await sql.query(`SELECT to_regclass($1)::text AS reg`, [candidate])) as Array<{ reg: string | null }>;
                const reg = toSafeText(rows[0]?.reg);
                if (reg) return reg;
              }
              return null;
            };
            const hasColumn = async (tableName: string, columnName: string): Promise<boolean> => {
              const normalized = toSafeText(tableName).replace(/"/g, '');
              const [schemaName, rawTableName] = normalized.includes('.')
                ? normalized.split('.', 2)
                : ['public', normalized];
              const rows = (await sql.query(
                `SELECT 1
                 FROM information_schema.columns
                 WHERE table_schema = $1
                   AND table_name = $2
                   AND column_name = $3
                 LIMIT 1`,
                [schemaName, rawTableName, columnName]
              )) as Array<{ '?column?': number }>;
              return rows.length > 0;
            };

            const registrarEnrollmentsTable = await resolveExistingTable([
              'registrar.enrollments',
              'public.registrar_enrollments',
              'public.enrollments'
            ]);
            const registrarStudentsTable = await resolveExistingTable([
              'registrar.students',
              'public.registrar_students',
              'public.students'
            ]);
            const registrarClassesTable = await resolveExistingTable([
              'registrar.classes',
              'public.registrar_classes',
              'public.classes'
            ]);

            let liveSnapshotRows: Array<{
              id: number;
              batchId: string;
              source: string;
              office: string;
              studentNo: string;
              studentName: string;
              classCode: string;
              subject: string;
              academicYear: string;
              semester: string;
              status: string;
              downpaymentAmount: number;
              downpaymentAmountFormatted: string;
              payload: Record<string, unknown> | null;
              decisionNotes: string;
              actionBy: string;
              actionAt: string | null;
              lastAction: string;
              billingId: number | null;
              billingCode: string;
              billingStatus: string;
              billingWorkflowStage: string | null;
              billingWorkflowStageLabel: string;
              nextStep: string;
              queueBucket: 'pending' | 'approved' | 'hold' | 'returned';
              sentAt: string | null;
              createdAt: string | null;
            }> = [];

            if (registrarEnrollmentsTable && registrarStudentsTable && registrarClassesTable) {
              const liveRows = (await queryWithTimeout(sql.query(
                `SELECT
                   e.id AS enrollment_id,
                   e.status AS enrollment_status,
                   COALESCE(e.academic_year, '')::text AS academic_year,
                   COALESCE(e.semester, '')::text AS semester,
                   COALESCE(e.downpayment_amount, 0)::numeric AS downpayment_amount,
                   COALESCE(e.created_at, NOW())::text AS created_at,
                   s.student_no,
                   COALESCE(s.first_name, '')::text AS first_name,
                   COALESCE(s.last_name, '')::text AS last_name,
                   trim(concat_ws(' ', COALESCE(s.first_name, ''), COALESCE(s.last_name, '')))::text AS full_name,
                   c.class_code,
                   COALESCE(c.title, '')::text AS title
                 FROM ${registrarEnrollmentsTable} e
                 INNER JOIN ${registrarStudentsTable} s ON s.id = e.student_id
                 INNER JOIN ${registrarClassesTable} c ON c.id = e.class_id
                 ORDER BY e.created_at DESC NULLS LAST, e.id DESC
                 LIMIT 150`,
                []
              ), 9000)) as Array<Record<string, unknown>>;

              for (const row of liveRows) {
                const sourceEnrollmentId = Number(row.enrollment_id || 0);
                if (!sourceEnrollmentId) continue;

                const studentNo = toSafeText(row.student_no);
                const studentName =
                  [toSafeText(row.first_name), toSafeText(row.last_name)].filter(Boolean).join(' ') ||
                  toSafeText(row.full_name) ||
                  studentNo ||
                  'Unknown Student';
                const classCode = toSafeText(row.class_code) || null;
                const subject = toSafeText(row.title) || null;
                const academicYear = toSafeText(row.academic_year) || null;
                const semester = toSafeText(row.semester) || null;
                const enrollmentStatus = toSafeText(row.enrollment_status) || 'Pending';
                const downpaymentAmount = Number(row.downpayment_amount || 0);
                const batchSuffix = academicYear ? academicYear.replace(/[^0-9]/g, '').slice(-4) : String(new Date().getFullYear());
                const batchId = `REG-LIVE-${batchSuffix || String(new Date().getFullYear())}`;
                const payloadJson = JSON.stringify({
                  source: 'registrar.enrollments',
                  enrollment_id: sourceEnrollmentId,
                  student_no: studentNo,
                  student_name: studentName,
                  class_code: classCode,
                  subject,
                  academic_year: academicYear,
                  semester,
                  status: enrollmentStatus,
                  downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
                });
                liveSnapshotRows.push({
                  id: sourceEnrollmentId,
                  batchId,
                  source: 'Registrar',
                  office: 'Registrar',
                  studentNo,
                  studentName,
                  classCode: classCode || '',
                  subject: subject || '',
                  academicYear: academicYear || '',
                  semester: semester || '',
                  status: normalizeEnrollmentFeedStatus(enrollmentStatus),
                  downpaymentAmount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                  downpaymentAmountFormatted: formatCurrency(downpaymentAmount || 0),
                  payload: JSON.parse(payloadJson) as Record<string, unknown>,
                  decisionNotes: '',
                  actionBy: '',
                  actionAt: null,
                  lastAction: '',
                  billingId: null,
                  billingCode: '',
                  billingStatus: '',
                  billingWorkflowStage: null,
                  billingWorkflowStageLabel: '',
                  nextStep: resolveEnrollmentFeedNextStep(normalizeEnrollmentFeedStatus(enrollmentStatus), '', ''),
                  queueBucket: resolveEnrollmentFeedBucket(normalizeEnrollmentFeedStatus(enrollmentStatus), null),
                  sentAt: null,
                  createdAt: toSafeText(row.created_at) || null
                });

                const updatedRows = (await sql.query(
                  `UPDATE public.cashier_registrar_student_enrollment_feed
                   SET batch_id = $2,
                       source = 'Registrar',
                       office = 'Registrar',
                       student_no = $3,
                       student_name = $4,
                       class_code = $5,
                       subject = $6,
                       academic_year = $7,
                       semester = $8,
                       downpayment_amount = $10,
                       payload = $11::jsonb,
                       sent_at = NOW(),
                       status = CASE
                         WHEN COALESCE(TRIM(last_action), '') = ''
                           THEN $9
                         ELSE status
                       END
                   WHERE source_enrollment_id = $1
                   RETURNING id`,
                  [
                    sourceEnrollmentId,
                    batchId,
                    studentNo,
                    studentName,
                    classCode,
                    subject,
                    academicYear,
                    semester,
                    enrollmentStatus,
                    Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                    payloadJson
                  ]
                )) as Array<{ id: number }>;

                if (!updatedRows.length) {
                  await sql.query(
                    `INSERT INTO public.cashier_registrar_student_enrollment_feed (
                       source_enrollment_id,
                       batch_id,
                       source,
                       office,
                       student_no,
                       student_name,
                       class_code,
                       subject,
                       academic_year,
                       semester,
                       status,
                       downpayment_amount,
                       payload,
                       sent_at,
                       created_at
                     ) VALUES (
                       $1,$2,'Registrar','Registrar',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),$12::timestamptz
                     )`,
                    [
                      sourceEnrollmentId,
                      batchId,
                      studentNo,
                      studentName,
                      classCode,
                      subject,
                      academicYear,
                      semester,
                      enrollmentStatus,
                      Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                      payloadJson,
                      toSafeText(row.created_at) || new Date().toISOString()
                    ]
                  );
                }
              }
            }

            if (!liveSnapshotRows.length) {
              const registrarApiBase = String(process.env.REGISTRAR_INTEGRATION_URL || 'http://localhost:3000/api/integrations').trim();
              const integrationKey = String(process.env.INTEGRATION_API_KEY || process.env.REGISTRAR_INTEGRATION_API_KEY || '').trim();
              const integrationHeaders: Record<string, string> = { Accept: 'application/json' };
              if (integrationKey) integrationHeaders['x-integration-key'] = integrationKey;

              const safeFetchJson = async (inputUrl: string) => {
                const response = await queryWithTimeout(
                  fetch(inputUrl, { method: 'GET', headers: integrationHeaders }),
                  25000
                );
                if (!response.ok) return null;
                try {
                  return (await response.json()) as Record<string, unknown>;
                } catch {
                  return null;
                }
              };

              const studentListJson = await safeFetchJson(`${registrarApiBase}?resource=student-list`);
              const studentRows = Array.isArray((studentListJson?.data as Record<string, unknown> | undefined)?.students)
                ? (((studentListJson?.data as Record<string, unknown>).students as unknown[]) || [])
                : [];

              for (const studentRow of studentRows.slice(0, 80)) {
                const studentNo = toSafeText((studentRow as Record<string, unknown>)?.student_no);
                if (!studentNo) continue;
                const enrollmentJson = await safeFetchJson(`${registrarApiBase}?resource=enrollment-data&student_no=${encodeURIComponent(studentNo)}`);
                const payloadData = (enrollmentJson?.data as Record<string, unknown> | undefined) || {};
                const enrollments = Array.isArray(payloadData.enrollments) ? (payloadData.enrollments as Array<Record<string, unknown>>) : [];
                const studentData = (payloadData.student as Record<string, unknown> | undefined) || (studentRow as Record<string, unknown>);
                const studentName =
                  [toSafeText(studentData.first_name), toSafeText(studentData.last_name)].filter(Boolean).join(' ') ||
                  toSafeText(studentData.full_name) ||
                  studentNo ||
                  'Unknown Student';

                for (const enrollment of enrollments.slice(0, 4)) {
                  const sourceEnrollmentId = Number(enrollment.id || 0);
                  if (!sourceEnrollmentId) continue;
                  const classCode = toSafeText(enrollment.class_code) || null;
                  const subject = toSafeText(enrollment.title) || null;
                  const academicYear = toSafeText(enrollment.academic_year) || null;
                  const semester = toSafeText(enrollment.semester) || null;
                  const enrollmentStatus = toSafeText(enrollment.status) || 'Pending';
                  const downpaymentAmount = Number(enrollment.downpayment_amount || 0);
                  const createdAt = toSafeText(enrollment.created_at) || new Date().toISOString();
                  const batchSuffix = academicYear ? academicYear.replace(/[^0-9]/g, '').slice(-4) : String(new Date().getFullYear());
                  const batchId = `REG-LIVE-${batchSuffix || String(new Date().getFullYear())}`;
                  const payloadJson = JSON.stringify({
                    source: 'registrar.api.enrollment-data',
                    enrollment_id: sourceEnrollmentId,
                    student_no: studentNo,
                    student_name: studentName,
                    class_code: classCode,
                    subject,
                    academic_year: academicYear,
                    semester,
                    status: enrollmentStatus,
                    downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
                  });

                  liveSnapshotRows.push({
                    id: sourceEnrollmentId,
                    batchId,
                    source: 'Registrar',
                    office: 'Registrar',
                    studentNo,
                    studentName,
                    classCode: classCode || '',
                    subject: subject || '',
                    academicYear: academicYear || '',
                    semester: semester || '',
                    status: normalizeEnrollmentFeedStatus(enrollmentStatus),
                    downpaymentAmount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                    downpaymentAmountFormatted: formatCurrency(downpaymentAmount || 0),
                    payload: JSON.parse(payloadJson) as Record<string, unknown>,
                    decisionNotes: '',
                    actionBy: '',
                    actionAt: null,
                    lastAction: '',
                    billingId: null,
                    billingCode: '',
                    billingStatus: '',
                    billingWorkflowStage: null,
                    billingWorkflowStageLabel: '',
                    nextStep: resolveEnrollmentFeedNextStep(normalizeEnrollmentFeedStatus(enrollmentStatus), '', ''),
                    queueBucket: resolveEnrollmentFeedBucket(normalizeEnrollmentFeedStatus(enrollmentStatus), null),
                    sentAt: null,
                    createdAt
                  });

                  const updatedRows = (await sql.query(
                    `UPDATE public.cashier_registrar_student_enrollment_feed
                     SET batch_id = $2,
                         source = 'Registrar',
                         office = 'Registrar',
                         student_no = $3,
                         student_name = $4,
                         class_code = $5,
                         subject = $6,
                         academic_year = $7,
                         semester = $8,
                         downpayment_amount = $10,
                         payload = $11::jsonb,
                         sent_at = NOW(),
                         status = CASE
                           WHEN COALESCE(TRIM(last_action), '') = ''
                             THEN $9
                           ELSE status
                         END
                     WHERE source_enrollment_id = $1
                     RETURNING id`,
                    [
                      sourceEnrollmentId,
                      batchId,
                      studentNo,
                      studentName,
                      classCode,
                      subject,
                      academicYear,
                      semester,
                      enrollmentStatus,
                      Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                      payloadJson
                    ]
                  )) as Array<{ id: number }>;

                  if (!updatedRows.length) {
                    await sql.query(
                      `INSERT INTO public.cashier_registrar_student_enrollment_feed (
                         source_enrollment_id,
                         batch_id,
                         source,
                         office,
                         student_no,
                         student_name,
                         class_code,
                         subject,
                         academic_year,
                         semester,
                         status,
                         downpayment_amount,
                         payload,
                         sent_at,
                         created_at
                       ) VALUES (
                         $1,$2,'Registrar','Registrar',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),$12::timestamptz
                       )`,
                      [
                        sourceEnrollmentId,
                        batchId,
                        studentNo,
                        studentName,
                        classCode,
                        subject,
                        academicYear,
                        semester,
                        enrollmentStatus,
                        Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
                        payloadJson,
                        createdAt
                      ]
                    );
                  }
                }
              }
            }

            const search = (url.searchParams.get('search') || '').trim().toLowerCase();
            const statusFilter = (url.searchParams.get('status') || '').trim();
            const semesterFilter = (url.searchParams.get('semester') || '').trim();
            const sourceFilter = (url.searchParams.get('source') || '').trim();
            const officeFilter = (url.searchParams.get('office') || '').trim();
            const page = Math.max(1, Number(url.searchParams.get('page') || 1));
            const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get('per_page') || 10)));

            const rows = (await sql.query(
              `SELECT
                 f.id,
                 f.batch_id,
                 f.source,
                 f.office,
                 f.student_no,
                 f.student_name,
                 f.class_code,
                 f.subject,
                 f.academic_year,
                 f.semester,
                 f.status,
                 f.downpayment_amount,
                 f.payload,
                 f.decision_notes,
                 f.linked_billing_id,
                 f.linked_billing_code,
                 f.last_action,
                 f.action_by,
                 f.action_at::text AS action_at,
                 f.sent_at::text AS sent_at,
                 f.created_at::text AS created_at,
                 b.id AS billing_id,
                 b.billing_code,
                 b.billing_status,
                 b.workflow_stage AS billing_workflow_stage,
                 b.balance_amount AS billing_balance_amount,
                 p.full_name AS action_by_name,
                 p.username AS action_by_username
               FROM public.cashier_registrar_student_enrollment_feed f
               LEFT JOIN billing_records b ON b.id = f.linked_billing_id
               LEFT JOIN admin_profiles p ON p.id = f.action_by
               ORDER BY COALESCE(f.sent_at, f.created_at) DESC, f.id DESC`
            )) as Array<{
              id: number | string;
              batch_id: string | null;
              source: string | null;
              office: string | null;
              student_no: string | null;
              student_name: string | null;
              class_code: string | null;
              subject: string | null;
              academic_year: string | null;
              semester: string | null;
              status: string | null;
              downpayment_amount: number | string | null;
              payload: Record<string, unknown> | null;
              decision_notes: string | null;
              linked_billing_id: number | string | null;
              linked_billing_code: string | null;
              last_action: string | null;
              action_by: number | string | null;
              action_at: string | null;
              sent_at: string | null;
              created_at: string | null;
              billing_id: number | string | null;
              billing_code: string | null;
              billing_status: string | null;
              billing_workflow_stage: string | null;
              billing_balance_amount: number | string | null;
              action_by_name: string | null;
              action_by_username: string | null;
            }>;

            const normalized = (Array.isArray(rows) ? rows : []).map((row) => {
              const linkedBillingId = Number(row.linked_billing_id || row.billing_id || 0) || null;
              const billingStage = linkedBillingId ? String(row.billing_workflow_stage || '') || 'student_portal_billing' : '';
              const normalizedStatus = normalizeEnrollmentFeedStatus(row.status, linkedBillingId);
              return {
                id: Number(row.id),
                batchId: toSafeText(row.batch_id),
                source: toSafeText(row.source) || 'Registrar',
                office: toSafeText(row.office) || 'Registrar',
                studentNo: toSafeText(row.student_no),
                studentName: toSafeText(row.student_name) || 'Unknown Student',
                classCode: toSafeText(row.class_code),
                subject: toSafeText(row.subject),
                academicYear: toSafeText(row.academic_year),
                semester: toSafeText(row.semester),
                status: normalizedStatus,
                downpaymentAmount: Number(row.downpayment_amount || 0),
                downpaymentAmountFormatted: formatCurrency(row.downpayment_amount || 0),
                payload: row.payload && typeof row.payload === 'object' ? row.payload : null,
                decisionNotes: toSafeText(row.decision_notes),
                actionBy: toSafeText(row.action_by_name) || toSafeText(row.action_by_username),
                actionAt: row.action_at ? new Date(String(row.action_at)).toISOString() : null,
                lastAction: toSafeText(row.last_action),
                billingId: linkedBillingId,
                billingCode: toSafeText(row.linked_billing_code) || toSafeText(row.billing_code),
                billingStatus: linkedBillingId ? mapEnrollmentBillingStatus(row.billing_status, row.billing_balance_amount) : '',
                billingWorkflowStage: billingStage || null,
                billingWorkflowStageLabel: billingStage ? workflowLabel(billingStage) : '',
                nextStep: resolveEnrollmentFeedNextStep(normalizedStatus, toSafeText(row.linked_billing_code) || toSafeText(row.billing_code), billingStage),
                queueBucket: resolveEnrollmentFeedBucket(normalizedStatus, linkedBillingId),
                sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null,
                createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : null
              };
            });
            const effectiveRows = normalized.length > 0 ? normalized : liveSnapshotRows;
            if (effectiveRows.length > 0) {
              lastStableEnrollmentFeedRows = effectiveRows;
            }

            const filtered = effectiveRows.filter((row) => {
              const matchesSearch =
                !search ||
                [
                  row.batchId,
                  row.source,
                  row.office,
                  row.studentNo,
                  row.studentName,
                  row.classCode,
                  row.subject,
                  row.academicYear,
                  row.semester,
                  row.status,
                  row.billingCode,
                  row.decisionNotes,
                  row.actionBy
                ]
                  .join(' ')
                  .toLowerCase()
                  .includes(search);
              const matchesStatus = !statusFilter || statusFilter === 'All Statuses' || row.status === statusFilter;
              const matchesSemester = !semesterFilter || semesterFilter === 'All Semesters' || row.semester === semesterFilter;
              const matchesSource = !sourceFilter || sourceFilter === 'All Sources' || row.source === sourceFilter;
              const matchesOffice = !officeFilter || officeFilter === 'All Offices' || row.office === officeFilter;
              return matchesSearch && matchesStatus && matchesSemester && matchesSource && matchesOffice;
            });

            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / perPage));
            const startIndex = (page - 1) * perPage;
            const pagedItems = filtered.slice(startIndex, startIndex + perPage);
            const pendingCount = filtered.filter((row) => row.queueBucket === 'pending').length;
            const approvedCount = filtered.filter((row) => row.queueBucket === 'approved').length;
            const holdCount = filtered.filter((row) => row.queueBucket === 'hold').length;
            const returnedCount = filtered.filter((row) => row.queueBucket === 'returned').length;

            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  {
                    title: 'Pending Review',
                    value: String(pendingCount),
                    subtitle: 'Registrar submissions waiting on cashier action',
                    icon: 'mdi-clipboard-check-outline',
                    tone: 'blue'
                  },
                  {
                    title: 'Billing Created',
                    value: String(approvedCount),
                    subtitle: 'Approved rows already linked to real billing records',
                    icon: 'mdi-file-document-check-outline',
                    tone: 'green'
                  },
                  {
                    title: 'On Hold',
                    value: String(holdCount),
                    subtitle: 'Rows paused for validation or missing registrar details',
                    icon: 'mdi-pause-circle-outline',
                    tone: 'orange'
                  },
                  {
                    title: 'Returned',
                    value: String(returnedCount),
                    subtitle: 'Rows sent back to registrar for correction',
                    icon: 'mdi-undo-variant',
                    tone: 'purple'
                  }
                ],
                items: pagedItems,
                meta: {
                  page,
                  perPage,
                  total,
                  totalPages
                },
                filters: {
                  statuses: Array.from(new Set(effectiveRows.map((row) => row.status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                  semesters: Array.from(new Set(effectiveRows.map((row) => row.semester).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                  sources: Array.from(new Set(effectiveRows.map((row) => row.source).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                  offices: Array.from(new Set(effectiveRows.map((row) => row.office).filter(Boolean))).sort((left, right) => left.localeCompare(right))
                }
              }
            });
            } catch (error) {
              console.warn('[cashier] Enrollment feed route fallback due to error:', error);
              const message = error instanceof Error ? error.message : String(error);
              const isConnectivityTimeout = /timed out|timeout exceeded when trying to connect|failed to query database after multiple retries|unable to check out connection from the pool/i.test(
                message
              );
              if (isConnectivityTimeout) {
                const apiRows = await buildRegistrarApiSnapshotRows();
                const fallbackRows = apiRows.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
                const stableRows = fallbackRows.length ? fallbackRows : lastStableEnrollmentFeedRows;
                if (fallbackRows.length) lastStableEnrollmentFeedRows = fallbackRows;
                writeJson(res, 200, {
                  ok: true,
                  data: {
                    stats: [
                      { title: 'Pending Review', value: String(stableRows.filter((row) => row.queueBucket === 'pending').length), subtitle: 'Registrar submissions waiting on cashier action', icon: 'mdi-clipboard-check-outline', tone: 'blue' },
                      { title: 'Billing Created', value: String(stableRows.filter((row) => row.queueBucket === 'approved').length), subtitle: 'Approved rows already linked to real billing records', icon: 'mdi-file-document-check-outline', tone: 'green' },
                      { title: 'On Hold', value: String(stableRows.filter((row) => row.queueBucket === 'hold').length), subtitle: 'Rows paused for validation or missing registrar details', icon: 'mdi-pause-circle-outline', tone: 'orange' },
                      { title: 'Returned', value: String(stableRows.filter((row) => row.queueBucket === 'returned').length), subtitle: 'Rows sent back to registrar for correction', icon: 'mdi-undo-variant', tone: 'purple' }
                    ],
                    items: stableRows,
                    meta: { page: 1, perPage: stableRows.length || 10, total: stableRows.length, totalPages: 1 },
                    filters: {
                      statuses: Array.from(new Set(stableRows.map((row) => row.status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                      semesters: Array.from(new Set(stableRows.map((row) => row.semester).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                      sources: Array.from(new Set(stableRows.map((row) => row.source).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
                      offices: Array.from(new Set(stableRows.map((row) => row.office).filter(Boolean))).sort((left, right) => left.localeCompare(right))
                    }
                  },
                  message: fallbackRows.length
                    ? 'Showing live registrar enrollment feed while cashier database reconnects.'
                    : 'Showing last stable registrar snapshot while live sync retries.'
                });
                return;
              }
              writeJson(res, 200, {
                ok: true,
                data: {
                  stats: [
                    { title: 'Pending Review', value: '0', subtitle: 'Registrar submissions waiting on cashier action', icon: 'mdi-clipboard-check-outline', tone: 'blue' },
                    { title: 'Billing Created', value: '0', subtitle: 'Approved rows already linked to real billing records', icon: 'mdi-file-document-check-outline', tone: 'green' },
                    { title: 'On Hold', value: '0', subtitle: 'Rows paused for validation or missing registrar details', icon: 'mdi-pause-circle-outline', tone: 'orange' },
                    { title: 'Returned', value: '0', subtitle: 'Rows sent back to registrar for correction', icon: 'mdi-undo-variant', tone: 'purple' }
                  ],
                  items: [],
                  meta: { page: 1, perPage: 10, total: 0, totalPages: 1 },
                  filters: { statuses: [], semesters: [], sources: [], offices: [] }
                },
                message: 'Enrollment feed is temporarily unavailable. Showing fallback data.'
              });
            }
            return;
          }

          if (url.pathname === '/api/crad-student-list-feed' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureCashierEnrollmentFeedTable(sql);
            await sql.query(
              `CREATE TABLE IF NOT EXISTS crad_student_list_feed (
                 id BIGSERIAL PRIMARY KEY,
                 enrollment_feed_id BIGINT DEFAULT NULL,
                 billing_id INT DEFAULT NULL,
                 batch_id TEXT DEFAULT NULL,
                 student_no TEXT NOT NULL,
                 student_name TEXT NOT NULL,
                 semester TEXT DEFAULT NULL,
                 academic_year TEXT DEFAULT NULL,
                 downpayment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
                 paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
                 status TEXT NOT NULL DEFAULT 'queued',
                 payload JSONB DEFAULT NULL,
                 sent_by INT DEFAULT NULL,
                 sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
               )`
            );
            await sql.query(
              `CREATE UNIQUE INDEX IF NOT EXISTS idx_crad_student_list_feed_enrollment_feed_id
               ON crad_student_list_feed (enrollment_feed_id)`
            );

            const eligibleRows = (await sql.query(
              `SELECT
                 f.id AS enrollment_feed_id,
                 f.linked_billing_id AS billing_id,
                 f.batch_id,
                 f.student_no,
                 f.student_name,
                 f.semester,
                 f.academic_year,
                 f.downpayment_amount,
                 b.paid_amount,
                 b.balance_amount,
                 b.billing_status,
                 CASE
                   WHEN COALESCE(b.paid_amount, 0) >= COALESCE(f.downpayment_amount, 0) THEN TRUE
                   ELSE FALSE
                 END AS ready_to_send,
                 c.id AS sent_id,
                 c.sent_at::text AS sent_at
               FROM public.cashier_registrar_student_enrollment_feed f
               INNER JOIN billing_records b ON b.id = f.linked_billing_id
               LEFT JOIN crad_student_list_feed c ON c.enrollment_feed_id = f.id
               WHERE COALESCE(f.downpayment_amount, 0) > 0
                 AND f.linked_billing_id IS NOT NULL
                 AND LOWER(COALESCE(f.last_action, '')) NOT IN ('hold', 'return')
               ORDER BY f.id DESC`
            )) as Array<Record<string, unknown>>;

            const eligibleItems = eligibleRows.map((row) => {
              const downpaymentAmount = Number(row.downpayment_amount || 0);
              const totalPaidAmount = Number(row.paid_amount || 0);
              const paidAmount = Math.max(0, Math.min(totalPaidAmount, Math.max(0, downpaymentAmount)));
              const downpaymentBalanceAmount = Math.max(0, downpaymentAmount - paidAmount);
              const billingBalanceAmount = downpaymentBalanceAmount;
              const normalizedBillingStatus = String(row.billing_status || '').trim().toLowerCase();
              const hasUnpaidBilling = billingBalanceAmount > 0 || ['unpaid', 'partial', 'active', 'verified'].includes(normalizedBillingStatus);

              return {
                enrollmentFeedId: Number(row.enrollment_feed_id || 0),
                billingId: Number(row.billing_id || 0) || null,
                batchId: toSafeText(row.batch_id),
                studentNo: toSafeText(row.student_no),
                studentName: toSafeText(row.student_name),
                semester: toSafeText(row.semester),
                academicYear: toSafeText(row.academic_year),
                downpaymentAmount,
                downpaymentAmountFormatted: formatCurrency(downpaymentAmount),
                totalPaidAmount,
                totalPaidAmountFormatted: formatCurrency(totalPaidAmount),
                paidAmount,
                paidAmountFormatted: formatCurrency(paidAmount),
                downpaymentBalanceAmount,
                downpaymentBalanceAmountFormatted: formatCurrency(downpaymentBalanceAmount),
                billingBalanceAmount,
                billingBalanceAmountFormatted: formatCurrency(billingBalanceAmount),
                hasUnpaidBilling,
                readyToSend: true,
                alreadySent: Boolean(row.sent_id),
                sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null
              };
            });

            const sentRows = (await sql.query(
              `SELECT id, enrollment_feed_id, student_no, student_name, semester, academic_year, downpayment_amount, paid_amount, status, sent_at::text AS sent_at
               FROM crad_student_list_feed
               ORDER BY sent_at DESC, id DESC
               LIMIT 200`
            )) as Array<Record<string, unknown>>;

            const sentItems = sentRows.map((row) => ({
              id: Number(row.id || 0),
              enrollmentFeedId: Number(row.enrollment_feed_id || 0) || null,
              studentNo: toSafeText(row.student_no),
              studentName: toSafeText(row.student_name),
              semester: toSafeText(row.semester),
              academicYear: toSafeText(row.academic_year),
              downpaymentAmount: Number(row.downpayment_amount || 0),
              downpaymentAmountFormatted: formatCurrency(row.downpayment_amount || 0),
              paidAmount: Number(row.paid_amount || 0),
              paidAmountFormatted: formatCurrency(row.paid_amount || 0),
              status: toSafeText(row.status) || 'queued',
              sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null
            }));

            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  {
                    title: 'Approved Students',
                    value: String(eligibleItems.length),
                    subtitle: 'Approved registrar rows with billing linked',
                    icon: 'mdi-account-check-outline',
                    tone: 'green'
                  },
                  {
                    title: 'Already Sent',
                    value: String(sentItems.length),
                    subtitle: 'Rows in crad_student_list_feed',
                    icon: 'mdi-send-check-outline',
                    tone: 'blue'
                  },
                  {
                    title: 'Approved Ready',
                    value: String(eligibleItems.length),
                    subtitle: 'Approved rows eligible for CRAD',
                    icon: 'mdi-cash-check',
                    tone: 'purple'
                  },
                  {
                    title: 'Pending Send',
                    value: String(eligibleItems.filter((item) => !item.alreadySent).length),
                    subtitle: 'Approved rows not yet sent',
                    icon: 'mdi-clock-outline',
                    tone: 'orange'
                  }
                ],
                eligibleItems,
                sentItems
              }
            });
            return;
          }

          if (url.pathname === '/api/cashier-registrar-student-enrollment-feed' && (req.method || '').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            const id = Number(body.id || 0);
            const batchId = String(body.batchId || '').trim() || `REG-ENR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            const source = String(body.source || '').trim() || 'Registrar';
            const office = String(body.office || '').trim() || 'Registrar';
            const studentNo = String(body.studentNo || '').trim();
            const studentName = String(body.studentName || '').trim();
            const classCode = String(body.classCode || '').trim() || null;
            const subject = String(body.subject || '').trim() || null;
            const academicYear = String(body.academicYear || '').trim() || null;
            const semester = String(body.semester || '').trim() || null;
            const status = String(body.status || '').trim() || 'Pending';
            const downpaymentAmount = Number(body.downpaymentAmount || 0);
            const remarks = toSafeText(body.remarks);
            const reason = toSafeText(body.reason);
            const payload = {
              batch_id: batchId,
              source,
              office,
              student_no: studentNo,
              student_name: studentName,
              class_code: classCode,
              subject,
              academic_year: academicYear,
              semester,
              status,
              downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
            };

            if (action === 'create') {
              if (!studentNo || !studentName) {
                writeJson(res, 422, { ok: false, message: 'studentNo and studentName are required.' });
                return;
              }

              const createdRows = (await sql.query(
                `INSERT INTO public.cashier_registrar_student_enrollment_feed (
                   batch_id, source, office, student_no, student_name, class_code, subject, academic_year, semester, status, downpayment_amount, payload, sent_at, created_at
                 ) VALUES (
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW(), NOW()
                 )
                 RETURNING id`,
                [batchId, source, office, studentNo, studentName, classCode, subject, academicYear, semester, status, Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0, JSON.stringify(payload)]
              )) as Array<{ id: number }>;
              const row = await fetchEnrollmentFeedRecordById(Number(createdRows[0]?.id || 0));
              writeJson(res, 200, {
                ok: true,
                message: 'Enrollment feed record created.',
                data: row
              });
              return;
            }

            if (action === 'update') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'A valid enrollment feed id is required.' });
                return;
              }
              if (!studentNo || !studentName) {
                writeJson(res, 422, { ok: false, message: 'studentNo and studentName are required.' });
                return;
              }

              const updatedRows = (await sql.query(
                `UPDATE public.cashier_registrar_student_enrollment_feed
                 SET batch_id = $1,
                     source = $2,
                     office = $3,
                     student_no = $4,
                     student_name = $5,
                     class_code = $6,
                     subject = $7,
                     academic_year = $8,
                     semester = $9,
                     status = $10,
                     downpayment_amount = $11,
                     payload = $12::jsonb,
                     sent_at = NOW()
                 WHERE id = $13
                 RETURNING id`,
                [batchId, source, office, studentNo, studentName, classCode, subject, academicYear, semester, status, Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0, JSON.stringify(payload), id]
              )) as Array<{ id: number }>;
              const rowId = Number(updatedRows[0]?.id || 0);
              const row = await fetchEnrollmentFeedRecordById(rowId);
              if (!row) {
                writeJson(res, 404, { ok: false, message: 'Enrollment feed record not found.' });
                return;
              }
              writeJson(res, 200, {
                ok: true,
                message: 'Enrollment feed record updated.',
                data: row
              });
              return;
            }

            if (action === 'delete') {
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'A valid enrollment feed id is required.' });
                return;
              }
              await sql.query(`DELETE FROM public.cashier_registrar_student_enrollment_feed WHERE id = $1`, [id]);
              writeJson(res, 200, { ok: true, message: 'Enrollment feed record deleted.', data: { id } });
              return;
            }

            if (['approve', 'hold', 'return'].includes(action)) {
              const actor = await resolveAdminSession();
              if (!actor) {
                writeJson(res, 401, { ok: false, message: 'Admin authentication required.' });
                return;
              }
              if (!id) {
                writeJson(res, 422, { ok: false, message: 'A valid enrollment feed id is required.' });
                return;
              }

              const feedRows = (await sql.query(
                `SELECT *
                 FROM public.cashier_registrar_student_enrollment_feed
                 WHERE id = $1
                 LIMIT 1`,
                [id]
              )) as Array<Record<string, unknown>>;
              const feedRow = feedRows[0];
              if (!feedRow) {
                writeJson(res, 404, { ok: false, message: 'Enrollment feed record not found.' });
                return;
              }

              const actorName = toSafeText(actor.full_name) || toSafeText(actor.username) || 'Cashier';
              const finalRemarks =
                action === 'return' ? [reason || 'Registrar correction required.', remarks].filter(Boolean).join(' ') : remarks;
              const previousStatus = normalizeEnrollmentFeedStatus(feedRow.status, Number(feedRow.linked_billing_id || 0) || null);
              const nextStatus = action === 'approve' ? 'Approved' : action === 'hold' ? 'On Hold' : 'Returned To Registrar';
              let nextStage = 'student_portal_billing';
              let linkedBillingId = Number(feedRow.linked_billing_id || 0) || null;
              let linkedBillingCode = toSafeText(feedRow.linked_billing_code);
              let actionMessage = '';
              const isTransientConnectionError = (error: unknown): boolean => {
                const message = error instanceof Error ? error.message : String(error || '');
                return /timeout exceeded when trying to connect|unable to check out connection from the pool|connection terminated due to connection timeout|connect etimedout/i.test(
                  message
                );
              };
              const wait = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms));
              const withTransientRetry = async <T>(task: () => Promise<T>): Promise<T> => {
                try {
                  return await task();
                } catch (error) {
                  if (!isTransientConnectionError(error)) throw error;
                  await wait(180);
                  return await task();
                }
              };

              if (action === 'approve') {
                const billingResult = await withTransientRetry(
                  async () => await upsertEnrollmentFeedBilling(feedRow, actor, remarks || 'Approved from registrar enrollment feed.')
                );
                linkedBillingId = billingResult.billingId;
                linkedBillingCode = billingResult.billingCode;
                nextStage = billingResult.workflowStage || 'student_portal_billing';
                actionMessage = billingResult.locked
                  ? `${billingResult.billingCode} already exists and remains in ${workflowLabel(nextStage)}.`
                  : billingResult.reused
                    ? `${billingResult.billingCode} was refreshed from the registrar feed and remains in ${workflowLabel(nextStage)}.`
                    : `${billingResult.billingCode} was created and queued in ${workflowLabel(nextStage)}.`;
              } else {
                let billingRow:
                  | {
                      id: number;
                      billing_code: string;
                      billing_status: string;
                      workflow_stage: string;
                      paid_amount: number;
                      balance_amount: number;
                    }
                  | null = null;

                if (linkedBillingId) {
                  const rows = (await sql.query(
                    `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
                     FROM billing_records
                     WHERE id = $1
                     LIMIT 1`,
                    [linkedBillingId]
                  )) as Array<{ id: number; billing_code: string; billing_status: string; workflow_stage: string; paid_amount: number; balance_amount: number }>;
                  billingRow = rows[0] || null;
                } else if (linkedBillingCode) {
                  const rows = (await sql.query(
                    `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
                     FROM billing_records
                     WHERE billing_code = $1
                     LIMIT 1`,
                    [linkedBillingCode]
                  )) as Array<{ id: number; billing_code: string; billing_status: string; workflow_stage: string; paid_amount: number; balance_amount: number }>;
                  billingRow = rows[0] || null;
                }

                if (billingRow) {
                  if (isEnrollmentBillingLocked(billingRow)) {
                    writeJson(res, 409, {
                      ok: false,
                      message: 'Linked billing already progressed beyond cashier review and can no longer be changed from this feed.'
                    });
                    return;
                  }

                  await sql.query(
                    `UPDATE billing_records
                     SET billing_status = $2,
                         workflow_stage = 'student_portal_billing',
                         remarks = $3,
                         action_by = $4,
                         action_at = NOW(),
                         returned_to = $5,
                         returned_by = $6,
                         returned_at = $7,
                         is_returned = $8,
                         needs_correction = $9,
                         correction_reason = $10,
                         correction_notes = $11,
                         updated_at = NOW()
                     WHERE id = $1`,
                    [
                      billingRow.id,
                      action === 'hold' ? 'on_hold' : 'correction',
                      finalRemarks || (action === 'hold' ? 'Enrollment feed placed on hold.' : 'Registrar correction required.'),
                      actor.admin_profile_id || null,
                      action === 'return' ? 'Registrar' : null,
                      action === 'return' ? actor.admin_profile_id || null : null,
                      action === 'return' ? new Date().toISOString() : null,
                      action === 'return',
                      action === 'return',
                      action === 'return' ? reason || 'Registrar correction required.' : null,
                      action === 'return' ? remarks || null : null
                    ]
                  );
                  linkedBillingId = Number(billingRow.id);
                  linkedBillingCode = toSafeText(billingRow.billing_code);
                }

                actionMessage =
                  action === 'hold'
                    ? `${toSafeText(feedRow.student_name) || 'Enrollment record'} was placed on hold for cashier review.`
                    : `${toSafeText(feedRow.student_name) || 'Enrollment record'} was returned to registrar for correction.`;
              }

              await sql.query(
                `UPDATE public.cashier_registrar_student_enrollment_feed
                 SET status = $2,
                     decision_notes = $3,
                     linked_billing_id = $4,
                     linked_billing_code = $5,
                     last_action = $6,
                     action_by = $7,
                     action_at = NOW(),
                     payload = $8::jsonb
                 WHERE id = $1`,
                [
                  id,
                  nextStatus,
                  finalRemarks || null,
                  linkedBillingId,
                  linkedBillingCode || null,
                  action,
                  actor.admin_profile_id || null,
                  JSON.stringify(
                    buildEnrollmentDecisionPayload(feedRow, {
                      action,
                      status: nextStatus,
                      remarks: finalRemarks,
                      actorName,
                      actionAt: new Date().toISOString(),
                      linkedBillingId,
                      linkedBillingCode
                    })
                  )
                ]
              );

              void (async () => {
                try {
                  await insertModuleActivity(
                    'billing_verification',
                    action === 'approve' ? 'Enrollment Approved' : action === 'hold' ? 'Enrollment On Hold' : 'Enrollment Returned',
                    action === 'approve'
                      ? `${toSafeText(feedRow.student_name)} approved from registrar feed. ${actionMessage}`
                      : action === 'hold'
                        ? `${toSafeText(feedRow.student_name)} placed on hold. ${finalRemarks || 'Awaiting cashier review.'}`
                        : `${toSafeText(feedRow.student_name)} returned to registrar. ${finalRemarks || 'Awaiting registrar correction.'}`,
                    actorName,
                    'enrollment_feed',
                    toSafeText(feedRow.batch_id) || String(id),
                    {
                      feedId: id,
                      action,
                      previousStatus,
                      nextStatus,
                      billingId: linkedBillingId,
                      billingCode: linkedBillingCode || null
                    }
                  );
                } catch (error) {
                  console.warn('[cashier] Unable to write enrollment activity log:', error);
                }
              })();

              void (async () => {
                try {
                  await sql.query(
                    `INSERT INTO notifications (recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at)
                     VALUES ($1, $2, 'in_app', $3, $4, $5, 'enrollment_feed', $6, FALSE, NOW())`,
                    [
                      'cashier',
                      actorName,
                      action === 'approve' ? 'billing_activated' : action === 'hold' ? 'billing_on_hold' : 'billing_returned',
                      action === 'approve' ? 'Enrollment approved' : action === 'hold' ? 'Enrollment placed on hold' : 'Enrollment returned',
                      actionMessage,
                      id
                    ]
                  );
                } catch (error) {
                  console.warn('[cashier] Unable to create enrollment notification:', error);
                }
              })();

              const item = await fetchEnrollmentFeedRecordById(id);
              writeJson(res, 200, {
                ok: true,
                message: actionMessage,
                data: {
                  message: actionMessage,
                  status: nextStatus,
                  workflow_stage: nextStage,
                  next_module: workflowLabel(nextStage),
                  billingId: linkedBillingId,
                  billingCode: linkedBillingCode || null,
                  item
                }
              });
              return;
            }

            writeJson(res, 400, { ok: false, message: 'Unsupported enrollment feed action.' });
            return;
          }

          if (url.pathname === '/api/crad-student-list-feed' && (req.method || '').toUpperCase() === 'POST') {
            await ensureCashierEnrollmentFeedTable(sql);
            await sql.query(
              `CREATE TABLE IF NOT EXISTS crad_student_list_feed (
                 id BIGSERIAL PRIMARY KEY,
                 enrollment_feed_id BIGINT DEFAULT NULL,
                 billing_id INT DEFAULT NULL,
                 batch_id TEXT DEFAULT NULL,
                 student_no TEXT NOT NULL,
                 student_name TEXT NOT NULL,
                 semester TEXT DEFAULT NULL,
                 academic_year TEXT DEFAULT NULL,
                 downpayment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
                 paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
                 status TEXT NOT NULL DEFAULT 'queued',
                 payload JSONB DEFAULT NULL,
                 sent_by INT DEFAULT NULL,
                 sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
               )`
            );
            await sql.query(
              `CREATE UNIQUE INDEX IF NOT EXISTS idx_crad_student_list_feed_enrollment_feed_id
               ON crad_student_list_feed (enrollment_feed_id)`
            );

            const body = await readJsonBody(req);
            const action = String(body.action || '').trim().toLowerCase();
            if (action !== 'send') {
              writeJson(res, 400, { ok: false, message: 'Unsupported CRAD student list feed action.' });
              return;
            }

            const enrollmentFeedId = Number(body.enrollmentFeedId || 0);
            if (!enrollmentFeedId) {
              writeJson(res, 422, { ok: false, message: 'A valid enrollmentFeedId is required.' });
              return;
            }

            const existingRows = (await sql.query(
              `SELECT id FROM crad_student_list_feed WHERE enrollment_feed_id = $1 LIMIT 1`,
              [enrollmentFeedId]
            )) as Array<Record<string, unknown>>;
            if (existingRows[0]) {
              writeJson(res, 200, {
                ok: true,
                message: 'Student already sent to CRAD student list feed.',
                data: { id: Number(existingRows[0].id || 0) }
              });
              return;
            }

            const eligibleRows = (await sql.query(
              `SELECT
                 f.id AS enrollment_feed_id,
                 f.linked_billing_id AS billing_id,
                 f.batch_id,
                 f.student_no,
                 f.student_name,
                 f.semester,
                 f.academic_year,
                 f.downpayment_amount,
                 f.payload,
                 b.paid_amount,
                 b.balance_amount
               FROM public.cashier_registrar_student_enrollment_feed f
               INNER JOIN billing_records b ON b.id = f.linked_billing_id
               WHERE f.id = $1
                 AND COALESCE(f.downpayment_amount, 0) > 0
                 AND f.linked_billing_id IS NOT NULL
                 AND LOWER(COALESCE(f.last_action, '')) NOT IN ('hold', 'return')
               LIMIT 1`,
              [enrollmentFeedId]
            )) as Array<Record<string, unknown>>;
            const row = eligibleRows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Eligible paid downpayment student not found.' });
              return;
            }

            const actor = await resolveAdminSession();
            const insertPayload = {
              enrollment_feed_id: Number(row.enrollment_feed_id || 0),
              billing_id: Number(row.billing_id || 0) || null,
              batch_id: toSafeText(row.batch_id),
              student_no: toSafeText(row.student_no),
              student_name: toSafeText(row.student_name),
              semester: toSafeText(row.semester),
              academic_year: toSafeText(row.academic_year),
              downpayment_amount: Number(row.downpayment_amount || 0),
              paid_amount: Number(row.paid_amount || 0),
              balance_amount: Number(row.balance_amount || 0),
              source_payload: row.payload && typeof row.payload === 'object' ? row.payload : null
            };

            const insertRows = (await sql.query(
              `INSERT INTO crad_student_list_feed (
                 enrollment_feed_id, billing_id, batch_id, student_no, student_name, semester, academic_year, downpayment_amount, paid_amount, status, payload, sent_by, sent_at, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW(), NOW())
               RETURNING id`,
              [
                Number(row.enrollment_feed_id || 0),
                Number(row.billing_id || 0) || null,
                toSafeText(row.batch_id),
                toSafeText(row.student_no),
                toSafeText(row.student_name),
                toSafeText(row.semester),
                toSafeText(row.academic_year),
                Number(row.downpayment_amount || 0),
                Number(row.paid_amount || 0),
                'queued',
                JSON.stringify(insertPayload),
                actor?.admin_profile_id || null
              ]
            )) as Array<Record<string, unknown>>;

            writeJson(res, 200, {
              ok: true,
              message: `${toSafeText(row.student_name)} was sent to crad_student_list_feed.`,
              data: {
                id: Number(insertRows[0]?.id || 0)
              }
            });
            return;
          }

          if (url.pathname === '/api/process-payment' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureCashierWorkflowDemoData();
            await ensureClinicBookingsSyncedToCashier();
            const upstreamRows = (await sql.query(
              `SELECT
                  b.id,
                  b.billing_code,
                  b.billing_status,
                  b.workflow_stage,
                  b.balance_amount,
                  b.created_at::text AS created_at,
                  COALESCE(s.full_name, 'Unknown Student') AS full_name,
                  COALESCE(s.student_no, '') AS student_no,
                  COALESCE(s.email, '') AS student_email
               FROM billing_records b
               LEFT JOIN students s ON s.id = b.student_id
               WHERE b.workflow_stage = 'pay_bills'
                 AND NOT EXISTS (
                   SELECT 1
                   FROM payment_transactions p
                   WHERE p.billing_id = b.id
                     AND p.workflow_stage = 'payment_processing_gateway'
                     AND LOWER(COALESCE(p.payment_status, 'processing')) IN ('processing', 'authorized')
                 )
               ORDER BY b.created_at DESC, b.id DESC
               LIMIT 120`
            )) as Array<{
              id: number;
              billing_code: string;
              billing_status: string;
              workflow_stage: string;
              balance_amount: number;
              created_at: string;
              full_name: string;
              student_no: string;
              student_email: string;
            }>;
            const upstreamFeeRows = (await sql.query(
              `SELECT id, billing_id, item_code, item_name, category, amount
               FROM billing_items
               ORDER BY billing_id ASC, sort_order ASC, id ASC`
            )) as Array<{
              id: number;
              billing_id: number;
              item_code: string | null;
              item_name: string;
              category: string | null;
              amount: number;
            }>;
            const upstreamFeeMap = new Map<number, Array<{
              id: number;
              feeType: string;
              feeCode: string;
              category: string;
              remainingAmount: number;
              remainingAmountFormatted: string;
            }>>();
            for (const fee of upstreamFeeRows) {
              const billingId = Number(fee.billing_id || 0);
              const existing = upstreamFeeMap.get(billingId) || [];
              existing.push({
                id: Number(fee.id),
                feeType: String(fee.item_name || fee.item_code || 'Fee Item'),
                feeCode: String(fee.item_code || `FEE-${fee.id}`),
                category: String(fee.category || 'Assessment'),
                remainingAmount: Number(fee.amount || 0),
                remainingAmountFormatted: formatCurrency(fee.amount)
              });
              upstreamFeeMap.set(billingId, existing);
            }

            const rows = (await sql.query(
              `SELECT p.id, p.reference_number, p.amount_paid, p.payment_method, p.payment_status, p.workflow_stage, p.payment_date::text AS payment_date,
                      b.billing_code, COALESCE(s.full_name, 'Unknown Student') AS full_name, COALESCE(s.student_no, '') AS student_no,
                      COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC
               LIMIT 120`
            )) as Array<{
              id: number;
              reference_number: string;
              amount_paid: number;
              payment_method: string;
              payment_status: string;
              workflow_stage: string;
              payment_date: string;
              billing_code: string | null;
              full_name: string;
              student_no: string;
              student_email: string;
              course: string;
            }>;
            const mapped = rows.map((row) => {
              const status = mapPaymentStatus(String(row.payment_status || ''));
              const connectionMeta = deriveBillingConnectionMeta(row);
              return {
                id: Number(row.id),
                reference: String(row.reference_number || `PAY-${row.id}`),
                studentName: String(row.full_name || 'Unknown Student'),
                channel: String(row.payment_method || 'Online'),
                amount: formatCurrency(row.amount_paid),
                billingCode: String(row.billing_code || ''),
                sourceModule: connectionMeta.sourceModule,
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                status,
                workflowStage: String(row.workflow_stage || 'payment_processing_gateway'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'payment_processing_gateway')),
                note: '',
                allocations: [],
                allocationSummary: '',
                totalAllocated: formatCurrency(row.amount_paid)
              };
            });
            const stageItems = mapped.filter((row) => row.workflowStage === 'payment_processing_gateway');
            const historyItems = mapped.filter((row) => row.workflowStage !== 'payment_processing_gateway');
            const items = stageItems.filter((row) => row.status === 'Processing' || row.status === 'Authorized');
            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'Pay Bills Intake', value: String(upstreamRows.length), subtitle: 'Ready from Pay Bills', icon: 'mdi-tray-arrow-down', tone: 'purple' },
                  { title: 'Pending Gateway', value: String(items.filter((item) => item.status === 'Processing').length), subtitle: 'Awaiting action', icon: 'mdi-timer-sand', tone: 'blue' },
                  { title: 'Authorized', value: String(items.filter((item) => item.status === 'Authorized').length), subtitle: 'Ready to confirm', icon: 'mdi-check-decagram-outline', tone: 'green' },
                  { title: 'Failed/Cancelled', value: String(stageItems.filter((item) => item.status === 'Failed' || item.status === 'Cancelled').length), subtitle: 'Requires follow-up', icon: 'mdi-alert-outline', tone: 'orange' }
                ],
                upstreamItems: upstreamRows.map((row) => {
                  const connectionMeta = deriveBillingConnectionMeta(row);
                  const isClinicOrigin = connectionMeta.isClinicOrigin;
                  const paymentLabel =
                    String(row.billing_status || '').toLowerCase() === 'failed'
                      ? 'failed'
                      : Number(row.balance_amount || 0) <= 0
                        ? 'paid'
                        : 'unpaid';
                  return {
                    id: Number(row.id),
                    reference: String(row.billing_code || `BILL-${row.id}`),
                    patientName: String(row.full_name || 'Unknown Student'),
                    amount: formatCurrency(row.balance_amount),
                    rawAmount: Number(row.balance_amount || 0),
                    payment: paymentLabel,
                    sync: isClinicOrigin ? 'clinic_synced' : 'cashier_ready',
                    createdAt: String(row.created_at || ''),
                    workflowStage: String(row.workflow_stage || 'pay_bills'),
                    workflowStageLabel: workflowLabel(String(row.workflow_stage || 'pay_bills')),
                    isClinicOrigin,
                    sourceModule: connectionMeta.sourceModule,
                    sourceDepartment: connectionMeta.sourceDepartment,
                    sourceCategory: connectionMeta.sourceCategory,
                    note: isClinicOrigin
                      ? `${connectionMeta.sourceDepartment} billing is ready for cashier payment update.`
                      : 'Billing is ready in Pay Bills for gateway handoff.',
                    feeItems: upstreamFeeMap.get(Number(row.id)) || []
                  };
                }),
                items,
                historyItems,
                activityFeed: []
              }
            });
            return;
          }

          if (url.pathname === '/api/generate-receipt' && (req.method || 'GET').toUpperCase() === 'GET') {
            const rows = (await sql.query(
              `SELECT r.id, r.receipt_number, r.receipt_status, r.workflow_stage, r.issued_date::text AS issued_date,
                      p.reference_number, p.amount_paid, p.payment_status, p.payment_method, p.id AS payment_id,
                      b.billing_code, COALESCE(s.full_name, 'Unknown Student') AS full_name, COALESCE(s.student_no, '') AS student_no,
                      COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course
               FROM receipt_records r
               LEFT JOIN payment_transactions p ON p.id = r.payment_id
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               ORDER BY r.issued_date DESC NULLS LAST, r.created_at DESC, r.id DESC
               LIMIT 120`
            )) as Array<{
              id: number;
              receipt_number: string | null;
              receipt_status: string | null;
              workflow_stage: string | null;
              issued_date: string | null;
              reference_number: string | null;
              amount_paid: number | null;
              payment_status: string | null;
              payment_method: string | null;
              payment_id: number | null;
              billing_code: string | null;
              full_name: string;
              student_no: string;
              student_email: string;
              course: string;
            }>;
            const mapped = rows.map((row) => {
              const status = mapReceiptStatus(String(row.receipt_status || ''));
              const connectionMeta = deriveBillingConnectionMeta(row);
              return {
                id: Number(row.id),
                receiptNo: String(row.receipt_number || '--'),
                studentName: String(row.full_name || 'Unknown Student'),
                paymentRef: String(row.reference_number || ''),
                paymentMethod: String(row.payment_method || 'Online'),
                paymentStatus: mapPaymentStatus(String(row.payment_status || '')),
                amount: formatCurrency(row.amount_paid),
                issuedFor: String(row.billing_code || 'Billing Settlement'),
                sourceModule: connectionMeta.sourceModule,
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                status,
                workflowStage: String(row.workflow_stage || 'compliance_documentation'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'compliance_documentation')),
                note: connectionMeta.isClinicOrigin
                  ? `${connectionMeta.sourceDepartment} documentation is ready for compliance review.`
                  : '',
                receiptItems: [],
                allocationSummary: ''
              };
            });
            const items = mapped.filter((item) => item.workflowStage === 'compliance_documentation');
            const historyItems = mapped.filter((item) => item.workflowStage !== 'compliance_documentation');
            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'Receipt Pending', value: String(items.filter((item) => item.status === 'Receipt Pending').length), subtitle: 'Awaiting generation', icon: 'mdi-receipt-text-outline', tone: 'blue' },
                  { title: 'Receipt Generated', value: String(items.filter((item) => item.status === 'Receipt Generated').length), subtitle: 'Ready for proof review', icon: 'mdi-receipt-outline', tone: 'orange' },
                  { title: 'Proof Verified', value: String(items.filter((item) => item.status === 'Proof Verified').length), subtitle: 'Validated records', icon: 'mdi-shield-check-outline', tone: 'green' },
                  { title: 'Documentation', value: String(historyItems.filter((item) => item.status === 'Documentation Completed').length), subtitle: 'Completed docs', icon: 'mdi-file-document-outline', tone: 'purple' }
                ],
                items,
                historyItems,
                activityFeed: []
              }
            });
            return;
          }

          if (url.pathname === '/api/reporting-reconciliation' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureCashierWorkflowDemoData();
            const rows = (await sql.query(
              `SELECT p.id, p.reference_number, p.amount_paid, p.payment_status, p.reporting_status, p.workflow_stage, p.payment_date::text AS payment_date,
                      b.billing_code, COALESCE(s.full_name, 'Unknown Student') AS full_name, COALESCE(s.student_no, '') AS student_no,
                      COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course,
                      COALESCE(r.receipt_number, '--') AS receipt_number, COALESCE(r.receipt_status, '') AS receipt_status
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC
               LIMIT 120`
            )) as Array<{
              id: number;
              reference_number: string;
              amount_paid: number;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string;
              billing_code: string | null;
              full_name: string;
              student_no: string;
              student_email: string;
              course: string;
              receipt_number: string;
              receipt_status: string;
            }>;
            const mapped = rows.map((row) => {
              const connectionMeta = deriveBillingConnectionMeta(row);
              const departmentTargets = resolveCashierDepartmentTargets(connectionMeta);
              return {
                id: Number(row.id),
                reference: String(row.reference_number || `PAY-${row.id}`),
                studentName: String(row.full_name || 'Unknown Student'),
                amount: formatCurrency(row.amount_paid),
                billingCode: String(row.billing_code || ''),
                receiptNumber: String(row.receipt_number || '--'),
                sourceModule: connectionMeta.sourceModule,
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                targetDepartment: departmentTargets.reportingDepartment,
                operationalTargetDepartment: departmentTargets.operationalTargetDepartment,
                paymentStatus: mapPaymentStatus(String(row.payment_status || '')),
                documentStatus: mapReceiptStatus(String(row.receipt_status || '')),
                status: mapReportingStatus(String(row.reporting_status || '')),
                workflowStage: String(row.workflow_stage || 'reporting_reconciliation'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'reporting_reconciliation')),
                postedAt: String(row.payment_date || ''),
                allocationSummary: '',
                allocations: []
              };
            });
            const pmedRequestRows = await fetchPmedCashierRequestRows(12);
            const pmedRequestAlerts = pmedRequestRows.map((row) => {
              const metadata = typeof row.metadata === 'string'
                ? (() => {
                    try {
                      return JSON.parse(row.metadata) as Record<string, unknown>;
                    } catch {
                      return {} as Record<string, unknown>;
                    }
                  })()
                : ((row.metadata || {}) as Record<string, unknown>);
              const reportName = toSafeText(metadata.report_name) || toSafeText(row.entity_key) || 'Requested Financial Report';
              const reportReference = toSafeText(metadata.report_reference) || toSafeText(row.entity_key);
              return {
                title: `PMED Request: ${reportName}`,
                detail: `${toSafeText(row.detail) || 'PMED requested a cashier financial report.'}${reportReference ? ` Reference: ${reportReference}.` : ''}`,
                time: formatRelativeTime(row.created_at)
              };
            });
            const items = mapped.filter((item) => item.workflowStage === 'reporting_reconciliation');
            const historyItems = mapped.filter((item) => item.workflowStage === 'completed');
            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'PMED Requests', value: String(pmedRequestRows.length), subtitle: 'Incoming report requests from PMED Department', icon: 'mdi-bell-badge-outline', tone: 'purple' },
                  { title: 'Logged', value: String(items.filter((item) => item.status === 'Logged').length), subtitle: 'Captured records', icon: 'mdi-text-box-check-outline', tone: 'blue' },
                  { title: 'Reconciled', value: String(items.filter((item) => item.status === 'Reconciled').length), subtitle: 'Balanced records', icon: 'mdi-check-outline', tone: 'green' },
                  { title: 'PMED Ready', value: String(mapped.filter((item) => item.status === 'Reported' || item.status === 'Archived').length), subtitle: 'Financial reporting linked to PMED Department', icon: 'mdi-chart-box-outline', tone: 'orange' },
                  { title: 'Archived', value: String(historyItems.filter((item) => item.status === 'Archived').length), subtitle: 'Completed records', icon: 'mdi-archive-outline', tone: 'purple' }
                ],
                items,
                historyItems,
                activityFeed: pmedRequestAlerts
              }
            });
            return;
          }

          if (url.pathname === '/api/cashier/department-handoffs' && (req.method || 'GET').toUpperCase() === 'GET') {
            try {
            const queryWithTimeout = async <T>(promise: Promise<T>, ms = 2500): Promise<T> =>
              await Promise.race([
                promise,
                new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error(`Department handoffs route timed out after ${ms}ms`)), ms)
                )
              ]);
            await queryWithTimeout(sql.query('SELECT 1'), 2500);
            await ensureCashierWorkflowDemoData();
            const rows = (await queryWithTimeout(sql.query(
              `SELECT p.id, p.billing_id, p.reference_number, p.amount_paid, p.payment_status, p.reporting_status, p.workflow_stage,
                      p.payment_date::text AS payment_date, b.billing_code,
                      COALESCE(s.full_name, 'Unknown Student') AS full_name,
                      COALESCE(s.student_no, '') AS student_no,
                      COALESCE(s.email, '') AS student_email,
                      COALESCE(s.course, '') AS course,
                      COALESCE(r.receipt_number, '--') AS receipt_number,
                      COALESCE(r.receipt_status, '') AS receipt_status,
                      r.issued_date::text AS issued_date
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC
               LIMIT 120`
            ), 4000)) as Array<{
              id: number;
              billing_id: number | null;
              reference_number: string;
              amount_paid: number;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string | null;
              billing_code: string | null;
              full_name: string;
              student_no: string;
              student_email: string;
              course: string;
              receipt_number: string;
              receipt_status: string;
              issued_date: string | null;
            }>;

            const items = rows.flatMap((row) => {
              const connectionMeta = deriveBillingConnectionMeta(row);
              const departmentTargets = resolveCashierDepartmentTargets(connectionMeta);
              const paymentStatus = mapPaymentStatus(String(row.payment_status || ''));
              const receiptStatus = mapReceiptStatus(String(row.receipt_status || ''));
              const clearance = deriveCashierClearance(String(row.payment_status || ''), String(row.receipt_status || ''));
              const amountFormatted = formatCurrency(row.amount_paid);
              const workflowStage = String(row.workflow_stage || 'reporting_reconciliation');
              const lastUpdatedAt = String(row.issued_date || row.payment_date || '');

              return [
                {
                  id: `operational-${row.id}`,
                  paymentId: Number(row.id),
                  billingId: Number(row.billing_id || 0),
                  consumerDepartment: departmentTargets.operationalTargetDepartment,
                  consumerRole: String(departmentTargets.operationalTargetDepartment || '').toLowerCase().includes('clinic')
                    ? 'clinic'
                    : String(departmentTargets.operationalTargetDepartment || '').toLowerCase().includes('hr')
                      ? 'hr'
                      : 'registrar',
                  channelType: 'Operational',
                  sourceDepartment: connectionMeta.sourceDepartment,
                  sourceModule: connectionMeta.sourceModule,
                  sourceCategory: connectionMeta.sourceCategory,
                  studentName: String(row.full_name || 'Unknown Student'),
                  studentNumber: String(row.student_no || ''),
                  billingCode: String(row.billing_code || ''),
                  paymentReference: String(row.reference_number || `PAY-${row.id}`),
                  amount: Number(row.amount_paid || 0),
                  amountFormatted,
                  paymentStatus,
                  receiptNumber: String(row.receipt_number || 'Pending Receipt'),
                  receiptStatus,
                  clearanceStatus: clearance.status,
                  clearanceNote: clearance.note,
                  handoffStatus: clearance.status === 'Cleared' ? 'ready' : 'pending',
                  handoffReference: '',
                  requestReference: '',
                  outputs: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'],
                  workflowStage,
                  workflowStageLabel: workflowLabel(workflowStage),
                  integrationSummary: `${connectionMeta.sourceDepartment} sends cashier records to ${departmentTargets.operationalTargetDepartment}.`,
                  lastUpdatedAt,
                  lastUpdatedLabel: lastUpdatedAt ? formatDateTimeLabel(lastUpdatedAt) : '--'
                },
                {
                  id: `reporting-${row.id}`,
                  paymentId: Number(row.id),
                  billingId: Number(row.billing_id || 0),
                  consumerDepartment: departmentTargets.reportingDepartment,
                  consumerRole: String(departmentTargets.reportingDepartment || '').toLowerCase().includes('pmed')
                    ? 'pmed'
                    : String(departmentTargets.reportingDepartment || '').toLowerCase().includes('admin')
                      ? 'admin'
                      : 'cashier',
                  channelType: 'Reporting',
                  sourceDepartment: connectionMeta.sourceDepartment,
                  sourceModule: connectionMeta.sourceModule,
                  sourceCategory: connectionMeta.sourceCategory,
                  studentName: String(row.full_name || 'Unknown Student'),
                  studentNumber: String(row.student_no || ''),
                  billingCode: String(row.billing_code || ''),
                  paymentReference: String(row.reference_number || `PAY-${row.id}`),
                  amount: Number(row.amount_paid || 0),
                  amountFormatted,
                  paymentStatus,
                  receiptNumber: String(row.receipt_number || 'Pending Receipt'),
                  receiptStatus,
                  clearanceStatus: clearance.status,
                  clearanceNote: clearance.note,
                  handoffStatus:
                    String(row.reporting_status || '').toLowerCase() === 'reported'
                      ? 'sent'
                      : String(row.reporting_status || '').toLowerCase() === 'reconciled'
                        ? 'ready'
                        : 'pending',
                  handoffReference: '',
                  requestReference: '',
                  outputs: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status', departmentTargets.reportingArtifact],
                  workflowStage,
                  workflowStageLabel: workflowLabel(workflowStage),
                  integrationSummary: `${connectionMeta.sourceDepartment} cashier reporting is routed to ${departmentTargets.reportingDepartment}.`,
                  lastUpdatedAt,
                  lastUpdatedLabel: lastUpdatedAt ? formatDateTimeLabel(lastUpdatedAt) : '--'
                }
              ];
            });

            const latestItems = items
              .slice()
              .sort((left, right) => new Date(String(right.lastUpdatedAt || '')).getTime() - new Date(String(left.lastUpdatedAt || '')).getTime())
              .slice(0, 8);

            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'Registrar Linked', value: String(items.filter((item) => item.consumerDepartment === 'Registrar').length), subtitle: 'Cashier records ready for registrar visibility', icon: 'mdi-school-outline', tone: 'blue' },
                  { title: 'PMED / Admin', value: String(items.filter((item) => ['PMED Department', 'Admin Reports'].includes(String(item.consumerDepartment || ''))).length), subtitle: 'Reporting-facing records for PMED and admin reports', icon: 'mdi-domain', tone: 'purple' },
                  { title: 'Cleared', value: String(items.filter((item) => item.channelType === 'Operational' && item.clearanceStatus === 'Cleared').length), subtitle: 'Payment and official receipt already complete', icon: 'mdi-check-decagram-outline', tone: 'green' },
                  { title: 'Not Cleared', value: String(items.filter((item) => item.channelType === 'Operational' && item.clearanceStatus !== 'Cleared').length), subtitle: 'Records still waiting on payment or receipt completion', icon: 'mdi-alert-circle-outline', tone: 'orange' }
                ],
                matrix: buildDepartmentServiceMatrix(),
                items,
                latestItems
              }
            });
            } catch (error) {
              console.warn('[cashier] Department handoffs route fallback due to error:', error);
              writeJson(res, 200, {
                ok: true,
                data: {
                  stats: [
                    { title: 'Registrar Linked', value: '0', subtitle: 'Cashier records ready for registrar visibility', icon: 'mdi-school-outline', tone: 'blue' },
                    { title: 'PMED / Admin', value: '0', subtitle: 'Reporting-facing records for PMED and admin reports', icon: 'mdi-domain', tone: 'purple' },
                    { title: 'Cleared', value: '0', subtitle: 'Payment and official receipt already complete', icon: 'mdi-check-decagram-outline', tone: 'green' },
                    { title: 'Not Cleared', value: '0', subtitle: 'Records still waiting on payment or receipt completion', icon: 'mdi-alert-circle-outline', tone: 'orange' }
                  ],
                  matrix: [],
                  items: [],
                  latestItems: []
                },
                message: 'Department handoffs are temporarily unavailable. Showing fallback data.'
              });
            }
            return;
          }

          if (url.pathname === '/api/report-center' && (req.method || 'GET').toUpperCase() === 'GET') {
            const requestRows = await fetchPmedCashierRequestRows(40);

            const candidateRows = (await sql.query(
              `SELECT p.id, p.reference_number, p.amount_paid, p.payment_method, p.payment_status, p.reporting_status, p.workflow_stage, p.payment_date::text AS payment_date,
                      b.billing_code, COALESCE(s.full_name, 'Unknown Student') AS full_name, COALESCE(r.receipt_number, '--') AS receipt_number
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               WHERE LOWER(COALESCE(p.reporting_status, '')) IN ('logged', 'with_discrepancy', 'reconciled', 'reported')
                 AND (
                   LOWER(COALESCE(p.workflow_stage, '')) IN ('reporting_reconciliation', 'compliance_documentation', 'payment_processing_gateway')
                   OR LOWER(COALESCE(p.payment_status, '')) IN ('paid', 'posted')
                 )
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC
               LIMIT 60`
            )) as Array<{
              id: number;
              reference_number: string;
              amount_paid: number;
              payment_method: string;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string;
              billing_code: string | null;
              full_name: string;
              receipt_number: string;
            }>;

            const sentRows = (await sql.query(
              `SELECT id, action, detail, actor, entity_key, metadata, created_at
               FROM module_activity_logs
               WHERE LOWER(module) = 'department_reports'
                 AND LOWER(COALESCE(metadata->>'source_department', '')) = 'cashier'
                 AND LOWER(COALESCE(metadata->>'target_department', metadata->>'target_key', '')) = 'pmed'
               ORDER BY created_at DESC
               LIMIT 60`
            )) as Array<{
              id: number;
              action: string;
              detail: string;
              actor: string;
              entity_key: string | null;
              metadata: Record<string, unknown> | string | null;
              created_at: string;
            }>;

            const parseMetadata = (value: Record<string, unknown> | string | null | undefined): Record<string, unknown> => {
              if (!value) return {};
              if (typeof value === 'string') {
                try {
                  return JSON.parse(value) as Record<string, unknown>;
                } catch {
                  return {};
                }
              }
              return value;
            };

            const mappedRequests = requestRows.map((row) => {
              const metadata = parseMetadata(row.metadata);
              return {
                id: Number(row.id),
                requestReference: toSafeText(metadata.report_reference) || toSafeText(row.entity_key) || `REQ-${row.id}`,
                reportName: toSafeText(metadata.report_name) || 'Requested Cashier Report',
                reportType: toSafeText(metadata.report_type) || 'Cashier Financial Report',
                targetDepartment: toSafeText(metadata.target_department_name) || 'Cashier',
                requestedBy: toSafeText(row.actor) || 'PMED',
                requestedAt: toSafeText(row.created_at),
                requestedAtLabel: formatDateTimeLabel(toSafeText(row.created_at)),
                requestedAtRelative: formatRelativeTime(row.created_at),
                detail: toSafeText(row.detail) || 'PMED requested a cashier financial report package.',
                planReference: toSafeText(metadata.plan_reference),
                status: toSafeText(metadata.request_status) || 'requested'
              };
            });

            const mappedCandidates = candidateRows.map((row) => {
              const connectionMeta = deriveBillingConnectionMeta(row);
              return {
                id: Number(row.id),
                reference: String(row.reference_number || `PAY-${row.id}`),
                studentName: String(row.full_name || 'Unknown Student'),
                amount: formatCurrency(row.amount_paid),
                rawAmount: Number(row.amount_paid || 0),
                billingCode: String(row.billing_code || ''),
                receiptNumber: String(row.receipt_number || '--'),
                paymentMethod: String(row.payment_method || 'Cash'),
                paymentStatus: mapPaymentStatus(String(row.payment_status || '')),
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                postedAt: String(row.payment_date || ''),
                status: mapReportingStatus(String(row.reporting_status || '')),
                workflowStage: String(row.workflow_stage || 'reporting_reconciliation'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'reporting_reconciliation'))
              };
            });

            const mappedReady = mappedCandidates
              .filter((item) => item.status === 'Reconciled')
              .map((item) => ({
                id: item.id,
                reference: item.reference,
                studentName: item.studentName,
                amount: item.amount,
                rawAmount: item.rawAmount,
                billingCode: item.billingCode,
                receiptNumber: item.receiptNumber,
                paymentMethod: item.paymentMethod,
                paymentStatus: item.paymentStatus,
                sourceDepartment: item.sourceDepartment,
                sourceCategory: item.sourceCategory,
                postedAt: item.postedAt
              }));

            const mappedSent = sentRows.map((row) => {
              const metadata = parseMetadata(row.metadata);
              return {
                id: Number(row.id),
                reportReference: toSafeText(metadata.report_reference) || toSafeText(row.entity_key) || `CASHIER-RPT-${row.id}`,
                requestReference: toSafeText(metadata.request_reference),
                paymentReference: toSafeText(metadata.source_payment_reference),
                billingCode: toSafeText(metadata.source_billing_code),
                studentName: toSafeText(metadata.source_student_name) || 'Unknown Student',
                amount: formatCurrency(metadata.summary && typeof metadata.summary === 'object' ? (metadata.summary as Record<string, unknown>).amount_paid : 0),
                status: 'Sent to PMED',
                reportName: toSafeText(metadata.report_name) || 'Cashier Financial Report',
                sentAt: toSafeText(row.created_at),
                sentAtLabel: formatDateTimeLabel(toSafeText(row.created_at)),
                sentAtRelative: formatRelativeTime(row.created_at),
                actor: toSafeText(row.actor) || 'Cashier Reports Analyst'
              };
            });

            const sentRequestRefs = new Set(
              mappedSent
                .map((item) => toSafeText(item.requestReference).toLowerCase())
                .filter(Boolean)
            );
            const mappedRequestsWithStatus = mappedRequests.map((item) => ({
              ...item,
              status: sentRequestRefs.has(toSafeText(item.requestReference).toLowerCase()) ? 'matched' : item.status
            }));

            const activityFeed = [
              ...mappedRequests.slice(0, 6).map((item) => ({
                title: `PMED Request: ${item.reportName}`,
                detail: `${item.detail}${item.requestReference ? ` Reference: ${item.requestReference}.` : ''}`,
                time: item.requestedAtRelative || formatRelativeTime(item.requestedAt),
                sortAt: item.requestedAt
              })),
              ...mappedSent.slice(0, 6).map((item) => ({
                title: `Sent to PMED: ${item.reportReference}`,
                detail: `${item.reportName} for ${item.studentName} was delivered to PMED.`,
                time: item.sentAtRelative || formatRelativeTime(item.sentAt),
                sortAt: item.sentAt
              }))
            ]
              .sort((left, right) => new Date(String(right.sortAt || '')).getTime() - new Date(String(left.sortAt || '')).getTime())
              .slice(0, 8)
              .map(({ title, detail, time }) => ({ title, detail, time }));

            writeJson(res, 200, {
              ok: true,
              data: {
                stats: [
                  { title: 'PMED Requests', value: String(mappedRequestsWithStatus.length), subtitle: 'Inbound financial report requests from PMED', icon: 'mdi-alert-circle-outline', tone: 'purple' },
                  { title: 'Ready to Send', value: String(mappedReady.length), subtitle: 'Reconciled cashier reports ready for PMED handoff', icon: 'mdi-file-document-check-outline', tone: 'green' },
                  { title: 'Sent to PMED', value: String(mappedSent.length), subtitle: 'Cashier report packages already delivered to PMED', icon: 'mdi-bank-transfer', tone: 'blue' },
                  {
                    title: 'Pending Match',
                    value: String(mappedRequestsWithStatus.filter((item) => String(item.status || '').toLowerCase() !== 'matched').length),
                    subtitle: 'PMED requests waiting for a reconciled cashier record',
                    icon: 'mdi-timer-sand',
                    tone: 'orange'
                  }
                ],
                requests: mappedRequestsWithStatus,
                candidateItems: mappedCandidates,
                readyItems: mappedReady,
                sentItems: mappedSent,
                activityFeed
              }
            });
            return;
          }

          if (url.pathname === '/api/dashboard/hr-requests' && (req.method || 'GET').toUpperCase() === 'GET') {
            await sql.query(
              `CREATE TABLE IF NOT EXISTS cashier_hr_employee_requests (
                 id BIGSERIAL PRIMARY KEY,
                 request_reference TEXT NOT NULL UNIQUE,
                 employee_id BIGINT NULL,
                 employee_name TEXT NOT NULL,
                 employee_department TEXT NOT NULL DEFAULT 'Cashier',
                 request_type TEXT NOT NULL,
                 details TEXT NULL,
                 status TEXT NOT NULL DEFAULT 'pending',
                 requested_by TEXT NULL,
                 target_department TEXT NOT NULL DEFAULT 'HR',
                 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
               )`
            );

            const employeeRows = (await sql.query(
              `SELECT id, full_name, role, department
               FROM admin_users
               WHERE LOWER(COALESCE(department, '')) = 'cashier'
                 AND LOWER(COALESCE(status, 'active')) = 'active'
               ORDER BY full_name ASC`
            )) as Array<{ id: number; full_name: string; role: string; department: string }>;

            const requestRows = (await sql.query(
              `SELECT id, request_reference, employee_id, employee_name, employee_department, request_type, details, status, requested_by, target_department, created_at::text AS created_at
               FROM cashier_hr_employee_requests
               ORDER BY created_at DESC, id DESC
               LIMIT 60`
            )) as Array<{
              id: number;
              request_reference: string;
              employee_id: number | null;
              employee_name: string;
              employee_department: string;
              request_type: string;
              details: string | null;
              status: string;
              requested_by: string | null;
              target_department: string;
              created_at: string;
            }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                employees: employeeRows.map((row) => ({
                  id: Number(row.id),
                  name: toSafeText(row.full_name),
                  role: toSafeText(row.role),
                  department: toSafeText(row.department) || 'Cashier'
                })),
                requests: requestRows.map((row) => ({
                  id: Number(row.id),
                  requestReference: toSafeText(row.request_reference),
                  employeeId: Number(row.employee_id || 0) || null,
                  employeeName: toSafeText(row.employee_name),
                  employeeDepartment: toSafeText(row.employee_department) || 'Cashier',
                  requestType: toSafeText(row.request_type),
                  details: toSafeText(row.details),
                  status: toSafeText(row.status) || 'pending',
                  requestedBy: toSafeText(row.requested_by) || 'Cashier',
                  targetDepartment: toSafeText(row.target_department) || 'HR',
                  createdAt: toSafeText(row.created_at),
                  createdAtLabel: formatDateTimeLabel(toSafeText(row.created_at)),
                  createdAtRelative: formatRelativeTime(row.created_at)
                }))
              }
            });
            return;
          }

          if (url.pathname === '/api/dashboard/hr-requests' && (req.method || '').toUpperCase() === 'POST') {
            await sql.query(
              `CREATE TABLE IF NOT EXISTS cashier_hr_employee_requests (
                 id BIGSERIAL PRIMARY KEY,
                 request_reference TEXT NOT NULL UNIQUE,
                 employee_id BIGINT NULL,
                 employee_name TEXT NOT NULL,
                 employee_department TEXT NOT NULL DEFAULT 'Cashier',
                 request_type TEXT NOT NULL,
                 details TEXT NULL,
                 status TEXT NOT NULL DEFAULT 'pending',
                 requested_by TEXT NULL,
                 target_department TEXT NOT NULL DEFAULT 'HR',
                 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
               )`
            );
            const body = await readJsonBody(req);
            const employeeId = Number(body.employeeId || 0) || null;
            const employeeName = toSafeText(body.employeeName);
            const requestType = toSafeText(body.requestType);
            const details = toSafeText(body.details);
            if (!employeeName || !requestType) {
              writeJson(res, 422, { ok: false, message: 'employeeName and requestType are required.' });
              return;
            }
            const actor = await resolveAdminSession();
            const requestReference = `HR-REQ-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
            await sql.query(
              `INSERT INTO cashier_hr_employee_requests (
                 request_reference, employee_id, employee_name, employee_department, request_type, details, status, requested_by, target_department, created_at, updated_at
               ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,'HR',NOW(),NOW())`,
              [requestReference, employeeId, employeeName, 'Cashier', requestType, details || null, toSafeText(actor?.full_name || actor?.username || 'Cashier')]
            );
            await ensureModuleActivityLogsTable(sql);
            await insertModuleActivity(
              'department_reports',
              'HR Employee Request',
              `${employeeName} request submitted to HR (${requestType}).`,
              toSafeText(actor?.full_name || actor?.username || 'Cashier'),
              'hr_request',
              requestReference,
              {
                source_department: 'cashier',
                target_department: 'hr',
                request_reference: requestReference,
                employee_name: employeeName,
                request_type: requestType,
                details: details || null
              }
            );
            writeJson(res, 200, {
              ok: true,
              message: `${requestReference} submitted to HR.`,
              data: { requestReference }
            });
            return;
          }

          if (url.pathname === '/api/reporting-reconciliation' && (req.method || 'GET').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const paymentId = Number(body.paymentId || 0);
            const action = String(body.action || '').trim().toLowerCase();
            if (!paymentId || !['reconcile', 'report', 'archive'].includes(action)) {
              writeJson(res, 422, { ok: false, message: 'Invalid reporting action payload.' });
              return;
            }

            const requestReference = toSafeText(body.requestReference);
            const paymentRows = (await sql.query(
              `SELECT p.id, p.reference_number, p.amount_paid, p.payment_method, p.payment_status, p.reporting_status, p.workflow_stage,
                      p.payment_date::text AS payment_date, COALESCE(p.remarks, '') AS payment_remarks,
                      b.id AS billing_id, b.billing_code, b.balance_amount,
                      COALESCE(s.full_name, 'Unknown Student') AS full_name,
                      COALESCE(r.receipt_number, '--') AS receipt_number, COALESCE(r.receipt_status, '') AS receipt_status
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               WHERE p.id = $1
               LIMIT 1`,
              [paymentId]
            )) as Array<{
              id: number;
              reference_number: string;
              amount_paid: number;
              payment_method: string;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string;
              payment_remarks: string;
              billing_id: number | null;
              billing_code: string | null;
              balance_amount: number | null;
              full_name: string;
              receipt_number: string;
              receipt_status: string;
            }>;
            const paymentRow = paymentRows[0];
            if (!paymentRow) {
              writeJson(res, 404, { ok: false, message: 'Payment record not found.' });
              return;
            }

            const currentReportingStatus = String(paymentRow.reporting_status || '').trim().toLowerCase();
            const currentWorkflowStage = String(paymentRow.workflow_stage || '').trim().toLowerCase();
            if (action === 'reconcile' && currentWorkflowStage === 'completed') {
              writeJson(res, 422, { ok: false, message: 'Completed records cannot be reconciled again.' });
              return;
            }
            if (action === 'report' && currentReportingStatus !== 'reconciled') {
              writeJson(res, 422, { ok: false, message: 'Only reconciled records can be sent to PMED.' });
              return;
            }
            if (action === 'archive' && !['reported', 'archived'].includes(currentReportingStatus)) {
              writeJson(res, 422, { ok: false, message: 'Only PMED-sent records can be archived into completed history.' });
              return;
            }

            const nextReportingStatus = action === 'reconcile' ? 'reconciled' : action === 'report' ? 'reported' : 'archived';
            const nextWorkflowStage = action === 'archive' ? 'completed' : 'reporting_reconciliation';

            await sql.query(
              `UPDATE payment_transactions
               SET reporting_status = $1, workflow_stage = $2
               WHERE id = $3`,
              [nextReportingStatus, nextWorkflowStage, paymentId]
            );
            if (action === 'archive') {
              await sql.query(
                `UPDATE receipt_records
                 SET workflow_stage = 'completed'
                 WHERE payment_id = $1`,
                [paymentId]
              );
            }
            await ensureModuleActivityLogsTable(sql);
            if (action === 'report') {
              const reportReference = `CASHIER-RPT-${String(paymentRow.reference_number || paymentId).replace(/[^A-Za-z0-9-]/g, '')}`;
              const feeRows = paymentRow.billing_id
                ? (await sql.query(
                    `SELECT item_name, category, amount
                     FROM billing_items
                     WHERE billing_id = $1
                     ORDER BY sort_order ASC, id ASC`,
                    [paymentRow.billing_id]
                  )) as Array<{ item_name: string; category: string | null; amount: number }>
                : [];
              const packageSections = feeRows.length
                ? feeRows.map((fee, index) => ({
                    id: `${reportReference}-SEC-${index + 1}`,
                    title: String(fee.item_name || `Fee Item ${index + 1}`),
                    source: 'Cashier',
                    description: `${String(fee.category || 'Assessment')} allocation captured for ${formatCurrency(fee.amount)}.`,
                    amount: Number(fee.amount || 0),
                    category: String(fee.category || 'Assessment')
                  }))
                : [
                    {
                      id: `${reportReference}-SEC-1`,
                      title: 'Cashier Settlement Summary',
                      source: 'Cashier',
                      description: 'Completed payment moved from cashier reconciliation to PMED financial reporting.',
                      amount: Number(paymentRow.amount_paid || 0),
                      category: 'Settlement'
                    }
                  ];
              const reportMetadata = {
                target_key: 'pmed',
                target_department: 'pmed',
                source_department: 'cashier',
                source_department_name: 'Cashier',
                report_reference: reportReference,
                plan_reference: String(paymentRow.billing_code || paymentRow.reference_number || paymentId),
                report_name: `Cashier Financial Report - ${paymentRow.reference_number}`,
                report_type: 'Cashier Financial Report',
                owner_name: 'Cashier Reports Analyst',
                export_format: 'JSON',
                delivery_status: 'Received',
                archive_status: 'Active',
                summary: {
                  source_department: 'Cashier',
                  payment_reference: String(paymentRow.reference_number || ''),
                  billing_code: String(paymentRow.billing_code || ''),
                  student_name: String(paymentRow.full_name || 'Unknown Student'),
                  amount_paid: Number(paymentRow.amount_paid || 0),
                  payment_method: String(paymentRow.payment_method || 'Unknown'),
                  payment_status: String(paymentRow.payment_status || 'Unknown'),
                  receipt_number: String(paymentRow.receipt_number || '--'),
                  receipt_status: String(paymentRow.receipt_status || ''),
                  fee_item_count: packageSections.length,
                  remaining_balance: Number(paymentRow.balance_amount || 0)
                },
                pmed_sections: packageSections,
                source_payment_id: paymentId,
                source_payment_reference: String(paymentRow.reference_number || ''),
                source_billing_id: paymentRow.billing_id,
                source_billing_code: String(paymentRow.billing_code || ''),
                source_receipt_number: String(paymentRow.receipt_number || '--'),
                source_student_name: String(paymentRow.full_name || 'Unknown Student'),
                request_reference: requestReference || null,
                generated_at: new Date().toISOString()
              };
              const existingDelivery = (await sql.query(
                `SELECT id
                 FROM module_activity_logs
                 WHERE LOWER(module) = 'department_reports'
                   AND entity_key = $1
                 LIMIT 1`,
                [reportReference]
              )) as Array<{ id: number }>;
              if (!existingDelivery.length) {
                await insertModuleActivity(
                  'department_reports',
                  'DEPARTMENT_REPORT_RECEIVED',
                  `Cashier delivered ${reportReference} to PMED for ${paymentRow.reference_number}.`,
                  'Cashier Reports Analyst',
                  'report',
                  reportReference,
                  reportMetadata
                );
              }
              await insertModuleActivity(
                'reports',
                'PMED Report Sent',
                `${paymentRow.reference_number} was packaged and sent to PMED as ${reportReference}.`,
                'Cashier Reports Analyst',
                'payment',
                String(paymentId),
                {
                  target_department: 'pmed',
                  report_reference: reportReference,
                  request_reference: requestReference || null,
                  payment_reference: paymentRow.reference_number,
                  billing_code: paymentRow.billing_code
                }
              );
              broadcastRealtimeEvent({
                type: 'department_report',
                module: 'reports',
                action: 'PMED Report Sent',
                detail: `${paymentRow.reference_number} was sent to PMED as ${reportReference}.`,
                entityKey: reportReference
              });
            }
            writeJson(res, 200, {
              ok: true,
              data: {
                message:
                  action === 'report'
                    ? `${paymentRow.reference_number} was sent to PMED as part of the cashier financial reporting flow.`
                    : `Payment ${paymentId} marked as ${toActionLabel(nextReportingStatus)}.`,
                status: toActionLabel(nextReportingStatus),
                workflow_stage: nextWorkflowStage,
                next_module: action === 'report' ? 'PMED Department' : nextWorkflowStage
              }
            });
            return;
          }

          if (url.pathname === '/api/reports/transactions' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureCashierWorkflowDemoData();
            const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
            const statusFilter = String(url.searchParams.get('status') || '').trim().toLowerCase();
            const departmentFilter = String(url.searchParams.get('department') || '').trim().toLowerCase();
            const categoryFilter = String(url.searchParams.get('category') || '').trim().toLowerCase();
            const paymentMethodFilter = String(url.searchParams.get('payment_method') || '').trim().toLowerCase();
            const workflowStageFilter = String(url.searchParams.get('workflow_stage') || '').trim().toLowerCase();
            const dateFrom = String(url.searchParams.get('date_from') || '').trim();
            const dateTo = String(url.searchParams.get('date_to') || '').trim();
            const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
            const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') || '20')));

            let items = (await sql.query(
              `SELECT p.id, p.reference_number, p.amount_paid, p.payment_method, p.payment_status, p.reporting_status, p.workflow_stage, p.payment_date::text AS payment_date,
                      b.billing_code, COALESCE(s.full_name, 'Unknown Student') AS full_name, COALESCE(s.student_no, '') AS student_no,
                      COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course,
                      COALESCE(r.receipt_number, '--') AS receipt_number, COALESCE(r.receipt_status, '') AS receipt_status
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC`
            )) as Array<{
              id: number;
              reference_number: string;
              amount_paid: number;
              payment_method: string;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string;
              billing_code: string | null;
              full_name: string;
              student_no: string;
              student_email: string;
              course: string;
              receipt_number: string;
              receipt_status: string;
            }>;

            const mapped = items.map((row) => {
              const connectionMeta = deriveBillingConnectionMeta(row);
              const departmentTargets = resolveCashierDepartmentTargets(connectionMeta);
              return {
                id: Number(row.id),
                referenceNumber: String(row.reference_number || `PAY-${row.id}`),
                studentName: String(row.full_name || 'Unknown Student'),
                billingCode: String(row.billing_code || ''),
                receiptNumber: String(row.receipt_number || '--'),
                sourceModule: connectionMeta.sourceModule,
                sourceDepartment: connectionMeta.sourceDepartment,
                sourceCategory: connectionMeta.sourceCategory,
                targetDepartment: departmentTargets.reportingDepartment,
                operationalTargetDepartment: departmentTargets.operationalTargetDepartment,
                amount: Number(row.amount_paid || 0),
                amountFormatted: formatCurrency(row.amount_paid),
                paymentMethod: String(row.payment_method || 'Online'),
                paymentStatus: mapPaymentStatus(String(row.payment_status || '')),
                documentationStatus: mapReceiptStatus(String(row.receipt_status || '')),
                reportingStatus: mapReportingStatus(String(row.reporting_status || '')),
                workflowStage: String(row.workflow_stage || 'reporting_reconciliation'),
                workflowStageLabel: workflowLabel(String(row.workflow_stage || 'reporting_reconciliation')),
                createdAt: String(row.payment_date || ''),
                allocationSummary: '',
                allocations: []
              };
            });
            const completedOnly = mapped.filter((item) => item.workflowStage === 'completed');

            const filtered = completedOnly.filter((item) => {
              if (statusFilter && String(item.reportingStatus || '').toLowerCase() !== statusFilter) return false;
              if (
                departmentFilter &&
                ![item.sourceDepartment, item.targetDepartment, item.operationalTargetDepartment]
                  .filter(Boolean)
                  .some((value) => String(value).toLowerCase() === departmentFilter)
              ) return false;
              if (categoryFilter && String(item.sourceCategory || '').toLowerCase() !== categoryFilter) return false;
              if (paymentMethodFilter && !String(item.paymentMethod || '').toLowerCase().includes(paymentMethodFilter)) return false;
              if (workflowStageFilter && String(item.workflowStage || '').toLowerCase() !== workflowStageFilter) return false;
              if (dateFrom && String(item.createdAt || '').slice(0, 10) < dateFrom) return false;
              if (dateTo && String(item.createdAt || '').slice(0, 10) > dateTo) return false;
              if (search) {
                const haystack =
                  `${item.referenceNumber} ${item.studentName} ${item.billingCode} ${item.receiptNumber} ${item.paymentStatus} ${item.reportingStatus} ${item.sourceDepartment} ${item.targetDepartment || ''} ${item.operationalTargetDepartment || ''} ${item.sourceCategory}`.toLowerCase();
                if (!haystack.includes(search)) return false;
              }
              return true;
            });

            const total = filtered.length;
            const offset = (page - 1) * perPage;
            const paged = filtered.slice(offset, offset + perPage);
            writeJson(res, 200, {
              ok: true,
              data: {
                items: paged,
                meta: {
                  total,
                  page,
                  perPage,
                  totalPages: Math.max(1, Math.ceil(total / perPage))
                }
              }
            });
            return;
          }

          if (url.pathname === '/api/reports/export' && (req.method || 'GET').toUpperCase() === 'GET') {
            const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
            const statusFilter = String(url.searchParams.get('status') || '').trim().toLowerCase();
            const departmentFilter = String(url.searchParams.get('department') || '').trim().toLowerCase();
            const categoryFilter = String(url.searchParams.get('category') || '').trim().toLowerCase();
            const dateFrom = String(url.searchParams.get('date_from') || '').trim();
            const dateTo = String(url.searchParams.get('date_to') || '').trim();
            const rows = (await sql.query(
              `SELECT p.reference_number, s.full_name, b.billing_code, p.amount_paid, p.payment_status, p.reporting_status, p.workflow_stage, p.payment_date::text AS payment_date,
                      COALESCE(s.student_no, '') AS student_no, COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course,
                      COALESCE(r.receipt_number, '--') AS receipt_number
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               LEFT JOIN students s ON s.id = b.student_id
               LEFT JOIN receipt_records r ON r.payment_id = p.id
               ORDER BY p.payment_date DESC NULLS LAST, p.created_at DESC, p.id DESC`
            )) as Array<{
              reference_number: string;
              full_name: string | null;
              billing_code: string | null;
              amount_paid: number;
              payment_status: string;
              reporting_status: string;
              workflow_stage: string;
              payment_date: string;
              student_no: string;
              student_email: string;
              course: string;
              receipt_number: string;
            }>;
            const completedRows = rows
              .map((row) => {
                const connectionMeta = deriveBillingConnectionMeta(row);
                return {
                  ...row,
                  sourceDepartment: connectionMeta.sourceDepartment,
                  sourceCategory: connectionMeta.sourceCategory
                };
              })
              .filter((row) => {
                if (String(row.workflow_stage || '') !== 'completed') return false;
                if (statusFilter && mapReportingStatus(String(row.reporting_status || '')).toLowerCase() !== statusFilter) return false;
                if (departmentFilter && String(row.sourceDepartment || '').toLowerCase() !== departmentFilter) return false;
                if (categoryFilter && String(row.sourceCategory || '').toLowerCase() !== categoryFilter) return false;
                if (dateFrom && String(row.payment_date || '').slice(0, 10) < dateFrom) return false;
                if (dateTo && String(row.payment_date || '').slice(0, 10) > dateTo) return false;
                if (search) {
                  const haystack =
                    `${row.reference_number || ''} ${row.full_name || ''} ${row.billing_code || ''} ${row.receipt_number || ''} ${row.sourceDepartment || ''} ${row.sourceCategory || ''}`.toLowerCase();
                  if (!haystack.includes(search)) return false;
                }
                return true;
              });
            const header = [
              'Reference Number',
              'Student Name',
              'Billing Code',
              'Department',
              'Category Type',
              'Amount',
              'Payment Status',
              'Reporting Status',
              'Workflow Stage',
              'Payment Date',
              'Receipt Number'
            ];
            const lines = [header.join(',')];
            for (const row of completedRows) {
              lines.push(
                [
                  row.reference_number || '',
                  row.full_name || '',
                  row.billing_code || '',
                  row.sourceDepartment || '',
                  row.sourceCategory || '',
                  formatCurrency(row.amount_paid),
                  mapPaymentStatus(String(row.payment_status || '')),
                  mapReportingStatus(String(row.reporting_status || '')),
                  row.workflow_stage || '',
                  String(row.payment_date || '').slice(0, 19),
                  row.receipt_number || '--'
                ]
                  .map((value) => `"${String(value).replace(/"/g, '""')}"`)
                  .join(',')
              );
            }
            writeJson(res, 200, {
              ok: true,
              data: {
                filename: `completed-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
                mimeType: 'text/csv;charset=utf-8;',
                content: lines.join('\n')
              }
            });
            return;
          }

          if (url.pathname === '/api/integrated-flow' && (req.method || 'GET').toUpperCase() === 'GET') {
            const department = String(url.searchParams.get('department') || '').trim();
            const incoming = department ? integratedFlow.functions.getIncomingByDepartment(department) : [];
            const outgoing = department ? integratedFlow.functions.getOutgoingByDepartment(department) : [];
            writeJson(res, 200, {
              ok: true,
              data: {
                flow: {
                  nodes: integratedFlow.nodes,
                  edges: integratedFlow.edges
                },
                department,
                incoming,
                outgoing
              }
            });
            return;
          }

          if (url.pathname === '/api/clinic-sync/status' && (req.method || 'GET').toUpperCase() === 'GET') {
            await ensureClinicBookingsSyncedToCashier();
            await ensureModuleActivityLogsTable(sql);
            await ensurePatientMasterTables(sql);

            const billingRows = (await sql.query(
              `SELECT
                  COUNT(*)::int AS clinic_origin_billings,
                  COUNT(*) FILTER (WHERE workflow_stage = 'student_portal_billing')::int AS pending_cashier_queue,
                  COUNT(*) FILTER (WHERE workflow_stage <> 'student_portal_billing')::int AS forwarded_to_pay_bills
               FROM billing_records b
               INNER JOIN students s ON s.id = b.student_id
               WHERE s.student_no LIKE 'CLINIC-%' OR LOWER(COALESCE(s.email, '')) LIKE '%@clinic.local'`
            )) as Array<{
              clinic_origin_billings: number;
              pending_cashier_queue: number;
              forwarded_to_pay_bills: number;
            }>;

            const patientRows = (await sql.query(`SELECT COUNT(*)::int AS total FROM patient_master`)) as Array<{ total: number }>;
            const activityRows = (await sql.query(
              `SELECT id, module, action, detail, actor, entity_key, created_at::text AS created_at
               FROM module_activity_logs
               WHERE module IN ('laboratory', 'billing_verification', 'patients', 'appointments', 'walkin', 'checkup')
               ORDER BY created_at DESC
               LIMIT 6`
            )) as Array<{
              id: number;
              module: string;
              action: string;
              detail: string;
              actor: string;
              entity_key: string | null;
              created_at: string;
            }>;

            writeJson(res, 200, {
              ok: true,
              data: {
                generatedAt: new Date().toISOString(),
                counters: {
                  clinicOriginBillings: Number(billingRows[0]?.clinic_origin_billings || 0),
                  pendingCashierQueue: Number(billingRows[0]?.pending_cashier_queue || 0),
                  forwardedToPayBills: Number(billingRows[0]?.forwarded_to_pay_bills || 0),
                  patientProfiles: Number(patientRows[0]?.total || 0)
                },
                recentActivity: activityRows.map((row) => ({
                  id: Number(row.id),
                  module: String(row.module || ''),
                  action: String(row.action || ''),
                  detail: String(row.detail || ''),
                  actor: String(row.actor || ''),
                  entityKey: row.entity_key ? String(row.entity_key) : null,
                  createdAt: String(row.created_at || '')
                }))
              }
            });
            return;
          }

          if (isBillingVerifyRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/billings\/(\d+)\/verify$/);
            const billingId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            const remarks = toSafeText(body.remarks) || 'Billing verified and ready for payment.';
            const validationChecklist = toSafeText(body.validation_checklist);
            const studentProfileCheck = toSafeText(body.student_profile_check);
            const feeBreakdownCheck = toSafeText(body.fee_breakdown_check);
            const paymentEligibilityCheck = toSafeText(body.payment_eligibility_check);
            const duplicateBillingCheck = toSafeText(body.duplicate_billing_check);
            if (!billingId) {
              writeJson(res, 422, { ok: false, message: 'Invalid billing id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, billing_code, billing_status, workflow_stage, balance_amount
               FROM billing_records
               WHERE id = $1
               LIMIT 1`,
              [billingId]
            )) as Array<{
              id: number;
              billing_code: string;
              billing_status: string;
              workflow_stage: string;
              balance_amount: number;
            }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Billing record not found.' });
              return;
            }
            if (String(row.workflow_stage || '') !== 'student_portal_billing') {
              writeJson(res, 422, { ok: false, message: 'Billing is not in Student Portal & Billing stage.' });
              return;
            }
            if (Number(row.balance_amount || 0) <= 0) {
              writeJson(res, 422, { ok: false, message: 'Only billings with active outstanding balance can be verified.' });
              return;
            }
            if (!validationChecklist) {
              writeJson(res, 422, { ok: false, message: 'Validation checklist is required before verifying billing.' });
              return;
            }
            if (studentProfileCheck !== 'Complete') {
              writeJson(res, 422, {
                ok: false,
                message: 'Student profile must be marked Complete before the billing can move to Pay Bills.'
              });
              return;
            }
            if (feeBreakdownCheck !== 'Validated') {
              writeJson(res, 422, {
                ok: false,
                message: 'Fee breakdown must be validated before the billing can move to Pay Bills.'
              });
              return;
            }
            if (paymentEligibilityCheck !== 'Eligible') {
              writeJson(res, 422, {
                ok: false,
                message: 'Only payment-eligible billings can be forwarded to Pay Bills.'
              });
              return;
            }
            if (duplicateBillingCheck !== 'No Duplicate Found') {
              writeJson(res, 422, {
                ok: false,
                message: 'Duplicate billing review must be cleared before verification can proceed.'
              });
              return;
            }
            const itemRows = (await sql.query(
              `SELECT COUNT(*)::int AS total
               FROM billing_items
               WHERE billing_id = $1`,
              [billingId]
            )) as Array<{ total: number }>;
            if (Number(itemRows?.[0]?.total || 0) <= 0) {
              writeJson(res, 422, {
                ok: false,
                message: 'This billing record has no fee items yet. Add fee details before verification.'
              });
              return;
            }
            const consolidatedRemarks = [
              remarks,
              `Checklist: ${validationChecklist}`,
              `Student Profile: ${studentProfileCheck}`,
              `Fee Breakdown: ${feeBreakdownCheck}`,
              `Payment Eligibility: ${paymentEligibilityCheck}`,
              `Duplicate Check: ${duplicateBillingCheck}`
            ].join(' | ');
            await sql.query(
              `UPDATE billing_records
               SET billing_status = 'verified',
                   workflow_stage = 'pay_bills',
                   remarks = $2,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [billingId, consolidatedRemarks]
            );
            await ensureModuleActivityLogsTable(sql);
            await sql.query(
              `INSERT INTO module_activity_logs (module, action, detail, actor, entity_type, entity_key, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
              [
                'billing_verification',
                'Billing Verified',
                `Billing ${row.billing_code} was verified and moved to Pay Bills. ${consolidatedRemarks}`,
                'Cashier',
                'billing',
                row.billing_code,
                JSON.stringify({ billingId, from: 'student_portal_billing', to: 'pay_bills' })
              ]
            );
            broadcastRealtimeEvent({
              type: 'clinic_cashier_sync',
              module: 'billing_verification',
              action: 'Billing Verified',
              detail: `Billing ${row.billing_code} was verified and moved to Pay Bills.`,
              entityKey: row.billing_code
            });
            writeJson(res, 200, {
              ok: true,
              data: {
                message: 'Billing verified successfully.',
                status: 'Verified',
                workflow_stage: 'pay_bills',
                next_module: 'Pay Bills'
              }
            });
            return;
          }

          if (isPaymentsApproveRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const billingId = Number(body.billingId || 0);
            const amount = toSafeMoney(body.amount, 0);
            const paymentMethod = toSafeText(body.paymentMethod || body.payment_method) || 'Cash';
            const remarks = toSafeText(body.remarks) || 'Payment request approved for processing.';
            if (!billingId) {
              writeJson(res, 422, { ok: false, message: 'Invalid billing id.' });
              return;
            }
            if (amount <= 0) {
              writeJson(res, 422, { ok: false, message: 'Approved amount must be greater than zero.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT b.id, b.billing_code, b.workflow_stage, b.total_amount, b.paid_amount, b.balance_amount,
                      COALESCE(s.student_no, '') AS student_no, COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course
               FROM billing_records b
               LEFT JOIN students s ON s.id = b.student_id
               WHERE b.id = $1
               LIMIT 1`,
              [billingId]
            )) as Array<{
              id: number;
              billing_code: string;
              workflow_stage: string;
              total_amount: number;
              paid_amount: number;
              balance_amount: number;
              student_no: string;
              student_email: string;
              course: string;
            }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Billing record not found.' });
              return;
            }
            const connectionMeta = deriveBillingConnectionMeta(row);
            const currentStage = String(row.workflow_stage || '');
            const canApproveFromStage =
              currentStage === 'pay_bills' ||
              (currentStage === 'student_portal_billing' && connectionMeta.isClinicOrigin);
            if (!canApproveFromStage) {
              writeJson(res, 422, { ok: false, message: 'Only billings in Pay Bills can be forwarded to payment processing.' });
              return;
            }
            if (amount > Number(row.balance_amount || 0)) {
              writeJson(res, 422, { ok: false, message: 'Approved amount cannot exceed the remaining balance.' });
              return;
            }
            const existingQueue = (await sql.query(
              `SELECT id, reference_number
               FROM payment_transactions
               WHERE billing_id = $1
                 AND workflow_stage = 'payment_processing_gateway'
                 AND LOWER(COALESCE(payment_status, 'processing')) IN ('processing', 'authorized')
               ORDER BY id DESC
               LIMIT 1`,
              [billingId]
            )) as Array<{ id: number; reference_number: string }>;
            if (existingQueue[0]) {
              await sql.query(
                `UPDATE billing_records
                 SET billing_status = 'payment_in_progress',
                     workflow_stage = 'payment_processing_gateway',
                     remarks = $2,
                     updated_at = NOW(),
                     action_at = NOW()
                 WHERE id = $1`,
                [billingId, remarks]
              );
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${existingQueue[0].reference_number} is already active in Payment Processing & Gateway.`,
                  status: 'Processing',
                  workflow_stage: 'payment_processing_gateway',
                  next_module: 'Payment Processing & Gateway'
                }
              });
              return;
            }
            const referenceNumber = `PAY-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
            await sql.query(
               `INSERT INTO payment_transactions (
                 billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage,
                 payment_date, processed_by, remarks, created_at
               )
               VALUES ($1,$2,$3,$4,'processing','logged','payment_processing_gateway',NOW(),NULL,$5,NOW())`,
              [billingId, referenceNumber, amount, paymentMethod, remarks]
            );
            await sql.query(
              `UPDATE billing_records
               SET billing_status = 'payment_in_progress',
                   workflow_stage = 'payment_processing_gateway',
                   remarks = $2,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [billingId, remarks]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.billing_code} was forwarded to Payment Processing & Gateway.`,
                status: 'Processing',
                workflow_stage: 'payment_processing_gateway',
                next_module: 'Payment Processing & Gateway'
              }
            });
            return;
          }

          if (isInstallmentsRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const billingId = Number(body.billingId || 0);
            const installmentAmount = toSafeMoney(body.installmentAmount, 0);
            const installmentCount = Math.max(1, Number(body.installmentCount || 1));
            const dueSchedule = toSafeText(body.dueSchedule) || 'Installment schedule pending';
            const paymentMethod = toSafeText(body.paymentMethod) || 'Cash';
            const remarks = toSafeText(body.remarks) || 'Installment payment request created.';
            if (!billingId) {
              writeJson(res, 422, { ok: false, message: 'Invalid billing id.' });
              return;
            }
            if (installmentAmount <= 0) {
              writeJson(res, 422, { ok: false, message: 'Installment amount must be greater than zero.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT b.id, b.billing_code, b.workflow_stage, b.balance_amount,
                      COALESCE(s.student_no, '') AS student_no, COALESCE(s.email, '') AS student_email, COALESCE(s.course, '') AS course
               FROM billing_records b
               LEFT JOIN students s ON s.id = b.student_id
               WHERE b.id = $1
               LIMIT 1`,
              [billingId]
            )) as Array<{
              id: number;
              billing_code: string;
              workflow_stage: string;
              balance_amount: number;
              student_no: string;
              student_email: string;
              course: string;
            }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Billing record not found.' });
              return;
            }
            const connectionMeta = deriveBillingConnectionMeta(row);
            const currentStage = String(row.workflow_stage || '');
            const canApproveFromStage =
              currentStage === 'pay_bills' ||
              (currentStage === 'student_portal_billing' && connectionMeta.isClinicOrigin);
            if (!canApproveFromStage) {
              writeJson(res, 422, { ok: false, message: 'Only billings in Pay Bills can be scheduled for installment processing.' });
              return;
            }
            if (installmentAmount > Number(row.balance_amount || 0)) {
              writeJson(res, 422, { ok: false, message: 'Installment amount cannot exceed the remaining balance.' });
              return;
            }
            const existingQueue = (await sql.query(
              `SELECT id, reference_number
               FROM payment_transactions
               WHERE billing_id = $1
                 AND workflow_stage = 'payment_processing_gateway'
                 AND LOWER(COALESCE(payment_status, 'processing')) IN ('processing', 'authorized')
               ORDER BY id DESC
               LIMIT 1`,
              [billingId]
            )) as Array<{ id: number; reference_number: string }>;
            if (existingQueue[0]) {
              await sql.query(
                `UPDATE billing_records
                 SET billing_status = 'payment_in_progress',
                     workflow_stage = 'payment_processing_gateway',
                     remarks = $2,
                     updated_at = NOW(),
                     action_at = NOW()
                 WHERE id = $1`,
                [billingId, `${remarks} | ${installmentCount} installment(s) | ${dueSchedule}`]
              );
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${existingQueue[0].reference_number} is already active in Payment Processing & Gateway.`,
                  status: 'Processing',
                  workflow_stage: 'payment_processing_gateway',
                  next_module: 'Payment Processing & Gateway'
                }
              });
              return;
            }
            const referenceNumber = `PAY-INST-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
            await sql.query(
               `INSERT INTO payment_transactions (
                 billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage,
                 payment_date, processed_by, remarks, created_at
               )
               VALUES ($1,$2,$3,$4,'processing','logged','payment_processing_gateway',NOW(),NULL,$5,NOW())`,
              [billingId, referenceNumber, installmentAmount, paymentMethod, `${remarks} | ${installmentCount} installment(s) | ${dueSchedule}`]
            );
            await sql.query(
              `UPDATE billing_records
               SET billing_status = 'payment_in_progress',
                   workflow_stage = 'payment_processing_gateway',
                   remarks = $2,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [billingId, `${remarks} | ${installmentCount} installment(s) | ${dueSchedule}`]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.billing_code} installment request was forwarded to Payment Processing & Gateway.`,
                status: 'Processing',
                workflow_stage: 'payment_processing_gateway',
                next_module: 'Payment Processing & Gateway'
              }
            });
            return;
          }

          if (isPaymentAuthorizeRoute && (req.method || 'GET').toUpperCase() === 'PATCH') {
            const idMatch = url.pathname.match(/^\/api\/payment-transactions\/(\d+)\/authorize$/);
            const paymentId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            const remarks = [toSafeText(body.remarks), toSafeText(body.authorizationNotes)].filter(Boolean).join(' | ');
            if (!paymentId) {
              writeJson(res, 422, { ok: false, message: 'Invalid payment id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, reference_number, workflow_stage
               FROM payment_transactions
               WHERE id = $1
               LIMIT 1`,
              [paymentId]
            )) as Array<{ id: number; reference_number: string; workflow_stage: string }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Payment transaction not found.' });
              return;
            }
            await sql.query(
              `UPDATE payment_transactions
               SET payment_status = 'authorized',
                   remarks = $2
               WHERE id = $1`,
              [paymentId, remarks || 'Gateway validation completed.']
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.reference_number} was authorized successfully.`,
                status: 'Authorized',
                workflow_stage: 'payment_processing_gateway',
                next_module: 'Payment Processing & Gateway'
              }
            });
            return;
          }

          if (isPaymentConfirmPaidRoute && (req.method || 'GET').toUpperCase() === 'PATCH') {
            const idMatch = url.pathname.match(/^\/api\/payment-transactions\/(\d+)\/confirm-paid$/);
            const paymentId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            const remarks = toSafeText(body.remarks) || 'Payment confirmed successfully.';
            if (!paymentId) {
              writeJson(res, 422, { ok: false, message: 'Invalid payment id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT p.id, p.reference_number, p.billing_id, p.amount_paid,
                      b.billing_code, b.total_amount, b.paid_amount, b.balance_amount
               FROM payment_transactions p
               LEFT JOIN billing_records b ON b.id = p.billing_id
               WHERE p.id = $1
               LIMIT 1`,
              [paymentId]
            )) as Array<{
              id: number;
              reference_number: string;
              billing_id: number;
              amount_paid: number;
              billing_code: string;
              total_amount: number;
              paid_amount: number;
              balance_amount: number;
            }>;
            const row = rows[0];
            if (!row || !row.billing_id) {
              writeJson(res, 404, { ok: false, message: 'Payment transaction not found.' });
              return;
            }
            const nextPaid = Math.min(Number(row.total_amount || 0), Number(row.paid_amount || 0) + Number(row.amount_paid || 0));
            const nextBalance = Math.max(0, Number(row.total_amount || 0) - nextPaid);
            const receiptNumber = `RCPT-${new Date().getFullYear()}-${String(paymentId).padStart(6, '0')}`;
            await sql.query(
              `UPDATE payment_transactions
               SET payment_status = 'paid',
                   reporting_status = 'logged',
                   workflow_stage = 'compliance_documentation',
                   payment_date = NOW(),
                   remarks = $2
               WHERE id = $1`,
              [paymentId, remarks]
            );
            await sql.query(
              `UPDATE billing_records
               SET paid_amount = $2,
                   balance_amount = $3,
                   billing_status = $4,
                   workflow_stage = $5,
                   remarks = $6,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [
                row.billing_id,
                nextPaid,
                nextBalance,
                nextBalance <= 0 ? 'paid' : 'partial_payment',
                nextBalance <= 0 ? 'completed' : 'pay_bills',
                remarks
              ]
            );
            const existingReceipt = (await sql.query(
              `SELECT id
               FROM receipt_records
               WHERE payment_id = $1
               LIMIT 1`,
              [paymentId]
            )) as Array<{ id: number }>;
            if (existingReceipt[0]) {
              await sql.query(
                `UPDATE receipt_records
                 SET workflow_stage = 'compliance_documentation',
                     receipt_number = COALESCE(NULLIF(TRIM(receipt_number), ''), $2),
                     issued_date = COALESCE(issued_date, NOW()),
                     remarks = $3
                 WHERE id = $1`,
                [existingReceipt[0].id, receiptNumber, 'Ready for receipt generation.']
              );
            } else {
              await sql.query(
                `INSERT INTO receipt_records (
                   payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, created_at
                 )
                 VALUES ($1,$2,NOW(),'generated','compliance_documentation',$3,NOW())`,
                [paymentId, receiptNumber, 'Ready for receipt generation.']
              );
            }
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.reference_number} was confirmed as paid and moved to Compliance & Documentation.`,
                status: 'Paid',
                workflow_stage: 'compliance_documentation',
                next_module: 'Compliance & Documentation'
              }
            });
            return;
          }

          if (isReceiptsGenerateRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const body = await readJsonBody(req);
            const receiptId = Number(body.paymentId || 0);
            const receiptType = toSafeText(body.receipt_type) || 'Official Receipt';
            const remarks = toSafeText(body.remarks) || 'Official receipt generated.';
            if (!receiptId) {
              writeJson(res, 422, { ok: false, message: 'Invalid receipt record id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, receipt_number
               FROM receipt_records
               WHERE id = $1
               LIMIT 1`,
              [receiptId]
            )) as Array<{ id: number; receipt_number: string | null }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Receipt record not found.' });
              return;
            }
            const nextReceiptNo = toSafeText(row.receipt_number) || `RCPT-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
            await sql.query(
              `UPDATE receipt_records
               SET receipt_number = $2,
                   issued_date = NOW(),
                   receipt_status = 'receipt_generated',
                   workflow_stage = 'compliance_documentation',
                   remarks = $3
               WHERE id = $1`,
              [receiptId, nextReceiptNo, `${receiptType} | ${remarks}`]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${nextReceiptNo} was generated successfully.`,
                status: 'Receipt Generated',
                workflow_stage: 'compliance_documentation',
                next_module: 'Compliance & Documentation',
                receipt_no: nextReceiptNo
              }
            });
            return;
          }

          if (isComplianceVerifyRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/compliance\/(\d+)\/verify-proof$/);
            const receiptId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            if (!receiptId) {
              writeJson(res, 422, { ok: false, message: 'Invalid compliance record id.' });
              return;
            }
            const remarks = [toSafeText(body.proofType), toSafeText(body.verifiedBy), toSafeText(body.decision), toSafeText(body.verificationNotes)]
              .filter(Boolean)
              .join(' | ');
            await sql.query(
              `UPDATE receipt_records
               SET receipt_status = 'proof_verified',
                   workflow_stage = 'compliance_documentation',
                   remarks = $2
               WHERE id = $1`,
              [receiptId, remarks || 'Proof of payment verified.']
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: 'Proof of payment was verified successfully.',
                status: 'Proof Verified',
                workflow_stage: 'compliance_documentation',
                next_module: 'Compliance & Documentation'
              }
            });
            return;
          }

          if (isComplianceCompleteRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/compliance\/(\d+)\/complete$/);
            const receiptId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            if (!receiptId) {
              writeJson(res, 422, { ok: false, message: 'Invalid compliance record id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, payment_id
               FROM receipt_records
               WHERE id = $1
               LIMIT 1`,
              [receiptId]
            )) as Array<{ id: number; payment_id: number }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Compliance record not found.' });
              return;
            }
            const remarks = [toSafeText(body.checklistSummary), toSafeText(body.finalDecision), toSafeText(body.completionNotes)]
              .filter(Boolean)
              .join(' | ');
            await sql.query(
              `UPDATE receipt_records
               SET receipt_status = 'documentation_completed',
                   workflow_stage = 'reporting_reconciliation',
                   remarks = $2
               WHERE id = $1`,
              [receiptId, remarks || 'Documentation completed.']
            );
            await sql.query(
              `UPDATE payment_transactions
               SET workflow_stage = 'reporting_reconciliation',
                   reporting_status = 'logged'
               WHERE id = $1`,
              [row.payment_id]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: 'Compliance documentation completed successfully.',
                status: 'Documentation Completed',
                workflow_stage: 'reporting_reconciliation',
                next_module: 'Reporting & Reconciliation'
              }
            });
            return;
          }

          if (isReconciliationActionRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/reconciliation\/(\d+)\/(reconcile|archive|flag-discrepancy)$/);
            const paymentId = Number(idMatch?.[1] || 0);
            const action = String(idMatch?.[2] || '').trim().toLowerCase();
            const body = await readJsonBody(req);
            if (!paymentId || !action) {
              writeJson(res, 422, { ok: false, message: 'Invalid reconciliation action payload.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, reference_number
               FROM payment_transactions
               WHERE id = $1
               LIMIT 1`,
              [paymentId]
            )) as Array<{ id: number; reference_number: string }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Payment transaction not found.' });
              return;
            }
            const statusValue =
              action === 'reconcile' ? 'reconciled' :
              action === 'archive' ? 'archived' :
              'with_discrepancy';
            const nextStage =
              action === 'archive' ? 'completed' : 'reporting_reconciliation';
            const notes =
              action === 'flag-discrepancy'
                ? [toSafeText(body.note), toSafeText(body.reason), toSafeText(body.notes)].filter(Boolean).join(' | ')
                : toSafeText(body.remarks);
            await sql.query(
              `UPDATE payment_transactions
               SET reporting_status = $2,
                   workflow_stage = $3,
                   remarks = COALESCE($4, remarks)
               WHERE id = $1`,
              [paymentId, statusValue, nextStage, notes || null]
            );
            if (action === 'archive') {
              await sql.query(
                `UPDATE receipt_records
                 SET workflow_stage = 'completed'
                 WHERE payment_id = $1`,
                [paymentId]
              );
            }
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.reference_number} was marked as ${toActionLabel(statusValue)}.`,
                status: toActionLabel(statusValue),
                workflow_stage: nextStage,
                next_module: nextStage === 'completed' ? 'Completed Transactions' : 'Reporting & Reconciliation'
              }
            });
            return;
          }

          if (isPaymentsMarkFailedRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/payments\/(\d+)\/mark-failed$/);
            const billingId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            const reason = toSafeText(body.reason) || 'Payment request failed validation.';
            const remarks = toSafeText(body.remarks);
            if (!billingId) {
              writeJson(res, 422, { ok: false, message: 'Invalid billing id.' });
              return;
            }
            const rows = (await sql.query(
              `SELECT id, billing_code, billing_status, workflow_stage, balance_amount
               FROM billing_records
               WHERE id = $1
               LIMIT 1`,
              [billingId]
            )) as Array<{
              id: number;
              billing_code: string;
              billing_status: string;
              workflow_stage: string;
              balance_amount: number;
            }>;
            const row = rows[0];
            if (!row) {
              writeJson(res, 404, { ok: false, message: 'Billing record not found.' });
              return;
            }
            if (String(row.workflow_stage || '') !== 'pay_bills') {
              writeJson(res, 422, { ok: false, message: 'Only billings in Pay Bills can be marked as failed.' });
              return;
            }
            const combinedRemarks = remarks ? `${reason}. ${remarks}` : reason;
            await sql.query(
              `UPDATE billing_records
               SET billing_status = 'failed',
                   workflow_stage = 'pay_bills',
                   remarks = $2,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [billingId, combinedRemarks]
            );
            await ensureModuleActivityLogsTable(sql);
            await sql.query(
              `INSERT INTO module_activity_logs (module, action, detail, actor, entity_type, entity_key, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
              [
                'manage_billing',
                'Payment Failed',
                `${row.billing_code} was marked as failed. ${reason}${remarks ? ` ${remarks}` : ''}`,
                'Cashier',
                'billing',
                row.billing_code,
                JSON.stringify({ billingId, stage: 'pay_bills', reason })
              ]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `${row.billing_code} was marked as failed and remains in Pay Bills.`,
                status: 'Payment Failed',
                workflow_stage: 'pay_bills',
                next_module: 'Pay Bills'
              }
            });
            return;
          }

          if (isWorkflowCorrectionRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            const idMatch = url.pathname.match(/^\/api\/workflow\/(\d+)\/return-for-correction$/);
            const recordId = Number(idMatch?.[1] || 0);
            const body = await readJsonBody(req);
            const reason = toSafeText(body.reason) || 'Correction requested';
            const currentModule = toSafeText(body.current_module).toLowerCase();
            const remarks = toSafeText(body.remarks);
            if (!recordId) {
              writeJson(res, 422, { ok: false, message: 'Invalid record id.' });
              return;
            }

            if (currentModule === 'payment_processing_gateway') {
              const rows = (await sql.query(
                `SELECT id, billing_id, reference_number
                 FROM payment_transactions
                 WHERE id = $1
                 LIMIT 1`,
                [recordId]
              )) as Array<{ id: number; billing_id: number; reference_number: string }>;
              const row = rows[0];
              if (!row) {
                writeJson(res, 404, { ok: false, message: 'Payment transaction not found.' });
                return;
              }
              await sql.query(
                `UPDATE payment_transactions
                 SET payment_status = 'cancelled',
                     workflow_stage = 'pay_bills',
                     remarks = $2
                 WHERE id = $1`,
                [recordId, [reason, remarks].filter(Boolean).join(' | ')]
              );
              await sql.query(
                `UPDATE billing_records
                 SET billing_status = 'needs_correction',
                     workflow_stage = 'pay_bills',
                     correction_reason = $2,
                     correction_notes = $3,
                     needs_correction = 1,
                     updated_at = NOW(),
                     action_at = NOW()
                 WHERE id = $1`,
                [row.billing_id, reason, remarks]
              );
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${row.reference_number} returned to Pay Bills for correction.`,
                  status: 'Needs Correction',
                  workflow_stage: 'pay_bills',
                  returned_to: 'Pay Bills',
                  next_module: 'Pay Bills'
                }
              });
              return;
            }

            if (currentModule === 'compliance_documentation') {
              const rows = (await sql.query(
                `SELECT id, payment_id, receipt_number
                 FROM receipt_records
                 WHERE id = $1
                 LIMIT 1`,
                [recordId]
              )) as Array<{ id: number; payment_id: number; receipt_number: string | null }>;
              const row = rows[0];
              if (!row) {
                writeJson(res, 404, { ok: false, message: 'Compliance record not found.' });
                return;
              }
              await sql.query(
                `UPDATE receipt_records
                 SET workflow_stage = 'payment_processing_gateway',
                     remarks = $2
                 WHERE id = $1`,
                [recordId, [reason, remarks].filter(Boolean).join(' | ')]
              );
              await sql.query(
                `UPDATE payment_transactions
                 SET workflow_stage = 'payment_processing_gateway',
                     payment_status = 'authorized',
                     remarks = $2
                 WHERE id = $1`,
                [row.payment_id, [reason, remarks].filter(Boolean).join(' | ')]
              );
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${row.receipt_number || `RCPT-${recordId}`} returned to Payment Processing & Gateway for correction.`,
                  status: 'Needs Correction',
                  workflow_stage: 'payment_processing_gateway',
                  returned_to: 'Payment Processing & Gateway',
                  next_module: 'Payment Processing & Gateway'
                }
              });
              return;
            }

            if (currentModule === 'reporting_reconciliation') {
              const rows = (await sql.query(
                `SELECT id, reference_number
                 FROM payment_transactions
                 WHERE id = $1
                 LIMIT 1`,
                [recordId]
              )) as Array<{ id: number; reference_number: string }>;
              const row = rows[0];
              if (!row) {
                writeJson(res, 404, { ok: false, message: 'Reporting record not found.' });
                return;
              }
              await sql.query(
                `UPDATE payment_transactions
                 SET reporting_status = 'logged',
                     workflow_stage = 'compliance_documentation',
                     remarks = $2
                 WHERE id = $1`,
                [recordId, [reason, remarks].filter(Boolean).join(' | ')]
              );
              await sql.query(
                `UPDATE receipt_records
                 SET receipt_status = 'proof_verified',
                     workflow_stage = 'compliance_documentation',
                     remarks = $2
                 WHERE payment_id = $1`,
                [recordId, [reason, remarks].filter(Boolean).join(' | ')]
              );
              writeJson(res, 200, {
                ok: true,
                data: {
                  message: `${row.reference_number} returned to Compliance & Documentation for correction.`,
                  status: 'Needs Correction',
                  workflow_stage: 'compliance_documentation',
                  returned_to: 'Compliance & Documentation',
                  next_module: 'Compliance & Documentation'
                }
              });
              return;
            }

            await sql.query(
              `UPDATE billing_records
               SET billing_status = 'needs_correction',
                   workflow_stage = 'student_portal_billing',
                   correction_reason = $2,
                   correction_notes = $3,
                   needs_correction = 1,
                   updated_at = NOW(),
                   action_at = NOW()
               WHERE id = $1`,
              [recordId, reason, remarks]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                message: `Billing ${recordId} returned for correction.`,
                status: 'Needs Correction',
                workflow_stage: 'student_portal_billing',
                returned_to: 'Student Portal & Billing',
                next_module: 'Student Portal & Billing'
              }
            });
            return;
          }

          if (isNotificationsSendRoute && (req.method || 'GET').toUpperCase() === 'POST') {
            await ensureNotificationsTable(sql);
            const body = await readJsonBody(req);
            const billingId = Number(body.billingId || 0) || null;
            const recipient = toSafeText(body.recipient) || 'Student';
            const subject = toSafeText(body.subject) || 'Billing Status Update';
            const message = toSafeText(body.message) || 'Billing status update.';
            await sql.query(
              `INSERT INTO notifications (recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,NOW())`,
              ['student', recipient, 'in_app', 'billing_update', subject, message, 'billing', billingId]
            );
            writeJson(res, 200, {
              ok: true,
              data: {
                billingId,
                recipient,
                subject,
                message
              }
            });
            return;
          }

          if (isNotificationsRoute && (req.method || 'GET').toUpperCase() === 'GET') {
            await syncPmedReportRequestNotifications();
            const filter = toSafeText(url.searchParams.get('filter')).toLowerCase();
            const rows = (await sql.query(
              `SELECT id, recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, read_at::text AS read_at, created_at::text AS created_at
               FROM notifications
               WHERE LOWER(recipient_role) IN ('cashier', 'admin')
               ORDER BY created_at DESC
               LIMIT 120`
            )) as Array<{
              id: number;
              recipient_role: string;
              recipient_name: string | null;
              channel: string;
              type: string;
              title: string;
              message: string;
              entity_type: string | null;
              entity_id: number | null;
              is_read: boolean;
              read_at: string | null;
              created_at: string | null;
            }>;
            const filteredRows = rows.filter((row) => {
              if (filter === 'pmed_requests') return String(row.type || '') === 'pmed_report_request';
              if (filter === 'unread') return !row.is_read;
              if (filter === 'new') {
                const created = row.created_at ? new Date(row.created_at).getTime() : 0;
                return !row.is_read && created >= Date.now() - (24 * 60 * 60 * 1000);
              }
              if (filter === 'other') return !String(row.type || '').includes('payment') && !String(row.type || '').includes('billing');
              return true;
            });
            const unreadCount = rows.filter((row) => !row.is_read).length;
            writeJson(res, 200, {
              ok: true,
              data: {
                items: filteredRows.map((row) => ({
                  id: Number(row.id),
                  recipientRole: String(row.recipient_role || ''),
                  recipientName: row.recipient_name ? String(row.recipient_name) : null,
                  channel: String(row.channel || 'in_app'),
                  type: String(row.type || 'general'),
                  title: String(row.title || ''),
                  message: String(row.message || ''),
                  entityType: row.entity_type ? String(row.entity_type) : null,
                  entityId: row.entity_id == null ? null : Number(row.entity_id),
                  isRead: Boolean(row.is_read),
                  createdAt: row.created_at ? String(row.created_at) : null,
                  readAt: row.read_at ? String(row.read_at) : null,
                  relativeTime: formatRelativeTime(row.created_at)
                })),
                meta: {
                  page: 1,
                  perPage: filteredRows.length,
                  total: filteredRows.length,
                  totalPages: 1,
                  unreadCount,
                  totalUnread: unreadCount
                }
              }
            });
            return;
          }

          if (isNotificationReadRoute && (req.method || 'GET').toUpperCase() === 'PATCH') {
            await ensureNotificationsTable(sql);
            const idMatch = url.pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
            const notificationId = Number(idMatch?.[1] || 0);
            if (!notificationId) {
              writeJson(res, 422, { ok: false, message: 'Invalid notification id.' });
              return;
            }
            await sql.query(
              `UPDATE notifications
               SET is_read = 1, read_at = NOW()
               WHERE id = $1`,
              [notificationId]
            );
            const unreadRows = (await sql.query(
              `SELECT COUNT(*)::int AS total
               FROM notifications
               WHERE LOWER(recipient_role) IN ('cashier', 'admin')
                 AND is_read = 0`
            )) as Array<{ total: number }>;
            writeJson(res, 200, { ok: true, data: { unreadCount: Number(unreadRows[0]?.total || 0) } });
            return;
          }

          if (isNotificationsReadAllRoute && (req.method || 'GET').toUpperCase() === 'PATCH') {
            await ensureNotificationsTable(sql);
            await sql.query(
              `UPDATE notifications
               SET is_read = 1, read_at = NOW()
               WHERE LOWER(recipient_role) IN ('cashier', 'admin')
                 AND is_read = 0`
            );
            writeJson(res, 200, { ok: true, data: { unreadCount: 0 } });
            return;
          }

          if (url.pathname === '/api/admin-auth' && (req.method || 'GET').toUpperCase() === 'GET') {
            const session = await resolveAdminSession();
            try {
              await syncPmedReportRequestNotifications();
            } catch (error) {
              console.warn('[cashier] Unable to refresh PMED notifications during auth hydrate:', error);
            }
            let unreadRows: Array<{ total: number }> = [];
            if (session) {
              try {
                unreadRows = (await sql.query(
                  `SELECT COUNT(*)::int AS total
                   FROM notifications
                   WHERE LOWER(recipient_role) IN ('cashier', 'admin')
                     AND is_read = 0`
                )) as Array<{ total: number }>;
              } catch (error) {
                console.warn('[cashier] Unable to count unread notifications during auth hydrate:', error);
              }
            }
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
                      isSuperAdmin: Boolean(session.is_super_admin),
                      unreadNotifications: Number(unreadRows[0]?.total || 0)
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
            const finalizeLaboratoryMutation = async (
              requestId: number,
              actionLabel: string,
              details: string,
              actor: string,
              data: Record<string, unknown> | null
            ): Promise<void> => {
              await saveActivity(requestId, actionLabel, details, actor);
              broadcastRealtimeEvent({
                type: 'clinic_data_changed',
                module: 'laboratory',
                action: actionLabel,
                detail: details,
                entityKey: String(requestId)
              });
              writeJson(res, 200, { ok: true, data });
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

              await finalizeLaboratoryMutation(nextId, 'Request Created', 'New lab request created from laboratory queue dashboard.', 'Lab Staff', inserted[0] || null);
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
              await finalizeLaboratoryMutation(requestId, 'Processing Started', 'Sample collected and processing started.', staff, updated[0] || null);
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
              await finalizeLaboratoryMutation(requestId, finalize ? 'Result Finalized' : 'Draft Saved', summary, currentStaff, updated[0] || null);
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
              await finalizeLaboratoryMutation(requestId, 'Report Released', 'Lab report released to doctor/check-up.', toSafeText(body.released_by) || 'Lab Staff', updated[0] || null);
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
              await finalizeLaboratoryMutation(
                requestId,
                Boolean(body.resample_flag) ? 'Resample Requested' : 'Request Rejected',
                reason,
                toSafeText(body.actor) || 'Lab Staff',
                updated[0] || null
              );
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
            const finalizeWalkInMutation = async (
              actionLabel: string,
              detail: string,
              caseKey: string,
              data: Record<string, unknown> | null,
              message = ''
            ): Promise<void> => {
              await logWalkIn(actionLabel, detail, caseKey);
              await syncPatientMasterProfiles();
              broadcastRealtimeEvent({
                type: 'clinic_data_changed',
                module: 'walkin',
                action: actionLabel,
                detail,
                entityKey: caseKey
              });
              writeJson(res, 200, { ok: true, ...(message ? { message } : {}), data });
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
              await finalizeWalkInMutation(
                'Walk-In Created',
                `Walk-in case ${caseId} created for ${patientName}.`,
                toSafeText(created?.case_id || caseId),
                created,
                'Walk-in created.'
              );
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
              await finalizeWalkInMutation('Patient Identified', 'Case moved to identified status.', toSafeText(updated?.case_id || id), updated);
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
              await finalizeWalkInMutation('Queued To Triage', 'Case queued for triage.', toSafeText(updated?.case_id || id), updated);
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
              await finalizeWalkInMutation('Triage Started', 'Case triage started.', toSafeText(updated?.case_id || id), updated);
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
              await finalizeWalkInMutation('Triage Saved', `Triage saved with severity ${severityValue}.`, toSafeText(updated?.case_id || id), updated);
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
              await finalizeWalkInMutation(
                'Doctor Assigned',
                `Doctor assigned: ${toSafeText(body.assigned_doctor) || 'Unchanged'}.`,
                toSafeText(updated?.case_id || id),
                updated
              );
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
              await finalizeWalkInMutation('Case Completed', 'Walk-in case marked as completed.', toSafeText(updated?.case_id || id), updated);
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
              await finalizeWalkInMutation('Emergency Escalated', 'Case escalated to emergency queue.', toSafeText(updated?.case_id || id), updated);
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
            await syncPatientMasterProfiles();
            broadcastRealtimeEvent({
              type: 'clinic_data_changed',
              module: 'checkup',
              action: toActionLabel(action),
              detail: `Check-up action ${toActionLabel(action)} applied to visit ${toSafeText(updatedRow?.visit_id || id)}.`,
              entityKey: toSafeText(updatedRow?.visit_id || id)
            });
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
              await syncPatientMasterProfiles();
              broadcastRealtimeEvent({
                type: 'clinic_data_changed',
                module: 'appointments',
                action: 'Appointment Created',
                detail: `Created appointment ${toSafeText(created?.booking_id || bookingId)} for ${patientName}.`,
                entityKey: toSafeText(created?.booking_id || bookingId)
              });
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
            await syncPatientMasterProfiles();
            broadcastRealtimeEvent({
              type: 'clinic_data_changed',
              module: 'appointments',
              action: 'Appointment Updated',
              detail: `Updated appointment ${bookingId}.`,
              entityKey: bookingId
            });
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
