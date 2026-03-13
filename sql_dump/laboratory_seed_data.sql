-- Neon PostgreSQL schema + seed data for Laboratory workflow module
-- Workflow: order -> processing -> encode -> release -> history

BEGIN;

CREATE TABLE IF NOT EXISTS laboratory_requests (
  id BIGSERIAL PRIMARY KEY,
  request_code VARCHAR(40) NOT NULL UNIQUE,
  visit_id VARCHAR(40) NULL,
  patient_id VARCHAR(60) NULL,
  patient_name VARCHAR(150) NOT NULL,
  age SMALLINT NULL CHECK (age BETWEEN 0 AND 120),
  sex VARCHAR(20) NULL,
  requested_by_doctor VARCHAR(120) NOT NULL,
  doctor_department VARCHAR(120) NULL,
  category VARCHAR(80) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Normal', 'Urgent', 'STAT')),
  status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Result Ready', 'Completed', 'Cancelled')),
  specimen_type VARCHAR(80) NULL,
  sample_source VARCHAR(80) NULL,
  collection_datetime TIMESTAMP NULL,
  clinical_diagnosis TEXT NULL,
  clinical_notes TEXT NULL,
  lab_instructions TEXT NULL,
  insurance_reference VARCHAR(120) NULL,
  billing_reference VARCHAR(120) NULL,
  assigned_lab_staff VARCHAR(120) NULL,
  sample_collected BOOLEAN NOT NULL DEFAULT FALSE,
  sample_collected_at TIMESTAMP NULL,
  processing_started_at TIMESTAMP NULL,
  result_encoded_at TIMESTAMP NULL,
  result_reference_range TEXT NULL,
  verified_by VARCHAR(120) NULL,
  verified_at TIMESTAMP NULL,
  rejection_reason TEXT NULL,
  resample_flag BOOLEAN NOT NULL DEFAULT FALSE,
  released_at TIMESTAMP NULL,
  raw_attachment_name VARCHAR(255) NULL,
  encoded_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS laboratory_request_tests (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES laboratory_requests(id) ON DELETE CASCADE,
  test_name VARCHAR(160) NOT NULL,
  specimen_required VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (request_id, test_name)
);

CREATE TABLE IF NOT EXISTS laboratory_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES laboratory_requests(id) ON DELETE CASCADE,
  action VARCHAR(80) NOT NULL,
  details TEXT NOT NULL,
  actor VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON laboratory_requests(status);
CREATE INDEX IF NOT EXISTS idx_lab_requests_priority ON laboratory_requests(priority);
CREATE INDEX IF NOT EXISTS idx_lab_requests_category ON laboratory_requests(category);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient ON laboratory_requests(patient_name);
CREATE INDEX IF NOT EXISTS idx_lab_requests_requested_at ON laboratory_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_activity_request ON laboratory_activity_logs(request_id, created_at DESC);

INSERT INTO laboratory_requests (
  request_code, visit_id, patient_id, patient_name, age, sex, requested_by_doctor, doctor_department,
  category, priority, status, specimen_type, sample_source, collection_datetime, clinical_diagnosis,
  clinical_notes, lab_instructions, insurance_reference, billing_reference, assigned_lab_staff,
  sample_collected, sample_collected_at, processing_started_at, result_encoded_at, result_reference_range,
  verified_by, verified_at, rejection_reason, resample_flag, released_at, raw_attachment_name, encoded_values
)
VALUES
(
  'LAB-2026-1208', 'VISIT-2026-2001', 'PAT-3401', 'Maria Santos', 34, 'Female', 'Dr. Humour', 'General Medicine',
  'Blood Test', 'Normal', 'Pending', 'Whole Blood', 'Blood', NULL, 'Rule out anemia and metabolic imbalance',
  'Fatigue and dizziness for 3 days.', 'Fasting sample preferred', 'HMO-MAXI-2026-1001', 'BILL-LAB-1208', 'Tech Anne',
  FALSE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, NULL, NULL, '{}'::jsonb
),
(
  'LAB-2026-1196', 'VISIT-2026-1983', 'PAT-2977', 'Emma Tan', 29, 'Female', 'Dr. Morco', 'Internal Medicine',
  'Urinalysis', 'Normal', 'In Progress', 'Urine', 'Urine', NOW() - INTERVAL '2 day 1 hour', 'UTI, rule out hematuria',
  'Dysuria and mild lower abdominal discomfort.', 'Midstream clean catch', NULL, 'BILL-LAB-1196', 'Tech Liza',
  TRUE, NOW() - INTERVAL '2 day 1 hour', NOW() - INTERVAL '2 day 50 minute', NULL, NULL, NULL, NULL, NULL, FALSE, NULL, 'emma-tan-urinalysis-raw.pdf', '{}'::jsonb
),
(
  'LAB-2026-1172', 'VISIT-2026-1948', 'PAT-2674', 'Alex Chua', 31, 'Male', 'Dr. Jenni', 'General Medicine',
  'Blood Test', 'Normal', 'Result Ready', 'Whole Blood', 'Blood', NOW() - INTERVAL '4 day 1 hour', 'Follow-up diabetes monitoring',
  'Routine follow-up panel before physician review.', NULL, 'HMO-INTEL-5522', 'BILL-LAB-1172', 'Tech Mark',
  TRUE, NOW() - INTERVAL '4 day 1 hour', NOW() - INTERVAL '4 day 55 minute', NOW() - INTERVAL '4 day 30 minute',
  'WBC 3.5-11, Hemoglobin 11.5-17.5', 'Tech Mark', NOW() - INTERVAL '4 day 25 minute', NULL, FALSE, NULL, 'alex-chua-blood-raw.pdf',
  '{"wbc": 6.4, "rbc": 4.8, "hemoglobin": 14.2, "platelets": 288}'::jsonb
),
(
  'LAB-2026-1168', 'VISIT-2026-1932', 'PAT-2509', 'Lara Gomez', 53, 'Female', 'Dr. Morco', 'Internal Medicine',
  'ECG', 'Normal', 'Completed', 'ECG Trace', 'Cardiac', NOW() - INTERVAL '5 day 1 hour', 'Baseline cardiac monitoring',
  'Baseline ECG prior to medication adjustment.', NULL, NULL, 'BILL-LAB-1168', 'Tech Anne',
  TRUE, NOW() - INTERVAL '5 day 1 hour', NOW() - INTERVAL '5 day 55 minute', NOW() - INTERVAL '5 day 30 minute',
  'Heart rate 60-100 bpm', 'Tech Anne', NOW() - INTERVAL '5 day 25 minute', NULL, FALSE, NOW() - INTERVAL '5 day 20 minute', 'lara-gomez-ecg.pdf',
  '{"heart_rate": 76, "rhythm": "Sinus Rhythm", "ecg_interpretation": "No acute ischemic changes."}'::jsonb
),
(
  'LAB-2026-1151', 'VISIT-2026-1884', 'PAT-2401', 'Carlos Medina', 36, 'Male', 'Dr. Rivera', 'Pediatrics',
  'Serology', 'Urgent', 'In Progress', 'Serum', 'Blood', NOW() - INTERVAL '1 day 1 hour', 'Rule out viral infection',
  'Evaluate viral markers due to persistent fever.', NULL, NULL, 'BILL-LAB-1151', 'Tech Carla',
  TRUE, NOW() - INTERVAL '1 day 1 hour', NOW() - INTERVAL '1 day 50 minute', NULL, NULL, NULL, NULL, NULL, FALSE, NULL, NULL,
  '{}'::jsonb
),
(
  'LAB-2026-1144', 'VISIT-2026-1869', 'PAT-2332', 'Rina Lopez', 49, 'Female', 'Dr. Morco', 'Internal Medicine',
  'Microbiology', 'Normal', 'Cancelled', 'Urine', 'Urine', NOW() - INTERVAL '2 day 2 hour', 'Complicated UTI workup',
  'Culture requested for persistent urinary symptoms.', 'Resample due to contamination', NULL, 'BILL-LAB-1144', 'Tech Liza',
  TRUE, NOW() - INTERVAL '2 day 2 hour', NOW() - INTERVAL '2 day 1 hour 45 minute', NULL, NULL, NULL, NULL,
  'Initial specimen contaminated; repeat sample required.', TRUE, NULL, 'rina-lopez-urine-culture-initial.pdf',
  '{}'::jsonb
)
ON CONFLICT (request_code) DO NOTHING;

INSERT INTO laboratory_request_tests (request_id, test_name, specimen_required)
SELECT lr.id, t.test_name, t.specimen_required
FROM laboratory_requests lr
JOIN (
  VALUES
    ('LAB-2026-1208', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-2026-1208', 'Comprehensive Metabolic Panel (CMP)', 'Serum'),
    ('LAB-2026-1208', 'Lipid Panel', 'Serum'),
    ('LAB-2026-1196', 'Urinalysis Routine', 'Urine'),
    ('LAB-2026-1196', 'Microscopy', 'Urine'),
    ('LAB-2026-1172', 'CBC', 'Whole Blood'),
    ('LAB-2026-1172', 'Fasting Blood Sugar', 'Plasma'),
    ('LAB-2026-1168', '12-lead ECG', 'ECG Trace'),
    ('LAB-2026-1151', 'Dengue IgM/IgG', 'Serum'),
    ('LAB-2026-1151', 'HBsAg', 'Serum'),
    ('LAB-2026-1144', 'Urine Culture and Sensitivity', 'Urine')
) AS t(request_code, test_name, specimen_required)
  ON t.request_code = lr.request_code
ON CONFLICT (request_id, test_name) DO NOTHING;

INSERT INTO laboratory_activity_logs (request_id, action, details, actor, created_at)
SELECT lr.id, l.action, l.details, l.actor, l.created_at
FROM laboratory_requests lr
JOIN (
  VALUES
    ('LAB-2026-1208', 'Request Created', 'Doctor submitted a new laboratory request.', 'Dr. Humour', NOW() - INTERVAL '10 hour'),
    ('LAB-2026-1196', 'Request Created', 'Laboratory request entered by check-up.', 'Dr. Morco', NOW() - INTERVAL '2 day 2 hour'),
    ('LAB-2026-1196', 'Processing Started', 'Sample collected and moved to processing queue.', 'Tech Liza', NOW() - INTERVAL '2 day 1 hour 50 minute'),
    ('LAB-2026-1172', 'Request Created', 'Routine blood panel requested.', 'Dr. Jenni', NOW() - INTERVAL '4 day 2 hour'),
    ('LAB-2026-1172', 'Result Finalized', 'Result encoded and marked as Result Ready.', 'Tech Mark', NOW() - INTERVAL '4 day 30 minute'),
    ('LAB-2026-1168', 'Request Created', 'ECG requested during follow-up consult.', 'Dr. Morco', NOW() - INTERVAL '5 day 2 hour'),
    ('LAB-2026-1168', 'Report Released', 'Lab report released to doctor/check-up.', 'Tech Anne', NOW() - INTERVAL '5 day 20 minute'),
    ('LAB-2026-1151', 'Processing Started', 'Serology sample received and processing started.', 'Tech Carla', NOW() - INTERVAL '1 day 50 minute'),
    ('LAB-2026-1144', 'Resample Requested', 'Initial sample rejected due to contamination.', 'Lab Manager', NOW() - INTERVAL '2 day 1 hour 30 minute')
) AS l(request_code, action, details, actor, created_at)
  ON l.request_code = lr.request_code
WHERE NOT EXISTS (
  SELECT 1
  FROM laboratory_activity_logs x
  WHERE x.request_id = lr.id
    AND x.action = l.action
    AND x.details = l.details
);

COMMIT;
