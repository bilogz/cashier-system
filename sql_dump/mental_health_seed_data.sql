-- Neon PostgreSQL schema + seed data for Mental Health & Addiction module
-- Workflow: Create -> Active -> Follow-Up -> At-Risk -> Completed -> Escalated -> Archived

BEGIN;

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
);

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
  created_by_role VARCHAR(40) NOT NULL DEFAULT 'Counselor',
  is_draft BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMP NULL
);

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
);

CREATE TABLE IF NOT EXISTS mental_health_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NULL REFERENCES mental_health_sessions(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  detail TEXT NOT NULL,
  actor_role VARCHAR(40) NOT NULL DEFAULT 'System',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mh_sessions_status ON mental_health_sessions(status);
CREATE INDEX IF NOT EXISTS idx_mh_sessions_patient ON mental_health_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_mh_notes_session ON mental_health_notes(session_id, created_at DESC);

INSERT INTO mental_health_patients (patient_id, patient_name, date_of_birth, sex, contact_number, guardian_contact)
VALUES
('PAT-3401', 'Maria Santos', '1990-03-14', 'Female', '0917-123-4411', NULL),
('PAT-3119', 'John Reyes', '1989-10-05', 'Male', '0918-223-8842', 'Luz Reyes - 0917-992-1113'),
('PAT-2977', 'Emma Tan', '1997-07-21', 'Female', '0919-664-9012', NULL),
('PAT-2509', 'Lara Gomez', '1995-12-09', 'Female', '0921-441-0023', NULL)
ON CONFLICT (patient_id) DO NOTHING;

INSERT INTO mental_health_sessions (
  case_reference, patient_id, patient_name, counselor, session_type, status, risk_level, diagnosis_condition, treatment_plan,
  session_goals, session_duration_minutes, session_mode, location_room, guardian_contact, emergency_contact, medication_reference,
  follow_up_frequency, escalation_reason, outcome_result, assessment_score, assessment_tool, appointment_at, next_follow_up_at, created_by_role
)
VALUES
('MHS-2026-2401', 'PAT-3401', 'Maria Santos', 'Dr. Rivera', 'Individual Counseling', 'active', 'medium', 'Generalized anxiety', 'CBT + sleep hygiene', 'Reduce panic episodes', 50, 'in_person', 'Room MH-2', NULL, 'Mario Santos - 0917-223-1201', 'Sertraline 25mg OD', 'Weekly', NULL, NULL, 14, 'GAD-7', NOW() - INTERVAL '2 day', NOW() + INTERVAL '5 day', 'Counselor'),
('MHS-2026-2397', 'PAT-3119', 'John Reyes', 'Dr. Molina', 'Substance Recovery', 'at_risk', 'high', 'Alcohol use disorder', 'Relapse prevention counseling', 'Prevent relapse in 30 days', 60, 'in_person', 'Recovery Room 1', 'Luz Reyes - 0917-992-1113', 'Luz Reyes - 0917-992-1113', 'Naltrexone 50mg', 'Twice Weekly', 'Withdrawal warning signs reported by family', NULL, 19, 'PHQ-9', NOW() - INTERVAL '1 day', NOW() + INTERVAL '2 day', 'Counselor'),
('MHS-2026-2389', 'PAT-2977', 'Emma Tan', 'Dr. Rivera', 'Family Session', 'follow_up', 'low', 'Adjustment disorder', 'Family support mapping', 'Improve family communication', 45, 'online', NULL, 'Angela Tan - 0917-991-5511', 'Angela Tan - 0917-991-5511', NULL, 'Bi-weekly', NULL, 'Improved self-report mood', 7, 'PHQ-9', NOW() - INTERVAL '4 day', NOW() + INTERVAL '6 day', 'Counselor')
ON CONFLICT (case_reference) DO NOTHING;

INSERT INTO mental_health_notes (session_id, note_type, note_content, clinical_score, attachment_name, attachment_url, created_by_role)
SELECT s.id, 'Progress', 'Patient reports improved sleep and reduced anxiety episodes.', 12, 'sleep-journal.pdf', '/files/sleep-journal.pdf', 'Counselor'
FROM mental_health_sessions s
WHERE s.case_reference = 'MHS-2026-2401'
ON CONFLICT DO NOTHING;

INSERT INTO mental_health_activity_logs (session_id, action, detail, actor_role)
SELECT s.id, 'SESSION_CREATED', 'Session created and set to active workflow.', 'Counselor'
FROM mental_health_sessions s
WHERE s.case_reference = 'MHS-2026-2401'
ON CONFLICT DO NOTHING;

COMMIT;
