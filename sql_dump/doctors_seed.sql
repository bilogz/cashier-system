-- Doctors master seed
-- Run manually if needed:
-- psql "$DATABASE_URL" -f database/seeds/doctors_seed.sql

CREATE TABLE IF NOT EXISTS doctors (
  id BIGSERIAL PRIMARY KEY,
  doctor_name VARCHAR(120) NOT NULL UNIQUE,
  department_name VARCHAR(120) NOT NULL,
  specialization VARCHAR(160) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doctors_department ON doctors(department_name, is_active);

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
ON CONFLICT (doctor_name) DO UPDATE
SET
  department_name = EXCLUDED.department_name,
  specialization = EXCLUDED.specialization,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

