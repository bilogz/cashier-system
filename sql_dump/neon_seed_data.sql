-- Neon PostgreSQL seed data for admin_template
-- Run after base schema: database/neon_required_schema.sql

BEGIN;

-- Ensure one admin user exists
INSERT INTO users (full_name, username, email, role, status, password_hash)
VALUES
  ('Nexora Admin', 'joecelgarcia1@gmail.com', 'joecelgarcia1@gmail.com', 'Admin', 'active', '$2y$10$1Su2MrWqY7kpP0UNS9Wm5uEku5Q48sI2ud0fDPAQ2rygb5n6mCIY6')
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_settings (user_id, theme, language, notifications_enabled)
SELECT id, 'light', 'en', TRUE
FROM users
WHERE email = 'joecelgarcia1@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO user_social (user_id, facebook, linkedin, website)
SELECT id, NULL, NULL, 'https://nexora.example.com'
FROM users
WHERE email = 'joecelgarcia1@gmail.com'
ON CONFLICT (user_id) DO NOTHING;

-- Patients used by dashboard/recent patient blocks
INSERT INTO patients (patient_id, full_name, first_name, last_name, gender)
VALUES
  ('PAT-1001', 'Maria Santos', 'Maria', 'Santos', 'Female'),
  ('PAT-1002', 'John Reyes', 'John', 'Reyes', 'Male'),
  ('PAT-1003', 'Emma Tan', 'Emma', 'Tan', 'Female'),
  ('PAT-1004', 'Alex Chua', 'Alex', 'Chua', 'Male'),
  ('PAT-1005', 'Lara Gomez', 'Lara', 'Gomez', 'Female')
ON CONFLICT (patient_id) DO NOTHING;

-- Appointments used by admin appointments module
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS patient_id VARCHAR(60) NULL;
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(120) NULL;
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR(120) NULL;
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40) NULL;
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS appointment_priority VARCHAR(20) NOT NULL DEFAULT 'Routine';
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS symptoms_summary TEXT NULL;
ALTER TABLE patient_appointments ADD COLUMN IF NOT EXISTS doctor_notes TEXT NULL;

INSERT INTO patient_appointments (
  booking_id, patient_id, patient_name, patient_age, patient_email, patient_gender, phone_number,
  emergency_contact, insurance_provider, payment_method, appointment_priority, symptoms_summary, doctor_notes,
  doctor_name, department_name, visit_type, appointment_date, preferred_time, visit_reason, status
)
VALUES
  ('APT-2026-1001', 'MRN-1001', 'Maria Santos', 34, 'maria.santos@example.com', 'Female', '09171234567', '09170001111', 'MaxiCare', 'Card', 'Routine', 'Fever, Cough', 'Monitor CBC result before consult', 'Dr. A. Rivera', 'General Medicine', 'General Check-Up', CURRENT_DATE + INTERVAL '1 day', '10:00 AM', 'Routine check-up', 'Confirmed'),
  ('APT-2026-1002', 'MRN-1002', 'John Reyes', 39, 'john.reyes@example.com', 'Male', '09182345678', '09180002222', 'Intellicare', 'HMO', 'Urgent', 'Chest Pain, Dizziness', 'Prioritize ECG review', 'Dr. A. Rivera', 'Laboratory', 'Laboratory Test', CURRENT_DATE + INTERVAL '1 day', '11:30 AM', 'Requested CBC panel', 'Pending'),
  ('APT-2026-1003', 'MRN-1003', 'Emma Tan', 28, 'emma.tan@example.com', 'Female', '09193456789', NULL, NULL, 'Online', 'Routine', 'Anxiety, Insomnia', 'Follow-up mental health assessment', 'Dr. S. Villaraza', 'Mental Health', 'Mental Health Counseling', CURRENT_DATE + INTERVAL '2 day', '09:00 AM', 'Follow-up counseling', 'Accepted'),
  ('APT-2026-1004', NULL, 'Alex Chua', 41, 'alex.chua@example.com', 'Male', '09204567890', '09200004444', NULL, 'Cash', 'Urgent', 'Headache, Fatigue', 'Rule out hypertension', 'Dr. B. Martinez', 'Check-Up', 'Walk-in Consultation', CURRENT_DATE, '02:00 PM', 'Headache and fatigue', 'Awaiting'),
  ('APT-2026-1005', NULL, 'Lara Gomez', 31, 'lara.gomez@example.com', 'Female', '09215678901', NULL, 'Medicard', 'Card', 'Routine', NULL, NULL, 'Dr. B. Martinez', 'General Medicine', 'General Check-Up', CURRENT_DATE - INTERVAL '1 day', '01:00 PM', 'Rescheduled visit', 'Canceled')
ON CONFLICT (booking_id) DO NOTHING;

-- Notifications for topbar badge
INSERT INTO notifications (user_id, title, body, is_read)
SELECT u.id, n.title, n.body, n.is_read
FROM users u
CROSS JOIN (
  VALUES
    ('Appointment Queue', 'Two pending appointments need review.', FALSE),
    ('Inventory Alert', 'Low stock alert: Omeprazole below threshold.', FALSE),
    ('Daily Summary', 'Dashboard metrics generated successfully.', TRUE)
) AS n(title, body, is_read)
WHERE u.email = 'joecelgarcia1@gmail.com'
  AND NOT EXISTS (
    SELECT 1
    FROM notifications existing
    WHERE existing.user_id = u.id
      AND existing.title = n.title
      AND existing.body = n.body
  );

-- Activity logs sample
INSERT INTO activity_logs (actor_user_id, actor_role, action, module, entity_type, entity_id, metadata, ip_address, user_agent)
SELECT
  u.id,
  'Admin',
  x.action,
  x.module,
  x.entity_type,
  x.entity_id,
  x.metadata::jsonb,
  '127.0.0.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
FROM users u
CROSS JOIN (
  VALUES
    ('LOGIN', 'auth', 'session', 'admin', '{"source":"web"}'),
    ('VIEW_APPOINTMENTS', 'appointments', 'page', 'appointments', '{"filter":"upcoming"}'),
    ('UPDATE_APPOINTMENT', 'appointments', 'appointment', 'APT-2026-1002', '{"status":"Pending"}')
) AS x(action, module, entity_type, entity_id, metadata)
WHERE u.email = 'joecelgarcia1@gmail.com'
  AND NOT EXISTS (
    SELECT 1
    FROM activity_logs l
    WHERE l.actor_user_id = u.id
      AND l.action = x.action
      AND l.module = x.module
      AND l.entity_id = x.entity_id
  );

COMMIT;
