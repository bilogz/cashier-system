-- Neon PostgreSQL end-to-end seed data
-- Run after the application has initialized tables via Vite API middleware.

BEGIN;

-- 1) Appointments (10)
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

-- 2) Registrations (10)
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

-- 3) Walk-ins (10)
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

-- 4) Check-up visits (10)
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
  (gs.i % 3 = 0),
  (gs.i % 5 = 0),
  (gs.i % 4 = 0),
  (gs.i % 5 = 0),
  (CURRENT_DATE + (gs.i % 7) * INTERVAL '1 day')::date,
  (gs.i % 7 = 0),
  1
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (visit_id) DO NOTHING;

-- 5) Laboratory requests (10)
INSERT INTO laboratory_requests (
  request_id, visit_id, patient_id, patient_name, age, sex, category, priority, status, requested_at,
  requested_by_doctor, doctor_department, notes, tests, specimen_type, sample_source, collection_date_time,
  clinical_diagnosis, lab_instructions, insurance_reference, billing_reference, assigned_lab_staff,
  sample_collected, sample_collected_at, processing_started_at, result_encoded_at, result_reference_range,
  verified_by, verified_at, rejection_reason, resample_flag, released_at, raw_attachment_name, encoded_values
)
SELECT
  1300 + gs.i,
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
  CASE WHEN gs.i % 3 = 0 THEN ARRAY['Urinalysis Routine', 'Microscopy'] ELSE ARRAY['Complete Blood Count (CBC)', 'Lipid Panel'] END,
  CASE WHEN gs.i % 3 = 0 THEN 'Urine' ELSE 'Whole Blood' END,
  CASE WHEN gs.i % 3 = 0 THEN 'Urine' ELSE 'Blood' END,
  NOW() - ((9 - gs.i) * INTERVAL '90 minute'),
  'Clinical diagnosis ' || gs.i::text,
  'Instruction ' || gs.i::text,
  'INS-' || gs.i::text,
  'BILL-LAB-' || (1300 + gs.i)::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Tech Anne' ELSE 'Tech Mark' END,
  (gs.i % 2 = 0),
  CASE WHEN gs.i % 2 = 0 THEN NOW() - ((8 - gs.i) * INTERVAL '80 minute') ELSE NULL END,
  CASE WHEN gs.i % 2 = 0 THEN NOW() - ((7 - gs.i) * INTERVAL '70 minute') ELSE NULL END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN NOW() - ((6 - gs.i) * INTERVAL '60 minute') ELSE NULL END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN 'Reference range text' ELSE '' END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN 'Tech Anne' ELSE '' END,
  CASE WHEN gs.i % 3 = 0 OR gs.i % 5 = 0 THEN NOW() - ((5 - gs.i) * INTERVAL '50 minute') ELSE NULL END,
  '',
  FALSE,
  CASE WHEN gs.i % 5 = 0 THEN NOW() - ((4 - gs.i) * INTERVAL '40 minute') ELSE NULL END,
  '',
  '{}'::jsonb
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (request_id) DO NOTHING;

INSERT INTO laboratory_activity_logs (request_id, action, details, actor, created_at)
SELECT
  1300 + gs.i,
  'Seed Activity',
  'Seeded activity log for request ' || (1300 + gs.i)::text,
  CASE WHEN gs.i % 2 = 0 THEN 'Tech Anne' ELSE 'Tech Mark' END,
  NOW() - ((10 - gs.i) * INTERVAL '1 hour')
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT DO NOTHING;

-- 6) Pharmacy medicines (10)
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
  FALSE
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (sku) DO NOTHING;

-- 7) Pharmacy dispense requests (10)
WITH med AS (
  SELECT id, medicine_name, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM pharmacy_medicines
  WHERE is_archived = FALSE
  LIMIT 10
)
INSERT INTO pharmacy_dispense_requests (
  request_code, medicine_id, patient_name, quantity, notes, prescription_reference, dispense_reason, status, requested_at, fulfilled_at, fulfilled_by
)
SELECT
  'RX-E2E-' || (900 + m.rn)::text,
  m.id,
  'Pharmacy Patient ' || m.rn::text,
  1 + (m.rn % 4),
  'Dose note ' || m.rn::text,
  'PRX-' || (1000 + m.rn)::text,
  'Dispense reason ' || m.rn::text,
  CASE WHEN m.rn % 3 = 0 THEN 'Fulfilled' ELSE 'Pending' END,
  NOW() - ((10 - m.rn) * INTERVAL '1 hour'),
  CASE WHEN m.rn % 3 = 0 THEN NOW() - ((9 - m.rn) * INTERVAL '40 minute') ELSE NULL END,
  CASE WHEN m.rn % 3 = 0 THEN 'Pharmacist Ana' ELSE NULL END
FROM med m
ON CONFLICT (request_code) DO NOTHING;

-- 8) Mental health patients (10)
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

-- 9) Mental health sessions (10)
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
  FALSE
FROM generate_series(1, 10) AS gs(i)
ON CONFLICT (case_reference) DO NOTHING;

COMMIT;
