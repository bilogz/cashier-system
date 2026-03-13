-- Neon PostgreSQL schema + seed data for Walk-In module
-- Run in Neon SQL editor.

BEGIN;

CREATE TABLE IF NOT EXISTS patient_walkins (
  id BIGSERIAL PRIMARY KEY,
  case_id VARCHAR(40) NOT NULL UNIQUE,
  patient_name VARCHAR(150) NOT NULL,
  age SMALLINT NULL CHECK (age BETWEEN 0 AND 120),
  sex VARCHAR(12) NULL CHECK (sex IN ('Male', 'Female', 'Other')),
  date_of_birth DATE NULL,
  contact VARCHAR(80) NULL,
  address TEXT NULL,
  emergency_contact VARCHAR(120) NULL,
  patient_ref VARCHAR(60) NULL,
  visit_department VARCHAR(80) NULL,
  checkin_time TIMESTAMP NULL,
  pain_scale SMALLINT NULL CHECK (pain_scale BETWEEN 0 AND 10),
  temperature_c NUMERIC(4, 1) NULL CHECK (temperature_c BETWEEN 30 AND 45),
  blood_pressure VARCHAR(20) NULL,
  pulse_bpm SMALLINT NULL CHECK (pulse_bpm BETWEEN 20 AND 240),
  weight_kg NUMERIC(5, 2) NULL CHECK (weight_kg > 0),
  chief_complaint TEXT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'Low' CHECK (severity IN ('Low', 'Moderate', 'Emergency')),
  intake_time TIMESTAMP NOT NULL DEFAULT NOW(),
  assigned_doctor VARCHAR(120) NOT NULL DEFAULT 'Nurse Triage',
  status VARCHAR(30) NOT NULL DEFAULT 'waiting',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS sex VARCHAR(12) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS address TEXT NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS patient_ref VARCHAR(60) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS visit_department VARCHAR(80) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS checkin_time TIMESTAMP NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS pain_scale SMALLINT NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS temperature_c NUMERIC(4, 1) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS blood_pressure VARCHAR(20) NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS pulse_bpm SMALLINT NULL;
ALTER TABLE patient_walkins ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5, 2) NULL;

CREATE INDEX IF NOT EXISTS idx_patient_walkins_status ON patient_walkins(status);
CREATE INDEX IF NOT EXISTS idx_patient_walkins_intake ON patient_walkins(intake_time DESC);
CREATE INDEX IF NOT EXISTS idx_patient_walkins_checkin ON patient_walkins(checkin_time DESC);
CREATE INDEX IF NOT EXISTS idx_patient_walkins_patient_ref ON patient_walkins(patient_ref);
CREATE INDEX IF NOT EXISTS idx_patient_walkins_severity_status ON patient_walkins(severity, status);

