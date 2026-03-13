-- Neon PostgreSQL schema + seed data for Pharmacy & Inventory module
-- Workflow: Add -> Stock -> Restock -> Dispense -> Adjust -> History

BEGIN;

CREATE TABLE IF NOT EXISTS pharmacy_medicines (
  id BIGSERIAL PRIMARY KEY,
  medicine_code VARCHAR(40) NOT NULL UNIQUE,
  sku VARCHAR(60) NOT NULL UNIQUE,
  medicine_name VARCHAR(150) NOT NULL,
  brand_name VARCHAR(150) NOT NULL,
  generic_name VARCHAR(150) NOT NULL,
  category VARCHAR(50) NOT NULL,
  medicine_type VARCHAR(80) NOT NULL,
  dosage_strength VARCHAR(60) NOT NULL,
  unit_of_measure VARCHAR(30) NOT NULL,
  supplier_name VARCHAR(120) NOT NULL,
  purchase_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  batch_lot_no VARCHAR(80) NOT NULL,
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
);

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
);

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
);

CREATE TABLE IF NOT EXISTS pharmacy_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  module VARCHAR(40) NOT NULL DEFAULT 'pharmacy_inventory',
  action VARCHAR(80) NOT NULL,
  detail TEXT NOT NULL,
  actor VARCHAR(120) NOT NULL,
  tone VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (tone IN ('success', 'warning', 'info', 'error')),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_name ON pharmacy_medicines(medicine_name);
CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_stock ON pharmacy_medicines(stock_on_hand);
CREATE INDEX IF NOT EXISTS idx_pharmacy_medicines_expiry ON pharmacy_medicines(expiry_date);
CREATE INDEX IF NOT EXISTS idx_pharmacy_dispense_status ON pharmacy_dispense_requests(status);
CREATE INDEX IF NOT EXISTS idx_pharmacy_movements_med ON pharmacy_stock_movements(medicine_id, created_at DESC);

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

COMMIT;
