-- Cashier System seed data (PostgreSQL/Supabase)
-- Run after schema.sql.

BEGIN;

INSERT INTO admin_profiles (username, full_name, email, role, department, access_exemptions, is_super_admin, password_hash, status, phone)
VALUES
  ('joecelgarcia1@gmail.com', 'Nexora Super Admin', 'joecelgarcia1@gmail.com', 'Admin', 'Administration', ARRAY['appointments','patients','registration','walkin','checkup','laboratory','pharmacy','mental_health','reports'], 1, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 345 6789'),
  ('appointments.admin@nexora.local', 'Appointments Admin', 'appointments.admin@nexora.local', 'Appointments Staff', 'Appointment', ARRAY['patients','reports'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1001'),
  ('patients.admin@nexora.local', 'Patients Database Admin', 'patients.admin@nexora.local', 'Patient Records Staff', 'Patients Database', ARRAY['registration','appointments'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1002'),
  ('registration.admin@nexora.local', 'Registration Admin', 'registration.admin@nexora.local', 'Registration Staff', 'Registration', ARRAY['patients','appointments'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1003'),
  ('walkin.admin@nexora.local', 'Walk-In Admin', 'walkin.admin@nexora.local', 'Walk-In Staff', 'Walk-In', ARRAY['checkup','patients'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1004'),
  ('checkup.admin@nexora.local', 'Check-Up Admin', 'checkup.admin@nexora.local', 'Check-Up Staff', 'Check-Up', ARRAY['laboratory','pharmacy','patients'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1005'),
  ('lab.admin@nexora.local', 'Laboratory Admin', 'lab.admin@nexora.local', 'Lab Technician', 'Laboratory', ARRAY['checkup','reports'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1006'),
  ('pharmacy.admin@nexora.local', 'Pharmacy Admin', 'pharmacy.admin@nexora.local', 'Pharmacist', 'Pharmacy & Inventory', ARRAY['checkup','reports'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1007'),
  ('mental.admin@nexora.local', 'Mental Health Admin', 'mental.admin@nexora.local', 'Counselor', 'Mental Health & Addiction', ARRAY['reports','patients'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1008'),
  ('reports.admin@nexora.local', 'Reports Admin', 'reports.admin@nexora.local', 'Reports Analyst', 'Reports', ARRAY['appointments','patients','registration','walkin','checkup','laboratory','pharmacy','mental_health'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1009'),
  ('finance.admin@nexora.local', 'Finance Admin', 'finance.admin@nexora.local', 'Manager', 'Finance', ARRAY['reports'], 0, '4d316a4e9a94c929a12f7d654ea8a205:8b513777a58abff03f5e03cdf5fe2181f5ab66afacfa3a368b117902be0ebe317779e3a62026fc7c0441728563d5f96dfc37d633a1b6634b82c16df6f7419e09', 'active', '+63 912 000 1010')
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
  ('VISIT-2026-2101', 'Maria Santos', 'Unassigned', 'appointment_confirmed', 'intake', 'Fever with sore throat', NULL, NULL, NULL, 0, 0, 0, 0, NULL, 0, 1),
  ('VISIT-2026-2102', 'Rico Dela Cruz', 'Unassigned', 'walkin_triage_completed', 'queue', 'Persistent headache', NULL, NULL, NULL, 0, 0, 0, 0, NULL, 0, 1),
  ('VISIT-2026-2103', 'Juana Reyes', 'Dr. Humour', 'waiting_for_doctor', 'doctor_assigned', 'Back pain with numbness', NULL, NULL, NULL, 0, 0, 0, 0, NULL, 0, 1),
  ('VISIT-2026-2104', 'Nina Cruz', 'Dr. Jenni', 'appointment_confirmed', 'in_consultation', 'Upper abdominal discomfort', 'Gastritis (suspected)', 'Initial consultation in progress.', NOW() - INTERVAL '35 minute', 0, 0, 0, 0, NULL, 0, 2),
  ('VISIT-2026-2105', 'Carlo Diaz', 'Dr. Morco', 'walkin_triage_completed', 'lab_requested', 'Blood pressure spike', 'Hypertension (rule out secondary cause)', 'CBC and ECG requested before final plan.', NOW() - INTERVAL '1 hour', 1, 0, 0, 0, NULL, 0, 3),
  ('VISIT-2026-2106', 'Ana Perez', 'Dr. Humour', 'appointment_confirmed', 'pharmacy', 'Fever and persistent cough', 'Upper respiratory tract infection', 'Rx prepared and routed to pharmacy.', NOW() - INTERVAL '2 hour', 0, 0, 1, 0, CURRENT_DATE + INTERVAL '7 day', 0, 4),
  ('VISIT-2026-2107', 'Leo Magno', 'Dr. Jenni', 'appointment_confirmed', 'completed', 'Minor ankle sprain', 'Grade 1 ankle sprain', 'Consultation completed, home care advised.', NOW() - INTERVAL '1 day', 0, 0, 1, 1, CURRENT_DATE + INTERVAL '14 day', 0, 5),
  ('VISIT-2026-2108', 'Paolo Lim', 'Dr. Humour', 'walkin_triage_completed', 'in_consultation', 'Chest discomfort, shortness of breath', 'Acute chest pain (urgent workup)', 'Emergency escalation applied and priority routing triggered.', NOW() - INTERVAL '20 minute', 1, 0, 0, 0, NULL, 1, 6)
ON CONFLICT (visit_id) DO NOTHING;
INSERT INTO doctors (doctor_name, department_name, specialization, is_active)
VALUES
  ('Dr. Humour', 'General Medicine', 'Internal Medicine', 1),
  ('Dr. Jenni', 'General Medicine', 'General Medicine', 1),
  ('Dr. Rivera', 'Pediatrics', 'Pediatrics', 1),
  ('Dr. Morco', 'Orthopedic', 'Orthopedics', 1),
  ('Dr. Martinez', 'Orthopedic', 'Orthopedics', 1),
  ('Dr. Santos', 'Dental', 'Dentistry', 1),
  ('Dr. Lim', 'Dental', 'Dentistry', 1),
  ('Dr. A. Rivera', 'Laboratory', 'Pathology', 1),
  ('Dr. S. Villaraza', 'Mental Health', 'Psychiatry', 1),
  ('Dr. B. Martinez', 'Check-Up', 'General Practice', 1)
ON CONFLICT (doctor_name) DO UPDATE
SET
  department_name = EXCLUDED.department_name,
  specialization = EXCLUDED.specialization,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();
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
  0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '{}'::jsonb
),
(
  'LAB-2026-1196', 'VISIT-2026-1983', 'PAT-2977', 'Emma Tan', 29, 'Female', 'Dr. Morco', 'Internal Medicine',
  'Urinalysis', 'Normal', 'In Progress', 'Urine', 'Urine', NOW() - INTERVAL '2 day 1 hour', 'UTI, rule out hematuria',
  'Dysuria and mild lower abdominal discomfort.', 'Midstream clean catch', NULL, 'BILL-LAB-1196', 'Tech Liza',
  1, NOW() - INTERVAL '2 day 1 hour', NOW() - INTERVAL '2 day 50 minute', NULL, NULL, NULL, NULL, NULL, 0, NULL, 'emma-tan-urinalysis-raw.pdf', '{}'::jsonb
),
(
  'LAB-2026-1172', 'VISIT-2026-1948', 'PAT-2674', 'Alex Chua', 31, 'Male', 'Dr. Jenni', 'General Medicine',
  'Blood Test', 'Normal', 'Result Ready', 'Whole Blood', 'Blood', NOW() - INTERVAL '4 day 1 hour', 'Follow-up diabetes monitoring',
  'Routine follow-up panel before physician review.', NULL, 'HMO-INTEL-5522', 'BILL-LAB-1172', 'Tech Mark',
  1, NOW() - INTERVAL '4 day 1 hour', NOW() - INTERVAL '4 day 55 minute', NOW() - INTERVAL '4 day 30 minute',
  'WBC 3.5-11, Hemoglobin 11.5-17.5', 'Tech Mark', NOW() - INTERVAL '4 day 25 minute', NULL, 0, NULL, 'alex-chua-blood-raw.pdf',
  '{"wbc": 6.4, "rbc": 4.8, "hemoglobin": 14.2, "platelets": 288}'::jsonb
),
(
  'LAB-2026-1168', 'VISIT-2026-1932', 'PAT-2509', 'Lara Gomez', 53, 'Female', 'Dr. Morco', 'Internal Medicine',
  'ECG', 'Normal', 'Completed', 'ECG Trace', 'Cardiac', NOW() - INTERVAL '5 day 1 hour', 'Baseline cardiac monitoring',
  'Baseline ECG prior to medication adjustment.', NULL, NULL, 'BILL-LAB-1168', 'Tech Anne',
  1, NOW() - INTERVAL '5 day 1 hour', NOW() - INTERVAL '5 day 55 minute', NOW() - INTERVAL '5 day 30 minute',
  'Heart rate 60-100 bpm', 'Tech Anne', NOW() - INTERVAL '5 day 25 minute', NULL, 0, NOW() - INTERVAL '5 day 20 minute', 'lara-gomez-ecg.pdf',
  '{"heart_rate": 76, "rhythm": "Sinus Rhythm", "ecg_interpretation": "No acute ischemic changes."}'::jsonb
),
(
  'LAB-2026-1151', 'VISIT-2026-1884', 'PAT-2401', 'Carlos Medina', 36, 'Male', 'Dr. Rivera', 'Pediatrics',
  'Serology', 'Urgent', 'In Progress', 'Serum', 'Blood', NOW() - INTERVAL '1 day 1 hour', 'Rule out viral infection',
  'Evaluate viral markers due to persistent fever.', NULL, NULL, 'BILL-LAB-1151', 'Tech Carla',
  1, NOW() - INTERVAL '1 day 1 hour', NOW() - INTERVAL '1 day 50 minute', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL,
  '{}'::jsonb
),
(
  'LAB-2026-1144', 'VISIT-2026-1869', 'PAT-2332', 'Rina Lopez', 49, 'Female', 'Dr. Morco', 'Internal Medicine',
  'Microbiology', 'Normal', 'Cancelled', 'Urine', 'Urine', NOW() - INTERVAL '2 day 2 hour', 'Complicated UTI workup',
  'Culture requested for persistent urinary symptoms.', 'Resample due to contamination', NULL, 'BILL-LAB-1144', 'Tech Liza',
  1, NOW() - INTERVAL '2 day 2 hour', NOW() - INTERVAL '2 day 1 hour 45 minute', NULL, NULL, NULL, NULL,
  'Initial specimen contaminated; repeat sample required.', 1, NULL, 'rina-lopez-urine-culture-initial.pdf',
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
INSERT INTO pharmacy_medicines (
  medicine_code, sku, medicine_name, brand_name, generic_name, category, medicine_type, dosage_strength,
  unit_of_measure, supplier_name, purchase_cost, selling_price, batch_lot_no, manufacturing_date, expiry_date,
  storage_requirements, reorder_level, low_stock_threshold, stock_capacity, stock_on_hand, stock_location, barcode
)
VALUES
('MED-00043', 'MED-OMP-043', 'Omeprazole', 'Losec', 'Omeprazole', 'Capsule', 'Antacid', '20mg', 'caps', 'MediCore Supply', 4.80, 8.50, 'OMP-52', '2025-01-05', '2026-05-01', 'Store below 25C, dry area', 35, 30, 200, 23, 'Warehouse A / Shelf C2', '4800010000432'),
('MED-00036', 'MED-MTF-036', 'Metformin', 'Glucophage', 'Metformin', 'Tablet', 'Diabetes', '500mg', 'tabs', 'Healix Pharma', 2.20, 4.70, 'MTF-11', '2025-02-18', '2026-11-22', 'Room temperature', 40, 35, 150, 0, 'Warehouse A / Shelf A1', '4800010000364'),
('MED-00024', 'MED-ALV-024', 'Aleve', 'Aleve', 'Naproxen', 'Tablet', 'Painkiller', '220mg', 'tabs', 'Healix Pharma', 1.30, 3.90, 'ALV-27', '2025-04-04', '2026-05-20', 'Room temperature', 65, 50, 300, 180, 'Warehouse C / Shelf B4', '4800010000243'),
('MED-00017', 'MED-AML-017', 'Amlodipine', 'Norvasc', 'Amlodipine', 'Tablet', 'Antihypertensive', '5mg', 'tabs', 'AxisMed Trading', 1.80, 4.10, 'AML-44', '2025-01-22', '2027-02-07', 'Store below 30C', 70, 60, 300, 150, 'Warehouse B / Shelf A3', '4800010000175')
ON CONFLICT (sku) DO NOTHING;
INSERT INTO pharmacy_dispense_requests (
  request_code, medicine_id, patient_name, quantity, notes, prescription_reference, dispense_reason, status, requested_at
)
SELECT 'DSP-2026-0901', pm.id, 'John Doe', 5, 'Before breakfast', 'RX-2026-12311', 'Acid reflux management', 'Pending', NOW() - INTERVAL '2 hour'
FROM pharmacy_medicines pm WHERE pm.sku = 'MED-OMP-043'
ON CONFLICT (request_code) DO NOTHING;
INSERT INTO pharmacy_dispense_requests (
  request_code, medicine_id, patient_name, quantity, notes, prescription_reference, dispense_reason, status, requested_at
)
SELECT 'DSP-2026-0902', pm.id, 'Emma Tan', 10, 'After meals', 'RX-2026-12349', 'Type 2 diabetes maintenance', 'Pending', NOW() - INTERVAL '3 hour'
FROM pharmacy_medicines pm WHERE pm.sku = 'MED-MTF-036'
ON CONFLICT (request_code) DO NOTHING;
INSERT INTO pharmacy_stock_movements (
  medicine_id, movement_type, quantity_change, quantity_before, quantity_after, reason, batch_lot_no, stock_location, actor, created_at
)
SELECT pm.id, 'restock', 150, 30, 180, 'Routine replenishment', 'ALV-27', 'Warehouse C / Shelf B4', 'Gina Marquez', NOW() - INTERVAL '4 hour'
FROM pharmacy_medicines pm WHERE pm.sku = 'MED-ALV-024'
ON CONFLICT DO NOTHING;
INSERT INTO pharmacy_stock_movements (
  medicine_id, movement_type, quantity_change, quantity_before, quantity_after, reason, batch_lot_no, stock_location, actor, created_at
)
SELECT pm.id, 'alert', 0, 0, 0, 'Out of stock threshold reached', pm.batch_lot_no, pm.stock_location, 'System', NOW() - INTERVAL '5 hour'
FROM pharmacy_medicines pm WHERE pm.sku = 'MED-MTF-036'
ON CONFLICT DO NOTHING;
INSERT INTO pharmacy_activity_logs (action, detail, actor, tone, created_at)
VALUES
('RESTOCK', 'Aleve restocked +150 (Batch ALV-27)', 'Gina Marquez', 'success', NOW() - INTERVAL '4 hour'),
('DISPENSE', 'Omeprazole dispensed -5 for John Doe (RX-2026-12311)', 'Nurse Carla', 'info', NOW() - INTERVAL '3 hour'),
('ALERT', 'Metformin out-of-stock alert triggered', 'System', 'warning', NOW() - INTERVAL '5 hour')
ON CONFLICT DO NOTHING;
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
INSERT INTO patient_appointments (
  booking_id, patient_id, patient_name, patient_age, patient_email, patient_gender, phone_number,
  emergency_contact, insurance_provider, payment_method, appointment_priority,
  symptoms_summary, doctor_notes, doctor_name, department_name, visit_type,
  appointment_date, preferred_time, visit_reason, status
)
SELECT
  'BK-E2E-' || (2000 + gs.i)::text,
  'PAT-E2E-' || (3000 + gs.i)::text,
  'E2E Patient ' || gs.i::text,
  20 + gs.i,
  'e2e' || gs.i::text || '@clinic.test',
  CASE WHEN gs.i % 2 = 0 THEN 'Female' ELSE 'Male' END,
  '0917-555-' || LPAD(gs.i::text, 4, '0'),
  '0908-444-' || LPAD(gs.i::text, 4, '0'),
  CASE WHEN gs.i % 2 = 0 THEN 'CarePlus' ELSE 'MediShield' END,
  CASE WHEN gs.i % 3 = 0 THEN 'Insurance' ELSE 'Cash' END,
  CASE WHEN gs.i % 4 = 0 THEN 'Urgent' ELSE 'Routine' END,
  'Symptom summary ' || gs.i::text,
  'Doctor note ' || gs.i::text,
  CASE WHEN gs.i % 3 = 0 THEN 'Dr. Humour' WHEN gs.i % 3 = 1 THEN 'Dr. Jenni' ELSE 'Dr. Rivera' END,
  CASE WHEN gs.i % 3 = 0 THEN 'General Medicine' WHEN gs.i % 3 = 1 THEN 'Pediatrics' ELSE 'Internal Medicine' END,
  'Check-Up',
  CURRENT_DATE - ((10 - gs.i) % 7),
  CASE WHEN gs.i % 2 = 0 THEN '09:00' ELSE '14:30' END,
  'Follow-up visit',
  CASE WHEN gs.i % 5 = 0 THEN 'Pending' WHEN gs.i % 2 = 0 THEN 'Confirmed' ELSE 'Accepted' END
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (booking_id) DO NOTHING;
INSERT INTO patient_registrations (
  case_id, patient_name, patient_email, age, concern, intake_time, booked_time, status, assigned_to
)
SELECT
  'REG-E2E-' || (1000 + gs.i)::text,
  'Registration Patient ' || gs.i::text,
  'reg' || gs.i::text || '@clinic.test',
  22 + gs.i,
  'Registration concern ' || gs.i::text,
  NOW() - ((12 - gs.i) * INTERVAL '30 minute'),
  NOW() - ((12 - gs.i) * INTERVAL '20 minute'),
  CASE WHEN gs.i % 4 = 0 THEN 'Active' WHEN gs.i % 3 = 0 THEN 'Review' ELSE 'Pending' END,
  CASE WHEN gs.i % 2 = 0 THEN 'Nurse Triage' ELSE 'Dr. Humour' END
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (case_id) DO NOTHING;
INSERT INTO patient_walkins (
  case_id, patient_name, age, sex, date_of_birth, contact, address, emergency_contact, patient_ref,
  visit_department, checkin_time, pain_scale, temperature_c, blood_pressure, pulse_bpm, weight_kg,
  chief_complaint, severity, intake_time, assigned_doctor, status
)
SELECT
  'WALK-E2E-' || (100 + gs.i)::text,
  'WalkIn Patient ' || gs.i::text,
  18 + gs.i,
  CASE WHEN gs.i % 2 = 0 THEN 'Female' ELSE 'Male' END,
  (CURRENT_DATE - ((18 + gs.i) * INTERVAL '1 year'))::date,
  '0920-777-' || LPAD(gs.i::text, 4, '0'),
  'E2E Address ' || gs.i::text,
  '0918-333-' || LPAD(gs.i::text, 4, '0'),
  'PAT-E2E-' || (3000 + gs.i)::text,
  CASE WHEN gs.i % 4 = 0 THEN 'ER' ELSE 'General OPD' END,
  NOW() - ((11 - gs.i) * INTERVAL '15 minute'),
  gs.i % 10,
  36.4 + (gs.i::numeric / 10),
  '12' || gs.i::text || '/8' || gs.i::text,
  70 + gs.i,
  50 + gs.i,
  'Walk-in complaint ' || gs.i::text,
  CASE WHEN gs.i % 5 = 0 THEN 'Emergency' WHEN gs.i % 2 = 0 THEN 'Moderate' ELSE 'Low' END,
  NOW() - ((11 - gs.i) * INTERVAL '15 minute'),
  CASE WHEN gs.i % 5 = 0 THEN 'ER Team' ELSE 'Nurse Triage' END,
  CASE
    WHEN gs.i % 5 = 0 THEN 'emergency'
    WHEN gs.i % 4 = 0 THEN 'waiting_for_doctor'
    WHEN gs.i % 3 = 0 THEN 'in_triage'
    WHEN gs.i % 2 = 0 THEN 'triage_pending'
    ELSE 'waiting'
  END
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (case_id) DO NOTHING;
INSERT INTO checkup_visits (
  visit_id, patient_name, assigned_doctor, source, status, chief_complaint, diagnosis, clinical_notes,
  consultation_started_at, lab_requested, lab_result_ready, prescription_created, prescription_dispensed,
  follow_up_date, is_emergency, version
)
SELECT
  'VISIT-E2E-' || (2100 + gs.i)::text,
  'Checkup Patient ' || gs.i::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Dr. Jenni' ELSE 'Unassigned' END,
  CASE WHEN gs.i % 2 = 0 THEN 'appointment_confirmed' ELSE 'walkin_triage_completed' END,
  CASE
    WHEN gs.i % 5 = 0 THEN 'completed'
    WHEN gs.i % 4 = 0 THEN 'pharmacy'
    WHEN gs.i % 3 = 0 THEN 'lab_requested'
    WHEN gs.i % 2 = 0 THEN 'in_consultation'
    ELSE 'queue'
  END,
  'Checkup complaint ' || gs.i::text,
  'Initial diagnosis ' || gs.i::text,
  'Clinical notes ' || gs.i::text,
  NOW() - ((10 - gs.i) * INTERVAL '1 hour'),
  CASE WHEN gs.i % 3 = 0 THEN 1 ELSE 0 END,
  CASE WHEN gs.i % 5 = 0 THEN 1 ELSE 0 END,
  CASE WHEN gs.i % 4 = 0 THEN 1 ELSE 0 END,
  CASE WHEN gs.i % 5 = 0 THEN 1 ELSE 0 END,
  (CURRENT_DATE + (gs.i % 7) * INTERVAL '1 day')::date,
  CASE WHEN gs.i % 7 = 0 THEN 1 ELSE 0 END,
  1
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (visit_id) DO NOTHING;
INSERT INTO laboratory_requests (
  request_code, visit_id, patient_id, patient_name, age, sex, category, priority, status, requested_at,
  requested_by_doctor, doctor_department, clinical_notes, specimen_type, sample_source, collection_datetime,
  clinical_diagnosis, lab_instructions, insurance_reference, billing_reference, assigned_lab_staff,
  sample_collected, sample_collected_at, processing_started_at, result_encoded_at, result_reference_range,
  verified_by, verified_at, rejection_reason, resample_flag, released_at, raw_attachment_name, encoded_values
)
SELECT
  'LAB-E2E-' || (1300 + gs.i)::text,
  'VISIT-E2E-' || (2100 + gs.i)::text,
  'PAT-E2E-' || (3000 + gs.i)::text,
  'Lab Patient ' || gs.i::text,
  21 + gs.i,
  CASE WHEN gs.i % 2 = 0 THEN 'Female' ELSE 'Male' END,
  CASE WHEN gs.i % 3 = 0 THEN 'Urinalysis' ELSE 'Blood Test' END,
  CASE WHEN gs.i % 4 = 0 THEN 'Urgent' ELSE 'Normal' END,
  CASE WHEN gs.i % 5 = 0 THEN 'Completed' WHEN gs.i % 3 = 0 THEN 'Result Ready' WHEN gs.i % 2 = 0 THEN 'In Progress' ELSE 'Pending' END,
  NOW() - ((10 - gs.i) * INTERVAL '2 hour'),
  CASE WHEN gs.i % 2 = 0 THEN 'Dr. Humour' ELSE 'Dr. Jenni' END,
  'General Medicine',
  'Lab notes ' || gs.i::text,
  CASE WHEN gs.i % 3 = 0 THEN 'Urine' ELSE 'Whole Blood' END,
  CASE WHEN gs.i % 3 = 0 THEN 'Urine' ELSE 'Blood' END,
  NOW() - ((9 - gs.i) * INTERVAL '90 minute'),
  'Clinical diagnosis ' || gs.i::text,
  'Instruction ' || gs.i::text,
  'INS-' || gs.i::text,
  'BILL-LAB-' || (1300 + gs.i)::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Tech Anne' ELSE 'Tech Mark' END,
  CASE WHEN gs.i % 2 = 0 THEN 1 ELSE 0 END,
  CASE WHEN gs.i % 2 = 0 THEN NOW() - ((8 - gs.i) * INTERVAL '80 minute') ELSE NULL END,
  CASE WHEN gs.i % 2 = 0 THEN NOW() - ((7 - gs.i) * INTERVAL '70 minute') ELSE NULL END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN NOW() - ((6 - gs.i) * INTERVAL '60 minute') ELSE NULL END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN 'Reference range text' ELSE '' END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN 'Tech Anne' ELSE '' END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN NOW() - ((5 - gs.i) * INTERVAL '50 minute') ELSE NULL END,
  '',
  0,
  CASE WHEN gs.i % 5 = 0 THEN NOW() - ((4 - gs.i) * INTERVAL '40 minute') ELSE NULL END,
  '',
  '{}'::jsonb
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (request_code) DO NOTHING;

INSERT INTO laboratory_request_tests (request_id, test_name, specimen_required)
SELECT lr.id, test_data.test_name, test_data.specimen_required
FROM laboratory_requests lr
JOIN (
  VALUES
    ('LAB-E2E-1301', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1301', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1302', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1302', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1303', 'Urinalysis Routine', 'Urine'),
    ('LAB-E2E-1303', 'Microscopy', 'Urine'),
    ('LAB-E2E-1304', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1304', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1305', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1305', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1306', 'Urinalysis Routine', 'Urine'),
    ('LAB-E2E-1306', 'Microscopy', 'Urine'),
    ('LAB-E2E-1307', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1307', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1308', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1308', 'Lipid Panel', 'Serum'),
    ('LAB-E2E-1309', 'Urinalysis Routine', 'Urine'),
    ('LAB-E2E-1309', 'Microscopy', 'Urine'),
    ('LAB-E2E-1310', 'Complete Blood Count (CBC)', 'Whole Blood'),
    ('LAB-E2E-1310', 'Lipid Panel', 'Serum')
) AS test_data(request_code, test_name, specimen_required)
  ON test_data.request_code = lr.request_code
ON CONFLICT (request_id, test_name) DO NOTHING;

INSERT INTO laboratory_activity_logs (request_id, action, details, actor, created_at)
SELECT
  lr.id,
  'Seed Activity',
  'Seeded activity log for request ' || lr.request_code,
  CASE WHEN gs.i % 2 = 0 THEN 'Tech Anne' ELSE 'Tech Mark' END,
  NOW() - ((10 - gs.i) * INTERVAL '1 hour')
FROM generate_series(1, 10) AS gs(i)
JOIN laboratory_requests lr
  ON lr.request_code = 'LAB-E2E-' || (1300 + gs.i)::text
ON CONFLICT DO NOTHING;
INSERT INTO pharmacy_medicines (
  medicine_code, sku, medicine_name, brand_name, generic_name, category, medicine_type, dosage_strength, unit_of_measure,
  supplier_name, purchase_cost, selling_price, batch_lot_no, manufacturing_date, expiry_date, storage_requirements,
  reorder_level, low_stock_threshold, stock_capacity, stock_on_hand, stock_location, barcode, is_archived
)
SELECT
  'MED-E2E-' || (500 + gs.i)::text,
  'SKU-E2E-' || (500 + gs.i)::text,
  'Medicine ' || gs.i::text,
  'Brand ' || gs.i::text,
  'Generic ' || gs.i::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Tablet' ELSE 'Capsule' END,
  CASE WHEN gs.i % 3 = 0 THEN 'Cardio' ELSE 'General' END,
  CASE WHEN gs.i % 2 = 0 THEN '500mg' ELSE '250mg' END,
  'tabs',
  CASE WHEN gs.i % 2 = 0 THEN 'MediCore Supply' ELSE 'Healix Pharma' END,
  5 + gs.i,
  8 + gs.i,
  'BATCH-E2E-' || gs.i::text,
  CURRENT_DATE - (300 + gs.i),
  CURRENT_DATE + (300 + gs.i),
  'Store below 25C',
  20,
  20,
  200,
  30 + gs.i,
  'Warehouse A / Shelf ' || gs.i::text,
  '48000999' || LPAD(gs.i::text, 4, '0'),
  0
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (sku) DO NOTHING;
INSERT INTO mental_health_patients (patient_id, patient_name, date_of_birth, sex, contact_number, guardian_contact)
SELECT
  'MHP-E2E-' || (700 + gs.i)::text,
  'MH Patient ' || gs.i::text,
  (CURRENT_DATE - ((20 + gs.i) * INTERVAL '1 year'))::date,
  CASE WHEN gs.i % 2 = 0 THEN 'Female' ELSE 'Male' END,
  '0930-111-' || LPAD(gs.i::text, 4, '0'),
  'Guardian ' || gs.i::text
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (patient_id) DO NOTHING;
INSERT INTO mental_health_sessions (
  case_reference, patient_id, patient_name, counselor, session_type, status, risk_level,
  diagnosis_condition, treatment_plan, session_goals, session_duration_minutes, session_mode, location_room,
  guardian_contact, emergency_contact, medication_reference, follow_up_frequency, escalation_reason, outcome_result,
  assessment_score, assessment_tool, appointment_at, next_follow_up_at, created_by_role, is_draft
)
SELECT
  'MHS-E2E-' || (800 + gs.i)::text,
  'MHP-E2E-' || (700 + gs.i)::text,
  'MH Patient ' || gs.i::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Dr. Rivera' ELSE 'Dr. Molina' END,
  CASE WHEN gs.i % 2 = 0 THEN 'Counseling' ELSE 'Assessment' END,
  CASE
    WHEN gs.i % 6 = 0 THEN 'escalated'
    WHEN gs.i % 5 = 0 THEN 'completed'
    WHEN gs.i % 4 = 0 THEN 'at_risk'
    WHEN gs.i % 3 = 0 THEN 'follow_up'
    ELSE 'active'
  END,
  CASE WHEN gs.i % 4 = 0 OR gs.i % 6 = 0 THEN 'high' WHEN gs.i % 3 = 0 THEN 'medium' ELSE 'low' END,
  'Diagnosis ' || gs.i::text,
  'Treatment plan ' || gs.i::text,
  'Session goal ' || gs.i::text,
  45,
  CASE WHEN gs.i % 2 = 0 THEN 'in_person' ELSE 'online' END,
  'Room ' || gs.i::text,
  'Guardian ' || gs.i::text,
  '0910-222-' || LPAD(gs.i::text, 4, '0'),
  'Medication ref ' || gs.i::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Weekly' ELSE 'Bi-weekly' END,
  CASE WHEN gs.i % 6 = 0 THEN 'Escalation due to high-risk indicators.' ELSE NULL END,
  CASE WHEN gs.i % 5 = 0 THEN 'Improved symptoms' ELSE '' END,
  10 + gs.i,
  'PHQ-9',
  NOW() - ((10 - gs.i) * INTERVAL '1 day'),
  NOW() + ((gs.i % 7) * INTERVAL '1 day'),
  'Admin',
  0
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (case_reference) DO NOTHING;
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

-- Cashier flow verification test seeds
INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
VALUES
  ('2026-9001', 'Verify Eligible Student', 'BS Information Technology', '3rd Year', 'verify.eligible@student.local', '09170009001', 'active'),
  ('2026-9002', 'Already Settled Student', 'BS Office Administration', '2nd Year', 'verify.settled@student.local', '09170009002', 'active'),
  ('2024-0091', 'Clara Verify Search', 'BS Information Systems', '2nd Year', 'clara.verify@example.com', '09170000091', 'active'),
  ('2024-0092', 'Noah Billing Finder', 'BS Accountancy', '1st Year', 'noah.finder@example.com', '09170000092', 'active')
ON CONFLICT (student_no) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  course = EXCLUDED.course,
  year_level = EXCLUDED.year_level,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status;

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
)
SELECT s.id, 'BILL-VERIFY-1001', '2nd Semester', '2025-2026', 12000.00, 0.00, 12000.00, 'pending_payment', 'student_portal_billing', NOW(), NOW()
FROM students s
WHERE s.student_no = '2026-9001'
ON CONFLICT (billing_code) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  total_amount = EXCLUDED.total_amount,
  paid_amount = EXCLUDED.paid_amount,
  balance_amount = EXCLUDED.balance_amount,
  billing_status = EXCLUDED.billing_status,
  workflow_stage = EXCLUDED.workflow_stage,
  updated_at = NOW();

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
)
SELECT s.id, 'BILL-VERIFY-1002', '2nd Semester', '2025-2026', 11080.00, 11080.00, 0.00, 'paid', 'student_portal_billing', NOW(), NOW()
FROM students s
WHERE s.student_no = '2026-9002'
ON CONFLICT (billing_code) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  total_amount = EXCLUDED.total_amount,
  paid_amount = EXCLUDED.paid_amount,
  balance_amount = EXCLUDED.balance_amount,
  billing_status = EXCLUDED.billing_status,
  workflow_stage = EXCLUDED.workflow_stage,
  updated_at = NOW();

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
)
SELECT s.id, 'BILL-VERIFY-2001', '2nd Semester', '2025-2026', 13250.00, 0.00, 13250.00, 'pending_payment', 'student_portal_billing', NOW(), NOW()
FROM students s
WHERE s.student_no = '2024-0091'
ON CONFLICT (billing_code) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  total_amount = EXCLUDED.total_amount,
  paid_amount = EXCLUDED.paid_amount,
  balance_amount = EXCLUDED.balance_amount,
  billing_status = EXCLUDED.billing_status,
  workflow_stage = EXCLUDED.workflow_stage,
  updated_at = NOW();

INSERT INTO billing_records (
  student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
)
SELECT s.id, 'BILL-VERIFY-2002', '2nd Semester', '2025-2026', 9875.00, 0.00, 9875.00, 'pending_payment', 'student_portal_billing', NOW(), NOW()
FROM students s
WHERE s.student_no = '2024-0092'
ON CONFLICT (billing_code) DO UPDATE SET
  student_id = EXCLUDED.student_id,
  total_amount = EXCLUDED.total_amount,
  paid_amount = EXCLUDED.paid_amount,
  balance_amount = EXCLUDED.balance_amount,
  billing_status = EXCLUDED.billing_status,
  workflow_stage = EXCLUDED.workflow_stage,
  updated_at = NOW();

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', 8400.00, 1, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-1001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'TUITION'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'MISC', 'Miscellaneous Fee', 'Assessment', 2200.00, 2, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-1001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'MISC'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'PORTAL', 'Portal and Service Fee', 'Services', 1400.00, 3, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-1001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'PORTAL'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', 8900.00, 1, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'TUITION'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'LAB', 'Laboratory Fee', 'Laboratory', 2450.00, 2, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'LAB'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'MISC', 'Miscellaneous Fee', 'Assessment', 1900.00, 3, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2001'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'MISC'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', 6400.00, 1, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2002'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'TUITION'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'REGISTRATION', 'Registration Fee', 'Services', 1475.00, 2, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2002'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'REGISTRATION'
  );

INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
SELECT b.id, 'FOUNDATION', 'Foundation Fee', 'Institutional', 2000.00, 3, NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-2002'
  AND NOT EXISTS (
    SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'FOUNDATION'
  );

INSERT INTO payment_transactions (
  billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage, payment_date, processed_by, remarks, created_at
)
SELECT b.id, 'PAY-VERIFY-1002', 11080.00, 'Online', 'paid', 'logged', 'payment_processing_gateway', NOW(), NULL, 'Settled seed payment.', NOW()
FROM billing_records b
WHERE b.billing_code = 'BILL-VERIFY-1002'
ON CONFLICT (reference_number) DO UPDATE SET
  billing_id = EXCLUDED.billing_id,
  amount_paid = EXCLUDED.amount_paid,
  payment_status = EXCLUDED.payment_status,
  reporting_status = EXCLUDED.reporting_status,
  workflow_stage = EXCLUDED.workflow_stage,
  payment_date = EXCLUDED.payment_date,
  remarks = EXCLUDED.remarks;

INSERT INTO receipt_records (
  payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, created_at
)
SELECT p.id, 'RCPT-VERIFY-1002', NOW(), 'generated', 'compliance_documentation', 'Seed receipt for cashier flow testing.', NOW()
FROM payment_transactions p
WHERE p.reference_number = 'PAY-VERIFY-1002'
ON CONFLICT (receipt_number) DO UPDATE SET
  payment_id = EXCLUDED.payment_id,
  issued_date = EXCLUDED.issued_date,
  receipt_status = EXCLUDED.receipt_status,
  workflow_stage = EXCLUDED.workflow_stage,
  remarks = EXCLUDED.remarks;

COMMIT;
