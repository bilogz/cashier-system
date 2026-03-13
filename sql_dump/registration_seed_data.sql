-- Neon PostgreSQL seed data for Registration module
-- Run this in Neon SQL editor after base schema

BEGIN;

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
);

CREATE INDEX IF NOT EXISTS idx_patient_registrations_status ON patient_registrations(status);
CREATE INDEX IF NOT EXISTS idx_patient_registrations_intake ON patient_registrations(intake_time DESC);

INSERT INTO patient_registrations (case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to)
VALUES
  ('REG-20260213-1001', 'Maria Santos', 'maria.santos@example.com', 34, 'Back pain', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour', 'Pending', 'Dr. Humour'),
  ('REG-20260213-1002', 'Juana Locsin', 'juana.locsin@example.com', 31, 'Headache', NOW() - INTERVAL '1 day', NOW() - INTERVAL '23 hours', 'Active', 'Dr. Morco'),
  ('REG-20260213-1003', 'Gina Marquez', 'gina.marquez@example.com', 41, 'Anxiety', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', 'Active', 'Dr. Jenni'),
  ('REG-20260213-1004', 'Leo Magno', 'leo.magno@example.com', 45, 'New Concern', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', 'Pending', 'Register Marion'),
  ('REG-20260213-1005', 'Juan Dela Cruz', 'juan.delacruz@example.com', 39, 'Cold', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days', 'Pending', 'Dr. Humour'),
  ('REG-20260213-1006', 'Ana Perez', 'ana.perez@example.com', 27, 'Archived intake', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', 'Archived', 'Dr. S. Villaraza'),
  ('REG-20260213-1007', 'Emma Tan', 'emma.tan@example.com', 29, 'Family stress', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours', 'Pending', 'Dr. Rivera'),
  ('REG-20260213-1008', 'Alex Chua', 'alex.chua@example.com', 40, 'Follow-up triage', NOW() - INTERVAL '8 hours', NOW() - INTERVAL '8 hours', 'Active', 'Dr. Martinez')
ON CONFLICT (case_id) DO NOTHING;

COMMIT;