INSERT INTO patient_walkins (
  case_id, patient_name, age, sex, date_of_birth, contact, address, emergency_contact, patient_ref,
  visit_department, checkin_time, pain_scale, temperature_c, blood_pressure, pulse_bpm, weight_kg,
  chief_complaint, severity, intake_time, assigned_doctor, status
)
VALUES
  (
    'WALK-2026-101', 'Mario Santos', 42, 'Male', '1983-04-15', '0917-123-4411', 'Quezon City',
    '0917-100-0001', 'MRN-1001', 'General OPD', NOW() - INTERVAL '2 hour', 3, 36.9, '128/84', 82, 72.40,
    'Mild dizziness and headache', 'Moderate', NOW() - INTERVAL '2 hour', 'Dr. Humour', 'waiting_for_doctor'
  ),
  (
    'WALK-2026-102', 'Juana Reyes', 27, 'Female', '1998-08-21', '0916-994-1209', 'Makati',
    '0916-800-1111', NULL, 'ER', NOW() - INTERVAL '1 hour 40 minute', 4, 37.2, '118/78', 88, 58.20,
    'Small hand laceration', 'Low', NOW() - INTERVAL '1 hour 40 minute', 'Nurse Triage', 'triage_pending'
  ),
  (
    'WALK-2026-098', 'Nina Cruz', 29, 'Female', '1996-02-14', '0915-445-1992', 'Taguig',
    NULL, NULL, 'General OPD', NOW() - INTERVAL '35 minute', 2, 36.7, '112/74', 76, 54.00,
    'Initial intake', 'Low', NOW() - INTERVAL '35 minute', 'Nurse Triage', 'waiting'
  ),
  (
    'WALK-2026-096', 'Paolo Lim', 31, 'Male', '1994-01-10', '0922-117-6200', 'Pasig',
    '0922-700-2200', 'MRN-1022', 'General OPD', NOW() - INTERVAL '25 minute', 1, 36.5, '116/76', 74, 66.80,
    'Identity confirmed for triage', 'Low', NOW() - INTERVAL '25 minute', 'Nurse Triage', 'identified'
  ),
  (
    'WALK-2026-097', 'Carlo Diaz', 37, 'Male', '1988-11-03', '0991-000-1288', 'Manila',
    '0991-222-3333', 'MRN-2109', 'ER', NOW() - INTERVAL '55 minute', 7, 37.8, '156/98', 102, 79.50,
    'Blood pressure spike', 'Moderate', NOW() - INTERVAL '55 minute', 'Nurse Triage', 'in_triage'
  ),
  (
    'WALK-2026-103', 'Rico Dela Cruz', 56, 'Male', '1969-05-25', '0920-334-7781', 'Marikina',
    '0920-111-4444', 'MRN-9012', 'ER', NOW() - INTERVAL '1 hour 25 minute', 9, 38.4, '170/106', 116, 83.00,
    'Chest discomfort, shortness of breath', 'Emergency', NOW() - INTERVAL '1 hour 25 minute', 'ER Team', 'emergency'
  ),
  (
    'WALK-2026-104', 'Ana Perez', 33, 'Female', '1992-09-09', '0919-331-8880', 'Pasay',
    '0919-555-1212', NULL, 'General OPD', NOW() - INTERVAL '2 hour 30 minute', 5, 38.1, '126/82', 94, 60.40,
    'Fever and persistent cough', 'Moderate', NOW() - INTERVAL '2 hour 30 minute', 'Dr. Jenni', 'waiting_for_doctor'
  ),
  (
    'WALK-2026-099', 'Leo Magno', 24, 'Male', '2002-02-01', '0918-776-4022', 'Muntinlupa',
    NULL, NULL, 'Orthopedic', NOW() - INTERVAL '3 hour', 2, 36.6, '110/70', 72, 68.20,
    'Minor ankle sprain', 'Low', NOW() - INTERVAL '3 hour', 'Dr. Morco', 'completed'
  )
ON CONFLICT (case_id) DO UPDATE SET
  patient_name = EXCLUDED.patient_name,
  age = EXCLUDED.age,
  sex = EXCLUDED.sex,
  date_of_birth = EXCLUDED.date_of_birth,
  contact = EXCLUDED.contact,
  address = EXCLUDED.address,
  emergency_contact = EXCLUDED.emergency_contact,
  patient_ref = EXCLUDED.patient_ref,
  visit_department = EXCLUDED.visit_department,
  checkin_time = EXCLUDED.checkin_time,
  pain_scale = EXCLUDED.pain_scale,
  temperature_c = EXCLUDED.temperature_c,
  blood_pressure = EXCLUDED.blood_pressure,
  pulse_bpm = EXCLUDED.pulse_bpm,
  weight_kg = EXCLUDED.weight_kg,
  chief_complaint = EXCLUDED.chief_complaint,
  severity = EXCLUDED.severity,
  intake_time = EXCLUDED.intake_time,
  assigned_doctor = EXCLUDED.assigned_doctor,
  status = EXCLUDED.status,
  updated_at = NOW();

COMMIT;
