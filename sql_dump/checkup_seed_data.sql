-- Neon PostgreSQL seed data for Check-Up Consultation Center module
-- Run this in Neon SQL editor after base schema

BEGIN;

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
);

CREATE INDEX IF NOT EXISTS idx_checkup_visits_status ON checkup_visits(status);
CREATE INDEX IF NOT EXISTS idx_checkup_visits_emergency ON checkup_visits(is_emergency);
CREATE INDEX IF NOT EXISTS idx_checkup_visits_updated ON checkup_visits(updated_at DESC);

INSERT INTO checkup_visits (
  visit_id,
  patient_name,
  assigned_doctor,
  source,
  status,
  chief_complaint,
  diagnosis,
  clinical_notes,
  consultation_started_at,
  lab_requested,
  lab_result_ready,
  prescription_created,
  prescription_dispensed,
  follow_up_date,
  is_emergency,
  version
)
VALUES
  ('VISIT-2026-2101', 'Maria Santos', 'Unassigned', 'appointment_confirmed', 'intake', 'Fever with sore throat', NULL, NULL, NULL, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, 1),
  ('VISIT-2026-2102', 'Rico Dela Cruz', 'Unassigned', 'walkin_triage_completed', 'queue', 'Persistent headache', NULL, NULL, NULL, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, 1),
  ('VISIT-2026-2103', 'Juana Reyes', 'Dr. Humour', 'waiting_for_doctor', 'doctor_assigned', 'Back pain with numbness', NULL, NULL, NULL, FALSE, FALSE, FALSE, FALSE, NULL, FALSE, 1),
  ('VISIT-2026-2104', 'Nina Cruz', 'Dr. Jenni', 'appointment_confirmed', 'in_consultation', 'Upper abdominal discomfort', 'Gastritis (suspected)', 'Initial consultation in progress.', NOW() - INTERVAL '35 minute', FALSE, FALSE, FALSE, FALSE, NULL, FALSE, 2),
  ('VISIT-2026-2105', 'Carlo Diaz', 'Dr. Morco', 'walkin_triage_completed', 'lab_requested', 'Blood pressure spike', 'Hypertension (rule out secondary cause)', 'CBC and ECG requested before final plan.', NOW() - INTERVAL '1 hour', TRUE, FALSE, FALSE, FALSE, NULL, FALSE, 3),
  ('VISIT-2026-2106', 'Ana Perez', 'Dr. Humour', 'appointment_confirmed', 'pharmacy', 'Fever and persistent cough', 'Upper respiratory tract infection', 'Rx prepared and routed to pharmacy.', NOW() - INTERVAL '2 hour', FALSE, FALSE, TRUE, FALSE, CURRENT_DATE + INTERVAL '7 day', FALSE, 4),
  ('VISIT-2026-2107', 'Leo Magno', 'Dr. Jenni', 'appointment_confirmed', 'completed', 'Minor ankle sprain', 'Grade 1 ankle sprain', 'Consultation completed, home care advised.', NOW() - INTERVAL '1 day', FALSE, FALSE, TRUE, TRUE, CURRENT_DATE + INTERVAL '14 day', FALSE, 5),
  ('VISIT-2026-2108', 'Paolo Lim', 'Dr. Humour', 'walkin_triage_completed', 'in_consultation', 'Chest discomfort, shortness of breath', 'Acute chest pain (urgent workup)', 'Emergency escalation applied and priority routing triggered.', NOW() - INTERVAL '20 minute', TRUE, FALSE, FALSE, FALSE, NULL, TRUE, 6)
ON CONFLICT (visit_id) DO NOTHING;

COMMIT;
