import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createDbPool } from './db.mjs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env.server') });
dotenv.config();

const app = express();
const port = Number(process.env.API_PORT || process.env.PORT || 3001);
const frontendOrigins = String(process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const sessionCookieName = 'cashier_admin_session';
const studentSessionCookieName = 'cashier_student_session';
const sessionTtlMs = 1000 * 60 * 60 * 12;
const sessions = new Map();
const studentSessions = new Map();

const pool = createDbPool();

async function warmUpDbConnection() {
  let retries = 0;
  const maxRetries = 5;
  const baseDelayMs = 500;

  while (retries < maxRetries) {
    try {
      console.log(`[cashier] Warming up DB connection, attempt ${retries + 1}/${maxRetries}...`);
      // Perform a simple query to check connectivity
      await pool.query('SELECT 1');
      console.log('[cashier] DB connection warmed up successfully.');
      return;
    } catch (error) {
      retries++;
      const delay = baseDelayMs * Math.pow(2, retries - 1);
      console.error(`[cashier] DB warmup failed (attempt ${retries}):`, error.message);
      if (retries < maxRetries) {
        console.log(`[cashier] Retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        console.error('[cashier] Failed to warm up DB connection after multiple retries. Exiting.');
        process.exit(1);
      }
    }
  }
}

warmUpDbConnection();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const isConfiguredOrigin = frontendOrigins.includes(origin);
      const isLocalDevOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);

      if (isConfiguredOrigin || isLocalDevOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());

function sendOk(res, data, message) {
  res.json({
    ok: true,
    ...(message ? { message } : {}),
    data
  });
}

function sendError(res, status, message) {
  res.status(status).json({
    ok: false,
    message
  });
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value));
}

function formatRelativeMinutes(value) {
  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  const diffMinutes = Math.max(1, Math.round(diffMs / (1000 * 60)));
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

function parseAccessExemptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toAdminUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    department: row.department,
    accessExemptions: parseAccessExemptions(row.access_exemptions_json),
    isSuperAdmin: Boolean(row.is_super_admin)
  };
}

function cleanupSessionStore(store) {
  const now = Date.now();
  for (const [token, session] of store.entries()) {
    if (session.expiresAt <= now) store.delete(token);
  }
}

function cleanupSessions() {
  cleanupSessionStore(sessions);
  cleanupSessionStore(studentSessions);
}

async function getAdminById(id) {
  const [rows] = await pool.query(
    `SELECT id, username, email, full_name, role, department, access_exemptions_json, is_super_admin, status, phone, created_at, last_login_at
     FROM admin_users
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getAdminByUsername(username) {
  const [rows] = await pool.query(
    `SELECT id, username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone, created_at, last_login_at
     FROM admin_users
     WHERE username = ?
     LIMIT 1`,
    [username]
  );
  return rows[0] || null;
}

async function getStudentAccountByLogin(login) {
  const [rows] = await pool.query(
    `SELECT
        sa.id,
        sa.student_id,
        sa.username,
        sa.password_hash,
        sa.status,
        sa.created_at,
        s.student_no,
        s.full_name,
        s.course,
        s.year_level,
        s.email,
        s.phone
     FROM student_accounts sa
     INNER JOIN students s ON s.id = sa.student_id
     WHERE sa.username = ? OR s.student_no = ? OR s.email = ?
     LIMIT 1`,
    [login, login, login]
  );
  return rows[0] || null;
}

async function getStudentAccountById(id) {
  const [rows] = await pool.query(
    `SELECT
        sa.id,
        sa.student_id,
        sa.username,
        sa.password_hash,
        sa.status,
        sa.created_at,
        s.student_no,
        s.full_name,
        s.course,
        s.year_level,
        s.email,
        s.phone
     FROM student_accounts sa
     INNER JOIN students s ON s.id = sa.student_id
     WHERE sa.id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

function toStudentPortalUser(row) {
  return {
    id: Number(row.id),
    studentId: Number(row.student_id),
    username: row.username,
    studentNumber: row.student_no,
    fullName: row.full_name,
    program: row.course,
    yearLevel: row.year_level,
    email: row.email,
    phone: row.phone
  };
}

async function insertActivityLog(userId, action, description, ipAddress = '127.0.0.1', rawActionOverride = null) {
  await pool.query(
    `INSERT INTO admin_activity_logs (user_id, username, action, raw_action, description, ip_address, created_at)
     VALUES (?, COALESCE((SELECT username FROM admin_users WHERE id = ?), 'system'), ?, ?, ?, ?, ?)`,
    [userId, userId, action, rawActionOverride || action.toUpperCase().replace(/\s+/g, '_'), description, ipAddress, nowSql()]
  );
}

async function seedActivityLog(userId, action, rawAction, description, createdAtOffsetHours = 0) {
  const createdAt = new Date(Date.now() - createdAtOffsetHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  await pool.query(
    `INSERT INTO admin_activity_logs (user_id, username, action, raw_action, description, ip_address, created_at)
     SELECT ?, COALESCE((SELECT username FROM admin_users WHERE id = ?), 'system'), ?, ?, ?, '127.0.0.1', ?
     WHERE NOT EXISTS (
       SELECT 1
       FROM admin_activity_logs
       WHERE raw_action = ?
         AND description = ?
     )`,
    [userId, userId, action, rawAction, description, createdAt, rawAction, description]
  );
}

async function insertSystemNotification({
  recipientRole = 'cashier',
  recipientName = null,
  channel = 'in_app',
  type,
  title,
  message,
  entityType = null,
  entityId = null
}) {
  await pool.query(
    `INSERT INTO notifications (
      recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [recipientRole, recipientName, channel, type, title, message, entityType, entityId, nowSql()]
  );
}

async function insertAuditTrail({
  actorUser = null,
  moduleKey,
  entityType,
  entityId,
  action,
  beforeStatus = null,
  afterStatus = null,
  beforeStage = null,
  afterStage = null,
  remarks = null
}) {
  await pool.query(
    `INSERT INTO audit_logs (
      actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, before_stage, after_stage, remarks, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorUser?.id || null,
      actorUser?.full_name || actorUser?.username || null,
      actorUser?.role || null,
      moduleKey,
      entityType,
      entityId,
      action,
      beforeStatus,
      afterStatus,
      beforeStage,
      afterStage,
      remarks,
      nowSql()
    ]
  );
}

async function recordWorkflowEvent({
  actorUser = null,
  ipAddress = '127.0.0.1',
  rawAction = null,
  action,
  description,
  moduleKey,
  entityType,
  entityId,
  beforeStatus = null,
  afterStatus = null,
  beforeStage = null,
  afterStage = null,
  notification = null
}) {
  if (actorUser?.id) {
    await insertActivityLog(actorUser.id, action, description, ipAddress, rawAction);
  }

  await insertAuditTrail({
    actorUser,
    moduleKey,
    entityType,
    entityId,
    action,
    beforeStatus,
    afterStatus,
    beforeStage,
    afterStage,
    remarks: description
  });

  if (notification?.title && notification?.message) {
    await insertSystemNotification({
      recipientRole: notification.recipientRole || 'cashier',
      recipientName: notification.recipientName || null,
      channel: notification.channel || 'in_app',
      type: notification.type || 'workflow_update',
      title: notification.title,
      message: notification.message,
      entityType: notification.entityType || entityType || null,
      entityId: notification.entityId ?? entityId ?? null
    });
  }
}

async function countUnreadNotifications() {
  const [[row]] = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE is_read = 0`);
  return Number(row?.total || 0);
}

const WORKFLOW_STAGES = {
  STUDENT_PORTAL_BILLING: 'student_portal_billing',
  PAY_BILLS: 'pay_bills',
  PAYMENT_PROCESSING_GATEWAY: 'payment_processing_gateway',
  COMPLIANCE_DOCUMENTATION: 'compliance_documentation',
  REPORTING_RECONCILIATION: 'reporting_reconciliation',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

const WORKFLOW_STAGE_LABELS = {
  [WORKFLOW_STAGES.STUDENT_PORTAL_BILLING]: 'Student Portal & Billing',
  [WORKFLOW_STAGES.PAY_BILLS]: 'Pay Bills',
  [WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY]: 'Payment Processing & Gateway',
  [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION]: 'Compliance & Documentation',
  [WORKFLOW_STAGES.REPORTING_RECONCILIATION]: 'Reporting & Reconciliation',
  [WORKFLOW_STAGES.COMPLETED]: 'Completed',
  [WORKFLOW_STAGES.CANCELLED]: 'Cancelled'
};

const CASHIER_INTEGRATION_PROFILES = {
  registrar_enrollment: {
    key: 'registrar_enrollment',
    sourceModule: 'Registrar',
    sourceDepartment: 'Registrar',
    sourceCategory: 'Enrollment & Payment',
    originArtifacts: ['Student and billing info'],
    operationalArtifact: 'Payment status, official receipt records, and cleared / not cleared status',
    operationalTargetDepartment: 'Registrar',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports and cashier summaries',
    recipientRole: 'registrar',
    outcome: 'Enrollment validation'
  },
  hr_payroll: {
    key: 'hr_payroll',
    sourceModule: 'HR',
    sourceDepartment: 'HR Department',
    sourceCategory: 'Payroll',
    originArtifacts: ['Payroll data'],
    operationalArtifact: 'Payment status, official receipt records, and cleared / not cleared status',
    operationalTargetDepartment: 'HR Department',
    reportingDepartment: 'Admin Reports',
    reportingArtifact: 'Payroll financial reports',
    recipientRole: 'hr',
    outcome: 'Employee salary processing'
  },
  clinic_medical: {
    key: 'clinic_medical',
    sourceModule: 'Clinic',
    sourceDepartment: 'Clinic',
    sourceCategory: 'Medical Fees',
    originArtifacts: ['Medical fee assessment', 'Service charges'],
    operationalArtifact: 'Payment confirmation (medical fees)',
    operationalTargetDepartment: 'Clinic',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports',
    recipientRole: 'clinic',
    outcome: 'Medical clearance release'
  },
  pmed_reporting: {
    key: 'pmed_reporting',
    sourceModule: 'PMED',
    sourceDepartment: 'PMED Department',
    sourceCategory: 'Financial Reporting',
    originArtifacts: ['Financial report requests'],
    operationalArtifact: 'Financial reports',
    operationalTargetDepartment: 'PMED Department',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports',
    recipientRole: 'pmed',
    outcome: 'Planning, evaluation, and reporting'
  },
  admin_reporting: {
    key: 'admin_reporting',
    sourceModule: 'Admin Reports',
    sourceDepartment: 'Admin Reports',
    sourceCategory: 'Institutional Reporting',
    originArtifacts: ['Completed transaction report requests'],
    operationalArtifact: 'Official receipt records and cleared / not cleared status',
    operationalTargetDepartment: 'Admin Reports',
    reportingDepartment: 'Admin Reports',
    reportingArtifact: 'Completed transaction reports',
    recipientRole: 'admin',
    outcome: 'Audit, compliance, and executive reporting'
  },
  crad_activity: {
    key: 'crad_activity',
    sourceModule: 'CRAD',
    sourceDepartment: 'CRAD Department',
    sourceCategory: 'Activity Fees',
    originArtifacts: ['Activity fee list'],
    operationalArtifact: 'Payment confirmation',
    operationalTargetDepartment: 'CRAD Department',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports',
    recipientRole: 'crad',
    outcome: 'Activity fee clearance'
  },
  computer_lab: {
    key: 'computer_lab',
    sourceModule: 'Computer Laboratory',
    sourceDepartment: 'Computer Laboratory',
    sourceCategory: 'Laboratory Usage Fees',
    originArtifacts: ['Lab usage fees'],
    operationalArtifact: 'Payment confirmation',
    operationalTargetDepartment: 'Computer Laboratory',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports',
    recipientRole: 'computer_lab',
    outcome: 'Laboratory usage release'
  },
  prefect_fines: {
    key: 'prefect_fines',
    sourceModule: 'Prefect',
    sourceDepartment: 'Prefect Office',
    sourceCategory: 'Penalties & Fines',
    originArtifacts: ['Violation fines'],
    operationalArtifact: 'Payment confirmation',
    operationalTargetDepartment: 'Prefect Office',
    reportingDepartment: 'PMED Department',
    reportingArtifact: 'Financial reports',
    recipientRole: 'prefect',
    outcome: 'Fine settlement release'
  }
};

function cleanTextValue(value) {
  return String(value || '').trim();
}

function splitSchemaAndTable(identifier) {
  const normalized = cleanTextValue(identifier).replace(/"/g, '');
  if (!normalized) return { schema: 'public', table: '' };
  const [schema, table] = normalized.includes('.') ? normalized.split('.', 2) : ['public', normalized];
  return { schema, table };
}

async function tableExists(identifier) {
  const { schema, table } = splitSchemaAndTable(identifier);
  if (!table) return false;
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema = ?
       AND table_name = ?
     LIMIT 1`,
    [schema, table]
  );
  return Boolean(rows[0]);
}

async function findFirstExistingTable(candidates = []) {
  for (const candidate of candidates) {
    if (await tableExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function columnExists(identifier, columnName) {
  const { schema, table } = splitSchemaAndTable(identifier);
  if (!table) return false;
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = ?
       AND table_name = ?
       AND column_name = ?
     LIMIT 1`,
    [schema, table, cleanTextValue(columnName)]
  );
  return Boolean(rows[0]);
}

function compactIntegrationText(parts = []) {
  return parts
    .flat()
    .map((value) => cleanTextValue(value))
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

function resolveCashierIntegrationProfile(input = {}) {
  const billingCode = cleanTextValue(input.billingCode);
  const feeItems = Array.isArray(input.feeItems) ? input.feeItems : [];
  const explicitKey = cleanTextValue(input.integrationProfile);
  let profileKey = Object.prototype.hasOwnProperty.call(CASHIER_INTEGRATION_PROFILES, explicitKey)
    ? explicitKey
    : 'registrar_enrollment';

  if (!Object.prototype.hasOwnProperty.call(CASHIER_INTEGRATION_PROFILES, explicitKey)) {
    const text = compactIntegrationText([
      input.sourceModule,
      input.sourceDepartment,
      input.sourceCategory,
      input.targetDepartment,
      billingCode,
      feeItems.map((item) => [item.category, item.feeType, item.feeName, item.item_name, item.item_code, item.feeCode])
    ]);

    if (/(^|\W)(pmed|planning|evaluation|financial report|report request)(\W|$)/i.test(text)) profileKey = 'pmed_reporting';
    else if (/(^|\W)(admin report|admin reports|audit report|executive report|institutional report)(\W|$)/i.test(text)) profileKey = 'admin_reporting';
    else if (/(^|\W)(hr|human resource|payroll|salary|allowance|wage|disbursement)(\W|$)/i.test(text)) profileKey = 'hr_payroll';
    else if (/(^|\W)(clinic|medical|checkup|consult|clearance|service charge|laboratory service|health)(\W|$)/i.test(text)) profileKey = 'clinic_medical';
    else if (/(^|\W)(crad|activity|program fee|event fee)(\W|$)/i.test(text)) profileKey = 'crad_activity';
    else if (/(^|\W)(computer lab|computer laboratory|lab usage|laboratory usage)(\W|$)/i.test(text)) profileKey = 'computer_lab';
    else if (/(^|\W)(prefect|fine|penalty|violation|discipline)(\W|$)/i.test(text)) profileKey = 'prefect_fines';
    else profileKey = 'registrar_enrollment';
  }

  const profile = CASHIER_INTEGRATION_PROFILES[profileKey] || CASHIER_INTEGRATION_PROFILES.registrar_enrollment;
  const sourceModule = cleanTextValue(input.sourceModule) || profile.sourceModule;
  const sourceDepartment = cleanTextValue(input.sourceDepartment) || profile.sourceDepartment;
  const sourceCategory = cleanTextValue(input.sourceCategory) || profile.sourceCategory;
  const operationalTargetDepartment = cleanTextValue(input.targetDepartment) || profile.operationalTargetDepartment;
  const incomingArtifact = profile.originArtifacts.join(' + ');
  const operationalFlow = `${sourceDepartment} -> Cashier -> ${operationalTargetDepartment}`;
  const departmentFlow = `${sourceDepartment} -> Cashier -> ${profile.reportingDepartment}`;

  return {
    integrationProfile: profile.key,
    sourceModule,
    sourceDepartment,
    sourceCategory,
    operationalTargetDepartment,
    reportingDepartment: profile.reportingDepartment,
    incomingArtifact,
    operationalArtifact: profile.operationalArtifact,
    reportingArtifact: profile.reportingArtifact,
    operationalFlow,
    departmentFlow,
    integrationSummary: `${incomingArtifact} enters Cashier, ${profile.operationalArtifact.toLowerCase()} goes to ${operationalTargetDepartment}, and ${profile.reportingArtifact.toLowerCase()} goes to ${profile.reportingDepartment}.`,
    recipientRole: profile.recipientRole,
    outcome: profile.outcome
  };
}

function departmentShortCode(value) {
  const normalized = cleanTextValue(value).toLowerCase();
  if (normalized.includes('pmed')) return 'PMED';
  if (normalized.includes('registrar')) return 'REG';
  if (normalized.includes('hr')) return 'HR';
  if (normalized.includes('admin')) return 'ADMN';
  if (normalized.includes('clinic')) return 'CLIN';
  if (normalized.includes('crad')) return 'CRAD';
  if (normalized.includes('computer')) return 'LAB';
  if (normalized.includes('prefect')) return 'PREF';
  if (normalized.includes('cashier')) return 'CASH';
  return cleanTextValue(value).replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() || 'DEPT';
}

function resolveDepartmentRecipientRole(value) {
  const normalized = cleanTextValue(value).toLowerCase();
  if (normalized.includes('pmed')) return 'pmed';
  if (normalized.includes('registrar')) return 'registrar';
  if (normalized.includes('hr')) return 'hr';
  if (normalized.includes('admin')) return 'admin';
  if (normalized.includes('clinic')) return 'clinic';
  if (normalized.includes('crad')) return 'crad';
  if (normalized.includes('computer')) return 'computer_lab';
  if (normalized.includes('prefect')) return 'prefect';
  if (normalized.includes('cashier')) return 'cashier';
  return resolveCashierIntegrationProfile({ sourceDepartment: value }).recipientRole;
}

function nextDepartmentHandoffReference(targetDepartment, paymentId) {
  return `${departmentShortCode(targetDepartment)}-${new Date().getFullYear()}-${String(paymentId).padStart(5, '0')}`;
}

function buildDepartmentFlowGraph() {
  const edges = [
    { from: 'Registrar', to: 'Cashier', artifact: 'Student and billing info' },
    { from: 'Cashier', to: 'Registrar', artifact: 'Payment status' },
    { from: 'Cashier', to: 'Registrar', artifact: 'Official receipt records' },
    { from: 'Cashier', to: 'Registrar', artifact: 'Cleared / Not Cleared status' },
    { from: 'HR Department', to: 'Cashier', artifact: 'Payroll data' },
    { from: 'Cashier', to: 'HR Department', artifact: 'Payment status' },
    { from: 'Cashier', to: 'HR Department', artifact: 'Official receipt records' },
    { from: 'Cashier', to: 'HR Department', artifact: 'Cleared / Not Cleared status' },
    { from: 'Clinic', to: 'Cashier', artifact: 'Medical fee assessment' },
    { from: 'Clinic', to: 'Cashier', artifact: 'Service charges' },
    { from: 'Cashier', to: 'Clinic', artifact: 'Payment confirmation (medical fees)' },
    { from: 'PMED Department', to: 'Cashier', artifact: 'Financial report requests' },
    { from: 'Cashier', to: 'PMED Department', artifact: 'Payment status' },
    { from: 'Cashier', to: 'PMED Department', artifact: 'Official receipt records' },
    { from: 'Cashier', to: 'PMED Department', artifact: 'Cleared / Not Cleared status' },
    { from: 'Cashier', to: 'PMED Department', artifact: 'Financial reports' },
    { from: 'Computer Laboratory', to: 'Cashier', artifact: 'Lab fee assessment' },
    { from: 'Cashier', to: 'Computer Laboratory', artifact: 'Payment confirmation' },
    { from: 'Cashier', to: 'Admin Reports', artifact: 'Official receipt records' },
    { from: 'Cashier', to: 'Admin Reports', artifact: 'Cleared / Not Cleared status' },
    { from: 'Cashier', to: 'Admin Reports', artifact: 'Completed transaction reports' }
  ];

  return {
    nodes: Array.from(new Set(edges.flatMap((edge) => [edge.from, edge.to]))),
    edges
  };
}

function buildDepartmentServiceMatrix() {
  return [
    {
      department: 'Registrar',
      incomingToCashier: ['Student and billing info'],
      outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'],
      usage: 'Enrollment validation and student clearance release'
    },
    {
      department: 'PMED Department',
      incomingToCashier: ['Financial report requests'],
      outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status', 'Financial reports'],
      usage: 'Financial monitoring, planning, and evaluation'
    },
    {
      department: 'HR Department',
      incomingToCashier: ['Payroll data'],
      outgoingFromCashier: ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'],
      usage: 'Payroll validation and employee settlement tracking'
    },
    {
      department: 'Admin Reports',
      incomingToCashier: ['Completed transaction report requests'],
      outgoingFromCashier: ['Official receipt records', 'Cleared / Not Cleared status', 'Completed transaction reports'],
      usage: 'Audit, executive dashboards, and institutional reporting'
    }
  ];
}

function deriveCashierClearance(paymentStatus, receiptStatus) {
  const normalizedPayment = String(paymentStatus || '').toLowerCase();
  const normalizedReceipt = String(receiptStatus || '').toLowerCase();
  const hasSuccessfulPayment = ['paid', 'posted'].includes(normalizedPayment);
  const hasOfficialReceipt = ['generated', 'verified', 'completed', 'released'].includes(normalizedReceipt);

  if (hasSuccessfulPayment && hasOfficialReceipt) {
    return {
      status: 'Cleared',
      note: 'Payment is settled and an official receipt record is available.'
    };
  }

  if (hasSuccessfulPayment) {
    return {
      status: 'Not Cleared',
      note: 'Payment is posted, but the official receipt record is still pending.'
    };
  }

  if (['failed', 'cancelled'].includes(normalizedPayment)) {
    return {
      status: 'Not Cleared',
      note: 'The cashier payment did not complete successfully.'
    };
  }

  return {
    status: 'Not Cleared',
    note: 'Cashier is still processing the payment status for this record.'
  };
}

function normalizeWorkflowStage(value, fallback = WORKFLOW_STAGES.STUDENT_PORTAL_BILLING) {
  const raw = String(value || '').trim().toLowerCase();
  if (WORKFLOW_STAGE_LABELS[raw]) return raw;
  if (!raw) return fallback;
  if (raw === 'billing_verification' || raw === 'student portal & billing') return WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
  if (raw === 'manage_billing' || raw === 'pay bills') return WORKFLOW_STAGES.PAY_BILLS;
  if (raw === 'process_payment' || raw === 'payment processing & gateway') return WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY;
  if (raw === 'generate_receipt' || raw === 'compliance & documentation') return WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION;
  if (raw === 'reports' || raw === 'reporting & reconciliation') return WORKFLOW_STAGES.REPORTING_RECONCILIATION;
  return fallback;
}

function workflowStageLabel(stage) {
  return WORKFLOW_STAGE_LABELS[normalizeWorkflowStage(stage)] || 'Workflow';
}

function workflowModuleKey(stage) {
  const normalized = normalizeWorkflowStage(stage, WORKFLOW_STAGES.STUDENT_PORTAL_BILLING);
  if (normalized === WORKFLOW_STAGES.STUDENT_PORTAL_BILLING) return 'billing_verification';
  if (normalized === WORKFLOW_STAGES.PAY_BILLS) return 'manage_billing';
  if (normalized === WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY) return 'process_payment';
  if (normalized === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION) return 'generate_receipt';
  if (normalized === WORKFLOW_STAGES.REPORTING_RECONCILIATION) return 'reports';
  return 'reports';
}

function workflowCorrectionTarget(currentStage) {
  const normalized = normalizeWorkflowStage(currentStage, WORKFLOW_STAGES.STUDENT_PORTAL_BILLING);
  if (normalized === WORKFLOW_STAGES.PAY_BILLS) return WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
  if (normalized === WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY) return WORKFLOW_STAGES.PAY_BILLS;
  if (normalized === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION) return WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY;
  if (normalized === WORKFLOW_STAGES.REPORTING_RECONCILIATION) return WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION;
  return WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
}

function workflowCorrectionNotificationRole(stage) {
  const normalized = normalizeWorkflowStage(stage, WORKFLOW_STAGES.STUDENT_PORTAL_BILLING);
  if (normalized === WORKFLOW_STAGES.REPORTING_RECONCILIATION) return 'accounting';
  if (normalized === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION) return 'compliance';
  return 'cashier';
}

function resolveBillingWorkflowStage(rawStatus, balanceAmount, currentStage = null) {
  const status = String(rawStatus || '').toLowerCase();
  const normalizedCurrent = currentStage ? normalizeWorkflowStage(currentStage, '') : '';

  if (normalizedCurrent === WORKFLOW_STAGES.COMPLETED && status === 'archived') return WORKFLOW_STAGES.COMPLETED;
  if (
    Number(balanceAmount || 0) <= 0 &&
    [WORKFLOW_STAGES.STUDENT_PORTAL_BILLING, WORKFLOW_STAGES.PAY_BILLS].includes(normalizedCurrent)
  ) {
    return WORKFLOW_STAGES.COMPLETED;
  }
  if (status === 'draft' || status === 'unpaid' || status === 'updated') return WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
  if (['correction', 'rejected', 'on_hold'].includes(status)) return WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
  if (['verified', 'partial', 'failed'].includes(status)) return WORKFLOW_STAGES.PAY_BILLS;
  if (status === 'paid') return normalizedCurrent || WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY;
  if (status === 'archived' || Number(balanceAmount || 0) <= 0) return normalizedCurrent || WORKFLOW_STAGES.COMPLETED;
  return normalizedCurrent || WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
}

function resolvePaymentWorkflowStage(rawStatus, currentStage = null, reportingStatus = null) {
  const status = String(rawStatus || '').toLowerCase();
  const normalizedCurrent = currentStage ? normalizeWorkflowStage(currentStage, '') : '';
  const reporting = String(reportingStatus || '').toLowerCase();

  if (['processing', 'authorized', 'pending'].includes(status)) return WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY;
  if (status === 'failed' || status === 'cancelled') return WORKFLOW_STAGES.PAY_BILLS;
  if (status === 'refunded') return WORKFLOW_STAGES.CANCELLED;
  if (status === 'paid' || status === 'posted') {
    if (reporting === 'archived') return WORKFLOW_STAGES.COMPLETED;
    if (['reconciled', 'reported'].includes(reporting) || normalizedCurrent === WORKFLOW_STAGES.REPORTING_RECONCILIATION) {
      return WORKFLOW_STAGES.REPORTING_RECONCILIATION;
    }
    if (normalizedCurrent === WORKFLOW_STAGES.COMPLETED) return WORKFLOW_STAGES.COMPLETED;
    return normalizedCurrent === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
      ? WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
      : WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION;
  }
  return normalizedCurrent || WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY;
}

function resolveReceiptWorkflowStage(rawStatus, currentStage = null) {
  const status = String(rawStatus || '').toLowerCase();
  const normalizedCurrent = currentStage ? normalizeWorkflowStage(currentStage, '') : '';
  if (status === 'completed' || status === 'released') {
    if (normalizedCurrent === WORKFLOW_STAGES.COMPLETED) return WORKFLOW_STAGES.COMPLETED;
    return WORKFLOW_STAGES.REPORTING_RECONCILIATION;
  }
  if (status === 'cancelled') return WORKFLOW_STAGES.CANCELLED;
  return normalizedCurrent === WORKFLOW_STAGES.COMPLETED ? WORKFLOW_STAGES.COMPLETED : WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION;
}

function resolveReconciliationWorkflowStage(rawStatus, currentStage = null) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'archived') return WORKFLOW_STAGES.COMPLETED;
  if (status === 'cancelled') return WORKFLOW_STAGES.CANCELLED;
  return currentStage === WORKFLOW_STAGES.COMPLETED ? WORKFLOW_STAGES.COMPLETED : WORKFLOW_STAGES.REPORTING_RECONCILIATION;
}

function buildWorkflowActionPayload(message, status, workflowStage) {
  return {
    message,
    status,
    workflow_stage: workflowStage,
    next_module: workflowStageLabel(workflowStage)
  };
}

async function syncWorkflowStages() {
  const [billingRows] = await pool.query(`SELECT id, billing_status, balance_amount, workflow_stage FROM billing_records`);
  for (const row of Array.isArray(billingRows) ? billingRows : []) {
    const nextStage = resolveBillingWorkflowStage(row.billing_status, row.balance_amount, row.workflow_stage);
    if (nextStage !== normalizeWorkflowStage(row.workflow_stage, '')) {
      await pool.query(`UPDATE billing_records SET workflow_stage = ? WHERE id = ?`, [nextStage, row.id]);
    }
  }

  const [paymentRows] = await pool.query(
    `SELECT id, payment_status, reporting_status, workflow_stage FROM payment_transactions`
  );
  for (const row of Array.isArray(paymentRows) ? paymentRows : []) {
    const nextStage = resolvePaymentWorkflowStage(row.payment_status, row.workflow_stage, row.reporting_status);
    if (nextStage !== normalizeWorkflowStage(row.workflow_stage, '')) {
      await pool.query(`UPDATE payment_transactions SET workflow_stage = ? WHERE id = ?`, [nextStage, row.id]);
    }
  }

  const [receiptRows] = await pool.query(`SELECT id, receipt_status, workflow_stage FROM receipt_records`);
  for (const row of Array.isArray(receiptRows) ? receiptRows : []) {
    const nextStage = resolveReceiptWorkflowStage(row.receipt_status, row.workflow_stage);
    if (nextStage !== normalizeWorkflowStage(row.workflow_stage, '')) {
      await pool.query(`UPDATE receipt_records SET workflow_stage = ? WHERE id = ?`, [nextStage, row.id]);
    }
  }

  const [reconciliationRows] = await pool.query(`SELECT id, status, workflow_stage FROM reconciliations`);
  for (const row of Array.isArray(reconciliationRows) ? reconciliationRows : []) {
    const nextStage = resolveReconciliationWorkflowStage(row.status, row.workflow_stage);
    if (nextStage !== normalizeWorkflowStage(row.workflow_stage, '')) {
      await pool.query(`UPDATE reconciliations SET workflow_stage = ?, updated_at = ? WHERE id = ?`, [nextStage, nowSql(), row.id]);
    }
  }
}

function inferModuleFromRawAction(rawAction, description = '') {
  const raw = String(rawAction || '').trim().toUpperCase();
  const detail = String(description || '').toLowerCase();

  if (raw.startsWith('BILLING_PORTAL_')) return 'billing_verification';
  if (raw.startsWith('PAY_BILLS_')) return 'manage_billing';
  if (raw.startsWith('PAYMENT_GATEWAY_')) return 'process_payment';
  if (raw.startsWith('COMPLIANCE_')) return 'generate_receipt';
  if (raw.startsWith('REPORTING_')) return 'reports';
  if (raw === 'BILLING_APPROVE' || raw === 'BILLING_REJECT' || raw === 'BILLING_NOTIFY') return 'billing_verification';
  if (raw === 'BILLING_UPDATE' || raw === 'BILLING_HOLD' || raw === 'BILLING_ARCHIVE') return 'manage_billing';
  if (raw.startsWith('PAYMENT_')) return 'process_payment';
  if (raw.startsWith('RECEIPT_')) return 'generate_receipt';
  if (raw.startsWith('TRANSACTION_')) return 'financial_transactions';
  if (raw.startsWith('REPORT_') || raw.startsWith('REPORTING_')) return 'reports';
  if (raw.startsWith('SETTING_')) return 'settings';
  if (raw.startsWith('PROFILE_')) return 'my_profile';

  if (detail.includes('billing verification')) return 'billing_verification';
  if (detail.includes('billing management')) return 'manage_billing';
  if (detail.includes('payment')) return 'process_payment';
  if (detail.includes('receipt')) return 'generate_receipt';
  if (detail.includes('transaction')) return 'financial_transactions';
  if (detail.includes('report') || detail.includes('reconciliation')) return 'reports';
  if (detail.includes('setting')) return 'settings';
  return 'dashboard';
}

function extractEntityKey(description) {
  const match = String(description || '').match(/\b([A-Z]{2,}-\d{2,}(?:-\d{2,})?)\b/);
  return match ? match[1] : null;
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(190) NOT NULL UNIQUE,
      email VARCHAR(190) NOT NULL,
      full_name VARCHAR(190) NOT NULL,
      role VARCHAR(120) NOT NULL DEFAULT 'Cashier Admin',
      department VARCHAR(120) DEFAULT 'Cashier',
      access_exemptions_json JSONB NOT NULL,
      is_super_admin SMALLINT NOT NULL DEFAULT 0,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      phone VARCHAR(60) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS access_exemptions_json JSONB NULL`);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_super_admin SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS phone VARCHAR(60) NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_profile_preferences (
      user_id INT NOT NULL PRIMARY KEY,
      email_notifications SMALLINT NOT NULL DEFAULT 1,
      in_app_notifications SMALLINT NOT NULL DEFAULT 1,
      dark_mode SMALLINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_activity_logs (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      action VARCHAR(100) NOT NULL,
      raw_action VARCHAR(100) NOT NULL,
      description TEXT NOT NULL,
      ip_address VARCHAR(80) NOT NULL DEFAULT '127.0.0.1',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`ALTER TABLE admin_activity_logs ADD COLUMN IF NOT EXISTS user_id INT NULL`);
  await pool.query(`ALTER TABLE admin_activity_logs ADD COLUMN IF NOT EXISTS username VARCHAR(190) NULL`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      student_no VARCHAR(50) NOT NULL UNIQUE,
      full_name VARCHAR(150) NOT NULL,
      course VARCHAR(100) DEFAULT NULL,
      year_level VARCHAR(20) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      phone VARCHAR(30) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.cashier_registrar_student_enrollment_feed (
      id BIGSERIAL PRIMARY KEY,
      source_enrollment_id BIGINT UNIQUE,
      batch_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Registrar',
      office TEXT NOT NULL DEFAULT 'Registrar',
      student_no TEXT NOT NULL,
      student_name TEXT NOT NULL,
      class_code TEXT DEFAULT NULL,
      subject TEXT DEFAULT NULL,
      academic_year TEXT DEFAULT NULL,
      semester TEXT DEFAULT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      downpayment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      payload JSONB DEFAULT NULL,
      decision_notes TEXT DEFAULT NULL,
      linked_billing_id INT DEFAULT NULL,
      linked_billing_code VARCHAR(80) DEFAULT NULL,
      last_action VARCHAR(60) DEFAULT NULL,
      action_by INT DEFAULT NULL,
      action_at TIMESTAMPTZ DEFAULT NULL,
      sent_at TIMESTAMPTZ DEFAULT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS crad_student_list_feed (
      id BIGSERIAL PRIMARY KEY,
      enrollment_feed_id BIGINT DEFAULT NULL,
      billing_id INT DEFAULT NULL,
      batch_id TEXT DEFAULT NULL,
      student_no TEXT NOT NULL,
      student_name TEXT NOT NULL,
      semester TEXT DEFAULT NULL,
      academic_year TEXT DEFAULT NULL,
      downpayment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
      status TEXT NOT NULL DEFAULT 'queued',
      payload JSONB DEFAULT NULL,
      sent_by INT DEFAULT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_crad_student_list_feed_enrollment_feed_id ON crad_student_list_feed (enrollment_feed_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS student_accounts (
      id SERIAL PRIMARY KEY,
      student_id INT NOT NULL UNIQUE,
      username VARCHAR(190) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_records (
      id SERIAL PRIMARY KEY,
      student_id INT NOT NULL,
      billing_code VARCHAR(50) NOT NULL UNIQUE,
      source_module VARCHAR(120) DEFAULT 'Registrar',
      source_department VARCHAR(120) DEFAULT 'Registrar',
      source_category VARCHAR(120) DEFAULT 'Enrollment & Payment',
      integration_profile VARCHAR(120) DEFAULT 'registrar_enrollment',
      target_department VARCHAR(120) DEFAULT 'Registrar',
      semester VARCHAR(50) NOT NULL,
      school_year VARCHAR(20) NOT NULL,
      total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      balance_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      billing_status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
      workflow_stage VARCHAR(60) NOT NULL DEFAULT 'student_portal_billing',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_items (
      id SERIAL PRIMARY KEY,
      billing_id INT NOT NULL,
      item_code VARCHAR(60) DEFAULT NULL,
      item_name VARCHAR(190) NOT NULL,
      category VARCHAR(100) DEFAULT NULL,
      amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      sort_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fee_types (
      id SERIAL PRIMARY KEY,
      fee_code VARCHAR(60) NOT NULL UNIQUE,
      fee_name VARCHAR(190) NOT NULL,
      category VARCHAR(100) DEFAULT NULL,
      priority_order INT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_notifications (
      id SERIAL PRIMARY KEY,
      billing_id INT NOT NULL,
      student_id INT NOT NULL,
      notification_type VARCHAR(50) NOT NULL DEFAULT 'billing_reminder',
      subject VARCHAR(190) NOT NULL,
      message TEXT NOT NULL,
      recipient_name VARCHAR(150) NOT NULL,
      recipient_email VARCHAR(150) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'sent',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id SERIAL PRIMARY KEY,
      payment_id INT DEFAULT NULL,
      billing_id INT NOT NULL,
      reference_number VARCHAR(60) DEFAULT NULL,
      gateway_name VARCHAR(120) NOT NULL DEFAULT 'Mock Gateway',
      attempt_status VARCHAR(40) NOT NULL DEFAULT 'processing',
      request_payload_json JSONB DEFAULT NULL,
      response_payload_json JSONB DEFAULT NULL,
      remarks TEXT DEFAULT NULL,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY,
      billing_id INT NOT NULL,
      reference_number VARCHAR(50) NOT NULL UNIQUE,
      amount_paid DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      payment_method VARCHAR(50) NOT NULL DEFAULT 'Online',
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      reporting_status VARCHAR(30) NOT NULL DEFAULT 'logged',
      workflow_stage VARCHAR(60) NOT NULL DEFAULT 'payment_processing_gateway',
      payment_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id SERIAL PRIMARY KEY,
      payment_id INT NOT NULL,
      billing_id INT NOT NULL,
      billing_item_id INT NOT NULL,
      allocated_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      allocation_order INT NOT NULL DEFAULT 1,
      allocation_status VARCHAR(30) NOT NULL DEFAULT 'active',
      remarks TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_records (
      id SERIAL PRIMARY KEY,
      payment_id INT NOT NULL,
      receipt_number VARCHAR(50) NOT NULL UNIQUE,
      issued_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      receipt_status VARCHAR(30) NOT NULL DEFAULT 'queued',
      workflow_stage VARCHAR(60) NOT NULL DEFAULT 'compliance_documentation',
      remarks VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS receipt_items (
      id SERIAL PRIMARY KEY,
      receipt_id INT NOT NULL,
      billing_item_id INT NOT NULL,
      fee_type VARCHAR(190) NOT NULL,
      allocated_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS proof_documents (
      id SERIAL PRIMARY KEY,
      receipt_id INT NOT NULL,
      payment_id INT NOT NULL,
      document_type VARCHAR(60) NOT NULL DEFAULT 'proof_of_payment',
      file_name VARCHAR(190) DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      verified_by INT DEFAULT NULL,
      verified_at TIMESTAMP DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reconciliations (
      id SERIAL PRIMARY KEY,
      payment_id INT NOT NULL UNIQUE,
      receipt_id INT DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
      workflow_stage VARCHAR(60) NOT NULL DEFAULT 'reporting_reconciliation',
      discrepancy_note TEXT DEFAULT NULL,
      handoff_department VARCHAR(120) DEFAULT NULL,
      handoff_artifact VARCHAR(190) DEFAULT NULL,
      handoff_reference VARCHAR(120) DEFAULT NULL,
      handoff_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      request_reference VARCHAR(120) DEFAULT NULL,
      handoff_notes TEXT DEFAULT NULL,
      reconciled_by INT DEFAULT NULL,
      reconciled_at TIMESTAMP DEFAULT NULL,
      reported_at TIMESTAMP DEFAULT NULL,
      archived_at TIMESTAMP DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      recipient_role VARCHAR(60) NOT NULL DEFAULT 'cashier',
      recipient_name VARCHAR(190) DEFAULT NULL,
      channel VARCHAR(40) NOT NULL DEFAULT 'in_app',
      type VARCHAR(80) NOT NULL,
      title VARCHAR(190) NOT NULL,
      message TEXT NOT NULL,
      entity_type VARCHAR(60) DEFAULT NULL,
      entity_id INT DEFAULT NULL,
      is_read SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP DEFAULT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      actor_user_id INT DEFAULT NULL,
      actor_name VARCHAR(190) DEFAULT NULL,
      actor_role VARCHAR(120) DEFAULT NULL,
      module_key VARCHAR(80) NOT NULL,
      entity_type VARCHAR(60) NOT NULL,
      entity_id INT NOT NULL,
      action VARCHAR(120) NOT NULL,
      before_status VARCHAR(60) DEFAULT NULL,
      after_status VARCHAR(60) DEFAULT NULL,
      before_stage VARCHAR(60) DEFAULT NULL,
      after_stage VARCHAR(60) DEFAULT NULL,
      remarks TEXT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auto_debit_arrangements (
      id SERIAL PRIMARY KEY,
      billing_id INT NOT NULL,
      account_name VARCHAR(190) NOT NULL,
      bank_name VARCHAR(190) DEFAULT NULL,
      account_mask VARCHAR(40) DEFAULT NULL,
      frequency VARCHAR(40) NOT NULL DEFAULT 'monthly',
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS installments (
      id SERIAL PRIMARY KEY,
      billing_id INT NOT NULL,
      payment_id INT DEFAULT NULL,
      installment_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      installment_count INT NOT NULL DEFAULT 1,
      due_schedule VARCHAR(190) DEFAULT NULL,
      remarks TEXT DEFAULT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      created_by INT DEFAULT NULL,
      updated_by INT DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS receipt_status VARCHAR(30) NOT NULL DEFAULT 'queued'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(60) NOT NULL DEFAULT 'student_portal_billing'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS source_module VARCHAR(120) DEFAULT 'Registrar'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS source_department VARCHAR(120) DEFAULT 'Registrar'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS source_category VARCHAR(120) DEFAULT 'Enrollment & Payment'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS integration_profile VARCHAR(120) DEFAULT 'registrar_enrollment'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS target_department VARCHAR(120) DEFAULT 'Registrar'`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(190) NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS correction_notes TEXT NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS previous_workflow_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS action_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS remarks TEXT NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS audit_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS returned_from VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS returned_to VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS returned_by INT NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS is_returned SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS needs_correction SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE billing_records ADD COLUMN IF NOT EXISTS is_completed SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS decision_notes TEXT NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS linked_billing_id INT NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS linked_billing_code VARCHAR(80) NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS last_action VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS action_at TIMESTAMPTZ NULL`);
  await pool.query(`ALTER TABLE public.cashier_registrar_student_enrollment_feed ADD COLUMN IF NOT EXISTS source_enrollment_id BIGINT NULL`);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cashier_registrar_student_enrollment_feed_source_enrollment_id
     ON public.cashier_registrar_student_enrollment_feed (source_enrollment_id)
     WHERE source_enrollment_id IS NOT NULL`
  );
  await pool.query(
    `ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(60) NOT NULL DEFAULT 'payment_processing_gateway'`
  );
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(190) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS correction_notes TEXT NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS previous_workflow_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS action_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS remarks TEXT NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS audit_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS returned_from VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS returned_to VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS returned_by INT NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS is_returned SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS needs_correction SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS is_completed SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(
    `ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(60) NOT NULL DEFAULT 'compliance_documentation'`
  );
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(190) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS correction_notes TEXT NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS previous_workflow_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS action_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS audit_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS returned_from VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS returned_to VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS returned_by INT NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS is_returned SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS needs_correction SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS is_completed SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(
    `ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR(60) NOT NULL DEFAULT 'reporting_reconciliation'`
  );
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS handoff_department VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS handoff_artifact VARCHAR(190) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS handoff_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS handoff_status VARCHAR(40) NOT NULL DEFAULT 'pending'`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS request_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS handoff_notes TEXT NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS correction_reason VARCHAR(190) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS correction_notes TEXT NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS previous_workflow_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS action_by INT NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS action_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS audit_reference VARCHAR(120) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS returned_from VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS returned_to VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS returned_by INT NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS returned_at TIMESTAMP NULL`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS is_returned SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS needs_correction SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE reconciliations ADD COLUMN IF NOT EXISTS is_completed SMALLINT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS before_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS after_stage VARCHAR(60) NULL`);
  await pool.query(`ALTER TABLE receipt_records ADD COLUMN IF NOT EXISTS remarks VARCHAR(255) NULL`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS reporting_status VARCHAR(30) NOT NULL DEFAULT 'logged'`);

  const defaultUsername = process.env.SEED_ADMIN_USERNAME || 'admin@cashier.local';
  const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
  const defaultHash = process.env.SEED_ADMIN_PASSWORD_HASH || hashPassword(defaultPassword);

  await pool.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (username) DO NOTHING`,
    [
      defaultUsername,
      defaultUsername,
      'Cashier System Administrator',
      'Admin',
      'Cashier',
      JSON.stringify([
        'billing_verification',
        'manage_billing',
        'process_payment',
        'generate_receipt',
        'financial_transactions',
        'reports'
      ]),
      1,
      defaultHash,
      'active',
      '+63 912 345 6789'
    ]
  );

  const seededAdmin = await getAdminByUsername(defaultUsername);
  if (!seededAdmin) return;

  await pool.query(
    `INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode)
     VALUES (?, 1, 1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [seededAdmin.id]
  );

  await pool.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)
    ON CONFLICT (username) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      department = EXCLUDED.department,
      access_exemptions_json = EXCLUDED.access_exemptions_json,
      phone = EXCLUDED.phone`,
    [
      'staff@cashier.local',
      'staff@cashier.local',
      'Faculty Staff Monitor',
      'Accounting Faculty Staff',
      'Transaction Reporting',
      JSON.stringify(['process_payment', 'generate_receipt', 'reports']),
      hashPassword('staff123'),
      '+63 917 100 2001'
    ]
  );

  await pool.query(
    `INSERT INTO admin_users (
      username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'active', ?)
    ON CONFLICT (username) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      department = EXCLUDED.department,
      access_exemptions_json = EXCLUDED.access_exemptions_json,
      phone = EXCLUDED.phone`,
    [
      'compliance@cashier.local',
      'compliance@cashier.local',
      'Compliance Documentation Officer',
      'Compliance Staff',
      'Compliance',
      JSON.stringify(['generate_receipt', 'reports']),
      hashPassword('compliance123'),
      '+63 917 100 2002'
    ]
  );

  const [[studentCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM students');
  if (Number(studentCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
       VALUES
         ('2024-0001', 'Juan Dela Cruz', 'BSIT', '3rd Year', 'juan@gmail.com', '09123456789', 'active'),
         ('2024-0002', 'Maria Santos', 'BSBA', '2nd Year', 'maria@gmail.com', '09987654321', 'active'),
         ('2024-0003', 'Angela Dela Cruz', 'BS Information Technology', '2nd Year', 'angela@gmail.com', '09170000001', 'active'),
         ('2024-0004', 'Michael Santos', 'BS Business Administration', '3rd Year', 'michael@gmail.com', '09170000002', 'active')
      `
    );
  }

  const [[enrollmentFeedCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM public.cashier_registrar_student_enrollment_feed');
  if (Number(enrollmentFeedCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO public.cashier_registrar_student_enrollment_feed (
        batch_id, source, office, student_no, student_name, class_code, subject, academic_year, semester, status, downpayment_amount, payload, sent_at, created_at
      )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '6 hours', NOW() - INTERVAL '6 hours'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '5 hours', NOW() - INTERVAL '5 hours'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '4 hours', NOW() - INTERVAL '4 hours'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '90 minutes'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '50 minutes', NOW() - INTERVAL '50 minutes'),
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '25 minutes')`,
      [
        'REG-ENR-2026-001',
        'Registrar',
        'Main Registrar',
        '2024-0001',
        'Juan Dela Cruz',
        'BSIT-3A',
        'Information Management',
        '2025-2026',
        '2nd Semester',
        'Sent to Cashier',
        3500,
        JSON.stringify({
          course: 'BSIT',
          year_level: '3rd Year',
          units: 24,
          assessment_type: 'Regular Enrollment',
          fee_breakdown: {
            tuition: 12000,
            miscellaneous: 3500,
            laboratory: 1800
          }
        }),
        'REG-ENR-2026-001',
        'Registrar',
        'Main Registrar',
        '2024-0002',
        'Maria Santos',
        'BSBA-2B',
        'Financial Management',
        '2025-2026',
        '2nd Semester',
        'Matched',
        4000,
        JSON.stringify({
          course: 'BSBA',
          year_level: '2nd Year',
          units: 21,
          assessment_type: 'Regular Enrollment',
          contact_email: 'maria@gmail.com'
        }),
        'REG-ENR-2026-001',
        'Registrar',
        'Main Registrar',
        '2024-0003',
        'Angela Dela Cruz',
        'BSIT-2C',
        'Web Systems',
        '2025-2026',
        '2nd Semester',
        'Pending',
        3000,
        JSON.stringify({
          course: 'BS Information Technology',
          year_level: '2nd Year',
          units: 23,
          scholarship_flag: false
        }),
        'REG-ENR-2026-001',
        'Registrar',
        'Main Registrar',
        '2024-0004',
        'Michael Santos',
        'BSBA-3A',
        'Operations Management',
        '2025-2026',
        '2nd Semester',
        'Cleared',
        5000,
        JSON.stringify({
          course: 'BS Business Administration',
          year_level: '3rd Year',
          units: 18,
          cashier_clearance: 'Cleared'
        }),
        'REG-ENR-2026-002',
        'Registrar',
        'Satellite Registrar',
        '2024-0005',
        'Trisha Mendoza',
        'BSA-4A',
        'Auditing Theory',
        '2025-2026',
        'Summer',
        'For Verification',
        4500,
        JSON.stringify({
          course: 'BS Accountancy',
          year_level: '4th Year',
          units: 15,
          assessment_type: 'Summer'
        }),
        'REG-ENR-2026-002',
        'Registrar',
        'Satellite Registrar',
        '2024-0006',
        'Carlo Reyes',
        'BSCS-1A',
        'Programming Logic',
        '2025-2026',
        '1st Semester',
        'Pending',
        2500,
        JSON.stringify({
          course: 'BS Computer Science',
          year_level: '1st Year',
          units: 27,
          remarks: 'Freshman assessment created'
        }),
        'REG-ENR-2026-002',
        'Registrar',
        'Satellite Registrar',
        '2024-0007',
        'Liza Garcia',
        'BSHM-2A',
        'Food Service Operations',
        '2025-2026',
        '1st Semester',
        'On Hold',
        2750,
        JSON.stringify({
          course: 'BS Hospitality Management',
          year_level: '2nd Year',
          units: 20,
          hold_reason: 'Pending registrar attachment'
        }),
        'REG-ENR-2026-003',
        'Registrar',
        'Main Registrar',
        '2024-0008',
        'Ethan Flores',
        'BSOA-3B',
        'Records Management',
        '2025-2026',
        '1st Semester',
        'Sent to Cashier',
        3200,
        JSON.stringify({
          course: 'BS Office Administration',
          year_level: '3rd Year',
          units: 19,
          last_updated_by: 'Registrar Batch Sync'
        })
      ]
    );
  }

  const [[billingCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM billing_records');
  if (Number(billingCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO billing_records (
        student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
      )
      VALUES
        (1, 'BILL-1001', '1st Semester', '2025-2026', 15000.00, 5000.00, 10000.00, 'partial', NOW(), NOW()),
        (2, 'BILL-1002', '1st Semester', '2025-2026', 12000.00, 12000.00, 0.00, 'paid', NOW(), NOW()),
        (3, 'BILL-1003', '2nd Semester', '2025-2026', 12450.00, 0.00, 12450.00, 'unpaid', NOW(), NOW()),
        (4, 'BILL-1004', '2nd Semester', '2025-2026', 8960.00, 0.00, 8960.00, 'on_hold', NOW(), NOW())
      `
    );
  }

  const [[notificationCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM billing_notifications');
  if (Number(notificationCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO billing_notifications (
        billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
      )
      VALUES
        (1, 1, 'billing_reminder', 'Billing ready for review', 'Juan Dela Cruz has a billing record waiting for cashier verification.', 'Juan Dela Cruz', 'juan@gmail.com', 'sent', 1, NOW()),
        (2, 2, 'receipt_notice', 'Billing fully settled', 'Maria Santos has completed settlement and is ready for receipt release.', 'Maria Santos', 'maria@gmail.com', 'sent', 1, NOW())
      `
    );
  }

  await pool.query(
    `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status)
     VALUES
       ('2024-0005', 'Trisha Mendoza', 'BS Accountancy', '4th Year', 'trisha@gmail.com', '09170000003', 'active'),
       ('2024-0006', 'Carlo Reyes', 'BS Computer Science', '1st Year', 'carlo@gmail.com', '09170000004', 'active'),
       ('2024-0007', 'Liza Garcia', 'BS Hospitality Management', '2nd Year', 'liza@gmail.com', '09170000005', 'active'),
       ('2024-0008', 'Ethan Flores', 'BS Office Administration', '3rd Year', 'ethan@gmail.com', '09170000006', 'active'),
       ('2024-0091', 'Clara Verify Search', 'BS Information Systems', '2nd Year', 'clara.verify@example.com', '09170000091', 'active'),
       ('2024-0092', 'Noah Billing Finder', 'BS Accountancy', '1st Year', 'noah.finder@example.com', '09170000092', 'active')
     ON CONFLICT (student_no) DO NOTHING`
  );

  const defaultStudentPassword = process.env.SEED_STUDENT_PASSWORD || 'student123';
  const defaultStudentHash = process.env.SEED_STUDENT_PASSWORD_HASH || hashPassword(defaultStudentPassword);
  await pool.query(
    `INSERT INTO student_accounts (student_id, username, password_hash, status, created_at)
     SELECT s.id, s.student_no, ?, 'active', ?
     FROM students s
     WHERE NOT EXISTS (
       SELECT 1 FROM student_accounts sa WHERE sa.student_id = s.id
     )`,
    [defaultStudentHash, nowSql()]
  );

  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
    )
    SELECT id, 'BILL-1005', '2nd Semester', '2025-2026', 15300.00, 0.00, 15300.00, 'unpaid', NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0005'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-1005')`
  );
  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
    )
    SELECT id, 'BILL-1006', '2nd Semester', '2025-2026', 4520.00, 0.00, 4520.00, 'correction', NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0006'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-1006')`
  );
  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
    )
    SELECT id, 'BILL-1007', '1st Semester', '2025-2026', 9340.00, 2500.00, 6840.00, 'partial', NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0007'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-1007')`
  );
  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, created_at, updated_at
    )
    SELECT id, 'BILL-1008', '1st Semester', '2025-2026', 11080.00, 11080.00, 0.00, 'paid', NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0008'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-1008')`
  );
  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
    )
    SELECT id, 'BILL-VERIFY-2001', '2nd Semester', '2025-2026', 13250.00, 0.00, 13250.00, 'pending_payment', ?, NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0091'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-VERIFY-2001')`,
    [WORKFLOW_STAGES.STUDENT_PORTAL_BILLING]
  );
  await pool.query(
    `INSERT INTO billing_records (
      student_id, billing_code, semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
    )
    SELECT id, 'BILL-VERIFY-2002', '2nd Semester', '2025-2026', 9875.00, 0.00, 9875.00, 'pending_payment', ?, NOW(), NOW()
    FROM students
    WHERE student_no = '2024-0092'
      AND NOT EXISTS (SELECT 1 FROM billing_records WHERE billing_code = 'BILL-VERIFY-2002')`,
    [WORKFLOW_STAGES.STUDENT_PORTAL_BILLING]
  );

  const [[billingItemCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM billing_items');
  if (Number(billingItemCountRow?.total || 0) === 0) {
    const [billingSeedRows] = await pool.query('SELECT id, total_amount FROM billing_records ORDER BY id ASC');
    for (const row of Array.isArray(billingSeedRows) ? billingSeedRows : []) {
      const totalAmount = Number(row.total_amount || 0);
      const tuitionAmount = Number((totalAmount * 0.7).toFixed(2));
      const miscAmount = Number((totalAmount * 0.2).toFixed(2));
      const portalAmount = Number((totalAmount - tuitionAmount - miscAmount).toFixed(2));

      await pool.query(
        `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
         VALUES
           (?, 'TUITION', 'Tuition Fee', 'Tuition', ?, 1, ?),
           (?, 'MISC', 'Miscellaneous Fee', 'Assessment', ?, 2, ?),
           (?, 'PORTAL', 'Portal and Service Fee', 'Services', ?, 3, ?)`,
        [row.id, tuitionAmount, nowSql(), row.id, miscAmount, nowSql(), row.id, portalAmount, nowSql()]
      );
    }
  }

  await pool.query(
    `INSERT INTO fee_types (fee_code, fee_name, category, priority_order, created_at)
     VALUES
       ('TUITION', 'Tuition Fee', 'Tuition', 1, ?),
       ('LAB', 'Laboratory Fee', 'Laboratory', 2, ?),
       ('BOOK', 'Book Fee', 'Materials', 3, ?),
       ('UNIFORM', 'Uniform Fee', 'Materials', 4, ?),
       ('MISC', 'Miscellaneous Fee', 'Assessment', 5, ?),
       ('RESEARCH', 'Research Fee', 'Research', 6, ?),
       ('FOUNDATION', 'Foundation Fee', 'Institutional', 7, ?),
       ('REGISTRATION', 'Registration Fee', 'Services', 8, ?),
       ('ID', 'ID Fee', 'Services', 9, ?),
       ('OTHER', 'Other School Fee', 'Others', 10, ?)
     ON CONFLICT (fee_code) DO UPDATE SET
       fee_name = EXCLUDED.fee_name,
       category = EXCLUDED.category,
       priority_order = EXCLUDED.priority_order`,
    [nowSql(), nowSql(), nowSql(), nowSql(), nowSql(), nowSql(), nowSql(), nowSql(), nowSql(), nowSql()]
  );

  await pool.query(
    `INSERT INTO billing_notifications (
      billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
    )
    SELECT b.id, s.id, 'billing_reminder', 'Balance reminder sent', 'A reminder was sent for BILL-1005 after verification review.', s.full_name, s.email, 'sent', ?, NOW()
    FROM billing_records b
    INNER JOIN students s ON s.id = b.student_id
    WHERE b.billing_code = 'BILL-1005'
      AND NOT EXISTS (
        SELECT 1 FROM billing_notifications WHERE billing_id = b.id AND subject = 'Balance reminder sent'
      )`,
    [seededAdmin.id]
  );
  await pool.query(
    `INSERT INTO billing_notifications (
      billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
    )
    SELECT b.id, s.id, 'correction_notice', 'Correction notice queued', 'The billing record requires registrar confirmation before payment can continue.', s.full_name, s.email, 'sent', ?, NOW()
    FROM billing_records b
    INNER JOIN students s ON s.id = b.student_id
    WHERE b.billing_code = 'BILL-1006'
      AND NOT EXISTS (
        SELECT 1 FROM billing_notifications WHERE billing_id = b.id AND subject = 'Correction notice queued'
      )`,
    [seededAdmin.id]
  );

  await seedActivityLog(
    seededAdmin.id,
    'Verification Queue Seeded',
    'BILLING_NOTIFY',
    'Student billing verification queue was seeded with sample billing reminders.',
    9
  );
  await seedActivityLog(
    seededAdmin.id,
    'Billing Management Seeded',
    'BILLING_UPDATE',
    'Manage student billing board was seeded with ledger updates for demo monitoring.',
    8
  );
  await seedActivityLog(
    seededAdmin.id,
    'Payment Batch Prepared',
    'PAYMENT_POST',
    'Process payment module prepared a morning batch for cashier posting.',
    7
  );
  await seedActivityLog(
    seededAdmin.id,
    'Receipt Queue Refreshed',
    'RECEIPT_RELEASE',
    'Generate receipt module refreshed the queue for official receipt release.',
    6
  );
  await seedActivityLog(
    seededAdmin.id,
    'Transaction Export Prepared',
    'TRANSACTION_EXPORT',
    'Financial transactions module staged an export bundle for finance review.',
    5
  );
  await seedActivityLog(
    seededAdmin.id,
    'Report Snapshot Generated',
    'REPORT_GENERATE',
    'Reports module generated a daily collection snapshot for administration.',
    4
  );
  await seedActivityLog(
    seededAdmin.id,
    'Settings Snapshot Saved',
    'SETTING_SAVE',
    'Settings module stored a preview of cashier configuration changes.',
    3
  );

  await pool.query(
    `INSERT INTO payment_transactions (
      billing_id, reference_number, amount_paid, payment_method, payment_status, payment_date, processed_by, created_at
    )
    SELECT b.id, 'PAY-2026-0041', 7450.00, 'GCash', 'posted', NOW(), ?, NOW()
    FROM billing_records b
    WHERE b.billing_code = 'BILL-1005'
      AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE reference_number = 'PAY-2026-0041')`,
    [seededAdmin.id]
  );
  await pool.query(
    `INSERT INTO payment_transactions (
      billing_id, reference_number, amount_paid, payment_method, payment_status, payment_date, processed_by, created_at
    )
    SELECT b.id, 'PAY-2026-0046', 4520.00, 'Bank Transfer', 'pending_validation', NOW(), ?, NOW()
    FROM billing_records b
    WHERE b.billing_code = 'BILL-1006'
      AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE reference_number = 'PAY-2026-0046')`,
    [seededAdmin.id]
  );
  await pool.query(
    `INSERT INTO payment_transactions (
      billing_id, reference_number, amount_paid, payment_method, payment_status, payment_date, processed_by, created_at
    )
    SELECT b.id, 'PAY-2026-0050', 11080.00, 'Maya', 'posted', NOW(), ?, NOW()
    FROM billing_records b
    WHERE b.billing_code = 'BILL-1008'
      AND NOT EXISTS (SELECT 1 FROM payment_transactions WHERE reference_number = 'PAY-2026-0050')`,
    [seededAdmin.id]
  );

  await pool.query(
    `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
     SELECT p.id, 'OR-2026-0089', NOW(), 'released', 'Official receipt already released and archived.', NOW()
     FROM payment_transactions p
     WHERE p.reference_number = 'PAY-2026-0050'
       AND NOT EXISTS (SELECT 1 FROM receipt_records WHERE receipt_number = 'OR-2026-0089')`
  );

  const [[systemNotificationCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM notifications');
  if (Number(systemNotificationCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO notifications (
        recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at
      )
      VALUES
        ('cashier', 'Cashier Team', 'in_app', 'billing_activated', 'Billing activated', 'BILL-1005 is now active in Student Portal & Billing.', 'billing', 5, 0, ?),
        ('cashier', 'Cashier Team', 'in_app', 'payment_successful', 'Payment successful', 'PAY-2026-0050 was posted and is waiting for compliance documentation.', 'payment', 3, 0, ?),
        ('accounting', 'Accounting Staff', 'in_app', 'receipt_generated', 'Receipt ready for verification', 'Documentation for PAY-2026-0050 is ready for proof verification.', 'receipt', 1, 0, ?)` ,
      [nowSql(8), nowSql(5), nowSql(4)]
    );
  }

  const [[auditCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM audit_logs');
  if (Number(auditCountRow?.total || 0) === 0) {
    await pool.query(
      `INSERT INTO audit_logs (
        actor_user_id, actor_name, actor_role, module_key, entity_type, entity_id, action, before_status, after_status, remarks, created_at
      )
      VALUES
        (?, 'Cashier System Administrator', 'Admin', 'billing_verification', 'billing', 5, 'Billing Activated', 'Draft', 'Active Billing', 'Seeded BPA billing activation sample.', ?),
        (?, 'Cashier System Administrator', 'Admin', 'process_payment', 'payment', 3, 'Payment Confirmed', 'Processing', 'Paid', 'Seeded BPA payment confirmation sample.', ?),
        (?, 'Cashier System Administrator', 'Admin', 'reports', 'reconciliation', 1, 'Record Reconciled', 'Pending Review', 'Reconciled', 'Seeded BPA reconciliation sample.', ?)` ,
      [seededAdmin.id, nowSql(8), seededAdmin.id, nowSql(5), seededAdmin.id, nowSql(3)]
    );
  }

  const [[allocationCountRow]] = await pool.query('SELECT COUNT(*) AS total FROM payment_allocations');
  if (Number(allocationCountRow?.total || 0) === 0) {
    const [paymentSeedRows] = await pool.query(
      `SELECT id, billing_id, amount_paid
       FROM payment_transactions
       ORDER BY id ASC`
    );

    for (const payment of Array.isArray(paymentSeedRows) ? paymentSeedRows : []) {
      try {
        await createPaymentAllocations({
          paymentId: Number(payment.id),
          billingId: Number(payment.billing_id),
          paymentAmount: Number(payment.amount_paid || 0),
          allocationMode: 'auto',
          remarks: 'Seeded fee allocation.'
        });
      } catch {
        // Skip seeded payments that cannot be auto-allocated cleanly.
      }
    }
  }

  const [seededReceiptRows] = await pool.query(`SELECT id, payment_id FROM receipt_records ORDER BY id ASC`);
  for (const receiptRow of Array.isArray(seededReceiptRows) ? seededReceiptRows : []) {
    await replaceReceiptItemsFromPayment(Number(receiptRow.payment_id), Number(receiptRow.id));
  }

  const [billingRowsForRecalc] = await pool.query(`SELECT id, workflow_stage FROM billing_records ORDER BY id ASC`);
  for (const billingRow of Array.isArray(billingRowsForRecalc) ? billingRowsForRecalc : []) {
    await recalculateBillingFinancials(Number(billingRow.id), {
      workflowStage: billingRow.workflow_stage || null
    });
  }

  await syncWorkflowStages();
}

async function readSessionUser(req) {
  cleanupSessions();
  const token = req.cookies?.[sessionCookieName];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = await getAdminById(session.userId);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionTtlMs;
  return user;
}

async function readStudentSession(req) {
  cleanupSessions();
  const token = req.cookies?.[studentSessionCookieName];
  if (!token) return null;
  const session = studentSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    studentSessions.delete(token);
    return null;
  }
  const account = await getStudentAccountById(session.accountId);
  if (!account || String(account.status || '').toLowerCase() !== 'active') {
    studentSessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + sessionTtlMs;
  return account;
}

async function requireAuth(req, res, next) {
  try {
    const user = await readSessionUser(req);
    if (!user) {
      sendError(res, 401, 'Authentication required.');
      return;
    }
    req.currentUser = user;
    next();
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to validate session.');
  }
}

async function requireStudentAuth(req, res, next) {
  try {
    const student = await readStudentSession(req);
    if (!student) {
      sendError(res, 401, 'Student authentication required.');
      return;
    }
    req.currentStudent = student;
    next();
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to validate student session.');
  }
}

function requireRole(...roleKeywords) {
  return (req, res, next) => {
    const user = req.currentUser;
    const roleValue = String(user?.role || '').toLowerCase();
    const isAllowed =
      Boolean(user?.is_super_admin) ||
      roleKeywords.some((keyword) => roleValue.includes(String(keyword || '').trim().toLowerCase()));

    if (!isAllowed) {
      sendError(res, 403, 'You do not have permission to perform this action.');
      return;
    }

    next();
  };
}

async function fetchBillingRows() {
  const [rows] = await pool.query(
    `SELECT
        b.id,
        b.student_id,
        b.billing_code,
        b.source_module,
        b.source_department,
        b.source_category,
        b.integration_profile,
        b.target_department,
        b.semester,
        b.school_year,
        b.total_amount,
        b.paid_amount,
        b.balance_amount,
        b.billing_status,
        b.workflow_stage,
        b.created_at,
        b.updated_at,
        s.student_no,
        s.full_name,
        s.course,
        s.year_level
     FROM billing_records b
     INNER JOIN students s ON s.id = b.student_id
     ORDER BY b.updated_at DESC, b.id DESC`
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchBillingItemRows(billingId = null) {
  const hasBillingId = Number.isFinite(Number(billingId)) && Number(billingId) > 0;
  const [rows] = await pool.query(
    `SELECT id, billing_id, item_code, item_name, category, amount, sort_order, created_at
     FROM billing_items
     ${hasBillingId ? 'WHERE billing_id = ?' : ''}
     ORDER BY billing_id ASC, sort_order ASC, id ASC`,
    hasBillingId ? [Number(billingId)] : []
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchPaymentAllocationRows(filters = {}) {
  const clauses = [];
  const values = [];

  if (Number.isFinite(Number(filters.paymentId)) && Number(filters.paymentId) > 0) {
    clauses.push('pa.payment_id = ?');
    values.push(Number(filters.paymentId));
  }

  if (Number.isFinite(Number(filters.billingId)) && Number(filters.billingId) > 0) {
    clauses.push('pa.billing_id = ?');
    values.push(Number(filters.billingId));
  }

  const [rows] = await pool.query(
    `SELECT
        pa.id,
        pa.payment_id,
        pa.billing_id,
        pa.billing_item_id,
        pa.allocated_amount,
        pa.allocation_order,
        pa.allocation_status,
        pa.remarks,
        pa.created_at,
        pa.updated_at,
        p.reference_number,
        p.payment_status,
        p.payment_method,
        bi.item_code,
        bi.item_name,
        bi.category,
        bi.amount AS item_amount,
        bi.sort_order
     FROM payment_allocations pa
     INNER JOIN payment_transactions p ON p.id = pa.payment_id
     INNER JOIN billing_items bi ON bi.id = pa.billing_item_id
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY pa.payment_id ASC, pa.allocation_order ASC, pa.id ASC`,
    values
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchReceiptItemRows(receiptId = null) {
  const hasReceiptId = Number.isFinite(Number(receiptId)) && Number(receiptId) > 0;
  const [rows] = await pool.query(
    `SELECT id, receipt_id, billing_item_id, fee_type, allocated_amount, created_at
     FROM receipt_items
     ${hasReceiptId ? 'WHERE receipt_id = ?' : ''}
     ORDER BY receipt_id ASC, id ASC`,
    hasReceiptId ? [Number(receiptId)] : []
  );

  return Array.isArray(rows) ? rows : [];
}

const ACTIVE_ALLOCATION_PAYMENT_STATUSES = new Set(['processing', 'authorized', 'paid', 'posted']);
const FINALIZED_ALLOCATION_PAYMENT_STATUSES = new Set(['paid', 'posted']);
const ACTIVE_ALLOCATION_STATUSES = new Set(['active', 'pending', 'finalized']);
const FINALIZED_ALLOCATION_STATUSES = new Set(['finalized', 'active']);

function allocationCountsTowardsCommitted(row) {
  return (
    ACTIVE_ALLOCATION_PAYMENT_STATUSES.has(String(row.payment_status || '').toLowerCase()) &&
    ACTIVE_ALLOCATION_STATUSES.has(String(row.allocation_status || 'active').toLowerCase())
  );
}

function allocationCountsTowardsFinalized(row) {
  return (
    FINALIZED_ALLOCATION_PAYMENT_STATUSES.has(String(row.payment_status || '').toLowerCase()) &&
    FINALIZED_ALLOCATION_STATUSES.has(String(row.allocation_status || 'active').toLowerCase())
  );
}

function buildBillingFeeBreakdown(itemRows, allocationRows) {
  const allocationMap = new Map();

  for (const row of allocationRows) {
    const itemId = Number(row.billing_item_id || 0);
    if (!itemId) continue;
    if (!allocationMap.has(itemId)) allocationMap.set(itemId, []);
    allocationMap.get(itemId).push(row);
  }

  const billingMap = new Map();

  for (const item of itemRows) {
    const billingId = Number(item.billing_id || 0);
    const amount = Number(item.amount || 0);
    const itemAllocations = allocationMap.get(Number(item.id)) || [];
    const committedAmount = Number(
      itemAllocations
        .filter(allocationCountsTowardsCommitted)
        .reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0)
        .toFixed(2)
    );
    const finalizedAmount = Number(
      itemAllocations
        .filter(allocationCountsTowardsFinalized)
        .reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0)
        .toFixed(2)
    );
    const pendingAmount = Number(Math.max(0, committedAmount - finalizedAmount).toFixed(2));
    const remainingAmount = Number(Math.max(0, amount - committedAmount).toFixed(2));
    const feeStatus = committedAmount <= 0 ? 'Unpaid' : remainingAmount <= 0 ? 'Paid' : 'Partially Paid';

    const feeItem = {
      id: Number(item.id),
      feeCode: item.item_code,
      feeType: item.item_name,
      feeName: item.item_name,
      category: item.category || 'School Fee',
      amount,
      amountFormatted: formatCurrency(amount),
      paidAmount: finalizedAmount,
      paidAmountFormatted: formatCurrency(finalizedAmount),
      pendingAmount,
      pendingAmountFormatted: formatCurrency(pendingAmount),
      committedAmount,
      committedAmountFormatted: formatCurrency(committedAmount),
      remainingAmount,
      remainingAmountFormatted: formatCurrency(remainingAmount),
      status: feeStatus,
      sortOrder: Number(item.sort_order || 0),
      allocations: itemAllocations.map((allocation) => ({
        id: Number(allocation.id),
        paymentId: Number(allocation.payment_id),
        paymentReference: allocation.reference_number,
        paymentMethod: allocation.payment_method,
        paymentStatus: mapPaymentStatus(allocation.payment_status),
        allocatedAmount: Number(allocation.allocated_amount || 0),
        allocatedAmountFormatted: formatCurrency(allocation.allocated_amount),
        allocationStatus: allocation.allocation_status
      }))
    };

    if (!billingMap.has(billingId)) {
      billingMap.set(billingId, {
        items: [],
        summary: {
          totalFees: 0,
          paidCount: 0,
          partialCount: 0,
          unpaidCount: 0,
          committedAmount: 0,
          finalizedAmount: 0,
          remainingAmount: 0
        }
      });
    }

    const billing = billingMap.get(billingId);
    billing.items.push(feeItem);
    billing.summary.totalFees += 1;
    billing.summary.committedAmount += committedAmount;
    billing.summary.finalizedAmount += finalizedAmount;
    billing.summary.remainingAmount += remainingAmount;

    if (feeStatus === 'Paid') billing.summary.paidCount += 1;
    else if (feeStatus === 'Partially Paid') billing.summary.partialCount += 1;
    else billing.summary.unpaidCount += 1;
  }

  for (const value of billingMap.values()) {
    value.summary.committedAmount = Number(value.summary.committedAmount.toFixed(2));
    value.summary.finalizedAmount = Number(value.summary.finalizedAmount.toFixed(2));
    value.summary.remainingAmount = Number(value.summary.remainingAmount.toFixed(2));
    value.summary.committedAmountFormatted = formatCurrency(value.summary.committedAmount);
    value.summary.finalizedAmountFormatted = formatCurrency(value.summary.finalizedAmount);
    value.summary.remainingAmountFormatted = formatCurrency(value.summary.remainingAmount);
    value.summary.label = `${value.summary.paidCount} Paid | ${value.summary.partialCount} Partial | ${value.summary.unpaidCount} Unpaid`;
    value.items.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  }

  return billingMap;
}

function buildPaymentAllocationMap(allocationRows) {
  const paymentMap = new Map();

  for (const row of allocationRows) {
    const paymentId = Number(row.payment_id || 0);
    if (!paymentId) continue;

    if (!paymentMap.has(paymentId)) {
      paymentMap.set(paymentId, {
        items: [],
        totalAllocated: 0
      });
    }

    const target = paymentMap.get(paymentId);
    const allocatedAmount = Number(row.allocated_amount || 0);
    target.items.push({
      id: Number(row.id),
      billingItemId: Number(row.billing_item_id || 0),
      feeType: row.item_name,
      feeCode: row.item_code,
      category: row.category || 'School Fee',
      allocatedAmount,
      allocatedAmountFormatted: formatCurrency(row.allocated_amount),
      allocationOrder: Number(row.allocation_order || 0),
      allocationStatus: row.allocation_status
    });
    target.totalAllocated += allocatedAmount;
  }

  for (const value of paymentMap.values()) {
    value.totalAllocated = Number(value.totalAllocated.toFixed(2));
    value.totalAllocatedFormatted = formatCurrency(value.totalAllocated);
    value.summary = value.items.map((item) => `${item.feeType}: ${item.allocatedAmountFormatted}`).join(' | ');
    value.items.sort((left, right) => left.allocationOrder - right.allocationOrder || left.id - right.id);
  }

  return paymentMap;
}

async function recalculateBillingFinancials(billingId, overrides = {}) {
  const itemRows = await fetchBillingItemRows(billingId);
  const allocationRows = await fetchPaymentAllocationRows({ billingId });
  const breakdown = buildBillingFeeBreakdown(itemRows, allocationRows).get(Number(billingId));
  const totalAmount = Number(itemRows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
  const committedAmount = breakdown ? Number(breakdown.summary.committedAmount || 0) : 0;
  const remainingAmount = Number(Math.max(0, totalAmount - committedAmount).toFixed(2));
  const nextStatus = committedAmount <= 0 ? 'unpaid' : remainingAmount <= 0 ? 'paid' : 'partial';

  await pool.query(
    `UPDATE billing_records
     SET total_amount = ?,
         paid_amount = ?,
         balance_amount = ?,
         billing_status = ?,
         workflow_stage = COALESCE(?, workflow_stage),
         updated_at = ?
     WHERE id = ?`,
    [totalAmount, committedAmount, remainingAmount, overrides.status || nextStatus, overrides.workflowStage || null, nowSql(), billingId]
  );

  return {
    totalAmount,
    committedAmount,
    remainingAmount,
    status: overrides.status || nextStatus
  };
}

async function createPaymentAllocations({ paymentId, billingId, paymentAmount, allocationMode = 'auto', manualAllocations = [], remarks = '' }) {
  const itemRows = await fetchBillingItemRows(billingId);
  if (!itemRows.length) {
    throw new Error('No fee items are available for this billing record.');
  }

  const existingAllocationRows = await fetchPaymentAllocationRows({ billingId });
  const breakdownMap = buildBillingFeeBreakdown(itemRows, existingAllocationRows);
  const feeBreakdown = breakdownMap.get(Number(billingId));
  const remainingByItem = new Map((feeBreakdown?.items || []).map((item) => [item.id, Number(item.remainingAmount || 0)]));

  const normalizedMode = String(allocationMode || 'auto').toLowerCase();
  let allocations = [];

  if (normalizedMode === 'manual') {
    allocations = manualAllocations
      .map((item) => ({
        billingItemId: Number(item.billingItemId || item.billing_item_id || item.id || 0),
        allocatedAmount: Number(item.allocatedAmount || item.allocated_amount || 0)
      }))
      .filter((item) => item.billingItemId > 0 && item.allocatedAmount > 0);

    if (!allocations.length) {
      throw new Error('At least one fee allocation is required for manual allocation mode.');
    }
  } else {
    let remainingToAllocate = Number(paymentAmount || 0);
    for (const item of feeBreakdown?.items || []) {
      if (remainingToAllocate <= 0) break;
      const remaining = Number(item.remainingAmount || 0);
      if (remaining <= 0) continue;
      const allocatedAmount = Number(Math.min(remaining, remainingToAllocate).toFixed(2));
      if (allocatedAmount <= 0) continue;
      allocations.push({
        billingItemId: item.id,
        allocatedAmount
      });
      remainingToAllocate = Number((remainingToAllocate - allocatedAmount).toFixed(2));
    }
  }

  const totalAllocated = Number(allocations.reduce((sum, item) => sum + Number(item.allocatedAmount || 0), 0).toFixed(2));
  if (Math.abs(totalAllocated - Number(paymentAmount || 0)) > 0.01) {
    throw new Error('Allocated total must exactly match the payment amount.');
  }

  for (const [index, allocation] of allocations.entries()) {
    const remaining = Number(remainingByItem.get(allocation.billingItemId) || 0);
    if (allocation.allocatedAmount > remaining + 0.01) {
      throw new Error('Allocated amount cannot exceed the remaining balance of any fee item.');
    }

    await pool.query(
      `INSERT INTO payment_allocations (
        payment_id, billing_id, billing_item_id, allocated_amount, allocation_order, allocation_status, remarks, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [paymentId, billingId, allocation.billingItemId, allocation.allocatedAmount, index + 1, remarks || null, nowSql(), nowSql()]
    );
  }

  return allocations;
}

async function replaceReceiptItemsFromPayment(paymentId, receiptId) {
  const allocationRows = await fetchPaymentAllocationRows({ paymentId });
  await pool.query(`DELETE FROM receipt_items WHERE receipt_id = ?`, [receiptId]);

  for (const allocation of allocationRows.filter(allocationCountsTowardsFinalized)) {
    await pool.query(
      `INSERT INTO receipt_items (receipt_id, billing_item_id, fee_type, allocated_amount, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [receiptId, Number(allocation.billing_item_id || 0), allocation.item_name, Number(allocation.allocated_amount || 0), nowSql()]
    );
  }
}

async function fetchPaymentAttemptRows(paymentId = null) {
  const hasPaymentId = Number.isFinite(Number(paymentId)) && Number(paymentId) > 0;
  const [rows] = await pool.query(
    `SELECT id, payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
     FROM payment_attempts
     ${hasPaymentId ? 'WHERE payment_id = ?' : ''}
     ORDER BY created_at DESC, id DESC`,
    hasPaymentId ? [Number(paymentId)] : []
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchProofDocumentRows(receiptId = null) {
  const hasReceiptId = Number.isFinite(Number(receiptId)) && Number(receiptId) > 0;
  const [rows] = await pool.query(
    `SELECT id, receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at
     FROM proof_documents
     ${hasReceiptId ? 'WHERE receipt_id = ?' : ''}
     ORDER BY created_at DESC, id DESC`,
    hasReceiptId ? [Number(receiptId)] : []
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchReconciliationRows() {
  const [rows] = await pool.query(
    `SELECT
        r.id,
        r.payment_id,
        r.receipt_id,
        r.status,
        r.discrepancy_note,
        r.handoff_department,
        r.handoff_artifact,
        r.handoff_reference,
        r.handoff_status,
        r.request_reference,
        r.handoff_notes,
        r.reconciled_at,
        r.reported_at,
        r.archived_at,
        r.created_at,
        r.updated_at,
        r.workflow_stage,
        p.reference_number,
        p.amount_paid,
        p.payment_method,
        p.payment_status,
        p.reporting_status,
        p.workflow_stage,
        p.payment_date,
        b.billing_code,
        b.source_module,
        b.source_department,
        b.source_category,
        b.integration_profile,
        b.target_department,
        s.full_name,
        s.student_no,
        COALESCE(rr.receipt_number, '--') AS receipt_number,
        COALESCE(rr.receipt_status, 'queued') AS receipt_status
     FROM reconciliations r
     INNER JOIN payment_transactions p ON p.id = r.payment_id
     INNER JOIN billing_records b ON b.id = p.billing_id
     INNER JOIN students s ON s.id = b.student_id
     LEFT JOIN receipt_records rr ON rr.id = r.receipt_id
     ORDER BY r.updated_at DESC, r.id DESC`
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchBillingActivity(limit = 3) {
  const [rows] = await pool.query(
    `SELECT action, description, created_at
     FROM admin_activity_logs
     WHERE raw_action LIKE 'BILLING_%'
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchBillingNotifications(limit = 5) {
  const [rows] = await pool.query(
    `SELECT
        n.id,
        n.notification_type,
        n.subject,
        n.message,
        n.recipient_name,
        n.recipient_email,
        n.status,
        n.created_at,
        b.billing_code
     FROM billing_notifications n
     INNER JOIN billing_records b ON b.id = n.billing_id
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [limit]
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchPaymentRows() {
  const [rows] = await pool.query(
    `SELECT
        p.id AS payment_id,
        b.id AS billing_id,
        b.billing_code,
        b.source_module,
        b.source_department,
        b.source_category,
        b.integration_profile,
        b.target_department,
        b.total_amount,
        b.paid_amount,
        b.balance_amount,
        b.billing_status,
        s.full_name,
        s.student_no,
        p.reference_number,
        p.amount_paid,
        p.payment_method,
        p.payment_status,
        p.reporting_status,
        p.workflow_stage,
        p.payment_date
     FROM payment_transactions p
     INNER JOIN billing_records b ON b.id = p.billing_id
     INNER JOIN students s ON s.id = b.student_id
     ORDER BY p.payment_date DESC, p.id DESC`
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchReceiptRows() {
  const [rows] = await pool.query(
    `SELECT
        p.id AS payment_id,
        p.reference_number,
        p.amount_paid,
        p.payment_method,
        p.payment_status,
        p.payment_date,
        b.billing_code,
        b.source_module,
        b.source_department,
        b.source_category,
        b.integration_profile,
        b.target_department,
        s.full_name,
        COALESCE(r.id, 0) AS receipt_id,
        COALESCE(r.receipt_number, CONCAT('OR-', to_char(CURRENT_DATE, 'YYYY'), '-', LPAD(p.id::text, 4, '0'))) AS receipt_number,
        COALESCE(r.receipt_status, CASE WHEN p.payment_status IN ('posted', 'paid') THEN 'ready' ELSE 'queued' END) AS receipt_status,
        COALESCE(r.workflow_stage, 'compliance_documentation') AS workflow_stage,
        COALESCE(r.issued_date, p.payment_date) AS issued_date,
        COALESCE(r.remarks, 'Receipt is ready to be released after successful payment confirmation.') AS remarks
     FROM payment_transactions p
     INNER JOIN billing_records b ON b.id = p.billing_id
     INNER JOIN students s ON s.id = b.student_id
     LEFT JOIN receipt_records r ON r.payment_id = p.id
     ORDER BY issued_date DESC, p.id DESC`
  );

  return Array.isArray(rows) ? rows : [];
}

async function fetchActivityByPrefix(prefix, limit = 3) {
  const [rows] = await pool.query(
    `SELECT action, description, created_at
     FROM admin_activity_logs
     WHERE raw_action LIKE ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [`${prefix}%`, limit]
  );
  return Array.isArray(rows) ? rows : [];
}

function mapPaymentStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'authorized') return 'Authorized';
  if (status === 'paid' || status === 'posted') return 'Paid';
  if (status === 'failed') return 'Failed';
  if (status === 'cancelled') return 'Cancelled';
  return 'Processing';
}

function mapReceiptStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'generated') return 'Receipt Generated';
  if (status === 'verified') return 'Proof Verified';
  if (status === 'completed' || status === 'released') return 'Documentation Completed';
  return 'Receipt Pending';
}

function paymentNote(row) {
  const status = String(row.payment_status || '').toLowerCase();
  if (status === 'authorized') return 'Transaction was authorized and is waiting for final paid confirmation.';
  if (status === 'paid' || status === 'posted') return 'Payment succeeded and the documentation queue is now available.';
  if (status === 'failed') return 'Gateway validation failed and the payment request was returned to billing.';
  if (status === 'cancelled') return 'Payment request was cancelled before final posting.';
  return 'Payment request is in processing and waiting for gateway validation.';
}

function receiptNote(row) {
  const status = String(row.receipt_status || '').toLowerCase();
  if (status === 'generated') return 'Proof of payment was generated and is ready for review.';
  if (status === 'verified') return 'Payment proof was verified and is waiting for final completion.';
  if (status === 'completed' || status === 'released') return 'Documentation is completed and ready for reconciliation.';
  return 'Receipt is pending generation after successful payment confirmation.';
}

function mapVerificationStatus(rawStatus, balanceAmount) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'draft') return 'Draft';
  if (status === 'verified' || status === 'partial') return 'Pending Payment';
  if (status === 'correction' || status === 'rejected' || status === 'on_hold' || status === 'failed') return 'Needs Correction';
  if (Number(balanceAmount || 0) > 0) return 'Active Billing';
  return 'Active Billing';
}

function mapManagementStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'partial') return 'Partially Paid';
  if (status === 'paid') return 'Fully Paid';
  if (status === 'failed') return 'Payment Failed';
  return 'Pending Payment';
}

function mapBillingWorkflowStatus(rawStatus, balanceAmount) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'draft') return 'Draft';
  if (status === 'archived') return 'Closed';
  if (status === 'paid') return 'Fully Paid';
  if (status === 'partial') return 'Partially Paid';
  if (status === 'verified') return 'Pending Payment';
  if (status === 'correction' || status === 'rejected' || status === 'on_hold' || status === 'failed') return 'Needs Correction';
  if (Number(balanceAmount || 0) <= 0) return 'Closed';
  return 'Active Billing';
}

function mapReconciliationStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'reconciled') return 'Reconciled';
  if (status === 'reported') return 'Reported';
  if (status === 'archived') return 'Archived';
  if (status === 'discrepancy') return 'With Discrepancy';
  return 'Pending Review';
}

function canCreatePaymentFromBilling(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  return ['verified', 'partial'].includes(status);
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function toIsoString(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function verificationNote(row) {
  const status = String(row.billing_status || '').toLowerCase();
  if (status === 'draft') return 'Billing statement is still in draft and needs activation before payment.';
  if (status === 'verified' || status === 'partial') return 'Billing is valid and already forwarded to the payment stage.';
  if (status === 'on_hold') return 'Billing record is on hold pending registrar or billing clarification.';
  if (status === 'correction' || status === 'rejected' || status === 'failed') return 'Billing record returned for correction.';
  return 'Billing is active and ready for cashier review.';
}

function managementNote(row) {
  const status = String(row.billing_status || '').toLowerCase();
  if (status === 'paid') return 'Billing is fully settled and has already been sent to the gateway flow.';
  if (status === 'partial') return 'Installment payment was accepted and the remaining balance stays visible.';
  if (status === 'failed') return 'Latest payment attempt failed and the billing remains unpaid.';
  return 'Billing is active and can receive full payment or installment settlement.';
}

function buildVerificationStats(rows, payBillsCount) {
  const drafts = rows.filter((row) => String(row.rawStatus || row.billing_status || '').toLowerCase() === 'draft').length;
  const activeBillings = rows.filter((row) => ['unpaid', 'updated'].includes(String(row.rawStatus || row.billing_status || '').toLowerCase())).length;
  const corrections = rows.filter((row) =>
    ['correction', 'rejected', 'on_hold', 'failed'].includes(String(row.rawStatus || row.billing_status || '').toLowerCase())
  ).length;

  return [
    {
      title: 'Draft',
      value: String(drafts),
      subtitle: 'Billing records still being prepared',
      icon: 'mdi-file-search-outline',
      tone: 'green'
    },
    {
      title: 'Active Billing',
      value: String(activeBillings),
      subtitle: 'Billing records ready for cashier review',
      icon: 'mdi-alert-circle-outline',
      tone: 'blue'
    },
    {
      title: 'Ready for Pay Bills',
      value: String(payBillsCount),
      subtitle: 'Records already released to the next module',
      icon: 'mdi-cash-check',
      tone: 'orange'
    },
    {
      title: 'Needs Correction',
      value: String(corrections),
      subtitle: 'Records needing registrar clarification',
      icon: 'mdi-bank-outline',
      tone: 'purple'
    }
  ];
}

function buildManagementStats(rows, gatewayCount) {
  const pending = rows.filter((row) => String(row.rawStatus || row.billing_status || '').toLowerCase() === 'verified').length;
  const partial = rows.filter((row) => String(row.rawStatus || row.billing_status || '').toLowerCase() === 'partial').length;
  const failed = rows.filter((row) => String(row.rawStatus || row.billing_status || '').toLowerCase() === 'failed').length;

  return [
    {
      title: 'Pending Payment',
      value: String(pending),
      subtitle: 'Billings forwarded from the portal',
      icon: 'mdi-table-account',
      tone: 'green'
    },
    {
      title: 'Partially Paid',
      value: String(partial),
      subtitle: 'Installment payments still open',
      icon: 'mdi-pencil-ruler-outline',
      tone: 'blue'
    },
    {
      title: 'In Gateway',
      value: String(gatewayCount),
      subtitle: 'Payments already handed to gateway processing',
      icon: 'mdi-pause-circle-outline',
      tone: 'orange'
    },
    {
      title: 'Payment Failed',
      value: String(failed),
      subtitle: 'Billings returned after failed payment',
      icon: 'mdi-finance',
      tone: 'purple'
    }
  ];
}

async function buildStudentBillingSnapshot(view) {
  const rows = await serializeBillingList();
  const activityRows = await fetchBillingActivity(3);
  const notificationRows = await fetchBillingNotifications(5);
  const paymentActivityRows = await fetchActivityByPrefix('PAYMENT_', 2);

  const activityFeedFromLogs =
    activityRows.length > 0
      ? activityRows.map((row) => ({
          title: row.action,
          detail: row.description,
          time: formatRelativeMinutes(row.created_at)
        }))
      : [];

  const activityFeedFromNotifications = notificationRows.map((row) => ({
    title: row.subject,
    detail: `${row.recipient_name} | ${row.billing_code} | ${row.message}`,
    time: formatRelativeMinutes(row.created_at)
  }));

  const paymentFeed = paymentActivityRows.map((row) => ({
    title: row.action,
    detail: row.description,
    time: formatRelativeMinutes(row.created_at)
  }));

  const activityFeed =
    (view === 'verification' ? [...activityFeedFromNotifications, ...paymentFeed] : activityFeedFromLogs).length > 0
      ? (view === 'verification' ? [...activityFeedFromNotifications, ...paymentFeed].slice(0, 5) : activityFeedFromLogs)
      : [
          {
            title: 'Billing records synced',
            detail: `${rows.length} billing ledgers are available in the cashier queue.`,
            time: 'Just now'
          }
        ];

  if (view === 'management') {
    const payBillsRows = rows.filter(
      (row) => normalizeWorkflowStage(row.workflowStage, row.workflowStage) === WORKFLOW_STAGES.PAY_BILLS
    );
    return {
      stats: buildManagementStats(
        payBillsRows,
        rows.filter(
          (row) => normalizeWorkflowStage(row.workflowStage, row.workflowStage) === WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
        ).length
      ),
      items: payBillsRows.map((row) => ({
        id: Number(row.id),
        billingCode: row.billingCode,
        studentName: row.studentName,
        semester: `${row.semester} ${row.schoolYear}`,
        category: `${row.program || 'General'}${row.yearLevel ? ` | ${row.yearLevel}` : ''}`,
        sourceModule: row.sourceModule,
        sourceDepartment: row.sourceDepartment,
        sourceCategory: row.sourceCategory,
        total: row.totalAmountFormatted,
        balance: row.balanceAmountFormatted,
        status: mapManagementStatus(row.rawStatus),
        workflowStage: row.workflowStage,
        workflowStageLabel: row.workflowStageLabel,
        remarks: managementNote({ billing_status: row.rawStatus }),
        feeItems: row.items || [],
        feeSummary: row.feeSummary || null
      })),
      activityFeed
    };
  }

  const portalRows = rows.filter(
    (row) => normalizeWorkflowStage(row.workflowStage, row.workflowStage) === WORKFLOW_STAGES.STUDENT_PORTAL_BILLING
  );
  return {
    stats: buildVerificationStats(
      portalRows,
      rows.filter((row) => normalizeWorkflowStage(row.workflowStage, row.workflowStage) === WORKFLOW_STAGES.PAY_BILLS).length
    ),
    items: portalRows.map((row) => ({
      id: Number(row.id),
      reference: row.billingCode,
      studentName: row.studentName,
      studentNumber: row.studentNumber,
      program: row.program || 'General Program',
      sourceModule: row.sourceModule,
      sourceDepartment: row.sourceDepartment,
      sourceCategory: row.sourceCategory,
      amount: row.balanceAmountFormatted,
      totalPaid: row.paidAmountFormatted,
      dueDate: row.dueDateFormatted,
      status: mapVerificationStatus(row.rawStatus, row.balanceAmount),
      workflowStage: row.workflowStage,
      workflowStageLabel: row.workflowStageLabel,
      note: verificationNote({ billing_status: row.rawStatus }),
      feeItems: row.items || [],
      feeSummary: row.feeSummary || null
    })),
    activityFeed
  };
}

function buildPaymentStats(activeRows, allRows) {
  const processing = activeRows.filter((row) => mapPaymentStatus(row.payment_status) === 'Processing').length;
  const authorized = activeRows.filter((row) => mapPaymentStatus(row.payment_status) === 'Authorized').length;
  const movedToCompliance = allRows.filter((row) => {
    const stage = normalizeWorkflowStage(row.workflow_stage, resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status));
    return [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, WORKFLOW_STAGES.REPORTING_RECONCILIATION, WORKFLOW_STAGES.COMPLETED].includes(stage);
  }).length;
  const returnedToPayBills = allRows.filter((row) => {
    const stage = normalizeWorkflowStage(row.workflow_stage, resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status));
    return stage === WORKFLOW_STAGES.PAY_BILLS;
  }).length;

  return [
    { title: 'Processing', value: String(processing), subtitle: 'Transactions waiting for gateway validation', icon: 'mdi-cash-fast', tone: 'green' },
    { title: 'Authorized', value: String(authorized), subtitle: 'Approved gateway requests awaiting paid confirmation', icon: 'mdi-check-decagram-outline', tone: 'blue' },
    { title: 'Moved to Compliance', value: String(movedToCompliance), subtitle: 'Successful payments already handed to documentation', icon: 'mdi-timer-sand', tone: 'orange' },
    { title: 'Returned to Pay Bills', value: String(returnedToPayBills), subtitle: 'Failed or cancelled requests sent back for retry', icon: 'mdi-currency-php', tone: 'purple' }
  ];
}

function buildReceiptStats(activeRows, allRows) {
  const pending = activeRows.filter((row) => mapReceiptStatus(row.receipt_status) === 'Receipt Pending').length;
  const generated = activeRows.filter((row) => mapReceiptStatus(row.receipt_status) === 'Receipt Generated').length;
  const verified = activeRows.filter((row) => mapReceiptStatus(row.receipt_status) === 'Proof Verified').length;
  const movedToReporting = allRows.filter((row) => {
    const stage = normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status));
    return [WORKFLOW_STAGES.REPORTING_RECONCILIATION, WORKFLOW_STAGES.COMPLETED].includes(stage);
  }).length;

  return [
    { title: 'Receipt Pending', value: String(pending), subtitle: 'Successful payments waiting for a receipt', icon: 'mdi-receipt-text-check-outline', tone: 'green' },
    { title: 'Receipt Generated', value: String(generated), subtitle: 'Generated proof of payment documents', icon: 'mdi-file-document-check-outline', tone: 'blue' },
    { title: 'Proof Verified', value: String(verified), subtitle: 'Payment documentation validated by cashier staff', icon: 'mdi-printer-outline', tone: 'orange' },
    {
      title: 'Moved to Reporting',
      value: String(movedToReporting),
      subtitle: 'Documentation packages already forwarded to reconciliation',
      icon: 'mdi-folder-file-outline',
      tone: 'purple'
    }
  ];
}

async function buildPaymentSnapshot() {
  const payments = await serializePaymentTransactions();
  const activityRows = await fetchActivityByPrefix('PAYMENT_', 3);
  const rows = payments.map((item) => ({
    payment_id: item.id,
    reference_number: item.referenceNumber,
    full_name: item.studentName,
    payment_method: item.paymentMethod,
    amount_paid: item.amount,
    billing_code: item.billingCode,
    sourceModule: item.sourceModule,
    sourceDepartment: item.sourceDepartment,
    sourceCategory: item.sourceCategory,
    payment_status: item.rawStatus,
    reporting_status: item.rawReportingStatus,
    workflow_stage: item.workflowStage,
    allocation_summary: item.allocationSummary,
    allocations: item.allocations,
    amountFormatted: item.amountFormatted,
    status: item.status,
    workflowStageLabel: item.workflowStageLabel,
    totalAllocatedFormatted: item.totalAllocatedFormatted
  }));
  const activeRows = rows.filter((item) => normalizeWorkflowStage(item.workflow_stage, '') === WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY);
  const historyRows = rows.filter((item) => normalizeWorkflowStage(item.workflow_stage, '') !== WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY);

  const mapRow = (row) => ({
    id: Number(row.payment_id),
    reference: row.reference_number,
    studentName: row.full_name,
    channel: row.payment_method,
    amount: row.amountFormatted,
    billingCode: row.billing_code,
    sourceModule: row.sourceModule,
    sourceDepartment: row.sourceDepartment,
    sourceCategory: row.sourceCategory,
    status: row.status,
    workflowStage: row.workflow_stage,
    workflowStageLabel: row.workflowStageLabel,
    note: paymentNote({ payment_status: row.payment_status }),
    allocations: row.allocations,
    allocationSummary: row.allocation_summary,
    totalAllocated: row.totalAllocatedFormatted
  });

  return {
    stats: buildPaymentStats(activeRows, rows),
    items: activeRows.map(mapRow),
    historyItems: historyRows.map(mapRow),
    activityFeed: activityRows.map((row) => ({
      title: row.action,
      detail: row.description,
      time: formatRelativeMinutes(row.created_at)
    }))
  };
}

async function buildReceiptSnapshot() {
  const receipts = await serializeReceipts();
  const activityRows = await fetchActivityByPrefix('RECEIPT_', 3);
  const rows = receipts.map((item) => ({
    payment_id: item.paymentId,
    receipt_number: item.receiptNumber,
    full_name: item.studentName,
    reference_number: item.paymentReference,
    payment_method: item.paymentMethod,
    payment_status: item.paymentStatus,
    amount_paid: item.amount,
    billing_code: item.billingCode,
    sourceModule: item.sourceModule,
    sourceDepartment: item.sourceDepartment,
    sourceCategory: item.sourceCategory,
    receipt_status: item.rawStatus,
    workflow_stage: item.workflowStage,
    remarks: item.remarks,
    receipt_items: item.receiptItems,
    allocation_summary: item.allocationSummary,
    amountFormatted: item.amountFormatted,
    status: item.status,
    workflowStageLabel: item.workflowStageLabel
  }));
  const activeRows = rows.filter((row) => normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status)) === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION);
  const historyRows = rows.filter((row) => normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status)) !== WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION);

  const mapRow = (row) => ({
    id: Number(row.payment_id),
    receiptNo: row.receipt_number,
    studentName: row.full_name,
    paymentRef: row.reference_number,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    amount: row.amountFormatted,
    issuedFor: row.billing_code,
    sourceModule: row.sourceModule,
    sourceDepartment: row.sourceDepartment,
    sourceCategory: row.sourceCategory,
    status: row.status,
    workflowStage: normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status)),
    workflowStageLabel: row.workflowStageLabel,
    note: receiptNote(row),
    receiptItems: row.receipt_items,
    allocationSummary: row.allocation_summary
  });

  return {
    stats: buildReceiptStats(activeRows, rows),
    items: activeRows.map(mapRow),
    historyItems: historyRows.map(mapRow),
    activityFeed: activityRows.map((row) => ({
      title: row.action,
      detail: row.description,
      time: formatRelativeMinutes(row.created_at)
    }))
  };
}

async function fetchReportingRows() {
  const [rows] = await pool.query(
    `SELECT
        p.id AS payment_id,
        p.reference_number,
        p.amount_paid,
        p.payment_method,
        p.payment_status,
        p.reporting_status,
        p.payment_date,
        b.billing_code,
        s.full_name,
        COALESCE(r.receipt_number, '--') AS receipt_number,
        COALESCE(r.receipt_status, 'queued') AS receipt_status
     FROM payment_transactions p
     INNER JOIN billing_records b ON b.id = p.billing_id
     INNER JOIN students s ON s.id = b.student_id
     LEFT JOIN receipt_records r ON r.payment_id = p.id
     ORDER BY p.payment_date DESC, p.id DESC`
  );

  return Array.isArray(rows) ? rows : [];
}

function mapReportingStatus(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();
  if (status === 'archived') return 'Archived';
  if (status === 'reported') return 'Reported';
  if (status === 'reconciled') return 'Reconciled';
  return 'Logged';
}

function resolveEnrollmentDownpaymentAmount(row) {
  const directAmount = Number(row?.downpayment_amount ?? 0);
  if (Number.isFinite(directAmount) && directAmount > 0) {
    return directAmount;
  }

  const payload = enrollmentPayloadObject(row?.payload);
  const payloadDirect = Number(payload?.downpayment_amount ?? payload?.downpaymentAmount ?? 0);
  if (Number.isFinite(payloadDirect) && payloadDirect > 0) {
    return payloadDirect;
  }

  const nestedPayload = payload?.payload && typeof payload.payload === 'object' ? payload.payload : null;
  const nestedAmount = Number(nestedPayload?.downpayment_amount ?? nestedPayload?.downpaymentAmount ?? 0);
  if (Number.isFinite(nestedAmount) && nestedAmount > 0) {
    return nestedAmount;
  }

  return Number.isFinite(directAmount) ? directAmount : 0;
}

function normalizeEnrollmentFeedRow(row) {
  const linkedBillingId = row.linked_billing_id ? Number(row.linked_billing_id) : row.billing_id ? Number(row.billing_id) : null;
  const billingStage = linkedBillingId
    ? normalizeWorkflowStage(
        row.billing_workflow_stage || row.workflow_stage,
        resolveBillingWorkflowStage(row.billing_status, row.billing_balance_amount, row.billing_workflow_stage || row.workflow_stage)
      )
    : null;
  const status = normalizeEnrollmentFeedStatus(row.status, linkedBillingId);
  const downpaymentAmount = resolveEnrollmentDownpaymentAmount(row);

  return {
    id: Number(row.id),
    batchId: cleanTextValue(row.batch_id),
    source: cleanTextValue(row.source) || 'Registrar',
    office: cleanTextValue(row.office) || 'Registrar',
    studentNo: cleanTextValue(row.student_no),
    studentName: cleanTextValue(row.student_name) || 'Unknown Student',
    classCode: cleanTextValue(row.class_code),
    subject: cleanTextValue(row.subject),
    academicYear: cleanTextValue(row.academic_year),
    semester: cleanTextValue(row.semester),
    status,
    downpaymentAmount,
    downpaymentAmountFormatted: formatCurrency(downpaymentAmount),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : row.payload ? safeJsonParse(row.payload, null) : null,
    decisionNotes: cleanTextValue(row.decision_notes),
    actionBy: cleanTextValue(row.action_by_name || row.action_by_username),
    actionAt: toIsoString(row.action_at),
    lastAction: cleanTextValue(row.last_action),
    billingId: linkedBillingId,
    billingCode: cleanTextValue(row.linked_billing_code || row.billing_code),
    billingStatus: linkedBillingId ? mapBillingWorkflowStatus(row.billing_status, row.billing_balance_amount) : '',
    billingWorkflowStage: billingStage,
    billingWorkflowStageLabel: billingStage ? workflowStageLabel(billingStage) : '',
    nextStep: resolveEnrollmentFeedNextStep(status, cleanTextValue(row.linked_billing_code || row.billing_code), billingStage),
    queueBucket: resolveEnrollmentFeedBoardBucket(status, linkedBillingId),
    sentAt: toIsoString(row.sent_at),
    createdAt: toIsoString(row.created_at)
  };
}

function normalizeEnrollmentFeedStatus(rawStatus, linkedBillingId = null) {
  const normalized = cleanTextValue(rawStatus).toLowerCase();
  if (!normalized && linkedBillingId) return 'Approved';
  if (!normalized) return 'Pending Review';
  if (normalized === 'pending' || normalized === 'matched' || normalized === 'sent to cashier' || normalized === 'for verification') {
    return 'Pending Review';
  }
  if (normalized === 'cleared' || normalized === 'approved' || normalized === 'billing created' || normalized === 'billing ready') {
    return 'Approved';
  }
  if (normalized === 'returned' || normalized === 'returned to registrar' || normalized === 'rejected') {
    return 'Returned To Registrar';
  }
  if (normalized.includes('hold')) return 'On Hold';
  if (normalized.includes('approve') || normalized.includes('billing')) return 'Approved';
  if (normalized.includes('return') || normalized.includes('reject')) return 'Returned To Registrar';
  if (linkedBillingId && normalized === 'pending') return 'Approved';
  return cleanTextValue(rawStatus);
}

function resolveEnrollmentFeedBoardBucket(status, linkedBillingId = null) {
  const normalized = normalizeEnrollmentFeedStatus(status, linkedBillingId).toLowerCase();
  if (normalized.includes('approve')) return 'approved';
  if (normalized.includes('hold')) return 'hold';
  if (normalized.includes('return') || normalized.includes('reject')) return 'returned';
  return 'pending';
}

function resolveEnrollmentFeedNextStep(status, billingCode, billingStage) {
  if (billingCode) {
    return `${billingCode} is available in ${workflowStageLabel(billingStage || WORKFLOW_STAGES.STUDENT_PORTAL_BILLING)}.`;
  }

  const bucket = resolveEnrollmentFeedBoardBucket(status);
  if (bucket === 'hold') return 'Await cashier validation before billing activation.';
  if (bucket === 'returned') return 'Await registrar correction and resend.';
  return 'Review the registrar submission and decide whether to create billing.';
}

function enrollmentPayloadObject(value) {
  if (value && typeof value === 'object') return value;
  return safeJsonParse(value, {}) || {};
}

function numberToOrdinalText(value) {
  const numeric = Number(value || 0);
  if (!numeric) return '';
  const mod100 = numeric % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${numeric}th`;
  const mod10 = numeric % 10;
  if (mod10 === 1) return `${numeric}st`;
  if (mod10 === 2) return `${numeric}nd`;
  if (mod10 === 3) return `${numeric}rd`;
  return `${numeric}th`;
}

function resolveEnrollmentCourse(row) {
  const payload = enrollmentPayloadObject(row.payload);
  const payloadCourse = cleanTextValue(payload.course);
  if (payloadCourse) return payloadCourse;
  const classCode = cleanTextValue(row.class_code);
  if (classCode.includes('-')) return classCode.split('-')[0];
  if (classCode) return classCode;
  return cleanTextValue(row.subject) || 'General Enrollment';
}

function resolveEnrollmentYearLevel(row) {
  const payload = enrollmentPayloadObject(row.payload);
  const payloadLevel = cleanTextValue(payload.year_level);
  if (payloadLevel) return payloadLevel;

  const classCode = cleanTextValue(row.class_code);
  const match = classCode.match(/-(\d)/);
  if (match?.[1]) return `${numberToOrdinalText(match[1])} Year`;
  return 'Enrolled';
}

function buildEnrollmentBillingCode(feedId) {
  return `BILL-ENR-${new Date().getFullYear()}-${String(feedId).padStart(4, '0')}`;
}

function buildEnrollmentBillingItems(feedRow, totalAmount) {
  const amount = Number(totalAmount || 0);
  if (!(amount > 0)) return [];

  const processingFee = Number(Math.min(Math.max(amount * 0.18, 250), amount).toFixed(2));
  const reservationAmount = Number(Math.max(0, amount - processingFee).toFixed(2));
  const termLabel = [cleanTextValue(feedRow.semester), cleanTextValue(feedRow.academic_year)].filter(Boolean).join(' ');
  const subjectLabel = cleanTextValue(feedRow.subject) || cleanTextValue(feedRow.class_code) || 'Enrollment';
  const items = [];

  if (reservationAmount > 0) {
    items.push({
      code: 'ENR-DP',
      name: `${subjectLabel} Downpayment${termLabel ? ` - ${termLabel}` : ''}`,
      category: 'Enrollment',
      amount: reservationAmount
    });
  }

  if (processingFee > 0) {
    items.push({
      code: 'REG-PROC',
      name: 'Registrar Processing Fee',
      category: 'Registrar',
      amount: processingFee
    });
  }

  return items;
}

function buildEnrollmentDecisionPayload(feedRow, overrides = {}) {
  const existingPayload = enrollmentPayloadObject(feedRow.payload);
  const downpaymentAmount = resolveEnrollmentDownpaymentAmount(feedRow);
  const previousDecision =
    existingPayload.cashier_decision && typeof existingPayload.cashier_decision === 'object' ? existingPayload.cashier_decision : {};

  return {
    ...existingPayload,
    batch_id: cleanTextValue(feedRow.batch_id),
    source: cleanTextValue(feedRow.source) || 'Registrar',
    office: cleanTextValue(feedRow.office) || 'Registrar',
    student_no: cleanTextValue(feedRow.student_no),
    student_name: cleanTextValue(feedRow.student_name),
    class_code: cleanTextValue(feedRow.class_code) || null,
    subject: cleanTextValue(feedRow.subject) || null,
    academic_year: cleanTextValue(feedRow.academic_year) || null,
    semester: cleanTextValue(feedRow.semester) || null,
    status: normalizeEnrollmentFeedStatus(overrides.status || feedRow.status, overrides.linkedBillingId || feedRow.linked_billing_id),
    downpayment_amount: downpaymentAmount,
    cashier_decision: {
      ...previousDecision,
      action: cleanTextValue(overrides.action) || cleanTextValue(previousDecision.action),
      remarks: cleanTextValue(overrides.remarks) || cleanTextValue(previousDecision.remarks),
      actor_name: cleanTextValue(overrides.actorName) || cleanTextValue(previousDecision.actor_name),
      action_at: overrides.actionAt || previousDecision.action_at || null,
      linked_billing_id:
        overrides.linkedBillingId != null
          ? Number(overrides.linkedBillingId)
          : previousDecision.linked_billing_id != null
            ? Number(previousDecision.linked_billing_id)
            : null,
      linked_billing_code: cleanTextValue(overrides.linkedBillingCode) || cleanTextValue(previousDecision.linked_billing_code)
    }
  };
}

function isEnrollmentBillingLocked(row) {
  const stage = normalizeWorkflowStage(
    row.workflow_stage,
    resolveBillingWorkflowStage(row.billing_status, row.balance_amount, row.workflow_stage)
  );
  return (
    Number(row.paid_amount || 0) > 0 ||
    [WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY, WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, WORKFLOW_STAGES.REPORTING_RECONCILIATION, WORKFLOW_STAGES.COMPLETED].includes(
      stage
    )
  );
}

async function ensureStudentForEnrollmentFeed(feedRow) {
  const studentNo = cleanTextValue(feedRow.student_no);
  const studentName = cleanTextValue(feedRow.student_name);
  if (!studentNo || !studentName) {
    throw new Error('Student number and student name are required before approving the enrollment feed.');
  }

  const course = resolveEnrollmentCourse(feedRow);
  const yearLevel = resolveEnrollmentYearLevel(feedRow);
  const payload = enrollmentPayloadObject(feedRow.payload);
  const email = cleanTextValue(payload.contact_email) || null;
  const phone = cleanTextValue(payload.contact_phone) || null;

  const [existingRows] = await pool.query(`SELECT id FROM students WHERE student_no = ? LIMIT 1`, [studentNo]);
  if (existingRows[0]?.id) {
    await pool.query(
      `UPDATE students
       SET full_name = ?,
           course = ?,
           year_level = ?,
           email = COALESCE(?, email),
           phone = COALESCE(?, phone),
           status = 'active'
       WHERE id = ?`,
      [studentName, course || null, yearLevel || null, email, phone, existingRows[0].id]
    );
    return Number(existingRows[0].id);
  }

  const [rows] = await pool.query(
    `INSERT INTO students (student_no, full_name, course, year_level, email, phone, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
     RETURNING id`,
    [studentNo, studentName, course || null, yearLevel || null, email, phone, nowSql()]
  );

  return Number(rows[0]?.id || 0);
}

async function upsertEnrollmentFeedBilling(feedRow, actorUser, remarks = '') {
  const totalAmount = resolveEnrollmentDownpaymentAmount(feedRow);
  if (!(totalAmount > 0)) {
    throw new Error('Downpayment amount must be greater than zero before approval.');
  }

  const studentId = await ensureStudentForEnrollmentFeed(feedRow);
  const semester = cleanTextValue(feedRow.semester) || 'Current Semester';
  const schoolYear = cleanTextValue(feedRow.academic_year) || String(new Date().getFullYear());
  const nextItems = buildEnrollmentBillingItems(feedRow, totalAmount);
  if (!nextItems.length) {
    throw new Error('Unable to build billing items from the enrollment feed.');
  }

  let existingBilling = null;
  if (feedRow.linked_billing_id) {
    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
       FROM billing_records
       WHERE id = ?
       LIMIT 1`,
      [feedRow.linked_billing_id]
    );
    existingBilling = rows[0] || null;
  }

  if (!existingBilling && cleanTextValue(feedRow.linked_billing_code)) {
    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
       FROM billing_records
       WHERE billing_code = ?
       LIMIT 1`,
      [feedRow.linked_billing_code]
    );
    existingBilling = rows[0] || null;
  }

  if (!existingBilling) {
    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
       FROM billing_records
       WHERE student_id = ?
         AND semester = ?
         AND school_year = ?
         AND integration_profile = 'registrar_enrollment_feed'
       ORDER BY id DESC
       LIMIT 1`,
      [studentId, semester, schoolYear]
    );
    existingBilling = rows[0] || null;
  }

  if (existingBilling && isEnrollmentBillingLocked(existingBilling)) {
    return {
      billingId: Number(existingBilling.id),
      billingCode: cleanTextValue(existingBilling.billing_code),
      workflowStage: normalizeWorkflowStage(
        existingBilling.workflow_stage,
        resolveBillingWorkflowStage(existingBilling.billing_status, existingBilling.balance_amount, existingBilling.workflow_stage)
      ),
      reused: true,
      locked: true
    };
  }

  const billingCode = cleanTextValue(existingBilling?.billing_code) || buildEnrollmentBillingCode(feedRow.id);
  let billingId = existingBilling ? Number(existingBilling.id) : 0;
  const targetStage =
    existingBilling && normalizeWorkflowStage(existingBilling.workflow_stage, existingBilling.workflow_stage) === WORKFLOW_STAGES.PAY_BILLS
      ? WORKFLOW_STAGES.PAY_BILLS
      : WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;

  if (!billingId) {
    const [rows] = await pool.query(
      `INSERT INTO billing_records (
        student_id,
        billing_code,
        source_module,
        source_department,
        source_category,
        integration_profile,
        target_department,
        semester,
        school_year,
        total_amount,
        paid_amount,
        balance_amount,
        billing_status,
        workflow_stage,
        remarks,
        action_by,
        action_at,
        audit_reference,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`,
      [
        studentId,
        billingCode,
        'Registrar Enrollment Feed',
        cleanTextValue(feedRow.office) || 'Registrar',
        'Enrollment Downpayment',
        'registrar_enrollment_feed',
        'Cashier',
        semester,
        schoolYear,
        totalAmount,
        totalAmount,
        targetStage,
        remarks || 'Created from registrar enrollment feed approval.',
        actorUser?.id || null,
        nowSql(),
        `ENR-FEED-${feedRow.id}-${Date.now()}`,
        nowSql(),
        nowSql()
      ]
    );
    billingId = Number(rows[0]?.id || 0);
  } else {
    await pool.query(
      `UPDATE billing_records
       SET student_id = ?,
           source_module = ?,
           source_department = ?,
           source_category = ?,
           integration_profile = ?,
           target_department = ?,
           semester = ?,
           school_year = ?,
           balance_amount = ?,
           billing_status = 'active',
           workflow_stage = ?,
           remarks = ?,
           action_by = ?,
           action_at = ?,
           audit_reference = ?,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL,
           updated_at = ?
       WHERE id = ?`,
      [
        studentId,
        'Registrar Enrollment Feed',
        cleanTextValue(feedRow.office) || 'Registrar',
        'Enrollment Downpayment',
        'registrar_enrollment_feed',
        'Cashier',
        semester,
        schoolYear,
        totalAmount,
        targetStage,
        remarks || 'Updated from registrar enrollment feed approval.',
        actorUser?.id || null,
        nowSql(),
        `ENR-FEED-${feedRow.id}-${Date.now()}`,
        nowSql(),
        billingId
      ]
    );
    await pool.query(`DELETE FROM billing_items WHERE billing_id = ?`, [billingId]);
  }

  for (const [index, item] of nextItems.entries()) {
    await pool.query(
      `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [billingId, item.code, item.name, item.category, item.amount, index + 1, nowSql()]
    );
  }

  const recalculated = await recalculateBillingFinancials(billingId, {
    workflowStage: targetStage,
    status: 'active'
  });

  return {
    billingId,
    billingCode,
    workflowStage: targetStage,
    reused: Boolean(existingBilling),
    locked: false,
    totalAmount: recalculated.totalAmount
  };
}

async function fetchEnrollmentFeedRowById(feedId) {
  const [rows] = await pool.query(
    `SELECT
        f.id,
        f.batch_id,
        f.source,
        f.office,
        f.student_no,
        f.student_name,
        f.class_code,
        f.subject,
        f.academic_year,
        f.semester,
        f.status,
        f.downpayment_amount,
        f.payload,
        f.decision_notes,
        f.linked_billing_id,
        f.linked_billing_code,
        f.last_action,
        f.action_by,
        f.action_at,
        f.sent_at,
        f.created_at,
        b.id AS billing_id,
        b.billing_code,
        b.billing_status,
        b.workflow_stage AS billing_workflow_stage,
        b.balance_amount AS billing_balance_amount,
        u.full_name AS action_by_name,
        u.username AS action_by_username
     FROM public.cashier_registrar_student_enrollment_feed f
     LEFT JOIN billing_records b ON b.id = f.linked_billing_id
     LEFT JOIN admin_users u ON u.id = f.action_by
     WHERE f.id = ?
     LIMIT 1`,
    [feedId]
  );

  return rows[0] ? normalizeEnrollmentFeedRow(rows[0]) : null;
}

async function syncRegistrarEnrollmentsIntoCashierFeed() {
  const enrollmentsTable = await findFirstExistingTable(['registrar.enrollments', 'registrar_enrollments']);
  const studentsTable = await findFirstExistingTable(['registrar_students']);
  const classesTable = await findFirstExistingTable(['registrar_classes']);

  if (!enrollmentsTable || !studentsTable || !classesTable) {
    return;
  }

  const [
    hasDeletedAt,
    hasAcademicYear,
    hasSemester,
    hasDownpaymentAmount,
    hasCreatedAt
  ] = await Promise.all([
    columnExists(enrollmentsTable, 'deleted_at'),
    columnExists(enrollmentsTable, 'academic_year'),
    columnExists(enrollmentsTable, 'semester'),
    columnExists(enrollmentsTable, 'downpayment_amount'),
    columnExists(enrollmentsTable, 'created_at')
  ]);

  const [rows] = await pool.query(
    `SELECT
        e.id AS enrollment_id,
        e.status AS enrollment_status,
        ${hasAcademicYear ? 'e.academic_year' : "''::text AS academic_year"},
        ${hasSemester ? 'e.semester' : "''::text AS semester"},
        ${hasDownpaymentAmount ? 'e.downpayment_amount' : '0::numeric AS downpayment_amount'},
        ${hasCreatedAt ? 'e.created_at' : 'NOW() AS created_at'},
        s.student_no,
        s.first_name,
        s.last_name,
        c.class_code,
        c.title
     FROM ${enrollmentsTable} e
     INNER JOIN ${studentsTable} s ON s.id = e.student_id
     INNER JOIN ${classesTable} c ON c.id = e.class_id
     ${hasDeletedAt ? 'WHERE e.deleted_at IS NULL' : ''}
     ORDER BY ${hasCreatedAt ? 'e.created_at DESC' : 'e.id DESC'}`,
    []
  );

  const syncRows = Array.isArray(rows) ? rows : [];
  for (const row of syncRows) {
    const enrollmentId = Number(row.enrollment_id || 0);
    if (!enrollmentId) continue;

    const studentNo = cleanTextValue(row.student_no);
    const firstName = cleanTextValue(row.first_name);
    const lastName = cleanTextValue(row.last_name);
    const studentName = [firstName, lastName].filter(Boolean).join(' ') || studentNo || 'Unknown Student';
    const classCode = cleanTextValue(row.class_code) || null;
    const subject = cleanTextValue(row.title) || null;
    const academicYear = cleanTextValue(row.academic_year) || null;
    const semester = cleanTextValue(row.semester) || null;
    const status = cleanTextValue(row.enrollment_status) || 'Pending';
    const downpaymentAmount = Number(row.downpayment_amount || 0);
    const batchSuffix = academicYear ? academicYear.replace(/[^0-9]/g, '').slice(-4) : String(new Date().getFullYear());
    const batchId = `REG-LIVE-${batchSuffix || String(new Date().getFullYear())}`;
    const payloadJson = JSON.stringify({
      source: 'registrar.enrollments',
      enrollment_id: enrollmentId,
      student_no: studentNo,
      student_name: studentName,
      class_code: classCode,
      subject,
      academic_year: academicYear,
      semester,
      status,
      downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
    });

    await pool.query(
      `INSERT INTO public.cashier_registrar_student_enrollment_feed (
         source_enrollment_id,
         batch_id,
         source,
         office,
         student_no,
         student_name,
         class_code,
         subject,
         academic_year,
         semester,
         status,
         downpayment_amount,
         payload,
         sent_at,
         created_at
       ) VALUES (?, ?, 'Registrar', 'Registrar', ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), ?)
       ON CONFLICT (source_enrollment_id)
       DO UPDATE SET
         batch_id = EXCLUDED.batch_id,
         source = EXCLUDED.source,
         office = EXCLUDED.office,
         student_no = EXCLUDED.student_no,
         student_name = EXCLUDED.student_name,
         class_code = EXCLUDED.class_code,
         subject = EXCLUDED.subject,
         academic_year = EXCLUDED.academic_year,
         semester = EXCLUDED.semester,
         downpayment_amount = EXCLUDED.downpayment_amount,
         payload = EXCLUDED.payload,
         sent_at = NOW(),
         status = CASE
           WHEN COALESCE(TRIM(public.cashier_registrar_student_enrollment_feed.last_action), '') = ''
             THEN EXCLUDED.status
           ELSE public.cashier_registrar_student_enrollment_feed.status
         END`,
      [
        enrollmentId,
        batchId,
        studentNo,
        studentName,
        classCode,
        subject,
        academicYear,
        semester,
        status,
        Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0,
        payloadJson,
        row.created_at || nowSql()
      ]
    );
  }
}

async function buildCashierRegistrarEnrollmentFeedSnapshot(filters = {}) {
  await syncRegistrarEnrollmentsIntoCashierFeed();

  const [rows] = await pool.query(
    `SELECT
        f.id,
        f.source_enrollment_id,
        f.batch_id,
        f.source,
        f.office,
        f.student_no,
        f.student_name,
        f.class_code,
        f.subject,
        f.academic_year,
        f.semester,
        f.status,
        f.downpayment_amount,
        f.payload,
        f.decision_notes,
        f.linked_billing_id,
        f.linked_billing_code,
        f.last_action,
        f.action_by,
        f.action_at,
        f.sent_at,
        f.created_at,
        b.id AS billing_id,
        b.billing_code,
        b.billing_status,
        b.workflow_stage AS billing_workflow_stage,
        b.balance_amount AS billing_balance_amount,
        u.full_name AS action_by_name,
        u.username AS action_by_username
     FROM public.cashier_registrar_student_enrollment_feed f
     LEFT JOIN billing_records b ON b.id = f.linked_billing_id
     LEFT JOIN admin_users u ON u.id = f.action_by
     ORDER BY COALESCE(f.sent_at, f.created_at) DESC, f.id DESC`
  );

  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeEnrollmentFeedRow);

  const search = cleanTextValue(filters.search).toLowerCase();
  const statusFilter = cleanTextValue(filters.status);
  const semesterFilter = cleanTextValue(filters.semester);
  const sourceFilter = cleanTextValue(filters.source);
  const officeFilter = cleanTextValue(filters.office);
  const page = Math.max(1, Number(filters.page || 1));
  const perPage = Math.min(50, Math.max(1, Number(filters.perPage || 10)));

  const filtered = normalizedRows.filter((row) => {
    const matchesSearch =
      !search ||
      [
        row.batchId,
        row.source,
        row.office,
        row.studentNo,
        row.studentName,
        row.classCode,
        row.subject,
        row.academicYear,
        row.semester,
        row.status,
        row.billingCode,
        row.decisionNotes,
        row.actionBy
      ]
        .join(' ')
        .toLowerCase()
        .includes(search);
    const matchesStatus = !statusFilter || statusFilter === 'All Statuses' || row.status === statusFilter;
    const matchesSemester = !semesterFilter || semesterFilter === 'All Semesters' || row.semester === semesterFilter;
    const matchesSource = !sourceFilter || sourceFilter === 'All Sources' || row.source === sourceFilter;
    const matchesOffice = !officeFilter || officeFilter === 'All Offices' || row.office === officeFilter;

    return matchesSearch && matchesStatus && matchesSemester && matchesSource && matchesOffice;
  });

  const pendingCount = filtered.filter((row) => row.queueBucket === 'pending').length;
  const approvedCount = filtered.filter((row) => row.queueBucket === 'approved').length;
  const holdCount = filtered.filter((row) => row.queueBucket === 'hold').length;
  const returnedCount = filtered.filter((row) => row.queueBucket === 'returned').length;

  return {
    stats: [
      {
        title: 'Pending Review',
        value: String(pendingCount),
        subtitle: 'Registrar submissions waiting on cashier action',
        icon: 'mdi-clipboard-check-outline',
        tone: 'blue'
      },
      {
        title: 'Billing Created',
        value: String(approvedCount),
        subtitle: 'Approved rows already linked to real billing records',
        icon: 'mdi-file-document-check-outline',
        tone: 'green'
      },
      {
        title: 'On Hold',
        value: String(holdCount),
        subtitle: 'Rows paused for validation or missing registrar details',
        icon: 'mdi-pause-circle-outline',
        tone: 'orange'
      },
      {
        title: 'Returned',
        value: String(returnedCount),
        subtitle: 'Rows sent back to registrar for correction',
        icon: 'mdi-undo-variant',
        tone: 'purple'
      }
    ],
    items: paginateRows(filtered, page, perPage),
    meta: buildPaginationMeta(filtered.length, page, perPage),
    filters: {
      statuses: Array.from(new Set(normalizedRows.map((row) => row.status).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
      semesters: Array.from(new Set(normalizedRows.map((row) => row.semester).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
      sources: Array.from(new Set(normalizedRows.map((row) => row.source).filter(Boolean))).sort((left, right) => left.localeCompare(right)),
      offices: Array.from(new Set(normalizedRows.map((row) => row.office).filter(Boolean))).sort((left, right) => left.localeCompare(right))
    }
  };
}

function resolveReportingBoardStatus(reconciliationStatus, reportingStatus) {
  return mapReconciliationStatus(reconciliationStatus) === 'With Discrepancy'
    ? 'With Discrepancy'
    : mapReportingStatus(reportingStatus);
}

function buildReportingStats(activeRows, allRows = activeRows) {
  return [
    {
      title: 'Logged',
      value: String(activeRows.filter((row) => resolveReportingBoardStatus(row.status, row.reporting_status) === 'Logged').length),
      subtitle: 'Paid transactions already visible in reporting',
      icon: 'mdi-clipboard-list-outline',
      tone: 'green'
    },
    {
      title: 'Reconciled',
      value: String(activeRows.filter((row) => resolveReportingBoardStatus(row.status, row.reporting_status) === 'Reconciled').length),
      subtitle: 'Payments matched with documentation',
      icon: 'mdi-check-decagram-outline',
      tone: 'blue'
    },
    {
      title: 'With Discrepancy',
      value: String(activeRows.filter((row) => resolveReportingBoardStatus(row.status, row.reporting_status) === 'With Discrepancy').length),
      subtitle: 'Records that still need discrepancy review',
      icon: 'mdi-chart-box-outline',
      tone: 'orange'
    },
    {
      title: 'Archived',
      value: String(
        allRows.filter(
          (row) =>
            normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)) === WORKFLOW_STAGES.COMPLETED ||
            mapReconciliationStatus(row.status) === 'Archived'
        ).length
      ),
      subtitle: 'Finalized records stored for audit reference',
      icon: 'mdi-archive-outline',
      tone: 'purple'
    }
  ];
}

async function buildReportingSnapshot() {
  const rows = await fetchReconciliationRows();
  const activityRows = await fetchActivityByPrefix('REPORTING_', 4);
  const activeRows = rows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)) === WORKFLOW_STAGES.REPORTING_RECONCILIATION
  );
  const historyRows = rows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)) !== WORKFLOW_STAGES.REPORTING_RECONCILIATION
  );

  const mapRow = (row) => {
    const integration = resolveCashierIntegrationProfile({
      billingCode: row.billing_code,
      sourceModule: row.source_module,
      sourceDepartment: row.source_department,
      sourceCategory: row.source_category,
      integrationProfile: row.integration_profile,
      targetDepartment: row.target_department
    });

    return {
      id: Number(row.payment_id),
      reference: row.reference_number,
      studentName: row.full_name,
      amount: formatCurrency(row.amount_paid),
      billingCode: row.billing_code,
      receiptNumber: row.receipt_number,
      sourceModule: integration.sourceModule,
      sourceDepartment: integration.sourceDepartment,
      sourceCategory: integration.sourceCategory,
      targetDepartment: row.handoff_department || integration.reportingDepartment,
      operationalTargetDepartment: integration.operationalTargetDepartment,
      incomingArtifact: integration.incomingArtifact,
      handoffArtifact: row.handoff_artifact || integration.reportingArtifact,
      reportingArtifact: integration.reportingArtifact,
      departmentFlow: integration.departmentFlow,
      operationalFlow: integration.operationalFlow,
      integrationSummary: integration.integrationSummary,
      operationalHandoffStatus:
        mapPaymentStatus(row.payment_status) === 'Paid'
          ? `Confirmed to ${integration.operationalTargetDepartment}`
          : `Waiting for ${integration.operationalTargetDepartment} payment confirmation`,
      handoffStatus: cleanTextValue(row.handoff_status) || 'pending',
      handoffReference: cleanTextValue(row.handoff_reference) || '',
      requestReference: cleanTextValue(row.request_reference) || '',
      paymentStatus: mapPaymentStatus(row.payment_status),
      documentStatus: mapReceiptStatus(row.receipt_status),
      status: resolveReportingBoardStatus(row.status, row.reporting_status),
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolveReconciliationWorkflowStage(row.status)),
      postedAt: formatShortDate(row.payment_date)
    };
  };

  return {
    stats: buildReportingStats(activeRows, rows),
    items: activeRows.map(mapRow),
    historyItems: historyRows.map(mapRow),
    activityFeed: activityRows.map((row) => ({
      title: row.action,
      detail: row.description,
      time: formatRelativeMinutes(row.created_at)
    }))
  };
}

async function buildReportTransactionItems() {
  const payments = await serializePaymentTransactions();
  const receipts = await serializeReceipts();
  const receiptMap = new Map(receipts.map((item) => [item.paymentId, item]));
  const reconciliationRows = await fetchReconciliationRows();
  const reconciliationMap = new Map(reconciliationRows.map((row) => [Number(row.payment_id), row]));

  return payments.map((payment) => {
    const receipt = receiptMap.get(payment.id) || null;
    const reconciliation = reconciliationMap.get(payment.id) || null;
    const targetDepartment = cleanTextValue(reconciliation?.handoff_department) || payment.reportingDepartment || 'PMED Department';
    const reportingStatus = resolveReportingBoardStatus(reconciliation?.status, payment.rawReportingStatus);
    const handoffStatus =
      cleanTextValue(reconciliation?.handoff_status) ||
      (reportingStatus === 'Reported' ? 'sent' : reportingStatus === 'Reconciled' ? 'ready' : reportingStatus === 'With Discrepancy' ? 'on_hold' : 'pending');

    return {
      id: payment.id,
      referenceNumber: payment.referenceNumber,
      studentName: payment.studentName,
      amount: Number(payment.amount || 0),
      amountFormatted: payment.amountFormatted,
      billingCode: payment.billingCode,
      receiptNumber: receipt?.receiptNumber || '--',
      sourceModule: payment.sourceModule,
      sourceDepartment: payment.sourceDepartment,
      sourceCategory: payment.sourceCategory,
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.status,
      documentationStatus: receipt?.status || 'Receipt Pending',
      reportingStatus,
      workflowStage: payment.workflowStage,
      workflowStageLabel: payment.workflowStageLabel,
      createdAt: payment.paymentDate,
      allocationSummary: payment.allocationSummary,
      allocations: payment.allocations,
      targetDepartment,
      operationalTargetDepartment: payment.targetDepartment,
      incomingArtifact: payment.incomingArtifact,
      handoffArtifact: cleanTextValue(reconciliation?.handoff_artifact) || payment.reportingArtifact,
      reportingArtifact: payment.reportingArtifact,
      integrationSummary: payment.integrationSummary,
      departmentFlow: payment.departmentFlow,
      operationalFlow: payment.operationalFlow,
      operationalHandoffStatus:
        payment.status === 'Paid'
          ? `Confirmed to ${payment.targetDepartment}`
          : `Waiting for ${payment.targetDepartment} payment confirmation`,
      handoffStatus,
      handoffReference: cleanTextValue(reconciliation?.handoff_reference),
      requestReference: cleanTextValue(reconciliation?.request_reference)
    };
  });
}

async function buildDepartmentHandoffSnapshot() {
  const payments = await serializePaymentTransactions();
  const receipts = await serializeReceipts();
  const receiptMap = new Map(receipts.map((item) => [item.paymentId, item]));
  const reconciliationRows = await fetchReconciliationRows();
  const reconciliationMap = new Map(reconciliationRows.map((row) => [Number(row.payment_id), row]));
  const matrix = buildDepartmentServiceMatrix();
  const items = [];

  for (const payment of payments) {
    const receipt = receiptMap.get(payment.id) || null;
    const reconciliation = reconciliationMap.get(payment.id) || null;
    const clearance = deriveCashierClearance(payment.rawStatus, receipt?.rawStatus || '');
    const receiptNumber = cleanTextValue(receipt?.receiptNumber) || 'Pending Receipt';
    const receiptStatus = receipt?.status || 'Receipt Pending';
    const operationalOutputs = ['Payment status', 'Official receipt records', 'Cleared / Not Cleared status'];
    const reportingDepartment =
      cleanTextValue(reconciliation?.handoff_department) || cleanTextValue(payment.reportingDepartment) || 'PMED Department';
    const reportingOutputs = Array.from(
      new Set([
        'Payment status',
        'Official receipt records',
        'Cleared / Not Cleared status',
        cleanTextValue(payment.reportingArtifact) || 'Financial reports'
      ].filter(Boolean))
    );

    items.push({
      id: `operational-${payment.id}`,
      paymentId: payment.id,
      billingId: payment.billingId,
      consumerDepartment: payment.targetDepartment,
      consumerRole: resolveDepartmentRecipientRole(payment.targetDepartment),
      channelType: 'Operational',
      sourceDepartment: payment.sourceDepartment,
      sourceModule: payment.sourceModule,
      sourceCategory: payment.sourceCategory,
      studentName: payment.studentName,
      studentNumber: payment.studentNumber,
      billingCode: payment.billingCode,
      paymentReference: payment.referenceNumber,
      amount: payment.amount,
      amountFormatted: payment.amountFormatted,
      paymentStatus: payment.status,
      receiptNumber,
      receiptStatus,
      clearanceStatus: clearance.status,
      clearanceNote: clearance.note,
      handoffStatus: clearance.status === 'Cleared' ? 'ready' : 'pending',
      handoffReference: cleanTextValue(reconciliation?.handoff_reference),
      requestReference: cleanTextValue(reconciliation?.request_reference),
      outputs: operationalOutputs,
      workflowStage: payment.workflowStage,
      workflowStageLabel: payment.workflowStageLabel,
      integrationSummary: payment.integrationSummary,
      lastUpdatedAt: receipt?.issuedDate || payment.paymentDate || toIsoString(reconciliation?.updated_at)
    });

    items.push({
      id: `reporting-${payment.id}`,
      paymentId: payment.id,
      billingId: payment.billingId,
      consumerDepartment: reportingDepartment,
      consumerRole: resolveDepartmentRecipientRole(reportingDepartment),
      channelType: 'Reporting',
      sourceDepartment: payment.sourceDepartment,
      sourceModule: payment.sourceModule,
      sourceCategory: payment.sourceCategory,
      studentName: payment.studentName,
      studentNumber: payment.studentNumber,
      billingCode: payment.billingCode,
      paymentReference: payment.referenceNumber,
      amount: payment.amount,
      amountFormatted: payment.amountFormatted,
      paymentStatus: payment.status,
      receiptNumber,
      receiptStatus,
      clearanceStatus: clearance.status,
      clearanceNote: clearance.note,
      handoffStatus:
        cleanTextValue(reconciliation?.handoff_status) ||
        (String(payment.rawReportingStatus || '').toLowerCase() === 'reported'
          ? 'sent'
          : String(payment.rawReportingStatus || '').toLowerCase() === 'reconciled'
            ? 'ready'
            : 'pending'),
      handoffReference: cleanTextValue(reconciliation?.handoff_reference),
      requestReference: cleanTextValue(reconciliation?.request_reference),
      outputs: reportingOutputs,
      workflowStage: payment.workflowStage,
      workflowStageLabel: payment.workflowStageLabel,
      integrationSummary: payment.integrationSummary,
      lastUpdatedAt:
        toIsoString(reconciliation?.reported_at) ||
        toIsoString(reconciliation?.updated_at) ||
        receipt?.issuedDate ||
        payment.paymentDate
    });
  }

  const registrarCount = items.filter((item) => item.consumerDepartment === 'Registrar').length;
  const pmedAndAdminCount = items.filter((item) =>
    ['PMED Department', 'Admin Reports'].includes(String(item.consumerDepartment || ''))
  ).length;
  const clearedCount = items.filter((item) => item.channelType === 'Operational' && item.clearanceStatus === 'Cleared').length;
  const unclearedCount = items.filter((item) => item.channelType === 'Operational' && item.clearanceStatus !== 'Cleared').length;

  const latestItems = items
    .slice()
    .sort((left, right) => new Date(right.lastUpdatedAt || 0).getTime() - new Date(left.lastUpdatedAt || 0).getTime())
    .slice(0, 8)
    .map((item) => ({
      ...item,
      lastUpdatedLabel: item.lastUpdatedAt ? formatShortDate(item.lastUpdatedAt) : '--'
    }));

  return {
    stats: [
      {
        title: 'Registrar Linked',
        value: String(registrarCount),
        subtitle: 'Cashier records ready for registrar-facing status visibility',
        icon: 'mdi-school-outline',
        tone: 'blue'
      },
      {
        title: 'PMED / Admin',
        value: String(pmedAndAdminCount),
        subtitle: 'Reporting-facing records visible to PMED and admin reporting desks',
        icon: 'mdi-domain',
        tone: 'purple'
      },
      {
        title: 'Cleared',
        value: String(clearedCount),
        subtitle: 'Operational records with successful payment and official receipt support',
        icon: 'mdi-check-decagram-outline',
        tone: 'green'
      },
      {
        title: 'Not Cleared',
        value: String(unclearedCount),
        subtitle: 'Records still waiting on payment or receipt completion',
        icon: 'mdi-alert-circle-outline',
        tone: 'orange'
      }
    ],
    matrix,
    items,
    latestItems
  };
}

async function buildBpaDashboardSnapshot() {
  const billingRows = await fetchBillingRows();
  const paymentRows = await fetchPaymentRows();
  const receiptRows = await fetchReceiptRows();
  const reconciliationRows = await fetchReconciliationRows();
  const [[correctionRow]] = await pool.query(
    `SELECT
        (SELECT COUNT(*) FROM billing_records WHERE needs_correction = 1) +
        (SELECT COUNT(*) FROM payment_transactions WHERE needs_correction = 1) +
        (SELECT COUNT(*) FROM receipt_records WHERE needs_correction = 1) +
        (SELECT COUNT(*) FROM reconciliations WHERE needs_correction = 1) AS total`
  );
  const portalRows = billingRows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveBillingWorkflowStage(row.billing_status, row.balance_amount)) === WORKFLOW_STAGES.STUDENT_PORTAL_BILLING
  );
  const payBillsRows = billingRows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveBillingWorkflowStage(row.billing_status, row.balance_amount)) === WORKFLOW_STAGES.PAY_BILLS
  );
  const gatewayRows = paymentRows.filter(
    (row) =>
      normalizeWorkflowStage(row.workflow_stage, resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)) ===
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
  );
  const successfulRows = paymentRows.filter((row) => mapPaymentStatus(row.payment_status) === 'Paid');
  const complianceRows = receiptRows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status)) === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
  );
  const reportingQueueRows = reconciliationRows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)) === WORKFLOW_STAGES.REPORTING_RECONCILIATION
  );
  const archivedRows = reconciliationRows.filter(
    (row) => normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)) === WORKFLOW_STAGES.COMPLETED
  );
  const returnedForCorrection = Number(correctionRow?.total || 0);
  const dailyCollection = paymentRows
    .filter((row) => mapPaymentStatus(row.payment_status) === 'Paid')
    .reduce((sum, row) => sum + Number(row.amount_paid || 0), 0);

  return {
    summaryCards: [
      {
        key: 'active-billings',
        title: 'Active Billings',
        subtitle: 'Student billings available in the portal flow',
        value: String(portalRows.length),
        icon: 'mdi-file-document-multiple-outline',
        cardClass: 'analytics-card-green'
      },
      {
        key: 'pending-payments',
        title: 'Pending Payments',
        subtitle: 'Billing records currently waiting inside Pay Bills',
        value: String(payBillsRows.length),
        icon: 'mdi-cash-clock',
        cardClass: 'analytics-card-blue'
      },
      {
        key: 'processing-transactions',
        title: 'Processing Transactions',
        subtitle: 'Gateway requests still waiting for a final outcome',
        value: String(gatewayRows.length),
        icon: 'mdi-credit-card-sync-outline',
        cardClass: 'analytics-card-orange'
      },
      {
        key: 'successful-payments',
        title: 'Successful Payments',
        subtitle: 'Transactions that completed successfully',
        value: String(successfulRows.length),
        icon: 'mdi-check-decagram-outline',
        cardClass: 'analytics-card-purple'
      },
      {
        key: 'generated-receipts',
        title: 'Generated Receipts',
        subtitle: 'Documentation records still active in compliance',
        value: String(complianceRows.length),
        icon: 'mdi-receipt-text-check-outline',
        cardClass: 'analytics-card-green'
      },
      {
        key: 'reconciled-records',
        title: 'Reconciled Records',
        subtitle: 'Reporting records matched with documentation',
        value: String(reconciliationRows.filter((row) => mapReconciliationStatus(row.status) === 'Reconciled').length),
        icon: 'mdi-check-all',
        cardClass: 'analytics-card-blue'
      },
      {
        key: 'returned-for-correction',
        title: 'Returned for Correction',
        subtitle: 'Records currently sent back to a previous module',
        value: String(returnedForCorrection),
        icon: 'mdi-arrow-u-left-top-bold',
        cardClass: 'analytics-card-purple'
      },
      {
        key: 'daily-collection',
        title: 'Daily Collection',
        subtitle: 'Paid amount captured today',
        value: formatCurrency(dailyCollection),
        icon: 'mdi-currency-php',
        cardClass: 'analytics-card-orange'
      },
      {
        key: 'failed-payments',
        title: 'Failed Payments',
        subtitle: 'Transactions that need retry or review',
        value: String(paymentRows.filter((row) => ['Failed', 'Cancelled'].includes(mapPaymentStatus(row.payment_status))).length),
        icon: 'mdi-alert-decagram-outline',
        cardClass: 'analytics-card-purple'
      },
      {
        key: 'archived-transactions',
        title: 'Archived Transactions',
        subtitle: 'Records already moved out of the active BPA flow',
        value: String(archivedRows.length),
        icon: 'mdi-archive-outline',
        cardClass: 'analytics-card-blue'
      }
    ],
    moduleCards: [
      {
        title: 'Student Portal & Billing',
        description: 'View student account statements, billing summaries, unpaid balances, and payment eligibility.',
        icon: 'mdi-account-credit-card-outline',
        accent: 'verification',
        statusSummary: `${portalRows.length} billing record(s) still in Student Portal & Billing`,
        actionLabel: 'Open Module',
        actionTo: '/modules/billing-verification'
      },
      {
        title: 'Pay Bills',
        description: 'Accept full or installment payments, apply payment methods, and prepare bills for gateway processing.',
        icon: 'mdi-cash-multiple',
        accent: 'billing',
        statusSummary: `${payBillsRows.length} billing record(s) waiting in Pay Bills`,
        actionLabel: 'Open Module',
        actionTo: '/modules/manage-billing'
      },
      {
        title: 'Payment Processing & Gateway',
        description: 'Validate transactions, monitor gateway status, and confirm successful or failed payment requests.',
        icon: 'mdi-credit-card-sync-outline',
        accent: 'payment',
        statusSummary: `${gatewayRows.length} transaction(s) in the gateway queue`,
        actionLabel: 'Open Module',
        actionTo: '/modules/process-payment'
      },
      {
        title: 'Compliance & Documentation',
        description: 'Generate proof of payment, verify documentation, and complete official cashier records.',
        icon: 'mdi-file-certificate-outline',
        accent: 'receipt',
        statusSummary: `${complianceRows.length} documentation record(s) still in compliance`,
        actionLabel: 'Open Module',
        actionTo: '/modules/generate-receipt'
      },
      {
        title: 'Completed Transactions',
        description: 'Track final cashier outcomes, archived transactions, and any remaining discrepancy records after compliance.',
        icon: 'mdi-check-decagram-outline',
        accent: 'completed',
        statusSummary: `${reportingQueueRows.length} active completion record(s), ${archivedRows.length} archived transaction(s)`,
        actionLabel: 'View Completed',
        actionTo: '/modules/reports'
      }
    ],
    recentTransactions: paymentRows.slice(0, 6).map((row) => ({
      referenceNumber: row.reference_number,
      studentName: row.full_name,
      amount: formatCurrency(row.amount_paid),
      status: mapPaymentStatus(row.payment_status),
      date: formatShortDate(row.payment_date)
    }))
  };
}

function resolveBillingMutation(action, row) {
  const currentStatus = String(row.billing_status || '').toLowerCase();
  const currentStage = normalizeWorkflowStage(
    row.workflow_stage,
    resolveBillingWorkflowStage(row.billing_status, row.balance_amount)
  );

  if (action === 'approve') {
    return {
      nextStatus: 'verified',
      nextStage: WORKFLOW_STAGES.PAY_BILLS,
      message: 'Billing forwarded to Pay Bills successfully.'
    };
  }
  if (action === 'reject') {
    return {
      nextStatus: 'correction',
      nextStage: WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
      message: 'Billing record returned for correction.'
    };
  }
  if (action === 'notify') return { nextStatus: currentStatus, nextStage: currentStage, message: `Notification sent for ${row.billing_code}.` };
  if (action === 'update') {
    const nextStatus = Number(row.balance_amount || 0) <= 0 ? 'paid' : 'updated';
    return {
      nextStatus,
      nextStage: nextStatus === 'paid' ? WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY : WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
      message: `${row.billing_code} was updated successfully.`
    };
  }
  if (action === 'hold') {
    return {
      nextStatus: 'on_hold',
      nextStage: WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
      message: `${row.billing_code} is now on hold for validation.`
    };
  }
  if (action === 'archive') {
    return {
      nextStatus: 'archived',
      nextStage: WORKFLOW_STAGES.COMPLETED,
      message: `${row.billing_code} was archived from the active billing queue.`
    };
  }

  return null;
}

function nextPaymentReference(billingId) {
  return `PAY-${new Date().getFullYear()}-${String(billingId).padStart(4, '0')}-${String(Date.now()).slice(-5)}`;
}

function nextReceiptNumber(paymentId) {
  return `OR-${new Date().getFullYear()}-${String(paymentId).padStart(4, '0')}`;
}

function paymentMethodOptions() {
  return [
    { code: 'gcash', label: 'GCash', category: 'e-wallet' },
    { code: 'maya', label: 'Maya', category: 'e-wallet' },
    { code: 'bank_transfer', label: 'Bank Transfer', category: 'bank' },
    { code: 'online_banking', label: 'Online Banking', category: 'bank' },
    { code: 'cashier_counter', label: 'Cashier Counter', category: 'cash' }
  ];
}

function buildPaginationMeta(total, page, perPage) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    page,
    perPage,
    total,
    totalPages
  };
}

function applyTextSearch(items, search, selector) {
  const keyword = String(search || '').trim().toLowerCase();
  if (!keyword) return items;
  return items.filter((item) => selector(item).toLowerCase().includes(keyword));
}

function paginateRows(items, page, perPage) {
  const startIndex = (page - 1) * perPage;
  return items.slice(startIndex, startIndex + perPage);
}

async function createPaymentAttempt({
  paymentId = null,
  billingId,
  referenceNumber = null,
  gatewayName = 'Mock Gateway',
  attemptStatus = 'processing',
  requestPayload = null,
  responsePayload = null,
  remarks = null,
  createdBy = null
}) {
  await pool.query(
    `INSERT INTO payment_attempts (
      payment_id, billing_id, reference_number, gateway_name, attempt_status, request_payload_json, response_payload_json, remarks, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paymentId,
      billingId,
      referenceNumber,
      gatewayName,
      attemptStatus,
      requestPayload ? JSON.stringify(requestPayload) : null,
      responsePayload ? JSON.stringify(responsePayload) : null,
      remarks,
      createdBy,
      nowSql()
    ]
  );
}

async function ensureProofDocument(paymentId, receiptId, actorUserId = null) {
  await pool.query(
    `INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
     SELECT ?, ?, 'proof_of_payment', CONCAT('proof-', ?, '.pdf'), 'pending', ?, NULL, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM proof_documents WHERE receipt_id = ? AND payment_id = ?
     )`,
    [receiptId, paymentId, paymentId, actorUserId, nowSql(), receiptId, paymentId]
  );
}

async function upsertReconciliationRecord(paymentId, receiptId = null, status = 'pending_review', fields = {}) {
  await pool.query(
    `INSERT INTO reconciliations (
      payment_id, receipt_id, status, workflow_stage, discrepancy_note, handoff_department, handoff_artifact, handoff_reference, handoff_status, request_reference, handoff_notes,
      previous_workflow_stage, action_by, action_at, audit_reference, is_completed, reconciled_by, reconciled_at, reported_at, archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (payment_id) DO UPDATE SET
      receipt_id = COALESCE(EXCLUDED.receipt_id, reconciliations.receipt_id),
      status = EXCLUDED.status,
      workflow_stage = EXCLUDED.workflow_stage,
      discrepancy_note = COALESCE(EXCLUDED.discrepancy_note, reconciliations.discrepancy_note),
      handoff_department = COALESCE(EXCLUDED.handoff_department, reconciliations.handoff_department),
      handoff_artifact = COALESCE(EXCLUDED.handoff_artifact, reconciliations.handoff_artifact),
      handoff_reference = COALESCE(EXCLUDED.handoff_reference, reconciliations.handoff_reference),
      handoff_status = COALESCE(EXCLUDED.handoff_status, reconciliations.handoff_status),
      request_reference = COALESCE(EXCLUDED.request_reference, reconciliations.request_reference),
      handoff_notes = COALESCE(EXCLUDED.handoff_notes, reconciliations.handoff_notes),
      previous_workflow_stage = COALESCE(EXCLUDED.previous_workflow_stage, reconciliations.previous_workflow_stage),
      action_by = COALESCE(EXCLUDED.action_by, reconciliations.action_by),
      action_at = COALESCE(EXCLUDED.action_at, reconciliations.action_at),
      audit_reference = COALESCE(EXCLUDED.audit_reference, reconciliations.audit_reference),
      is_completed = CASE WHEN EXCLUDED.is_completed = 1 THEN 1 ELSE reconciliations.is_completed END,
      reconciled_by = COALESCE(EXCLUDED.reconciled_by, reconciliations.reconciled_by),
      reconciled_at = COALESCE(EXCLUDED.reconciled_at, reconciliations.reconciled_at),
      reported_at = COALESCE(EXCLUDED.reported_at, reconciliations.reported_at),
      archived_at = COALESCE(EXCLUDED.archived_at, reconciliations.archived_at),
      updated_at = EXCLUDED.updated_at`,
    [
      paymentId,
      receiptId,
      status,
      fields.workflowStage || resolveReconciliationWorkflowStage(status),
      fields.discrepancyNote || null,
      fields.handoffDepartment || null,
      fields.handoffArtifact || null,
      fields.handoffReference || null,
      fields.handoffStatus || null,
      fields.requestReference || null,
      fields.handoffNotes || null,
      fields.previousWorkflowStage || null,
      fields.actionBy || null,
      fields.actionAt || null,
      fields.auditReference || null,
      fields.isCompleted ? 1 : 0,
      fields.reconciledBy || null,
      fields.reconciledAt || null,
      fields.reportedAt || null,
      fields.archivedAt || null,
      nowSql(),
      nowSql()
    ]
  );
}

async function serializeBillingList() {
  const rows = await fetchBillingRows();
  const itemRows = await fetchBillingItemRows();
  const allocationRows = await fetchPaymentAllocationRows();
  const feeBreakdownMap = buildBillingFeeBreakdown(itemRows, allocationRows);

  return rows.map((row) => {
    const feeBreakdown =
      feeBreakdownMap.get(Number(row.id)) || {
      items: [],
      summary: {
        totalFees: 0,
        paidCount: 0,
        partialCount: 0,
        unpaidCount: 0,
        committedAmount: Number(row.paid_amount || 0),
        finalizedAmount: Number(row.paid_amount || 0),
        remainingAmount: Number(row.balance_amount || 0),
        committedAmountFormatted: formatCurrency(row.paid_amount),
        finalizedAmountFormatted: formatCurrency(row.paid_amount),
        remainingAmountFormatted: formatCurrency(row.balance_amount),
        label: '0 Paid | 0 Partial | 0 Unpaid'
      }
      };
    const integration = resolveCashierIntegrationProfile({
      billingCode: row.billing_code,
      sourceModule: row.source_module,
      sourceDepartment: row.source_department,
      sourceCategory: row.source_category,
      integrationProfile: row.integration_profile,
      targetDepartment: row.target_department,
      feeItems: feeBreakdown.items || []
    });

    return {
      ...feeBreakdown,
      id: Number(row.id),
      studentId: Number(row.student_id || 0),
      studentName: row.full_name,
      studentNumber: row.student_no,
      billingCode: row.billing_code,
      invoiceNumber: row.billing_code,
      sourceModule: integration.sourceModule,
      sourceDepartment: integration.sourceDepartment,
      sourceCategory: integration.sourceCategory,
      integrationProfile: integration.integrationProfile,
      targetDepartment: integration.operationalTargetDepartment,
      reportingDepartment: integration.reportingDepartment,
      incomingArtifact: integration.incomingArtifact,
      handoffArtifact: integration.operationalArtifact,
      reportingArtifact: integration.reportingArtifact,
      departmentFlow: integration.departmentFlow,
      operationalFlow: integration.operationalFlow,
      integrationSummary: integration.integrationSummary,
      semester: row.semester,
      schoolYear: row.school_year,
      term: `${row.semester} ${row.school_year}`,
      program: row.course || 'General Program',
      yearLevel: row.year_level || '--',
      totalAmount: Number(row.total_amount || 0),
      totalAmountFormatted: formatCurrency(row.total_amount),
      paidAmount: Number((feeBreakdown.summary.committedAmount ?? row.paid_amount) || 0),
      paidAmountFormatted: formatCurrency(feeBreakdown.summary.committedAmount ?? row.paid_amount),
      balanceAmount: Number((feeBreakdown.summary.remainingAmount ?? row.balance_amount) || 0),
      balanceAmountFormatted: formatCurrency(feeBreakdown.summary.remainingAmount ?? row.balance_amount),
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolveBillingWorkflowStage(row.billing_status, row.balance_amount)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolveBillingWorkflowStage(row.billing_status, row.balance_amount)),
      status: mapBillingWorkflowStatus(row.billing_status, feeBreakdown.summary.remainingAmount ?? row.balance_amount),
      rawStatus: String(row.billing_status || ''),
      paymentEligible: ['Active Billing', 'Pending Payment', 'Partially Paid'].includes(
        mapBillingWorkflowStatus(row.billing_status, feeBreakdown.summary.remainingAmount ?? row.balance_amount)
      ),
      dueDate: toIsoString(row.updated_at || row.created_at),
      dueDateFormatted: formatShortDate(row.updated_at || row.created_at),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
      items: feeBreakdown.items || [],
      feeSummary: feeBreakdown.summary || null
    };
  });
}

async function serializePaymentTransactions() {
  const rows = await fetchPaymentRows();
  const attemptRows = await fetchPaymentAttemptRows();
  const allocationRows = await fetchPaymentAllocationRows();
  const attemptMap = new Map();
  const allocationMap = buildPaymentAllocationMap(allocationRows);

  for (const item of attemptRows) {
    const paymentId = Number(item.payment_id || 0);
    if (!paymentId) continue;
    if (!attemptMap.has(paymentId)) attemptMap.set(paymentId, []);
    attemptMap.get(paymentId).push({
      id: Number(item.id),
      gatewayName: item.gateway_name,
      status: item.attempt_status,
      referenceNumber: item.reference_number,
      requestPayload: safeJsonParse(item.request_payload_json, {}),
      responsePayload: safeJsonParse(item.response_payload_json, {}),
      remarks: item.remarks,
      createdAt: toIsoString(item.created_at)
    });
  }

  return rows.map((row) => {
    const allocations = allocationMap.get(Number(row.payment_id))?.items || [];
    const integration = resolveCashierIntegrationProfile({
      billingCode: row.billing_code,
      sourceModule: row.source_module,
      sourceDepartment: row.source_department,
      sourceCategory: row.source_category,
      integrationProfile: row.integration_profile,
      targetDepartment: row.target_department,
      feeItems: allocations
    });

    return {
      id: Number(row.payment_id),
      billingId: Number(row.billing_id),
      referenceNumber: row.reference_number,
      studentName: row.full_name,
      studentNumber: row.student_no,
      billingCode: row.billing_code,
      sourceModule: integration.sourceModule,
      sourceDepartment: integration.sourceDepartment,
      sourceCategory: integration.sourceCategory,
      integrationProfile: integration.integrationProfile,
      targetDepartment: integration.operationalTargetDepartment,
      reportingDepartment: integration.reportingDepartment,
      incomingArtifact: integration.incomingArtifact,
      handoffArtifact: integration.operationalArtifact,
      reportingArtifact: integration.reportingArtifact,
      departmentFlow: integration.departmentFlow,
      operationalFlow: integration.operationalFlow,
      integrationSummary: integration.integrationSummary,
      amount: Number(row.amount_paid || 0),
      amountFormatted: formatCurrency(row.amount_paid),
      paymentMethod: row.payment_method,
      status: mapPaymentStatus(row.payment_status),
      rawStatus: String(row.payment_status || ''),
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)),
      reportingStatus: mapReportingStatus(row.reporting_status),
      rawReportingStatus: String(row.reporting_status || ''),
      paymentDate: toIsoString(row.payment_date),
      paymentDateFormatted: formatShortDate(row.payment_date),
      balanceAmount: Number(row.balance_amount || 0),
      balanceAmountFormatted: formatCurrency(row.balance_amount),
      attempts: attemptMap.get(Number(row.payment_id)) || [],
      allocations,
      allocationSummary: allocationMap.get(Number(row.payment_id))?.summary || 'No fee allocations yet.',
      totalAllocated: allocationMap.get(Number(row.payment_id))?.totalAllocated || 0,
      totalAllocatedFormatted: allocationMap.get(Number(row.payment_id))?.totalAllocatedFormatted || formatCurrency(0)
    };
  });
}

async function serializeReceipts() {
  const rows = await fetchReceiptRows();
  const proofRows = await fetchProofDocumentRows();
  const receiptItemRows = await fetchReceiptItemRows();
  const paymentAllocationRows = await fetchPaymentAllocationRows();
  const proofMap = new Map();
  const receiptItemMap = new Map();
  const paymentAllocationMap = buildPaymentAllocationMap(paymentAllocationRows);

  for (const item of proofRows) {
    const receiptId = Number(item.receipt_id || 0);
    if (!receiptId) continue;
    if (!proofMap.has(receiptId)) proofMap.set(receiptId, []);
    proofMap.get(receiptId).push({
      id: Number(item.id),
      paymentId: Number(item.payment_id),
      documentType: item.document_type,
      fileName: item.file_name,
      status: item.status,
      verifiedBy: item.verified_by,
      verifiedAt: toIsoString(item.verified_at),
      createdAt: toIsoString(item.created_at)
    });
  }

  for (const item of receiptItemRows) {
    const receiptId = Number(item.receipt_id || 0);
    if (!receiptId) continue;
    if (!receiptItemMap.has(receiptId)) receiptItemMap.set(receiptId, []);
    receiptItemMap.get(receiptId).push({
      id: Number(item.id),
      billingItemId: Number(item.billing_item_id || 0),
      feeType: item.fee_type,
      allocatedAmount: Number(item.allocated_amount || 0),
      allocatedAmountFormatted: formatCurrency(item.allocated_amount)
    });
  }

  return rows.map((row) => {
    const receiptItems = receiptItemMap.get(Number(row.receipt_id || 0)) || paymentAllocationMap.get(Number(row.payment_id))?.items || [];
    const integration = resolveCashierIntegrationProfile({
      billingCode: row.billing_code,
      sourceModule: row.source_module,
      sourceDepartment: row.source_department,
      sourceCategory: row.source_category,
      integrationProfile: row.integration_profile,
      targetDepartment: row.target_department,
      feeItems: receiptItems
    });

    return {
      id: Number(row.receipt_id || 0),
      paymentId: Number(row.payment_id),
      receiptNumber: row.receipt_number,
      studentName: row.full_name,
      paymentReference: row.reference_number,
      billingCode: row.billing_code,
      sourceModule: integration.sourceModule,
      sourceDepartment: integration.sourceDepartment,
      sourceCategory: integration.sourceCategory,
      integrationProfile: integration.integrationProfile,
      targetDepartment: integration.operationalTargetDepartment,
      reportingDepartment: integration.reportingDepartment,
      incomingArtifact: integration.incomingArtifact,
      handoffArtifact: integration.operationalArtifact,
      reportingArtifact: integration.reportingArtifact,
      departmentFlow: integration.departmentFlow,
      operationalFlow: integration.operationalFlow,
      integrationSummary: integration.integrationSummary,
      paymentMethod: row.payment_method,
      paymentStatus: mapPaymentStatus(row.payment_status),
      amount: Number(row.amount_paid || 0),
      amountFormatted: formatCurrency(row.amount_paid),
      status: mapReceiptStatus(row.receipt_status),
      rawStatus: String(row.receipt_status || ''),
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolveReceiptWorkflowStage(row.receipt_status)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolveReceiptWorkflowStage(row.receipt_status)),
      issuedDate: toIsoString(row.issued_date),
      issuedDateFormatted: formatShortDate(row.issued_date),
      remarks: row.remarks,
      proofDocuments: proofMap.get(Number(row.receipt_id || 0)) || [],
      receiptItems,
      allocationSummary:
        receiptItems.map((item) => `${item.feeType}: ${item.allocatedAmountFormatted}`).join(' | ') ||
        paymentAllocationMap.get(Number(row.payment_id))?.summary ||
        'No fee allocations yet.'
    };
  });
}

function studentActorFromSession(student) {
  return {
    id: null,
    username: student.username,
    full_name: student.full_name,
    role: 'Student'
  };
}

async function buildStudentAccountStatementPayload(studentId) {
  const [studentRows] = await pool.query(
    `SELECT id, student_no, full_name, course, year_level, email, phone, status
     FROM students
     WHERE id = ?
     LIMIT 1`,
    [studentId]
  );
  const student = studentRows[0];
  if (!student) {
    throw new Error('Student record not found.');
  }

  const billings = (await serializeBillingList()).filter((item) => item.studentId === Number(studentId));
  const totalAssessment = billings.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalPaid = billings.reduce((sum, item) => sum + item.paidAmount, 0);
  const totalBalance = billings.reduce((sum, item) => sum + item.balanceAmount, 0);

  return {
    student: {
      id: Number(student.id),
      studentNumber: student.student_no,
      fullName: student.full_name,
      program: student.course,
      yearLevel: student.year_level,
      email: student.email,
      phone: student.phone,
      status: student.status
    },
    summary: {
      totalAssessment,
      totalAssessmentFormatted: formatCurrency(totalAssessment),
      totalPaid,
      totalPaidFormatted: formatCurrency(totalPaid),
      totalBalance,
      totalBalanceFormatted: formatCurrency(totalBalance)
    },
    billings
  };
}

async function createAutoDebitArrangement({
  billingId,
  accountName,
  bankName = null,
  accountMask = null,
  frequency = 'monthly',
  createdBy = null
}) {
  await pool.query(
    `INSERT INTO auto_debit_arrangements (
      billing_id, account_name, bank_name, account_mask, frequency, status, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
    [billingId, accountName, bankName, accountMask, frequency, createdBy, nowSql()]
  );
}

async function createPaymentRequest({
  billingId,
  paymentMethod,
  requestedAmount,
  allocationMode = 'auto',
  allocations = [],
  remarks = '',
  actorUser,
  ipAddress = '127.0.0.1',
  requestPayload = {},
  moduleKey = 'manage_billing',
  rawAction = 'PAY_BILLS_CREATE_PAYMENT',
  actionLabel = 'Payment Request Created',
  notificationTitle = 'Payment request pending',
  notificationType = 'payment_pending',
  descriptionPrefix = 'was created',
  billingStageAfterCreate = WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
}) {
  const [rows] = await pool.query(
    `SELECT b.id, b.billing_code, b.billing_status, b.total_amount, b.paid_amount, b.balance_amount, s.full_name
     FROM billing_records b
     INNER JOIN students s ON s.id = b.student_id
     WHERE b.id = ?
     LIMIT 1`,
    [billingId]
  );
  const billingRow = rows[0];
  if (!billingRow) {
    throw new Error('Billing record not found.');
  }

  if (!canCreatePaymentFromBilling(billingRow.billing_status)) {
    throw new Error('Payment cannot proceed unless the billing is already active for payment.');
  }

  const remainingBalance = Number(billingRow.balance_amount || 0);
  if (requestedAmount > remainingBalance) {
    throw new Error('Payment amount cannot exceed the remaining balance.');
  }

  const referenceNumber = nextPaymentReference(billingId);

  const [insertedRows] = await pool.query(
    `INSERT INTO payment_transactions (
      billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage, payment_date, processed_by, remarks, created_at
    ) VALUES (?, ?, ?, ?, 'processing', 'logged', ?, ?, ?, ?, ?)
     RETURNING id`,
    [billingId, referenceNumber, requestedAmount, paymentMethod, WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY, nowSql(), actorUser?.id || null, remarks || null, nowSql()]
  );
  const paymentId = Number(insertedRows[0]?.id);
  if (!paymentId) {
    throw new Error('Unable to create payment transaction.');
  }

  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', 8900.00, 1, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2001'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'TUITION'
       )`,
    [nowSql()]
  );
  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'LAB', 'Laboratory Fee', 'Laboratory', 2450.00, 2, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2001'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'LAB'
       )`,
    [nowSql()]
  );
  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'MISC', 'Miscellaneous Fee', 'Assessment', 1900.00, 3, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2001'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'MISC'
       )`,
    [nowSql()]
  );
  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'TUITION', 'Tuition Fee', 'Tuition', 6400.00, 1, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2002'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'TUITION'
       )`,
    [nowSql()]
  );
  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'REGISTRATION', 'Registration Fee', 'Services', 1475.00, 2, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2002'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'REGISTRATION'
       )`,
    [nowSql()]
  );
  await pool.query(
    `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
     SELECT b.id, 'FOUNDATION', 'Foundation Fee', 'Institutional', 2000.00, 3, ?
     FROM billing_records b
     WHERE b.billing_code = 'BILL-VERIFY-2002'
       AND NOT EXISTS (
         SELECT 1 FROM billing_items bi WHERE bi.billing_id = b.id AND bi.item_code = 'FOUNDATION'
       )`,
    [nowSql()]
  );

  await createPaymentAllocations({
    paymentId,
    billingId,
    paymentAmount: requestedAmount,
    allocationMode,
    manualAllocations: allocations,
    remarks
  });
  const recalculated = await recalculateBillingFinancials(billingId, {
    workflowStage: billingStageAfterCreate
  });

  await createPaymentAttempt({
    paymentId,
    billingId,
    referenceNumber,
    attemptStatus: 'processing',
    requestPayload,
    responsePayload: { accepted: true, forwardedTo: 'Payment Processing & Gateway' },
    remarks: 'Payment request created from Pay Bills.',
    createdBy: actorUser?.id || null
  });

  await recordWorkflowEvent({
    actorUser,
    ipAddress,
    rawAction,
    action: actionLabel,
    description: `${referenceNumber} ${descriptionPrefix} for ${billingRow.billing_code} and forwarded to Payment Processing & Gateway.`,
    moduleKey,
    entityType: 'payment',
    entityId: paymentId,
    beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
    afterStatus: mapBillingWorkflowStatus(recalculated.status, recalculated.remainingAmount),
    beforeStage: normalizeWorkflowStage(
      billingRow.workflow_stage,
      resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
    ),
    afterStage: billingStageAfterCreate,
    notification: {
      type: notificationType,
      title: notificationTitle,
      message: `${referenceNumber} for ${billingRow.billing_code} is waiting in ${workflowStageLabel(WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY)}.`
    }
  });

  return {
    ...buildWorkflowActionPayload(
      `${referenceNumber} ${descriptionPrefix} for ${billingRow.billing_code} and forwarded to ${workflowStageLabel(WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY)}.`,
      'Processing',
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
    ),
    id: paymentId,
    referenceNumber,
    billingCode: billingRow.billing_code
  };
}

async function executeGatewayAction({ paymentId, action, actorUser, ipAddress = '127.0.0.1', requestPayload = {} }) {
  const [rows] = await pool.query(
    `SELECT
        p.id,
        p.billing_id,
        p.reference_number,
        p.amount_paid,
        p.payment_status,
        p.reporting_status,
        p.workflow_stage,
        b.billing_code,
        b.source_module,
        b.source_department,
        b.source_category,
        b.integration_profile,
        b.target_department,
        b.total_amount,
        b.paid_amount,
        b.balance_amount,
        b.billing_status,
        b.workflow_stage AS billing_workflow_stage,
        s.full_name
     FROM payment_transactions p
     INNER JOIN billing_records b ON b.id = p.billing_id
     INNER JOIN students s ON s.id = b.student_id
     WHERE p.id = ?
     LIMIT 1`,
    [paymentId]
  );
  const paymentRow = rows[0];
  if (!paymentRow) {
    throw new Error('Payment transaction not found.');
  }

  if (action === 'process') {
    await pool.query(`UPDATE payment_transactions SET payment_status = 'processing', workflow_stage = ?, payment_date = ?, processed_by = ? WHERE id = ?`, [
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
      nowSql(),
      actorUser.id,
      paymentId
    ]);
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'processing',
      requestPayload,
      responsePayload: { gatewayStatus: 'processing' },
      remarks: 'Gateway processing started.',
      createdBy: actorUser.id
    });
    return { status: 'Processing', message: `${paymentRow.reference_number} is now processing.` };
  }

  if (action === 'authorize') {
    await pool.query(`UPDATE payment_transactions SET payment_status = 'authorized', workflow_stage = ?, payment_date = ?, processed_by = ? WHERE id = ?`, [
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
      nowSql(),
      actorUser.id,
      paymentId
    ]);
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'authorized',
      requestPayload,
      responsePayload: { gatewayStatus: 'authorized' },
      remarks: 'Gateway authorization completed.',
      createdBy: actorUser.id
    });
    await recordWorkflowEvent({
      actorUser,
      ipAddress,
      rawAction: 'PAYMENT_GATEWAY_AUTHORIZE',
      action: 'Payment Authorized',
      description: `${paymentRow.reference_number} was authorized for ${paymentRow.billing_code}.`,
      moduleKey: 'process_payment',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Authorized',
      beforeStage: normalizeWorkflowStage(
        paymentRow.workflow_stage,
        resolvePaymentWorkflowStage(paymentRow.payment_status, null, paymentRow.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
    });
    return buildWorkflowActionPayload(
      `${paymentRow.reference_number} was authorized and remains in Payment Processing & Gateway.`,
      'Authorized',
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
    );
  }

  if (action === 'confirm' || action === 'capture') {
    const integration = resolveCashierIntegrationProfile({
      billingCode: paymentRow.billing_code,
      sourceModule: paymentRow.source_module,
      sourceDepartment: paymentRow.source_department,
      sourceCategory: paymentRow.source_category,
      integrationProfile: paymentRow.integration_profile,
      targetDepartment: paymentRow.target_department
    });
    const [allocationRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM payment_allocations
       WHERE payment_id = ?`,
      [paymentId]
    );
    if (!Number(allocationRows[0]?.total || 0)) {
      throw new Error('Payment allocations are required before confirming a paid transaction.');
    }

    await pool.query(`UPDATE payment_allocations SET allocation_status = 'finalized', updated_at = ? WHERE payment_id = ?`, [nowSql(), paymentId]);
    const recalculated = await recalculateBillingFinancials(Number(paymentRow.billing_id), {
      workflowStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
    });
    await pool.query(
      `UPDATE payment_transactions
       SET payment_status = 'paid',
           reporting_status = 'logged',
           workflow_stage = ?,
           payment_date = ?,
           processed_by = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, nowSql(), actorUser.id, paymentId]
    );

    await pool.query(
      `UPDATE billing_records
       SET workflow_stage = ?, updated_at = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, nowSql(), paymentRow.billing_id]
    );

    await pool.query(
      `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, created_at)
       VALUES (?, ?, ?, 'queued', ?, 'Receipt is pending generation after successful payment.', ?)
       ON CONFLICT (receipt_number) DO UPDATE SET
         issued_date = EXCLUDED.issued_date,
         workflow_stage = EXCLUDED.workflow_stage,
         receipt_status = 'queued',
         remarks = EXCLUDED.remarks`,
      [paymentId, nextReceiptNumber(paymentId), nowSql(), WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, nowSql()]
    );

    const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
    const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;
    if (receiptId) {
      await ensureProofDocument(paymentId, receiptId, actorUser.id);
      await replaceReceiptItemsFromPayment(paymentId, receiptId);
      await upsertReconciliationRecord(paymentId, receiptId, 'pending_review', {
        workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
      });
    }

    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'paid',
      requestPayload,
      responsePayload: { gatewayStatus: 'paid' },
      remarks: 'Gateway confirmed the payment as paid.',
      createdBy: actorUser.id
    });
    await recordWorkflowEvent({
      actorUser,
      ipAddress,
      rawAction: 'PAYMENT_GATEWAY_CONFIRM',
      action: 'Payment Confirmed',
      description: `${paymentRow.reference_number} was confirmed as paid and forwarded to Compliance & Documentation.`,
      moduleKey: 'process_payment',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Paid',
      beforeStage: normalizeWorkflowStage(
        paymentRow.workflow_stage,
        resolvePaymentWorkflowStage(paymentRow.payment_status, null, paymentRow.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      notification: {
        type: 'payment_successful',
        title: 'Payment successful',
        message: `${paymentRow.reference_number} succeeded and is ready for receipt generation.`
      }
    });
    await insertSystemNotification({
      recipientRole: integration.recipientRole,
      recipientName: integration.operationalTargetDepartment,
      type: 'department_payment_confirmation',
      title: `${integration.sourceDepartment} payment confirmed`,
      message: `${paymentRow.reference_number} for ${paymentRow.billing_code} is paid. Cashier sent ${integration.operationalArtifact.toLowerCase()} to ${integration.operationalTargetDepartment}.`,
      entityType: 'payment',
      entityId: paymentId
    });
    return buildWorkflowActionPayload(
      `${paymentRow.reference_number} is now paid and moved to Compliance & Documentation.`,
      'Paid',
      WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
    );
  }

  if (action === 'fail') {
    await pool.query(`UPDATE payment_allocations SET allocation_status = 'cancelled', updated_at = ? WHERE payment_id = ?`, [nowSql(), paymentId]);
    await pool.query(
      `UPDATE payment_transactions
       SET payment_status = 'failed', workflow_stage = ?, payment_date = ?, processed_by = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.PAY_BILLS, nowSql(), actorUser.id, paymentId]
    );
    await pool.query(
      `UPDATE billing_records
       SET workflow_stage = ?, updated_at = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.PAY_BILLS, nowSql(), paymentRow.billing_id]
    );
    await recalculateBillingFinancials(Number(paymentRow.billing_id), {
      workflowStage: WORKFLOW_STAGES.PAY_BILLS
    });
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'failed',
      requestPayload,
      responsePayload: { gatewayStatus: 'failed' },
      remarks: 'Gateway rejected the payment request.',
      createdBy: actorUser.id
    });
    await recordWorkflowEvent({
      actorUser,
      ipAddress,
      rawAction: 'PAYMENT_GATEWAY_FAIL',
      action: 'Payment Failed',
      description: `${paymentRow.reference_number} failed during gateway processing.`,
      moduleKey: 'process_payment',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Failed',
      beforeStage: normalizeWorkflowStage(
        paymentRow.workflow_stage,
        resolvePaymentWorkflowStage(paymentRow.payment_status, null, paymentRow.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        type: 'payment_failed',
        title: 'Payment failed',
        message: `${paymentRow.reference_number} failed and was returned to Pay Bills.`
      }
    });
    return buildWorkflowActionPayload(
      `${paymentRow.reference_number} failed and was returned to Pay Bills.`,
      'Failed',
      WORKFLOW_STAGES.PAY_BILLS
    );
  }

  if (action === 'cancel') {
    await pool.query(`UPDATE payment_allocations SET allocation_status = 'cancelled', updated_at = ? WHERE payment_id = ?`, [nowSql(), paymentId]);
    await pool.query(
      `UPDATE payment_transactions
       SET payment_status = 'cancelled', workflow_stage = ?, payment_date = ?, processed_by = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.PAY_BILLS, nowSql(), actorUser.id, paymentId]
    );
    await pool.query(
      `UPDATE billing_records
       SET workflow_stage = ?, updated_at = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.PAY_BILLS, nowSql(), paymentRow.billing_id]
    );
    await recalculateBillingFinancials(Number(paymentRow.billing_id), {
      workflowStage: WORKFLOW_STAGES.PAY_BILLS
    });
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'cancelled',
      requestPayload,
      responsePayload: { gatewayStatus: 'cancelled' },
      remarks: 'Gateway transaction was cancelled.',
      createdBy: actorUser.id
    });
    await recordWorkflowEvent({
      actorUser,
      ipAddress,
      rawAction: 'PAYMENT_GATEWAY_CANCEL',
      action: 'Payment Cancelled',
      description: `${paymentRow.reference_number} was cancelled before final posting.`,
      moduleKey: 'process_payment',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Cancelled'
      ,
      beforeStage: normalizeWorkflowStage(
        paymentRow.workflow_stage,
        resolvePaymentWorkflowStage(paymentRow.payment_status, null, paymentRow.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.PAY_BILLS
    });
    return buildWorkflowActionPayload(
      `${paymentRow.reference_number} was cancelled and returned to Pay Bills.`,
      'Cancelled',
      WORKFLOW_STAGES.PAY_BILLS
    );
  }

  throw new Error('Unsupported gateway action.');
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1 AS ok');
    sendOk(res, { status: 'ok', database: 'supabase', serverTime: new Date().toISOString() });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Database connection failed.');
  }
});

app.get('/api/bpa-dashboard', requireAuth, async (_req, res) => {
  try {
    const payload = await buildBpaDashboardSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load BPA dashboard snapshot.');
  }
});

app.get('/api/admin-auth', async (req, res) => {
  try {
    const user = await readSessionUser(req);
    const unreadNotifications = user ? await countUnreadNotifications() : 0;
    sendOk(res, {
      authenticated: Boolean(user),
      user: user ? { ...toAdminUser(user), unreadNotifications } : null
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to read admin session.');
  }
});

app.post('/api/admin-auth', async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();

    if (action === 'login') {
      const username = String(req.body?.username || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!username || !password) {
        sendError(res, 422, 'Username and password are required.');
        return;
      }

      const user = await getAdminByUsername(username);
      if (!user || String(user.status).toLowerCase() !== 'active' || !verifyPassword(password, user.password_hash)) {
        sendError(res, 401, 'Invalid login credentials.');
        return;
      }

      const token = randomBytes(24).toString('hex');
      sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionTtlMs });
      res.cookie(sessionCookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: sessionTtlMs
      });

      await pool.query('UPDATE admin_users SET last_login_at = ? WHERE id = ?', [nowSql(), user.id]);
      await insertActivityLog(user.id, 'Login', 'Admin signed in to Cashier System.', req.ip || '127.0.0.1');

      sendOk(res, { user: { ...toAdminUser(user), unreadNotifications: await countUnreadNotifications() } }, 'Login successful.');
      return;
    }

    if (action === 'logout') {
      const token = req.cookies?.[sessionCookieName];
      const user = await readSessionUser(req);
      if (token) sessions.delete(token);
      res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: 'lax', secure: false });
      if (user) {
        await insertActivityLog(user.id, 'Logout', 'Admin signed out of Cashier System.', req.ip || '127.0.0.1');
      }
      sendOk(res, {});
      return;
    }

    if (action === 'create_account') {
      const currentUser = await readSessionUser(req);
      if (!currentUser || !currentUser.is_super_admin) {
        sendError(res, 403, 'Only super admin can create admin accounts.');
        return;
      }

      const username = String(req.body?.username || '').trim().toLowerCase();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const fullName = String(req.body?.full_name || '').trim();
      const password = String(req.body?.password || '');

      if (!username || !email || !fullName || !password) {
        sendError(res, 422, 'Missing required create_account fields.');
        return;
      }

      await pool.query(
        `INSERT INTO admin_users (
          username, email, full_name, role, department, access_exemptions_json, is_super_admin, password_hash, status, phone
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          username,
          email,
          fullName,
          String(req.body?.role || 'Cashier Staff').trim(),
          String(req.body?.department || 'Cashier').trim(),
          JSON.stringify(Array.isArray(req.body?.access_exemptions) ? req.body.access_exemptions : []),
          req.body?.is_super_admin ? 1 : 0,
          hashPassword(password),
          String(req.body?.status || 'active').trim(),
          String(req.body?.phone || '').trim() || null
        ]
      );

      const created = await getAdminByUsername(username);
      if (created) {
        await pool.query(
          `INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode)
           VALUES (?, 1, 1, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [created.id]
        );
      }

      sendOk(res, {});
      return;
    }

    sendError(res, 400, 'Unsupported admin auth action.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Admin auth request failed.');
  }
});

app.get('/api/student-auth', async (req, res) => {
  try {
    const account = await readStudentSession(req);
    sendOk(res, {
      authenticated: Boolean(account),
      account: account ? toStudentPortalUser(account) : null
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to read student session.');
  }
});

app.post('/api/student-auth', async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();

    if (action === 'login') {
      const login = String(req.body?.login || req.body?.username || req.body?.studentNumber || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!login || !password) {
        sendError(res, 422, 'Student number or email and password are required.');
        return;
      }

      const account = await getStudentAccountByLogin(login);
      if (!account || String(account.status || '').toLowerCase() !== 'active' || !verifyPassword(password, account.password_hash)) {
        sendError(res, 401, 'Invalid student portal credentials.');
        return;
      }

      const token = randomBytes(24).toString('hex');
      studentSessions.set(token, { accountId: account.id, expiresAt: Date.now() + sessionTtlMs });
      res.cookie(studentSessionCookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: sessionTtlMs
      });

      sendOk(res, { account: toStudentPortalUser(account) }, 'Student portal login successful.');
      return;
    }

    if (action === 'logout') {
      const token = req.cookies?.[studentSessionCookieName];
      if (token) studentSessions.delete(token);
      res.clearCookie(studentSessionCookieName, { httpOnly: true, sameSite: 'lax', secure: false });
      sendOk(res, {});
      return;
    }

    sendError(res, 400, 'Unsupported student auth action.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Student auth request failed.');
  }
});

app.get('/api/admin-profile', requireAuth, async (req, res) => {
  try {
    const user = req.currentUser;
    const [prefRows] = await pool.query(
      `SELECT email_notifications, in_app_notifications, dark_mode
       FROM admin_profile_preferences
       WHERE user_id = ?
       LIMIT 1`,
      [user.id]
    );
    const [logRows] = await pool.query(
      `SELECT action, raw_action, description, ip_address, created_at
       FROM admin_activity_logs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [user.id]
    );

    const prefs = prefRows[0] || {
      email_notifications: 1,
      in_app_notifications: 1,
      dark_mode: 0
    };

    const payload = {
      profile: {
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        phone: user.phone || '',
        createdAt: new Date(user.created_at).toISOString(),
        lastLoginAt: new Date(user.last_login_at).toISOString()
      },
      preferences: {
        emailNotifications: Boolean(prefs.email_notifications),
        inAppNotifications: Boolean(prefs.in_app_notifications),
        darkMode: Boolean(prefs.dark_mode)
      },
      stats: {
        totalLogins: Array.isArray(logRows) ? logRows.filter((item) => item.raw_action === 'LOGIN').length : 0,
        status: String(user.status || 'active').toUpperCase()
      },
      activityLogs: Array.isArray(logRows)
        ? logRows.map((item) => ({
            dateTime: new Date(item.created_at).toISOString(),
            action: item.action,
            rawAction: item.raw_action,
            description: item.description,
            ipAddress: item.ip_address
          }))
        : [],
      loginHistory: Array.isArray(logRows)
        ? logRows
            .filter((item) => item.raw_action === 'LOGIN' || item.raw_action === 'LOGOUT')
            .map((item) => ({
              dateTime: new Date(item.created_at).toISOString(),
              action: item.action,
              rawAction: item.raw_action,
              description: item.description,
              ipAddress: item.ip_address
            }))
        : []
    };

    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load admin profile.');
  }
});

app.post('/api/admin-profile', requireAuth, async (req, res) => {
  try {
    const user = req.currentUser;
    const fullName = String(req.body?.full_name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const preferences = req.body?.preferences || {};

    await pool.query('UPDATE admin_users SET full_name = ?, phone = ? WHERE id = ?', [
      fullName || user.full_name,
      phone || null,
      user.id
    ]);
    await pool.query(
      `INSERT INTO admin_profile_preferences (user_id, email_notifications, in_app_notifications, dark_mode, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         email_notifications = EXCLUDED.email_notifications,
         in_app_notifications = EXCLUDED.in_app_notifications,
         dark_mode = EXCLUDED.dark_mode,
         updated_at = EXCLUDED.updated_at`,
      [
        user.id,
        preferences.emailNotifications ? 1 : 0,
        preferences.inAppNotifications ? 1 : 0,
        preferences.darkMode ? 1 : 0,
        nowSql()
      ]
    );

    await insertActivityLog(user.id, 'Profile Updated', 'Admin profile settings were updated.', req.ip || '127.0.0.1');
    sendOk(res, {});
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update admin profile.');
  }
});

app.get('/api/dashboard/summary', requireAuth, async (_req, res) => {
  try {
    const payload = await buildBpaDashboardSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load dashboard summary.');
  }
});

app.get('/api/dashboard/recent-activities', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
          id,
          actor_name,
          actor_role,
          module_key,
          entity_type,
          entity_id,
          action,
          before_status,
          after_status,
          remarks,
          created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT 12`
    );

    const items = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      actorName: row.actor_name,
      actorRole: row.actor_role,
      module: row.module_key,
      entityType: row.entity_type,
      entityId: Number(row.entity_id),
      action: row.action,
      beforeStatus: row.before_status,
      afterStatus: row.after_status,
      remarks: row.remarks,
      createdAt: toIsoString(row.created_at),
      relativeTime: formatRelativeMinutes(row.created_at)
    }));

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load dashboard activities.');
  }
});

app.get('/api/dashboard/activity', requireAuth, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
          id,
          actor_name,
          actor_role,
          module_key,
          entity_type,
          entity_id,
          action,
          before_status,
          after_status,
          remarks,
          created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC
       LIMIT 12`
    );

    const items = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      actorName: row.actor_name,
      actorRole: row.actor_role,
      module: row.module_key,
      entityType: row.entity_type,
      entityId: Number(row.entity_id),
      action: row.action,
      beforeStatus: row.before_status,
      afterStatus: row.after_status,
      remarks: row.remarks,
      createdAt: toIsoString(row.created_at),
      relativeTime: formatRelativeMinutes(row.created_at)
    }));

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load dashboard activities.');
  }
});

app.get('/api/dashboard/alerts', requireAuth, async (_req, res) => {
  try {
    const [notificationRows] = await pool.query(
      `SELECT id, type, title, message, entity_type, entity_id, created_at
       FROM notifications
       WHERE is_read = 0
       ORDER BY created_at DESC, id DESC
       LIMIT 8`
    );
    const [failedPaymentRows] = await pool.query(
      `SELECT p.id, p.reference_number, b.billing_code, s.full_name, p.created_at
       FROM payment_transactions p
       INNER JOIN billing_records b ON b.id = p.billing_id
       INNER JOIN students s ON s.id = b.student_id
       WHERE p.payment_status IN ('failed', 'cancelled')
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 4`
    );
    const [pendingDocRows] = await pool.query(
      `SELECT r.id, r.receipt_number, b.billing_code, s.full_name, r.created_at
       FROM receipt_records r
       INNER JOIN payment_transactions p ON p.id = r.payment_id
       INNER JOIN billing_records b ON b.id = p.billing_id
       INNER JOIN students s ON s.id = b.student_id
       WHERE r.receipt_status IN ('queued', 'generated')
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 4`
    );

    const items = [
      ...(Array.isArray(notificationRows) ? notificationRows : []).map((row) => ({
        id: `notification-${row.id}`,
        severity: 'info',
        title: row.title,
        detail: row.message,
        entityType: row.entity_type,
        entityId: row.entity_id,
        createdAt: toIsoString(row.created_at)
      })),
      ...(Array.isArray(failedPaymentRows) ? failedPaymentRows : []).map((row) => ({
        id: `payment-${row.id}`,
        severity: 'error',
        title: 'Failed payment requires review',
        detail: `${row.reference_number} for ${row.full_name} (${row.billing_code}) needs cashier follow-up.`,
        entityType: 'payment',
        entityId: row.id,
        createdAt: toIsoString(row.created_at)
      })),
      ...(Array.isArray(pendingDocRows) ? pendingDocRows : []).map((row) => ({
        id: `receipt-${row.id}`,
        severity: 'warning',
        title: 'Documentation still pending',
        detail: `${row.receipt_number} for ${row.full_name} (${row.billing_code}) is awaiting documentation completion.`,
        entityType: 'receipt',
        entityId: row.id,
        createdAt: toIsoString(row.created_at)
      }))
    ].slice(0, 12);

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load dashboard alerts.');
  }
});

app.get('/api/dashboard/charts', requireAuth, async (_req, res) => {
  try {
    const [dailyRows] = await pool.query(
      `SELECT
          DATE(payment_date) AS payment_day,
          COUNT(*) AS transaction_count,
          COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'posted') THEN amount_paid ELSE 0 END), 0) AS paid_total
       FROM payment_transactions
       WHERE payment_date >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY DATE(payment_date)
       ORDER BY payment_day ASC`
    );
    const [statusRows] = await pool.query(
      `SELECT payment_status, COUNT(*) AS total
       FROM payment_transactions
       GROUP BY payment_status`
    );

    sendOk(res, {
      dailyCollection: (Array.isArray(dailyRows) ? dailyRows : []).map((row) => ({
        date: String(row.payment_day),
        total: Number(row.paid_total || 0),
        totalFormatted: formatCurrency(row.paid_total),
        transactions: Number(row.transaction_count || 0)
      })),
      paymentStatusBreakdown: (Array.isArray(statusRows) ? statusRows : []).map((row) => ({
        status: mapPaymentStatus(row.payment_status),
        total: Number(row.total || 0)
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load dashboard charts.');
  }
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const filter = String(req.query?.filter || 'all').trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 12)));

    const [rows] = await pool.query(
      `SELECT id, recipient_role, recipient_name, channel, type, title, message, entity_type, entity_id, is_read, created_at, read_at
       FROM notifications
       ORDER BY created_at DESC, id DESC`
    );

    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      if (filter === 'unread') return !Boolean(row.is_read);
      if (filter === 'read') return Boolean(row.is_read);
      if (filter === 'other') return !['billing_activated', 'payment_pending', 'payment_successful', 'payment_failed', 'receipt_generated', 'discrepancy_flagged'].includes(String(row.type || '').toLowerCase());
      if (filter === 'new') return !Boolean(row.is_read);
      return true;
    });

    sendOk(res, {
      items: paginateRows(
        filtered.map((row) => ({
          id: Number(row.id),
          recipientRole: row.recipient_role,
          recipientName: row.recipient_name,
          channel: row.channel,
          type: row.type,
          title: row.title,
          message: row.message,
          entityType: row.entity_type,
          entityId: row.entity_id,
          isRead: Boolean(row.is_read),
          createdAt: toIsoString(row.created_at),
          readAt: toIsoString(row.read_at),
          relativeTime: formatRelativeMinutes(row.created_at)
        })),
        page,
        perPage
      ),
      meta: {
        ...buildPaginationMeta(filtered.length, page, perPage),
        unreadCount: filtered.filter((row) => !Boolean(row.is_read)).length,
        totalUnread: await countUnreadNotifications()
      }
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load notifications.');
  }
});

app.patch('/api/notifications/read-all', requireAuth, async (_req, res) => {
  try {
    await pool.query(`UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0`, [nowSql()]);
    sendOk(res, { unreadCount: 0 }, 'All notifications marked as read.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to mark notifications as read.');
  }
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  try {
    const notificationId = Number(req.params.id || 0);
    if (!notificationId || Number.isNaN(notificationId)) {
      sendError(res, 422, 'A valid notification record is required.');
      return;
    }

    await pool.query(`UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?`, [nowSql(), notificationId]);
    sendOk(res, { unreadCount: await countUnreadNotifications() }, 'Notification marked as read.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update notification.');
  }
});

app.post('/api/notifications/send', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const recipient = String(req.body?.recipient || req.body?.recipient_role || 'student').trim() || 'student';
    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();

    if (!subject || !message) {
      sendError(res, 422, 'subject and message are required.');
      return;
    }

    let billingRow = null;
    if (billingId) {
      const [rows] = await pool.query(
        `SELECT b.id, b.student_id, b.billing_code, s.full_name, s.email
         FROM billing_records b
         INNER JOIN students s ON s.id = b.student_id
         WHERE b.id = ?
         LIMIT 1`,
        [billingId]
      );
      billingRow = rows[0] || null;
    }

    if (billingRow) {
      await pool.query(
        `INSERT INTO billing_notifications (
          billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?)`,
        [
          billingRow.id,
          billingRow.student_id,
          'manual_notification',
          subject,
          message,
          billingRow.full_name,
          billingRow.email,
          req.currentUser.id,
          nowSql()
        ]
      );
    }

    await insertSystemNotification({
      recipientRole: recipient,
      recipientName: billingRow?.full_name || null,
      type: 'manual_notification',
      title: subject,
      message,
      entityType: billingId ? 'billing' : null,
      entityId: billingId || null
    });

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'WORKFLOW_NOTIFICATION_SEND',
      action: 'Notification Sent',
      description: billingRow
        ? `${subject} was sent for ${billingRow.billing_code}.`
        : `${subject} was sent from the cashier workflow.`,
      moduleKey: 'billing_verification',
      entityType: billingId ? 'billing' : 'notification',
      entityId: billingId || 0,
      remarks: message
    });

    sendOk(
      res,
      {
        billingId: billingId || null,
        recipient,
        subject,
        message
      },
      'Notification sent successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to send notification.');
  }
});

app.get('/api/audit-logs', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const moduleFilter = String(req.query?.module || '').trim().toLowerCase();
    const entityTypeFilter = String(req.query?.entity_type || '').trim().toLowerCase();
    const search = String(req.query?.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 20)));

    const [rows] = await pool.query(
      `SELECT
          id,
          actor_user_id,
          actor_name,
          actor_role,
          module_key,
          entity_type,
          entity_id,
          action,
          before_status,
          after_status,
          before_stage,
          after_stage,
          remarks,
          created_at
       FROM audit_logs
       ORDER BY created_at DESC, id DESC`
    );

    const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
      const matchesModule = !moduleFilter || String(row.module_key || '').toLowerCase().includes(moduleFilter);
      const matchesEntityType = !entityTypeFilter || String(row.entity_type || '').toLowerCase().includes(entityTypeFilter);
      const haystack = `${row.actor_name || ''} ${row.action || ''} ${row.remarks || ''}`.toLowerCase();
      const matchesSearch = !search || haystack.includes(search);
      return matchesModule && matchesEntityType && matchesSearch;
    });

    const items = paginateRows(
      filtered.map((row) => ({
        id: Number(row.id),
        actorUserId: row.actor_user_id ? Number(row.actor_user_id) : null,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        module: row.module_key,
        entityType: row.entity_type,
        entityId: Number(row.entity_id || 0),
        action: row.action,
        beforeStatus: row.before_status,
        afterStatus: row.after_status,
        beforeStage: row.before_stage,
        afterStage: row.after_stage,
        remarks: row.remarks,
        createdAt: toIsoString(row.created_at)
      })),
      page,
      perPage
    );

    sendOk(res, {
      items,
      meta: buildPaginationMeta(filtered.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load audit logs.');
  }
});

app.get('/api/billings', requireAuth, async (req, res) => {
  try {
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(req.query?.workflow_stage || '').trim(), '');
    const studentFilter = String(req.query?.student || '').trim().toLowerCase();
    const termFilter = String(req.query?.term || '').trim().toLowerCase();
    const programFilter = String(req.query?.program || '').trim().toLowerCase();
    const dueDateFilter = String(req.query?.due_date || '').trim();
    const search = String(req.query?.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 10)));

    let items = await serializeBillingList();

    items = items.filter((item) => {
      const matchesStatus = !statusFilter || item.status.toLowerCase() === statusFilter;
      const matchesWorkflowStage = !workflowStageFilter || normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter;
      const matchesStudent =
        !studentFilter ||
        item.studentName.toLowerCase().includes(studentFilter) ||
        item.studentNumber.toLowerCase().includes(studentFilter);
      const matchesTerm = !termFilter || item.term.toLowerCase().includes(termFilter);
      const matchesProgram = !programFilter || item.program.toLowerCase().includes(programFilter);
      const matchesDueDate = !dueDateFilter || String(item.dueDate || '').slice(0, 10) === dueDateFilter;
      const matchesSearch =
        !search ||
        `${item.studentName} ${item.studentNumber} ${item.invoiceNumber} ${item.billingCode} ${item.program} ${item.status}`
          .toLowerCase()
          .includes(search);

      return matchesStatus && matchesWorkflowStage && matchesStudent && matchesTerm && matchesProgram && matchesDueDate && matchesSearch;
    });

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load billings.');
  }
});

app.get('/api/billings/:id', requireAuth, async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const items = await serializeBillingList();
    const billing = items.find((item) => item.id === billingId);
    if (!billing) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    const [paymentRows] = await pool.query(
      `SELECT id, reference_number, amount_paid, payment_method, payment_status, payment_date
       FROM payment_transactions
       WHERE billing_id = ?
       ORDER BY payment_date DESC, id DESC`,
      [billingId]
    );

    sendOk(res, {
      ...billing,
      paymentHistory: (Array.isArray(paymentRows) ? paymentRows : []).map((row) => ({
        id: Number(row.id),
        referenceNumber: row.reference_number,
        amount: Number(row.amount_paid || 0),
        amountFormatted: formatCurrency(row.amount_paid),
        method: row.payment_method,
        status: mapPaymentStatus(row.payment_status),
        createdAt: toIsoString(row.payment_date)
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load billing record.');
  }
});

app.get('/api/billings/:id/fee-items', requireAuth, async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const billing = (await serializeBillingList()).find((item) => item.id === billingId);
    if (!billing) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    sendOk(res, {
      billingId,
      billingCode: billing.billingCode,
      items: billing.items || [],
      summary: billing.feeSummary || null
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load billing fee items.');
  }
});

app.post('/api/billings/:id/fee-items', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const feeName = String(req.body?.feeName || req.body?.fee_name || req.body?.item_name || '').trim();
    const feeCode = String(req.body?.feeCode || req.body?.fee_code || req.body?.item_code || feeName.toUpperCase().replace(/\s+/g, '_')).trim();
    const category = String(req.body?.category || 'Assessment').trim();
    const amount = Number(req.body?.amount || 0);
    const sortOrder = Number(req.body?.sortOrder || req.body?.priority_order || 99);

    if (!billingId || !feeName || amount <= 0) {
      sendError(res, 422, 'billingId, feeName, and amount are required.');
      return;
    }

    const [billingRows] = await pool.query(`SELECT id FROM billing_records WHERE id = ? LIMIT 1`, [billingId]);
    if (!billingRows[0]) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    const [rows] = await pool.query(
      `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [billingId, feeCode, feeName, category, amount, sortOrder, nowSql()]
    );

    await recalculateBillingFinancials(billingId);
    sendOk(res, { id: Number(rows[0]?.id) }, 'Billing fee item added successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to add billing fee item.');
  }
});

app.put('/api/billings/:id/fee-items/:feeItemId', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const feeItemId = Number(req.params.feeItemId || 0);
    const feeName = String(req.body?.feeName || req.body?.fee_name || req.body?.item_name || '').trim();
    const feeCode = String(req.body?.feeCode || req.body?.fee_code || req.body?.item_code || '').trim();
    const category = String(req.body?.category || 'Assessment').trim();
    const amount = Number(req.body?.amount || 0);
    const sortOrder = Number(req.body?.sortOrder || req.body?.priority_order || 99);

    if (!billingId || !feeItemId || !feeName || amount <= 0) {
      sendError(res, 422, 'billingId, feeItemId, feeName, and amount are required.');
      return;
    }

    await pool.query(
      `UPDATE billing_items
       SET item_code = ?, item_name = ?, category = ?, amount = ?, sort_order = ?
       WHERE id = ? AND billing_id = ?`,
      [feeCode || feeName.toUpperCase().replace(/\s+/g, '_'), feeName, category, amount, sortOrder, feeItemId, billingId]
    );

    await recalculateBillingFinancials(billingId);
    sendOk(res, { id: feeItemId }, 'Billing fee item updated successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update billing fee item.');
  }
});

app.delete('/api/billings/:id/fee-items/:feeItemId', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const feeItemId = Number(req.params.feeItemId || 0);
    await pool.query(`DELETE FROM billing_items WHERE id = ? AND billing_id = ?`, [feeItemId, billingId]);
    await recalculateBillingFinancials(billingId);
    sendOk(res, { id: feeItemId }, 'Billing fee item removed successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to delete billing fee item.');
  }
});

app.post('/api/billings', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const studentId = Number(req.body?.studentId || req.body?.student_id || 0);
    const semester = String(req.body?.semester || '').trim();
    const schoolYear = String(req.body?.schoolYear || req.body?.school_year || '').trim();
    const requestedStatus = String(req.body?.status || 'draft').trim().toLowerCase();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!studentId || !semester || !schoolYear) {
      sendError(res, 422, 'studentId, semester, and schoolYear are required.');
      return;
    }

    const billingTotal = items.length
      ? items.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
      : Number(req.body?.totalAmount || req.body?.total_amount || 0);

    if (billingTotal <= 0) {
      sendError(res, 422, 'Billing total must be greater than zero.');
      return;
    }

    const [studentRows] = await pool.query(`SELECT full_name FROM students WHERE id = ? LIMIT 1`, [studentId]);
    const studentRow = studentRows[0];
    if (!studentRow) {
      sendError(res, 404, 'Student record not found.');
      return;
    }

    const billingCode = String(req.body?.billingCode || req.body?.billing_code || `BILL-${Date.now().toString().slice(-6)}`).trim();
    const initialStatus = ['draft', 'unpaid', 'correction'].includes(requestedStatus) ? requestedStatus : 'draft';
    const initialStage = resolveBillingWorkflowStage(initialStatus, billingTotal);
    const normalizedItems =
      items.length > 0
        ? items
        : [
            { code: 'TUITION', name: 'Tuition Fee', category: 'Tuition', amount: Number((billingTotal * 0.7).toFixed(2)) },
            { code: 'MISC', name: 'Miscellaneous Fee', category: 'Assessment', amount: Number((billingTotal * 0.2).toFixed(2)) },
            {
              code: 'SERVICE',
              name: 'Service Fee',
              category: 'Services',
              amount: Number((billingTotal - Number((billingTotal * 0.7).toFixed(2)) - Number((billingTotal * 0.2).toFixed(2))).toFixed(2))
            }
          ];
    const integration = resolveCashierIntegrationProfile({
      billingCode,
      sourceModule: req.body?.sourceModule || req.body?.source_module,
      sourceDepartment: req.body?.sourceDepartment || req.body?.source_department,
      sourceCategory: req.body?.sourceCategory || req.body?.source_category,
      integrationProfile: req.body?.integrationProfile || req.body?.integration_profile,
      targetDepartment: req.body?.targetDepartment || req.body?.target_department,
      feeItems: normalizedItems
    });

    const [rows] = await pool.query(
      `INSERT INTO billing_records (
        student_id, billing_code, source_module, source_department, source_category, integration_profile, target_department,
        semester, school_year, total_amount, paid_amount, balance_amount, billing_status, workflow_stage, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      RETURNING id`,
      [
        studentId,
        billingCode,
        integration.sourceModule,
        integration.sourceDepartment,
        integration.sourceCategory,
        integration.integrationProfile,
        integration.operationalTargetDepartment,
        semester,
        schoolYear,
        billingTotal,
        billingTotal,
        initialStatus,
        initialStage,
        nowSql(),
        nowSql()
      ]
    );

    const billingId = Number(rows[0]?.id);
    if (!billingId) {
      sendError(res, 500, 'Unable to create billing record.');
      return;
    }

    for (const [index, item] of normalizedItems.entries()) {
      await pool.query(
        `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          billingId,
          String(item.code || item.item_code || `ITEM-${index + 1}`).trim(),
          String(item.name || item.item_name || `Billing Item ${index + 1}`).trim(),
          String(item.category || 'Assessment').trim(),
          Number(item.amount || 0),
          index + 1,
          nowSql()
        ]
      );
    }

    await recalculateBillingFinancials(billingId, { workflowStage: initialStage, status: initialStatus });

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'BILLING_PORTAL_CREATE',
      action: 'Billing Created',
      description: `${billingCode} was created for ${studentRow.full_name}.`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: null,
      afterStatus: mapBillingWorkflowStatus(initialStatus, billingTotal),
      beforeStage: null,
      afterStage: initialStage,
      notification: {
        type: 'billing_activated',
        title: 'New billing created',
        message: `${billingCode} was added to Student Portal & Billing for ${studentRow.full_name}.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${billingCode} was created successfully.`, mapBillingWorkflowStatus(initialStatus, billingTotal), initialStage, {
        id: billingId,
        billingCode
      }),
      `${billingCode} was created successfully.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to create billing.');
  }
});

app.put('/api/billings/:id', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    if (!billingId || Number.isNaN(billingId)) {
      sendError(res, 422, 'A valid billing record is required.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT billing_code, billing_status, workflow_stage, semester, school_year, balance_amount
       FROM billing_records
       WHERE id = ?
       LIMIT 1`,
      [billingId]
    );
    const currentRow = rows[0];
    if (!currentRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const totalAmount =
      items.length > 0
        ? items.reduce((sum, item) => sum + Number(item?.amount || 0), 0)
        : Number(req.body?.totalAmount || req.body?.total_amount || 0);

    const statusValue = String(req.body?.status || currentRow.billing_status || 'draft').trim().toLowerCase();
    const balanceValue = Number(req.body?.balanceAmount || req.body?.balance_amount || totalAmount || 0);
    const nextStage = resolveBillingWorkflowStage(statusValue, balanceValue, currentRow.workflow_stage);

    await pool.query(
      `UPDATE billing_records
       SET semester = ?, school_year = ?, total_amount = ?, balance_amount = ?, billing_status = ?, workflow_stage = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(req.body?.semester || '').trim() || req.body?.semester || currentRow.semester,
        String(req.body?.schoolYear || req.body?.school_year || '').trim() || req.body?.school_year || currentRow.school_year,
        totalAmount > 0 ? totalAmount : Number(req.body?.totalAmount || req.body?.total_amount || 0),
        balanceValue,
        statusValue,
        nextStage,
        nowSql(),
        billingId
      ]
    );

    if (items.length > 0) {
      await pool.query(`DELETE FROM billing_items WHERE billing_id = ?`, [billingId]);
      for (const [index, item] of items.entries()) {
        await pool.query(
          `INSERT INTO billing_items (billing_id, item_code, item_name, category, amount, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            billingId,
            String(item.code || item.item_code || `ITEM-${index + 1}`).trim(),
            String(item.name || item.item_name || `Billing Item ${index + 1}`).trim(),
            String(item.category || 'Assessment').trim(),
            Number(item.amount || 0),
            index + 1,
            nowSql()
          ]
        );
      }
    }

    await recalculateBillingFinancials(billingId, { workflowStage: nextStage, status: statusValue });

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'BILLING_PORTAL_UPDATE',
      action: 'Billing Updated',
      description: `${currentRow.billing_code} was updated in Student Portal & Billing.`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(currentRow.billing_status, 0),
      afterStatus: mapBillingWorkflowStatus(statusValue, balanceValue),
      beforeStage: normalizeWorkflowStage(currentRow.workflow_stage, resolveBillingWorkflowStage(currentRow.billing_status, currentRow.balance_amount)),
      afterStage: nextStage
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${currentRow.billing_code} was updated successfully.`, mapBillingWorkflowStatus(statusValue, balanceValue), nextStage, {
        id: billingId,
        billingCode: currentRow.billing_code
      }),
      `${currentRow.billing_code} was updated successfully.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update billing.');
  }
});

app.patch('/api/billings/:id/activate', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const [rows] = await pool.query(`SELECT billing_code, billing_status, workflow_stage, balance_amount FROM billing_records WHERE id = ? LIMIT 1`, [billingId]);
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    await pool.query(`UPDATE billing_records SET billing_status = 'verified', workflow_stage = ?, updated_at = ? WHERE id = ?`, [
      WORKFLOW_STAGES.PAY_BILLS,
      nowSql(),
      billingId
    ]);
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'BILLING_PORTAL_ACTIVATE',
      action: 'Billing Activated',
      description: `${billingRow.billing_code} is now active and eligible for payment review.`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
      afterStatus: 'Pending Payment',
      beforeStage: normalizeWorkflowStage(billingRow.workflow_stage, resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)),
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        type: 'billing_activated',
        title: 'Billing activated',
        message: `${billingRow.billing_code} was activated and is ready for the cashier flow.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${billingRow.billing_code} was activated and moved to Pay Bills.`, 'Pending Payment', WORKFLOW_STAGES.PAY_BILLS, {
        id: billingId,
        billingCode: billingRow.billing_code
      }),
      `${billingRow.billing_code} was activated and moved to Pay Bills.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to activate billing.');
  }
});

app.post('/api/billings/:id/verify', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const remarks = String(req.body?.remarks || 'Billing verified and ready for payment.').trim();
    const validationChecklist = String(req.body?.validation_checklist || '').trim();
    const studentProfileCheck = String(req.body?.student_profile_check || '').trim();
    const feeBreakdownCheck = String(req.body?.fee_breakdown_check || '').trim();
    const paymentEligibilityCheck = String(req.body?.payment_eligibility_check || '').trim();
    const duplicateBillingCheck = String(req.body?.duplicate_billing_check || '').trim();

    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, balance_amount
       FROM billing_records
       WHERE id = ?
       LIMIT 1`,
      [billingId]
    );
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    const normalizedStage = normalizeWorkflowStage(
      billingRow.workflow_stage,
      resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
    );
    if (normalizedStage !== WORKFLOW_STAGES.STUDENT_PORTAL_BILLING) {
      sendError(res, 409, 'Only billings in Student Portal & Billing can be verified.');
      return;
    }

    if (Number(billingRow.balance_amount || 0) <= 0) {
      sendError(res, 409, 'Only billings with an outstanding balance can be verified.');
      return;
    }

    if (!validationChecklist) {
      sendError(res, 422, 'Validation checklist is required before verifying billing.');
      return;
    }

    if (studentProfileCheck !== 'Complete') {
      sendError(res, 422, 'Student profile must be marked Complete before the billing can move to Pay Bills.');
      return;
    }

    if (feeBreakdownCheck !== 'Validated') {
      sendError(res, 422, 'Fee breakdown must be validated before the billing can move to Pay Bills.');
      return;
    }

    if (paymentEligibilityCheck !== 'Eligible') {
      sendError(res, 422, 'Only payment-eligible billings can be forwarded to Pay Bills.');
      return;
    }

    if (duplicateBillingCheck !== 'No Duplicate Found') {
      sendError(res, 422, 'Duplicate billing review must be cleared before verification can proceed.');
      return;
    }

    const [billingItemRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM billing_items
       WHERE billing_id = ?`,
      [billingId]
    );
    if (Number(billingItemRows?.[0]?.total || 0) <= 0) {
      sendError(res, 422, 'This billing record has no fee items yet. Add fee details before verification.');
      return;
    }

    const consolidatedRemarks = [
      remarks,
      `Checklist: ${validationChecklist}`,
      `Student Profile: ${studentProfileCheck}`,
      `Fee Breakdown: ${feeBreakdownCheck}`,
      `Payment Eligibility: ${paymentEligibilityCheck}`,
      `Duplicate Check: ${duplicateBillingCheck}`
    ].join(' | ');

    await pool.query(
      `UPDATE billing_records
       SET billing_status = 'verified',
           workflow_stage = ?,
           previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_completed = 0,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL,
           updated_at = ?
       WHERE id = ?`,
      [
        WORKFLOW_STAGES.PAY_BILLS,
        WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
        req.currentUser.id,
        nowSql(),
        consolidatedRemarks,
        `VERIFY-${billingId}-${Date.now()}`,
        nowSql(),
        billingId
      ]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'BILLING_VERIFY',
      action: 'Billing Verified',
      description: `${billingRow.billing_code} was verified and moved to Pay Bills. ${consolidatedRemarks}`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
      afterStatus: 'Pending Payment',
      beforeStage: normalizedStage,
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        recipientRole: 'cashier',
        type: 'billing_verified',
        title: 'Billing verified',
        message: `${billingRow.billing_code} passed verification and moved to Pay Bills.`,
        entityType: 'billing',
        entityId: billingId
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload('Billing verified successfully.', 'Verified', WORKFLOW_STAGES.PAY_BILLS),
      'Billing verified successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to verify billing.');
  }
});

app.patch('/api/billings/:id/mark-correction', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const [rows] = await pool.query(`SELECT billing_code, billing_status, workflow_stage, balance_amount FROM billing_records WHERE id = ? LIMIT 1`, [billingId]);
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    await pool.query(`UPDATE billing_records SET billing_status = 'correction', workflow_stage = ?, updated_at = ? WHERE id = ?`, [
      WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
      nowSql(),
      billingId
    ]);
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'BILLING_PORTAL_CORRECTION',
      action: 'Billing Marked for Correction',
      description: `${billingRow.billing_code} was sent back for correction.`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
      afterStatus: 'Needs Correction',
      beforeStage: normalizeWorkflowStage(billingRow.workflow_stage, resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)),
      afterStage: WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
      notification: {
        type: 'correction_required',
        title: 'Correction required',
        message: `${billingRow.billing_code} was marked for correction before payment can continue.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${billingRow.billing_code} was returned for correction.`, 'Needs Correction', WORKFLOW_STAGES.STUDENT_PORTAL_BILLING, {
        id: billingId,
        billingCode: billingRow.billing_code
      }),
      `${billingRow.billing_code} was returned for correction.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to mark billing for correction.');
  }
});

app.get('/api/students/:id/account-statement', requireAuth, async (req, res) => {
  try {
    const studentId = Number(req.params.id || 0);
    const [studentRows] = await pool.query(
      `SELECT id, student_no, full_name, course, year_level, email, phone, status
       FROM students
       WHERE id = ?
       LIMIT 1`,
      [studentId]
    );
    const student = studentRows[0];
    if (!student) {
      sendError(res, 404, 'Student record not found.');
      return;
    }

    const billings = (await serializeBillingList()).filter((item) => item.studentId === studentId);
    const totalAssessment = billings.reduce((sum, item) => sum + item.totalAmount, 0);
    const totalPaid = billings.reduce((sum, item) => sum + item.paidAmount, 0);
    const totalBalance = billings.reduce((sum, item) => sum + item.balanceAmount, 0);

    sendOk(res, {
      student: {
        id: Number(student.id),
        studentNumber: student.student_no,
        fullName: student.full_name,
        program: student.course,
        yearLevel: student.year_level,
        email: student.email,
        phone: student.phone,
        status: student.status
      },
      summary: {
        totalAssessment,
        totalAssessmentFormatted: formatCurrency(totalAssessment),
        totalPaid,
        totalPaidFormatted: formatCurrency(totalPaid),
        totalBalance,
        totalBalanceFormatted: formatCurrency(totalBalance)
      },
      billings
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load account statement.');
  }
});

app.get('/api/billings/:id/invoice', requireAuth, async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const items = await serializeBillingList();
    const billing = items.find((item) => item.id === billingId);
    if (!billing) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    sendOk(res, {
      invoiceNumber: billing.invoiceNumber,
      studentName: billing.studentName,
      studentNumber: billing.studentNumber,
      program: billing.program,
      term: billing.term,
      dueDate: billing.dueDate,
      dueDateFormatted: billing.dueDateFormatted,
      totalAmount: billing.totalAmount,
      totalAmountFormatted: billing.totalAmountFormatted,
      paidAmount: billing.paidAmount,
      paidAmountFormatted: billing.paidAmountFormatted,
      balanceAmount: billing.balanceAmount,
      balanceAmountFormatted: billing.balanceAmountFormatted,
      status: billing.status,
      paymentEligible: billing.paymentEligible,
      items: billing.items
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load invoice preview.');
  }
});

app.get('/api/student/account-statement', requireStudentAuth, async (req, res) => {
  try {
    const payload = await buildStudentAccountStatementPayload(req.currentStudent.student_id);
    sendOk(res, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load student account statement.';
    if (message === 'Student record not found.') {
      sendError(res, 404, message);
      return;
    }
    sendError(res, 500, message);
  }
});

app.get('/api/student/billings', requireStudentAuth, async (req, res) => {
  try {
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const search = String(req.query?.search || '').trim().toLowerCase();
    let items = (await serializeBillingList()).filter((item) => item.studentId === Number(req.currentStudent.student_id));

    if (statusFilter) {
      items = items.filter((item) => item.status.toLowerCase() === statusFilter);
    }

    items = applyTextSearch(items, search, (item) => `${item.billingCode} ${item.invoiceNumber} ${item.term} ${item.status} ${item.program}`);
    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load student billings.');
  }
});

app.get('/api/student/invoices', requireStudentAuth, async (req, res) => {
  try {
    const items = (await serializeBillingList())
      .filter((item) => item.studentId === Number(req.currentStudent.student_id))
      .map((item) => ({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        billingCode: item.billingCode,
        term: item.term,
        program: item.program,
        status: item.status,
        dueDate: item.dueDate,
        dueDateFormatted: item.dueDateFormatted,
        totalAmount: item.totalAmount,
        totalAmountFormatted: item.totalAmountFormatted,
        paidAmount: item.paidAmount,
        paidAmountFormatted: item.paidAmountFormatted,
        balanceAmount: item.balanceAmount,
        balanceAmountFormatted: item.balanceAmountFormatted,
        paymentEligible: item.paymentEligible,
        items: item.items
      }));

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load student invoices.');
  }
});

app.get('/api/student/receipts', requireStudentAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
          r.id,
          r.receipt_number,
          r.issued_date,
          r.receipt_status,
          r.remarks,
          p.reference_number,
          p.amount_paid,
          p.payment_method,
          b.billing_code,
          b.id AS billing_id
       FROM receipt_records r
       INNER JOIN payment_transactions p ON p.id = r.payment_id
       INNER JOIN billing_records b ON b.id = p.billing_id
       WHERE b.student_id = ?
       ORDER BY r.issued_date DESC, r.id DESC`,
      [req.currentStudent.student_id]
    );

    sendOk(res, {
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: Number(row.id),
        receiptNumber: row.receipt_number,
        billingId: Number(row.billing_id),
        billingCode: row.billing_code,
        paymentReference: row.reference_number,
        amount: Number(row.amount_paid || 0),
        amountFormatted: formatCurrency(row.amount_paid),
        paymentMethod: row.payment_method,
        status: mapReceiptStatus(row.receipt_status),
        issuedDate: toIsoString(row.issued_date),
        issuedDateFormatted: formatShortDate(row.issued_date),
        remarks: row.remarks
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load student receipts.');
  }
});

app.get('/api/billings/payable', requireStudentAuth, async (req, res) => {
  try {
    const items = (await serializeBillingList())
      .filter((item) => item.studentId === Number(req.currentStudent.student_id))
      .filter((item) => item.paymentEligible || ['Pending Payment', 'Partially Paid'].includes(item.status));

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payable student billings.');
  }
});

app.post('/api/payments/auto-debit', requireStudentAuth, async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const accountName = String(req.body?.accountName || req.currentStudent.full_name || '').trim();
    if (!billingId || !accountName) {
      sendError(res, 422, 'billingId and accountName are required.');
      return;
    }

    const [rows] = await pool.query(`SELECT id FROM billing_records WHERE id = ? AND student_id = ? LIMIT 1`, [
      billingId,
      req.currentStudent.student_id
    ]);
    if (!rows[0]) {
      sendError(res, 404, 'Billing record not found for this student.');
      return;
    }

    await createAutoDebitArrangement({
      billingId,
      accountName,
      bankName: String(req.body?.bankName || '').trim() || null,
      accountMask: String(req.body?.accountMask || '').trim() || null,
      frequency: String(req.body?.frequency || 'monthly').trim(),
      createdBy: null
    });

    sendOk(res, { billingId }, 'Auto debit arrangement saved.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to save auto debit arrangement.');
  }
});

app.post('/api/payments/initiate', requireStudentAuth, async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const paymentMethod = String(req.body?.paymentMethod || req.body?.payment_method || 'Online').trim();
    const requestedAmount = Number(req.body?.amount || req.body?.amount_paid || 0);

    if (!billingId || requestedAmount <= 0) {
      sendError(res, 422, 'billingId and a valid payment amount are required.');
      return;
    }

    const [billingRows] = await pool.query(
      `SELECT id FROM billing_records WHERE id = ? AND student_id = ? LIMIT 1`,
      [billingId, req.currentStudent.student_id]
    );
    if (!billingRows[0]) {
      sendError(res, 404, 'Billing record not found for this student.');
      return;
    }

    const payment = await createPaymentRequest({
      billingId,
      paymentMethod,
      requestedAmount,
      actorUser: studentActorFromSession(req.currentStudent),
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body,
      moduleKey: 'manage_billing',
      rawAction: 'PAY_BILLS_STUDENT_INITIATE',
      actionLabel: 'Student Payment Initiated',
      notificationTitle: 'Student payment initiated',
      notificationType: 'payment_pending',
      descriptionPrefix: 'was initiated by the student'
    });

    sendOk(res, payment, `${payment.referenceNumber} was submitted successfully.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to initiate payment.';
    if (
      message.includes('Billing record not found') ||
      message.includes('Payment cannot proceed') ||
      message.includes('Payment amount cannot exceed')
    ) {
      sendError(res, 409, message);
      return;
    }
    sendError(res, 500, message);
  }
});

app.get('/api/student/payment-methods', requireStudentAuth, async (_req, res) => {
  sendOk(res, { items: paymentMethodOptions() });
});

app.get('/api/payables', requireAuth, async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 10)));
    const [paymentRows] = await pool.query(
      `SELECT billing_id, COUNT(*) AS total_payments
       FROM payment_transactions
       GROUP BY billing_id`
    );
    const paymentCountMap = new Map((Array.isArray(paymentRows) ? paymentRows : []).map((row) => [Number(row.billing_id), Number(row.total_payments || 0)]));

    let items = (await serializeBillingList())
      .filter(
        (item) =>
          normalizeWorkflowStage(item.workflowStage, resolveBillingWorkflowStage(item.rawStatus, item.balanceAmount)) === WORKFLOW_STAGES.PAY_BILLS
      )
      .map((item) => ({
        ...item,
        paymentHistoryCount: paymentCountMap.get(item.id) || 0
      }));

    if (statusFilter) {
      items = items.filter((item) => item.status.toLowerCase() === statusFilter);
    }
    items = applyTextSearch(items, search, (item) => `${item.studentName} ${item.studentNumber} ${item.billingCode} ${item.program} ${item.status}`);

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payable billings.');
  }
});

app.get('/api/payables/:billingId', requireAuth, async (req, res) => {
  try {
    const billingId = Number(req.params.billingId || 0);
    const billing = (await serializeBillingList()).find((item) => item.id === billingId);
    if (!billing) {
      sendError(res, 404, 'Payable billing record not found.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT id, reference_number, amount_paid, payment_method, payment_status, payment_date
       FROM payment_transactions
       WHERE billing_id = ?
       ORDER BY payment_date DESC, id DESC`,
      [billingId]
    );

    sendOk(res, {
      billing,
      paymentHistory: (Array.isArray(rows) ? rows : []).map((row) => ({
        id: Number(row.id),
        referenceNumber: row.reference_number,
        amount: Number(row.amount_paid || 0),
        amountFormatted: formatCurrency(row.amount_paid),
        paymentMethod: row.payment_method,
        status: mapPaymentStatus(row.payment_status),
        paymentDate: toIsoString(row.payment_date)
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payable billing detail.');
  }
});

app.get('/api/payables/:billingId/fee-items', requireAuth, async (req, res) => {
  try {
    const billingId = Number(req.params.billingId || 0);
    const billing = (await serializeBillingList()).find((item) => item.id === billingId);
    if (!billing) {
      sendError(res, 404, 'Payable billing record not found.');
      return;
    }

    sendOk(res, {
      billingId,
      billingCode: billing.billingCode,
      items: billing.items || [],
      summary: billing.feeSummary || null
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payable fee items.');
  }
});

app.get('/api/payments/:id/allocations', requireAuth, async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const rows = await fetchPaymentAllocationRows({ paymentId });
    sendOk(res, {
      paymentId,
      items: buildPaymentAllocationMap(rows).get(paymentId)?.items || [],
      summary: buildPaymentAllocationMap(rows).get(paymentId)?.summary || 'No allocations found.'
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment allocations.');
  }
});

app.post('/api/payments/:id/allocate', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const [paymentRows] = await pool.query(
      `SELECT id, billing_id, amount_paid, payment_status
       FROM payment_transactions
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = paymentRows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment transaction not found.');
      return;
    }

    await pool.query(`DELETE FROM payment_allocations WHERE payment_id = ?`, [paymentId]);
    await createPaymentAllocations({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      paymentAmount: Number(paymentRow.amount_paid || 0),
      allocationMode: String(req.body?.allocationMode || req.body?.allocation_mode || 'manual'),
      manualAllocations: Array.isArray(req.body?.allocations) ? req.body.allocations : [],
      remarks: String(req.body?.remarks || '').trim()
    });
    await recalculateBillingFinancials(Number(paymentRow.billing_id));

    const rows = await fetchPaymentAllocationRows({ paymentId });
    const summary = buildPaymentAllocationMap(rows).get(paymentId);
    sendOk(
      res,
      {
        paymentId,
        items: summary?.items || [],
        summary: summary?.summary || 'No allocations found.'
      },
      'Payment allocations updated successfully.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update payment allocations.';
    sendError(res, 500, message);
  }
});

app.get('/api/payment-methods', requireAuth, async (_req, res) => {
  sendOk(res, { items: paymentMethodOptions() });
});

app.post('/api/auto-debit', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const accountName = String(req.body?.accountName || '').trim();
    if (!billingId || !accountName) {
      sendError(res, 422, 'billingId and accountName are required.');
      return;
    }

    await createAutoDebitArrangement({
      billingId,
      accountName,
      bankName: String(req.body?.bankName || '').trim() || null,
      accountMask: String(req.body?.accountMask || '').trim() || null,
      frequency: String(req.body?.frequency || 'monthly').trim(),
      createdBy: req.currentUser.id
    });

    sendOk(res, { billingId }, 'Auto debit arrangement saved.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to save auto debit arrangement.');
  }
});

app.get('/api/installments', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.query?.billing_id || req.query?.billingId || 0);
    const params = [];
    let query = `
      SELECT i.*, b.billing_code, s.full_name
      FROM installments i
      INNER JOIN billing_records b ON b.id = i.billing_id
      INNER JOIN students s ON s.id = b.student_id
    `;

    if (billingId) {
      query += ' WHERE i.billing_id = ?';
      params.push(billingId);
    }

    query += ' ORDER BY i.updated_at DESC, i.id DESC';
    const [rows] = await pool.query(query, params);
    sendOk(res, { items: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load installments.');
  }
});

app.get('/api/installments/:id', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const installmentId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT i.*, b.billing_code, s.full_name
       FROM installments i
       INNER JOIN billing_records b ON b.id = i.billing_id
       INNER JOIN students s ON s.id = b.student_id
       WHERE i.id = ?
       LIMIT 1`,
      [installmentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Installment plan not found.');
      return;
    }
    sendOk(res, row);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load installment plan.');
  }
});

app.post('/api/installments', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const installmentAmount = Number(req.body?.installmentAmount || req.body?.installment_amount || 0);
    const installmentCount = Math.max(1, Number(req.body?.installmentCount || req.body?.installment_count || 1));
    const dueSchedule = String(req.body?.dueSchedule || req.body?.due_schedule || '').trim();
    const paymentMethod = String(req.body?.paymentMethod || req.body?.payment_method || 'Online').trim() || 'Online';
    const allocationMode = String(req.body?.allocationMode || req.body?.allocation_mode || 'auto').trim() || 'auto';
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const remarks = String(req.body?.remarks || '').trim();

    if (!billingId || installmentAmount <= 0) {
      sendError(res, 422, 'billingId and installmentAmount are required.');
      return;
    }

    const payment = await createPaymentRequest({
      billingId,
      paymentMethod,
      requestedAmount: installmentAmount,
      allocationMode,
      allocations,
      remarks: remarks || 'Installment payment request created.',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: {
        ...req.body,
        mode: 'installment'
      },
      moduleKey: 'manage_billing',
      rawAction: 'PAY_BILLS_INSTALLMENT_CREATE',
      actionLabel: 'Installment Payment Created',
      notificationTitle: 'Installment payment pending',
      notificationType: 'payment_pending',
      descriptionPrefix: 'was created as an installment request',
      billingStageAfterCreate: WORKFLOW_STAGES.PAY_BILLS
    });

    const [rows] = await pool.query(
      `INSERT INTO installments (
        billing_id, payment_id, installment_amount, installment_count, due_schedule, remarks, status, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      RETURNING id`,
      [billingId, payment.id || null, installmentAmount, installmentCount, dueSchedule || null, remarks || null, req.currentUser.id, req.currentUser.id, nowSql(), nowSql()]
    );

    sendOk(
      res,
      {
        id: Number(rows[0]?.id),
        paymentId: payment.id || null,
        billingId,
        installmentAmount,
        installmentCount,
        dueSchedule,
        remarks,
        status: 'Active',
        allocationMode,
        workflow_stage: payment.workflow_stage,
        next_module: payment.next_module
      },
      'Installment plan saved and forwarded for payment processing.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create installment plan.';
    sendError(res, 500, message);
  }
});

app.put('/api/installments/:id', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const installmentId = Number(req.params.id || 0);
    const [rows] = await pool.query(`SELECT id FROM installments WHERE id = ? LIMIT 1`, [installmentId]);
    if (!rows[0]) {
      sendError(res, 404, 'Installment plan not found.');
      return;
    }

    const installmentAmount = Number(req.body?.installmentAmount || req.body?.installment_amount || 0);
    const installmentCount = Math.max(1, Number(req.body?.installmentCount || req.body?.installment_count || 1));
    const dueSchedule = String(req.body?.dueSchedule || req.body?.due_schedule || '').trim();
    const remarks = String(req.body?.remarks || '').trim();

    await pool.query(
      `UPDATE installments
       SET installment_amount = ?, installment_count = ?, due_schedule = ?, remarks = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`,
      [installmentAmount, installmentCount, dueSchedule || null, remarks || null, req.currentUser.id, nowSql(), installmentId]
    );

    sendOk(res, { id: installmentId }, 'Installment plan updated successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update installment plan.');
  }
});

app.delete('/api/installments/:id', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const installmentId = Number(req.params.id || 0);
    const [rows] = await pool.query(`SELECT id FROM installments WHERE id = ? LIMIT 1`, [installmentId]);
    if (!rows[0]) {
      sendError(res, 404, 'Installment plan not found.');
      return;
    }

    await pool.query(`UPDATE installments SET status = 'cancelled', updated_by = ?, updated_at = ? WHERE id = ?`, [
      req.currentUser.id,
      nowSql(),
      installmentId
    ]);

    sendOk(res, { id: installmentId }, 'Installment plan archived successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to archive installment plan.');
  }
});

app.post('/api/payments', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const paymentMethod = String(req.body?.paymentMethod || req.body?.payment_method || 'Online').trim();
    const requestedAmount = Number(req.body?.amount || req.body?.amount_paid || 0);
    const allocationMode = String(req.body?.allocationMode || req.body?.allocation_mode || 'auto').trim() || 'auto';
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const remarks = String(req.body?.remarks || '').trim();

    if (!billingId || requestedAmount <= 0) {
      sendError(res, 422, 'billingId and a valid payment amount are required.');
      return;
    }
    const payment = await createPaymentRequest({
      billingId,
      paymentMethod,
      requestedAmount,
      allocationMode,
      allocations,
      remarks,
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body,
      moduleKey: 'manage_billing',
      rawAction: 'PAY_BILLS_CREATE_PAYMENT',
      actionLabel: 'Payment Request Created',
      notificationTitle: 'Payment request pending',
      notificationType: 'payment_pending',
      descriptionPrefix: 'was created'
    });

    sendOk(
      res,
      payment,
      `${payment.referenceNumber} was created successfully.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create payment request.';
    if (
      message.includes('Billing record not found') ||
      message.includes('Payment cannot proceed') ||
      message.includes('Payment amount cannot exceed')
    ) {
      sendError(res, 409, message);
      return;
    }
    sendError(res, 500, message);
  }
});

app.post('/api/payments/approve', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.body?.billingId || req.body?.billing_id || 0);
    const paymentMethod = String(req.body?.paymentMethod || req.body?.payment_method || 'Online').trim();
    const allocationMode = String(req.body?.allocationMode || req.body?.allocation_mode || 'auto').trim() || 'auto';
    const allocations = Array.isArray(req.body?.allocations) ? req.body.allocations : [];
    const remarks = String(req.body?.remarks || 'Payment request approved for processing.').trim();

    const [rows] = await pool.query(`SELECT balance_amount FROM billing_records WHERE id = ? LIMIT 1`, [billingId]);
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    const requestedAmount = Number(req.body?.amount || req.body?.amount_paid || billingRow.balance_amount || 0);
    if (requestedAmount <= 0) {
      sendError(res, 422, 'A valid payment amount is required.');
      return;
    }

    const payment = await createPaymentRequest({
      billingId,
      paymentMethod,
      requestedAmount,
      allocationMode,
      allocations,
      remarks,
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: { ...req.body, approved: true },
      moduleKey: 'manage_billing',
      rawAction: 'PAYMENT_APPROVE',
      actionLabel: 'Payment Approved',
      notificationTitle: 'Payment approved',
      notificationType: 'payment_pending',
      descriptionPrefix: 'was approved',
      billingStageAfterCreate: WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY
    });

    sendOk(
      res,
      {
        ...payment,
        status: 'Approved',
        workflow_stage: WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
        next_module: workflowStageLabel(WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY)
      },
      'Payment request approved successfully.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to approve payment request.';
    if (
      message.includes('Billing record not found') ||
      message.includes('Payment cannot proceed') ||
      message.includes('Payment amount cannot exceed')
    ) {
      sendError(res, 409, message);
      return;
    }
    sendError(res, 500, message);
  }
});

app.post('/api/payments/:id/retry', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, billing_id, reference_number, payment_status, workflow_stage
       FROM payment_transactions
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = rows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment record not found.');
      return;
    }

    if (!['failed', 'cancelled'].includes(String(paymentRow.payment_status || '').toLowerCase())) {
      sendError(res, 409, 'Only failed or cancelled payments can be retried.');
      return;
    }

    await pool.query(`UPDATE payment_transactions SET payment_status = 'processing', workflow_stage = ?, payment_date = ?, processed_by = ? WHERE id = ?`, [
      WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
      nowSql(),
      req.currentUser.id,
      paymentId
    ]);
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'processing',
      requestPayload: { retried: true },
      responsePayload: { queued: true },
      remarks: 'Failed payment was retried.',
      createdBy: req.currentUser.id
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'PAYMENT_RETRY',
      action: 'Payment Retried',
      description: `${paymentRow.reference_number} was retried and moved back to Payment Processing & Gateway.`,
      moduleKey: 'process_payment',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Processing',
      beforeStage: normalizeWorkflowStage(paymentRow.workflow_stage, resolvePaymentWorkflowStage(paymentRow.payment_status)),
      afterStage: WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
      notification: {
        type: 'payment_pending',
        title: 'Payment retried',
        message: `${paymentRow.reference_number} was retried and returned to the gateway queue.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        `${paymentRow.reference_number} was retried and moved back to Payment Processing & Gateway.`,
        'Processing',
        WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
        { id: paymentId, referenceNumber: paymentRow.reference_number }
      ),
      `${paymentRow.reference_number} was retried and moved back to Payment Processing & Gateway.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to retry payment.');
  }
});

app.post('/api/payments/:id/mark-failed', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || req.body?.billingId || req.body?.billing_id || 0);
    const reason = String(req.body?.reason || req.body?.failureReason || 'Payment request failed validation.').trim();
    const remarks = String(req.body?.remarks || '').trim();

    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, balance_amount
       FROM billing_records
       WHERE id = ?
       LIMIT 1`,
      [billingId]
    );
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    await pool.query(
      `UPDATE billing_records
       SET billing_status = 'failed',
           workflow_stage = ?,
           remarks = ?,
           action_by = ?,
           action_at = ?,
           audit_reference = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        WORKFLOW_STAGES.PAY_BILLS,
        remarks ? `${reason}. ${remarks}` : reason,
        req.currentUser.id,
        nowSql(),
        `FAILED-${billingId}-${Date.now()}`,
        nowSql(),
        billingId
      ]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'PAY_BILLS_MARK_FAILED',
      action: 'Payment Failed',
      description: `${billingRow.billing_code} was marked as failed. ${reason}${remarks ? ` ${remarks}` : ''}`,
      moduleKey: 'manage_billing',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapManagementStatus(billingRow.billing_status),
      afterStatus: 'Payment Failed',
      beforeStage: normalizeWorkflowStage(
        billingRow.workflow_stage,
        resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
      ),
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        type: 'payment_failed',
        title: 'Payment failed',
        message: `${billingRow.billing_code} was marked as failed and remains in Pay Bills.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        `${billingRow.billing_code} was marked as failed and remains in Pay Bills.`,
        'Payment Failed',
        WORKFLOW_STAGES.PAY_BILLS
      ),
      `${billingRow.billing_code} was marked as failed and remains in Pay Bills.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to mark payment request as failed.');
  }
});

app.patch('/api/payments/:id/cancel', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, billing_id, reference_number, payment_status, workflow_stage
       FROM payment_transactions
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = rows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment record not found.');
      return;
    }

    await pool.query(`UPDATE payment_transactions SET payment_status = 'cancelled', workflow_stage = ?, payment_date = ?, processed_by = ? WHERE id = ?`, [
      WORKFLOW_STAGES.PAY_BILLS,
      nowSql(),
      req.currentUser.id,
      paymentId
    ]);
    await pool.query(`UPDATE billing_records SET workflow_stage = ?, updated_at = ? WHERE id = ?`, [WORKFLOW_STAGES.PAY_BILLS, nowSql(), paymentRow.billing_id]);
    await createPaymentAttempt({
      paymentId,
      billingId: Number(paymentRow.billing_id),
      referenceNumber: paymentRow.reference_number,
      attemptStatus: 'cancelled',
      requestPayload: { cancelled: true },
      responsePayload: { cancelled: true },
      remarks: 'Pending payment was cancelled.',
      createdBy: req.currentUser.id
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'PAYMENT_CANCELLED',
      action: 'Payment Cancelled',
      description: `${paymentRow.reference_number} was cancelled and returned to Pay Bills.`,
      moduleKey: 'manage_billing',
      entityType: 'payment',
      entityId: paymentId,
      beforeStatus: mapPaymentStatus(paymentRow.payment_status),
      afterStatus: 'Cancelled',
      beforeStage: normalizeWorkflowStage(paymentRow.workflow_stage, resolvePaymentWorkflowStage(paymentRow.payment_status)),
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        type: 'payment_failed',
        title: 'Payment cancelled',
        message: `${paymentRow.reference_number} was cancelled and moved back to Pay Bills.`
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${paymentRow.reference_number} was cancelled and returned to Pay Bills.`, 'Cancelled', WORKFLOW_STAGES.PAY_BILLS, {
        id: paymentId,
        referenceNumber: paymentRow.reference_number
      }),
      `${paymentRow.reference_number} was cancelled and returned to Pay Bills.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to cancel payment.');
  }
});

app.get('/api/payment-transactions', requireAuth, async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const paymentMethodFilter = String(req.query?.payment_method || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(req.query?.workflow_stage || '').trim(), '');
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 10)));

    let items = await serializePaymentTransactions();
    if (statusFilter) items = items.filter((item) => item.status.toLowerCase() === statusFilter);
    if (paymentMethodFilter) items = items.filter((item) => item.paymentMethod.toLowerCase().includes(paymentMethodFilter));
    if (workflowStageFilter) items = items.filter((item) => normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter);
    items = applyTextSearch(items, search, (item) => `${item.referenceNumber} ${item.studentName} ${item.billingCode} ${item.paymentMethod} ${item.status}`);

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment transactions.');
  }
});

app.get('/api/payment-transactions/:id', requireAuth, async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const payments = await serializePaymentTransactions();
    const receipts = await serializeReceipts();
    const payment = payments.find((item) => item.id === paymentId);
    if (!payment) {
      sendError(res, 404, 'Payment transaction not found.');
      return;
    }

    const receipt = receipts.find((item) => item.paymentId === paymentId) || null;
    const reconciliationRows = await fetchReconciliationRows();
    const reconciliation = reconciliationRows.find((item) => Number(item.payment_id) === paymentId) || null;

    sendOk(res, {
      ...payment,
      receipt,
      workflowStage: payment.workflowStage,
      workflowStageLabel: payment.workflowStageLabel,
      reconciliation: reconciliation
        ? {
            id: Number(reconciliation.id),
            status: mapReconciliationStatus(reconciliation.status),
            rawStatus: reconciliation.status,
            workflowStage: normalizeWorkflowStage(reconciliation.workflow_stage, resolveReconciliationWorkflowStage(reconciliation.status)),
            workflowStageLabel: workflowStageLabel(reconciliation.workflow_stage || resolveReconciliationWorkflowStage(reconciliation.status)),
            discrepancyNote: reconciliation.discrepancy_note,
            reconciledAt: toIsoString(reconciliation.reconciled_at),
            reportedAt: toIsoString(reconciliation.reported_at),
            archivedAt: toIsoString(reconciliation.archived_at)
          }
        : null
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment transaction detail.');
  }
});

app.get('/api/payment-transactions/:id/allocations', requireAuth, async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const rows = await fetchPaymentAllocationRows({ paymentId });
    const summary = buildPaymentAllocationMap(rows).get(paymentId);
    sendOk(res, {
      paymentId,
      items: summary?.items || [],
      summary: summary?.summary || 'No allocations found.',
      totalAllocated: summary?.totalAllocated || 0,
      totalAllocatedFormatted: summary?.totalAllocatedFormatted || formatCurrency(0)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment transaction allocations.');
  }
});

app.get('/api/payment-transactions/:id/status', requireAuth, async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT payment_status, reporting_status, workflow_stage, payment_date
       FROM payment_transactions
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Payment transaction not found.');
      return;
    }

    sendOk(res, {
      status: mapPaymentStatus(row.payment_status),
      rawStatus: row.payment_status,
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)),
      reportingStatus: mapReportingStatus(row.reporting_status),
      checkedAt: toIsoString(row.payment_date)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment transaction status.');
  }
});

app.post('/api/payment-gateway/process', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.body?.paymentId || req.body?.payment_id || 0);
    const action = String(req.body?.action || req.body?.command || 'process').trim().toLowerCase();
    if (!paymentId) {
      sendError(res, 422, 'A valid payment transaction is required.');
      return;
    }

    const result = await executeGatewayAction({
      paymentId,
      action,
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body
    });

    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process payment gateway request.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.patch('/api/payment-transactions/:id/confirm', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const result = await executeGatewayAction({
      paymentId,
      action: 'confirm',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });
    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm payment transaction.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.patch('/api/payment-transactions/:id/fail', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const result = await executeGatewayAction({
      paymentId,
      action: 'fail',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });
    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fail payment transaction.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.patch('/api/payment-transactions/:id/cancel', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const result = await executeGatewayAction({
      paymentId,
      action: 'cancel',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });
    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to cancel payment transaction.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.patch('/api/payment-transactions/:id/authorize', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const result = await executeGatewayAction({
      paymentId,
      action: 'authorize',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });
    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to authorize payment transaction.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.patch('/api/payment-transactions/:id/confirm-paid', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const result = await executeGatewayAction({
      paymentId,
      action: 'confirm',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });
    sendOk(
      res,
      {
        ...result,
        next_module: workflowStageLabel(WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION)
      },
      result.message
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to confirm payment transaction.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.get('/api/receipts', requireAuth, async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(req.query?.workflow_stage || '').trim(), '');
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 10)));

    let items = await serializeReceipts();
    if (statusFilter) items = items.filter((item) => item.status.toLowerCase() === statusFilter);
    if (workflowStageFilter) items = items.filter((item) => normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter);
    items = applyTextSearch(items, search, (item) => `${item.receiptNumber} ${item.studentName} ${item.paymentReference} ${item.billingCode} ${item.status}`);

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load receipts.');
  }
});

app.get('/api/receipts/:id', requireAuth, async (req, res) => {
  try {
    const receiptId = Number(req.params.id || 0);
    const receipt = (await serializeReceipts()).find((item) => item.id === receiptId);
    if (!receipt) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }

    sendOk(res, receipt);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load receipt detail.');
  }
});

app.get('/api/receipts/by-payment/:paymentReference', requireAuth, async (req, res) => {
  try {
    const paymentReference = String(req.params.paymentReference || '').trim();
    const receipts = await serializeReceipts();
    const receipt = receipts.find((item) => item.paymentReference === paymentReference);
    if (!receipt) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }

    sendOk(res, receipt);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load receipt by payment reference.');
  }
});

app.post('/api/receipts/generate', requireAuth, requireRole('admin', 'cashier', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.body?.paymentId || req.body?.payment_id || 0);
    if (!paymentId) {
      sendError(res, 422, 'A valid payment transaction is required.');
      return;
    }

    const [paymentRows] = await pool.query(
      `SELECT id, reference_number, payment_status
       FROM payment_transactions
       WHERE id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = paymentRows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment transaction not found.');
      return;
    }
    if (!['paid', 'posted'].includes(String(paymentRow.payment_status || '').toLowerCase())) {
      sendError(res, 409, 'Receipt generation is only allowed after successful payment.');
      return;
    }

    const receiptNumber = nextReceiptNumber(paymentId);
    await pool.query(
      `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, created_at)
       VALUES (?, ?, ?, 'generated', ?, 'Receipt document was generated from the successful payment.', ?)
       ON CONFLICT (receipt_number) DO UPDATE SET
         issued_date = EXCLUDED.issued_date,
         workflow_stage = EXCLUDED.workflow_stage,
         receipt_status = 'generated',
         remarks = EXCLUDED.remarks`,
      [paymentId, receiptNumber, nowSql(), WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, nowSql()]
    );

    const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
    const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;
    if (receiptId) {
      await ensureProofDocument(paymentId, receiptId, req.currentUser.id);
      await replaceReceiptItemsFromPayment(paymentId, receiptId);
      await upsertReconciliationRecord(paymentId, receiptId, 'pending_review');
    }

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_RECEIPT_GENERATE',
      action: 'Receipt Generated',
      description: `${receiptNumber} was generated for payment ${paymentRow.reference_number}.`,
      moduleKey: 'generate_receipt',
      entityType: 'receipt',
      entityId: receiptId || paymentId,
      beforeStatus: 'Receipt Pending',
      afterStatus: 'Receipt Generated',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      notification: {
        recipientRole: 'accounting',
        type: 'receipt_generated',
        title: 'Receipt generated',
        message: `${receiptNumber} is ready for proof verification.`
      }
    });

    sendOk(
      res,
      {
        ...buildWorkflowActionPayload(
          `${receiptNumber} was generated successfully and remains in Compliance & Documentation.`,
          'Receipt Generated',
          WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
        ),
        paymentId,
        receiptNumber,
        receiptId
      },
      `${receiptNumber} was generated successfully and remains in Compliance & Documentation.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to generate receipt.');
  }
});

app.post('/api/proof-documents', requireAuth, requireRole('admin', 'cashier', 'compliance'), async (req, res) => {
  try {
    const receiptId = Number(req.body?.receiptId || req.body?.receipt_id || 0);
    const paymentId = Number(req.body?.paymentId || req.body?.payment_id || 0);
    if (!receiptId || !paymentId) {
      sendError(res, 422, 'receiptId and paymentId are required.');
      return;
    }

    const fileName = String(req.body?.fileName || req.body?.file_name || `proof-${paymentId}.pdf`).trim();
    await pool.query(
      `INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
      [receiptId, paymentId, String(req.body?.documentType || 'proof_of_payment').trim(), fileName, nowSql()]
    );

    sendOk(res, { receiptId, paymentId, fileName }, 'Proof document attached successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to attach proof document.');
  }
});

app.post('/api/payment-proof/upload', requireAuth, requireRole('admin', 'cashier', 'compliance'), async (req, res) => {
  try {
    const receiptId = Number(req.body?.receiptId || req.body?.receipt_id || 0);
    const paymentId = Number(req.body?.paymentId || req.body?.payment_id || 0);
    if (!receiptId || !paymentId) {
      sendError(res, 422, 'receiptId and paymentId are required.');
      return;
    }

    const fileName = String(req.body?.fileName || req.body?.file_name || `proof-${paymentId}.pdf`).trim();
    await pool.query(
      `INSERT INTO proof_documents (receipt_id, payment_id, document_type, file_name, status, verified_by, verified_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
      [receiptId, paymentId, String(req.body?.documentType || 'proof_of_payment').trim(), fileName, nowSql()]
    );

    sendOk(res, { receiptId, paymentId, fileName }, 'Proof document attached successfully.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to attach proof document.');
  }
});

app.patch('/api/proof-documents/:id/verify', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const proofId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, receipt_id, payment_id, status
       FROM proof_documents
       WHERE id = ?
       LIMIT 1`,
      [proofId]
    );
    const proofRow = rows[0];
    if (!proofRow) {
      sendError(res, 404, 'Proof document not found.');
      return;
    }

    await pool.query(`UPDATE proof_documents SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?`, [
      req.currentUser.id,
      nowSql(),
      proofId
    ]);
    await pool.query(
      `UPDATE receipt_records
       SET receipt_status = 'verified',
           workflow_stage = ?,
           remarks = 'Proof of payment was verified by cashier staff.'
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, proofRow.receipt_id]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_PROOF_VERIFY',
      action: 'Proof Verified',
      description: `Proof document ${proofId} was verified for payment ${proofRow.payment_id}.`,
      moduleKey: 'generate_receipt',
      entityType: 'proof_document',
      entityId: proofId,
      beforeStatus: String(proofRow.status || 'pending'),
      afterStatus: 'verified',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        'Proof of payment verified successfully and kept in Compliance & Documentation.',
        'Proof Verified',
        WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
      ),
      'Proof of payment verified successfully and kept in Compliance & Documentation.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to verify proof document.');
  }
});

app.patch('/api/payment-proof/:id/verify', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const proofId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, receipt_id, payment_id, status
       FROM proof_documents
       WHERE id = ?
       LIMIT 1`,
      [proofId]
    );
    const proofRow = rows[0];
    if (!proofRow) {
      sendError(res, 404, 'Proof document not found.');
      return;
    }

    await pool.query(`UPDATE proof_documents SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?`, [
      req.currentUser.id,
      nowSql(),
      proofId
    ]);
    await pool.query(
      `UPDATE receipt_records
       SET receipt_status = 'verified',
           workflow_stage = ?,
           remarks = 'Proof of payment was verified by cashier staff.'
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, proofRow.receipt_id]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_PROOF_VERIFY',
      action: 'Proof Verified',
      description: `Proof document ${proofId} was verified for payment ${proofRow.payment_id}.`,
      moduleKey: 'generate_receipt',
      entityType: 'proof_document',
      entityId: proofId,
      beforeStatus: String(proofRow.status || 'pending'),
      afterStatus: 'verified',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        'Proof of payment verified successfully and kept in Compliance & Documentation.',
        'Proof Verified',
        WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
      ),
      'Proof of payment verified successfully and kept in Compliance & Documentation.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to verify proof document.');
  }
});

app.post('/api/compliance/:id/verify-proof', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const verificationNotes = String(req.body?.verificationNotes || req.body?.remarks || 'Proof of payment was verified by cashier staff.').trim();
    const verifiedBy = String(req.body?.verifiedBy || req.currentUser.fullName || req.currentUser.username || 'Compliance Staff').trim();
    const decision = String(req.body?.decision || 'Verified').trim();
    const proofType = String(req.body?.proofType || 'Proof of Payment').trim();

    const [proofRows] = await pool.query(
      `SELECT id, status
       FROM proof_documents
       WHERE payment_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [paymentId]
    );
    const proofRow = proofRows[0];
    if (!proofRow) {
      sendError(res, 404, 'Proof document not found.');
      return;
    }

    const [receiptRows] = await pool.query(
      `SELECT r.receipt_number, r.receipt_status, p.reference_number, p.payment_method, p.payment_status
       FROM receipt_records r
       INNER JOIN payment_transactions p ON p.id = r.payment_id
       WHERE r.payment_id = ?
       ORDER BY r.id DESC
       LIMIT 1`,
      [paymentId]
    );
    const receiptRow = receiptRows[0] || null;
    if (!receiptRow) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }
    if (!['paid', 'posted'].includes(String(receiptRow.payment_status || '').toLowerCase())) {
      sendError(res, 409, 'Proof verification is only allowed after successful payment.');
      return;
    }
    if (!['generated', 'released'].includes(String(receiptRow.receipt_status || '').toLowerCase())) {
      sendError(res, 409, 'Generate the receipt first before verifying proof of payment.');
      return;
    }
    const receiptReference = receiptRow?.receipt_number || `PAY-${paymentId}`;
    const paymentMethod = receiptRow?.payment_method || 'Online';
    const receiptRemarks = verificationNotes
      ? `${proofType} verified for receipt ${receiptReference} via ${paymentMethod}. ${verificationNotes}`
      : `${proofType} verified for receipt ${receiptReference} via ${paymentMethod}.`;

    await pool.query(`UPDATE proof_documents SET status = 'verified', verified_by = ?, verified_at = ? WHERE id = ?`, [
      req.currentUser.id,
      nowSql(),
      proofRow.id
    ]);
    await pool.query(
      `UPDATE receipt_records
       SET receipt_status = 'verified',
           workflow_stage = ?,
           remarks = ?
       WHERE payment_id = ?`,
      [WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, receiptRemarks, paymentId]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_PROOF_VERIFY',
      action: 'Proof Verified',
      description: `${proofType} was verified for receipt ${receiptReference} using ${paymentMethod}.`,
      moduleKey: 'generate_receipt',
      entityType: 'proof_document',
      entityId: Number(proofRow.id),
      beforeStatus: String(proofRow.status || 'pending'),
      afterStatus: 'verified',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      remarks: receiptRemarks
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        'Proof of payment verified successfully and kept in Compliance & Documentation.',
        'Proof Verified',
        WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
      ),
      'Proof of payment verified successfully and kept in Compliance & Documentation.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to verify proof document.');
  }
});

app.get('/api/compliance/documents', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (_req, res) => {
  try {
    const receipts = await serializeReceipts();
    sendOk(res, {
      items: receipts.map((receipt) => ({
        id: receipt.id,
        receiptNumber: receipt.receiptNumber,
        billingCode: receipt.billingCode,
        studentName: receipt.studentName,
        paymentReference: receipt.paymentReference,
        amount: receipt.amount,
        amountFormatted: receipt.amountFormatted,
        status: receipt.status,
        issuedDate: receipt.issuedDate,
        issuedDateFormatted: receipt.issuedDateFormatted,
        remarks: receipt.remarks,
        proofDocuments: receipt.proofDocuments
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load compliance documents.');
  }
});

app.post('/api/compliance/:id/complete', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const completionNotes = String(req.body?.completionNotes || req.body?.remarks || 'Documentation package was completed and moved to Reporting & Reconciliation.').trim();

    const [receiptRows] = await pool.query(
      `SELECT id, receipt_number, receipt_status
       FROM receipt_records
       WHERE payment_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [paymentId]
    );
    const receiptRow = receiptRows[0];
    if (!receiptRow) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }
    if (!['verified', 'completed', 'released'].includes(String(receiptRow.receipt_status || '').toLowerCase())) {
      sendError(res, 409, 'Proof verification must be completed before final documentation.');
      return;
    }

    const [proofRows] = await pool.query(
      `SELECT id, status
       FROM proof_documents
       WHERE payment_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [paymentId]
    );
    const proofRow = proofRows[0];
    if (!proofRow || String(proofRow.status || '').toLowerCase() !== 'verified') {
      sendError(res, 409, 'A verified proof document is required before completing documentation.');
      return;
    }

    await pool.query(
      `UPDATE receipt_records
       SET receipt_status = 'completed',
           workflow_stage = ?,
           remarks = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, completionNotes, receiptRow.id]
    );
    await pool.query(
      `UPDATE payment_transactions
       SET workflow_stage = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, paymentId]
    );
    await upsertReconciliationRecord(paymentId, Number(receiptRow.id), 'pending_review', {
      workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_DOCUMENT_COMPLETE',
      action: 'Documentation Completed',
      description: `${receiptRow.receipt_number} documentation completed and moved to Reporting & Reconciliation.`,
      moduleKey: 'generate_receipt',
      entityType: 'receipt',
      entityId: Number(receiptRow.id),
      beforeStatus: mapReceiptStatus(receiptRow.receipt_status),
      afterStatus: 'Documentation Completed',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        `${receiptRow.receipt_number} documentation completed and moved to Reporting & Reconciliation.`,
        'Documentation Completed',
        WORKFLOW_STAGES.REPORTING_RECONCILIATION
      ),
      `${receiptRow.receipt_number} documentation completed and moved to Reporting & Reconciliation.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to complete compliance documentation.');
  }
});

app.patch('/api/receipts/:id/complete', requireAuth, requireRole('admin', 'cashier', 'compliance', 'account'), async (req, res) => {
  try {
    const receiptId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, payment_id, receipt_number, receipt_status
       FROM receipt_records
       WHERE id = ?
       LIMIT 1`,
      [receiptId]
    );
    const receiptRow = rows[0];
    if (!receiptRow) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }

    await pool.query(
      `UPDATE receipt_records
       SET receipt_status = 'completed',
           workflow_stage = ?,
           remarks = 'Documentation package was completed and archived for reconciliation.'
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, receiptId]
    );
    await pool.query(
      `UPDATE payment_transactions
       SET workflow_stage = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, receiptRow.payment_id]
    );
    await upsertReconciliationRecord(Number(receiptRow.payment_id), receiptId, 'pending_review', {
      workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'COMPLIANCE_DOCUMENT_COMPLETE',
      action: 'Documentation Completed',
      description: `${receiptRow.receipt_number} was completed for reconciliation.`,
      moduleKey: 'generate_receipt',
      entityType: 'receipt',
      entityId: receiptId,
      beforeStatus: mapReceiptStatus(receiptRow.receipt_status),
      afterStatus: 'Documentation Completed',
      beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });

    sendOk(
      res,
      buildWorkflowActionPayload(
        `${receiptRow.receipt_number} documentation completed and moved to Reporting & Reconciliation.`,
        'Documentation Completed',
        WORKFLOW_STAGES.REPORTING_RECONCILIATION
      ),
      `${receiptRow.receipt_number} documentation completed and moved to Reporting & Reconciliation.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to complete receipt documentation.');
  }
});

app.post('/api/receipts/:id/reissue', requireAuth, requireRole('admin', 'cashier', 'compliance'), async (req, res) => {
  try {
    const receiptId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, payment_id, receipt_number
       FROM receipt_records
       WHERE id = ?
       LIMIT 1`,
      [receiptId]
    );
    const receiptRow = rows[0];
    if (!receiptRow) {
      sendError(res, 404, 'Receipt record not found.');
      return;
    }

    const newReceiptNumber = `${receiptRow.receipt_number}-R${String(Date.now()).slice(-3)}`;
    await pool.query(
      `UPDATE receipt_records
       SET receipt_number = ?, receipt_status = 'generated', workflow_stage = ?, issued_date = ?, remarks = 'Receipt was reissued by cashier staff.'
       WHERE id = ?`,
      [newReceiptNumber, WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION, nowSql(), receiptId]
    );

    sendOk(
      res,
      {
        ...buildWorkflowActionPayload(
          `${newReceiptNumber} was reissued and kept in Compliance & Documentation.`,
          'Receipt Generated',
          WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
        ),
        id: receiptId,
        receiptNumber: newReceiptNumber
      },
      `${newReceiptNumber} was reissued and kept in Compliance & Documentation.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to reissue receipt.');
  }
});

app.get('/api/reconciliation', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(req.query?.workflow_stage || '').trim(), '');
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(50, Math.max(1, Number(req.query?.per_page || 10)));

    let items = (await fetchReconciliationRows()).map((row) => ({
      id: Number(row.id),
      paymentId: Number(row.payment_id),
      receiptId: row.receipt_id ? Number(row.receipt_id) : null,
      referenceNumber: row.reference_number,
      studentName: row.full_name,
      studentNumber: row.student_no,
      billingCode: row.billing_code,
      receiptNumber: row.receipt_number,
      amount: Number(row.amount_paid || 0),
      amountFormatted: formatCurrency(row.amount_paid),
      paymentStatus: mapPaymentStatus(row.payment_status),
      documentationStatus: mapReceiptStatus(row.receipt_status),
      status: mapReconciliationStatus(row.status),
      rawStatus: row.status,
      workflowStage: normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)),
      workflowStageLabel: workflowStageLabel(row.workflow_stage || resolveReconciliationWorkflowStage(row.status)),
      discrepancyNote: row.discrepancy_note,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    }));

    if (statusFilter) items = items.filter((item) => item.status.toLowerCase() === statusFilter);
    if (workflowStageFilter) items = items.filter((item) => normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter);
    items = applyTextSearch(items, search, (item) => `${item.referenceNumber} ${item.studentName} ${item.billingCode} ${item.receiptNumber} ${item.status}`);

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load reconciliation queue.');
  }
});

app.post('/api/reconciliation/run', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const receipts = await serializeReceipts();
    const payments = await serializePaymentTransactions();
    let created = 0;

    for (const payment of payments.filter((item) => item.status === 'Paid')) {
      const receipt = receipts.find((item) => item.paymentId === payment.id) || null;
      await upsertReconciliationRecord(payment.id, receipt?.id || null, 'pending_review', {
        workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
      });
      created += 1;
    }

    sendOk(
      res,
      buildWorkflowActionPayload('Reconciliation run completed.', 'Logged', WORKFLOW_STAGES.REPORTING_RECONCILIATION, { totalProcessed: created }),
      'Reconciliation run completed.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to run reconciliation.');
  }
});

app.patch('/api/reconciliation/:id/mark-reconciled', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const reconciliationId = Number(req.params.id || 0);
    const [rows] = await pool.query(
      `SELECT id, payment_id, receipt_id, status, workflow_stage, reference_number
       FROM (
         SELECT r.id, r.payment_id, r.receipt_id, r.status, r.workflow_stage, p.reference_number
         FROM reconciliations r
         INNER JOIN payment_transactions p ON p.id = r.payment_id
       ) t
       WHERE id = ?
       LIMIT 1`,
      [reconciliationId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reconciliation record not found.');
      return;
    }

    await upsertReconciliationRecord(Number(row.payment_id), row.receipt_id ? Number(row.receipt_id) : null, 'reconciled', {
      reconciledBy: req.currentUser.id,
      reconciledAt: nowSql(),
      workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });
    await pool.query(`UPDATE payment_transactions SET reporting_status = 'reconciled' WHERE id = ?`, [row.payment_id]);
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'REPORTING_RECONCILE',
      action: 'Record Reconciled',
      description: `${row.reference_number} was reconciled from the reconciliation queue.`,
      moduleKey: 'reports',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      beforeStatus: mapReconciliationStatus(row.status),
      afterStatus: 'Reconciled',
      beforeStage: normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)),
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${row.reference_number} was reconciled successfully.`, 'Reconciled', WORKFLOW_STAGES.REPORTING_RECONCILIATION, {
        id: reconciliationId,
        referenceNumber: row.reference_number
      }),
      `${row.reference_number} was reconciled successfully.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to mark reconciliation as complete.');
  }
});

app.patch('/api/reconciliation/:id/flag-discrepancy', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const reconciliationId = Number(req.params.id || 0);
    const note = String(req.body?.note || req.body?.discrepancyNote || 'Discrepancy flagged during reconciliation review.').trim();
    const [rows] = await pool.query(`SELECT id, payment_id, status, workflow_stage FROM reconciliations WHERE id = ? LIMIT 1`, [reconciliationId]);
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reconciliation record not found.');
      return;
    }

    await pool.query(
      `UPDATE reconciliations
       SET status = 'discrepancy', workflow_stage = ?, discrepancy_note = ?, updated_at = ?
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, note, nowSql(), reconciliationId]
    );
    await pool.query(`UPDATE payment_transactions SET reporting_status = 'logged' WHERE id = ?`, [row.payment_id]);
    await insertSystemNotification({
      recipientRole: 'accounting',
      type: 'discrepancy_flagged',
      title: 'Discrepancy flagged',
      message: note,
      entityType: 'reconciliation',
      entityId: reconciliationId
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'REPORTING_DISCREPANCY',
      action: 'Discrepancy Flagged',
      description: note,
      moduleKey: 'reports',
      entityType: 'reconciliation',
      entityId: reconciliationId,
      beforeStatus: mapReconciliationStatus(row.status),
      afterStatus: 'With Discrepancy',
      beforeStage: normalizeWorkflowStage(row.workflow_stage, resolveReconciliationWorkflowStage(row.status)),
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
      notification: {
        recipientRole: 'accounting',
        type: 'discrepancy_flagged',
        title: 'Discrepancy flagged',
        message: note
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload('Discrepancy flagged successfully.', 'With Discrepancy', WORKFLOW_STAGES.REPORTING_RECONCILIATION, {
        id: reconciliationId
      }),
      'Discrepancy flagged successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to flag discrepancy.');
  }
});

app.post('/api/reconciliation/:id/reconcile', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const remarks = String(req.body?.remarks || 'Payment and receipt records matched successfully.').trim();

    const [rows] = await pool.query(
      `SELECT rec.id, rec.receipt_id, p.reference_number, p.payment_status, p.workflow_stage, COALESCE(r.receipt_status, 'queued') AS receipt_status
       FROM payment_transactions p
       LEFT JOIN reconciliations rec ON rec.payment_id = p.id
       LEFT JOIN receipt_records r ON r.id = rec.receipt_id
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reporting record not found.');
      return;
    }
    if (!['paid', 'posted'].includes(String(row.payment_status || '').toLowerCase())) {
      sendError(res, 409, 'Only paid transactions can be reconciled.');
      return;
    }
    if (!['generated', 'verified', 'completed', 'released'].includes(String(row.receipt_status || '').toLowerCase())) {
      sendError(res, 409, 'A completed receipt or proof document is required before reconciliation.');
      return;
    }

    await pool.query(
      `UPDATE payment_transactions
       SET reporting_status = 'archived',
           workflow_stage = ?,
           previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_completed = 1
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLETED, WORKFLOW_STAGES.REPORTING_RECONCILIATION, req.currentUser.id, nowSql(), remarks, `RECONCILE-${paymentId}-${Date.now()}`, paymentId]
    );
    await pool.query(`UPDATE receipt_records SET workflow_stage = ?, is_completed = 1 WHERE payment_id = ?`, [WORKFLOW_STAGES.COMPLETED, paymentId]);
    await upsertReconciliationRecord(paymentId, row.receipt_id ? Number(row.receipt_id) : null, 'reconciled', {
      archivedAt: nowSql(),
      workflowStage: WORKFLOW_STAGES.COMPLETED,
      reconciledBy: req.currentUser.id,
      reconciledAt: nowSql(),
      actionBy: req.currentUser.id,
      actionAt: nowSql(),
      auditReference: `RECONCILE-${paymentId}-${Date.now()}`,
      isCompleted: 1
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'RECONCILIATION_RECONCILE',
      action: 'Record Reconciled',
      description: `${row.reference_number} was reconciled and moved to archive. ${remarks}`,
      moduleKey: 'reports',
      entityType: 'reconciliation',
      entityId: paymentId,
      beforeStatus: 'Pending Review',
      afterStatus: 'Reconciled',
      beforeStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
      afterStage: WORKFLOW_STAGES.COMPLETED,
      notification: {
        recipientRole: 'accounting',
        type: 'reconciliation_completed',
        title: 'Record reconciled',
        message: `${row.reference_number} was reconciled and archived.`,
        entityType: 'reconciliation',
        entityId: paymentId
      }
    });

    sendOk(
      res,
      {
        message: 'Record reconciled successfully.',
        status: 'Reconciled',
        workflow_stage: WORKFLOW_STAGES.COMPLETED,
        next_module: 'Archive'
      },
      'Record reconciled successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to reconcile record.');
  }
});

app.post('/api/reconciliation/:id/flag-discrepancy', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const note = String(req.body?.note || req.body?.discrepancyNote || 'Discrepancy flagged during reconciliation review.').trim();
    const [rows] = await pool.query(
      `SELECT p.id, p.reporting_status, p.payment_status, p.workflow_stage
       FROM payment_transactions p
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reconciliation record not found.');
      return;
    }

    await pool.query(
      `UPDATE reconciliations
       SET status = 'discrepancy', workflow_stage = ?, discrepancy_note = ?, updated_at = ?
       WHERE payment_id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, note, nowSql(), paymentId]
    );
    await pool.query(`UPDATE payment_transactions SET reporting_status = 'logged' WHERE id = ?`, [paymentId]);
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'RECONCILIATION_DISCREPANCY',
      action: 'Discrepancy Flagged',
      description: note,
      moduleKey: 'reports',
      entityType: 'reconciliation',
      entityId: paymentId,
      beforeStatus: mapReportingStatus(row.reporting_status),
      afterStatus: 'With Discrepancy',
      beforeStage: normalizeWorkflowStage(
        row.workflow_stage,
        resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
      remarks: note,
      notification: {
        recipientRole: 'accounting',
        type: 'discrepancy_flagged',
        title: 'Discrepancy flagged',
        message: note
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload('Discrepancy flagged successfully.', 'With Discrepancy', WORKFLOW_STAGES.REPORTING_RECONCILIATION),
      'Discrepancy flagged successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to flag discrepancy.');
  }
});

app.post('/api/reconciliation/:id/archive', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const remarks = String(req.body?.remarks || 'Archived after reconciliation completion.').trim();

    const [rows] = await pool.query(
      `SELECT p.id, p.reference_number, p.reporting_status, p.payment_status, p.workflow_stage
       FROM payment_transactions p
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reporting record not found.');
      return;
    }

    await pool.query(`UPDATE payment_transactions SET reporting_status = ?, workflow_stage = ? WHERE id = ?`, [
      'archived',
      WORKFLOW_STAGES.COMPLETED,
      paymentId
    ]);
    await pool.query(`UPDATE receipt_records SET workflow_stage = ? WHERE payment_id = ?`, [WORKFLOW_STAGES.COMPLETED, paymentId]);
    const [reconciliationRows] = await pool.query(`SELECT receipt_id FROM reconciliations WHERE payment_id = ? LIMIT 1`, [paymentId]);
    await upsertReconciliationRecord(paymentId, reconciliationRows[0]?.receipt_id || null, 'archived', {
      archivedAt: nowSql(),
      workflowStage: WORKFLOW_STAGES.COMPLETED,
      handoffStatus: 'archived'
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'RECONCILIATION_ARCHIVE',
      action: 'Reporting Archived',
      description: `${row.reference_number} was archived in reconciliation records. ${remarks}`,
      moduleKey: 'reports',
      entityType: 'reconciliation',
      entityId: paymentId,
      beforeStatus: mapReportingStatus(row.reporting_status),
      afterStatus: 'Archived',
      beforeStage: normalizeWorkflowStage(
        row.workflow_stage,
        resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
      ),
      afterStage: WORKFLOW_STAGES.COMPLETED
    });

    sendOk(
      res,
      buildWorkflowActionPayload(`${row.reference_number} was archived and moved to Completed.`, 'Archived', WORKFLOW_STAGES.COMPLETED),
      `${row.reference_number} was archived and moved to Completed.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to archive reconciliation record.');
  }
});

app.get('/api/reports/transactions', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const search = String(req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(req.query?.status || '').trim().toLowerCase();
    const departmentFilter = String(req.query?.department || '').trim().toLowerCase();
    const categoryFilter = String(req.query?.category || '').trim().toLowerCase();
    const paymentMethodFilter = String(req.query?.payment_method || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(req.query?.workflow_stage || '').trim(), '');
    const dateFrom = String(req.query?.date_from || '').trim();
    const dateTo = String(req.query?.date_to || '').trim();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query?.per_page || 20)));

    let items = await buildReportTransactionItems();
    if (statusFilter) items = items.filter((item) => item.reportingStatus.toLowerCase() === statusFilter);
    if (departmentFilter) {
      items = items.filter((item) =>
        [item.sourceDepartment, item.targetDepartment, item.operationalTargetDepartment]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(departmentFilter))
      );
    }
    if (categoryFilter) items = items.filter((item) => item.sourceCategory.toLowerCase().includes(categoryFilter));
    if (paymentMethodFilter) items = items.filter((item) => item.paymentMethod.toLowerCase().includes(paymentMethodFilter));
    if (workflowStageFilter) items = items.filter((item) => normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter);
    if (dateFrom) items = items.filter((item) => String(item.createdAt || '').slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter((item) => String(item.createdAt || '').slice(0, 10) <= dateTo);
    items = applyTextSearch(
      items,
      search,
      (item) =>
        `${item.referenceNumber} ${item.studentName} ${item.billingCode} ${item.receiptNumber} ${item.sourceDepartment} ${item.sourceCategory} ${item.targetDepartment} ${item.paymentStatus} ${item.reportingStatus} ${item.handoffReference} ${item.allocationSummary || ''}`
    );

    sendOk(res, {
      items: paginateRows(items, page, perPage),
      meta: buildPaginationMeta(items.length, page, perPage)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load transaction reports.');
  }
});

app.get('/api/reports/daily-collection', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT DATE(payment_date) AS payment_day, COUNT(*) AS transaction_count, SUM(amount_paid) AS total_amount
       FROM payment_transactions
       WHERE payment_status IN ('paid', 'posted')
       GROUP BY DATE(payment_date)
       ORDER BY payment_day DESC
       LIMIT 14`
    );

    sendOk(res, {
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        date: String(row.payment_day),
        totalAmount: Number(row.total_amount || 0),
        totalAmountFormatted: formatCurrency(row.total_amount),
        transactionCount: Number(row.transaction_count || 0)
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load daily collection report.');
  }
});

app.get('/api/reports/daily-collections', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT
          DATE(payment_date) AS payment_day,
          COUNT(*) AS transaction_count,
          COALESCE(SUM(CASE WHEN payment_status IN ('paid', 'posted') THEN amount_paid ELSE 0 END), 0) AS paid_total
       FROM payment_transactions
       GROUP BY DATE(payment_date)
       ORDER BY payment_day DESC
       LIMIT 14`
    );

    sendOk(res, {
      items: (Array.isArray(rows) ? rows : []).map((row) => ({
        date: String(row.payment_day),
        total: Number(row.paid_total || 0),
        totalFormatted: formatCurrency(row.paid_total),
        transactions: Number(row.transaction_count || 0)
      }))
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load daily collection report.');
  }
});

app.get('/api/reports/financial-summary', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const payments = await serializePaymentTransactions();
    const receipts = await serializeReceipts();
    const reconciliations = await fetchReconciliationRows();
    const totalCollection = payments.filter((item) => item.status === 'Paid').reduce((sum, item) => sum + item.amount, 0);

    sendOk(res, {
      activeBillings: (await serializeBillingList()).filter((item) => ['Active Billing', 'Pending Payment', 'Partially Paid'].includes(item.status)).length,
      pendingPayments: payments.filter((item) => ['Processing', 'Authorized'].includes(item.status)).length,
      successfulPayments: payments.filter((item) => item.status === 'Paid').length,
      failedPayments: payments.filter((item) => ['Failed', 'Cancelled'].includes(item.status)).length,
      receiptsGenerated: receipts.filter((item) => ['Receipt Generated', 'Proof Verified', 'Documentation Completed'].includes(item.status)).length,
      reconciledRecords: reconciliations.filter((item) => mapReconciliationStatus(item.status) === 'Reconciled').length,
      dailyCollection: totalCollection,
      dailyCollectionFormatted: formatCurrency(totalCollection)
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load financial summary.');
  }
});

app.get('/api/reports/collections-by-fee-type', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const allocationRows = await fetchPaymentAllocationRows();
    const totals = new Map();

    for (const row of allocationRows.filter(allocationCountsTowardsFinalized)) {
      const feeType = row.item_name || 'Other School Fee';
      if (!totals.has(feeType)) totals.set(feeType, 0);
      totals.set(feeType, totals.get(feeType) + Number(row.allocated_amount || 0));
    }

    const items = Array.from(totals.entries())
      .map(([feeType, total]) => ({
        feeType,
        total: Number(Number(total || 0).toFixed(2)),
        totalFormatted: formatCurrency(total)
      }))
      .sort((left, right) => right.total - left.total);

    sendOk(res, { items });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load fee type collections.');
  }
});

app.get('/api/reports/export', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (_req, res) => {
  try {
    const search = String(_req.query?.search || '').trim().toLowerCase();
    const statusFilter = String(_req.query?.status || '').trim().toLowerCase();
    const departmentFilter = String(_req.query?.department || '').trim().toLowerCase();
    const categoryFilter = String(_req.query?.category || '').trim().toLowerCase();
    const paymentMethodFilter = String(_req.query?.payment_method || '').trim().toLowerCase();
    const workflowStageFilter = normalizeWorkflowStage(String(_req.query?.workflow_stage || '').trim(), '');
    const dateFrom = String(_req.query?.date_from || '').trim();
    const dateTo = String(_req.query?.date_to || '').trim();

    let items = await buildReportTransactionItems();
    if (statusFilter) items = items.filter((item) => item.reportingStatus.toLowerCase() === statusFilter);
    if (departmentFilter) {
      items = items.filter((item) =>
        [item.sourceDepartment, item.targetDepartment, item.operationalTargetDepartment]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(departmentFilter))
      );
    }
    if (categoryFilter) items = items.filter((item) => item.sourceCategory.toLowerCase().includes(categoryFilter));
    if (paymentMethodFilter) items = items.filter((item) => item.paymentMethod.toLowerCase().includes(paymentMethodFilter));
    if (workflowStageFilter) items = items.filter((item) => normalizeWorkflowStage(item.workflowStage, '') === workflowStageFilter);
    if (dateFrom) items = items.filter((item) => String(item.createdAt || '').slice(0, 10) >= dateFrom);
    if (dateTo) items = items.filter((item) => String(item.createdAt || '').slice(0, 10) <= dateTo);
    items = applyTextSearch(
      items,
      search,
      (item) =>
        `${item.referenceNumber} ${item.studentName} ${item.billingCode} ${item.receiptNumber} ${item.sourceDepartment} ${item.sourceCategory} ${item.targetDepartment} ${item.paymentStatus} ${item.reportingStatus} ${item.handoffReference} ${item.allocationSummary || ''}`
    );

    const rows = items.map((row) => [
      row.referenceNumber,
      row.studentName,
      row.billingCode,
      row.sourceDepartment,
      row.sourceCategory,
      row.departmentFlow,
      row.operationalHandoffStatus,
      row.targetDepartment,
      row.handoffReference,
      row.handoffStatus,
      row.amountFormatted,
      row.paymentStatus,
      row.documentationStatus,
      row.reportingStatus,
      row.allocationSummary || ''
    ]);
    const content = [
      [
        'Reference Number',
        'Student Name',
        'Billing Code',
        'Source Department',
        'Source Category',
        'Department Flow',
        'Operational Handoff',
        'Reporting Target',
        'Handoff Reference',
        'Handoff Status',
        'Amount',
        'Payment Status',
        'Documentation Status',
        'Reporting Status',
        'Fee Allocation Summary'
      ].join(','),
      ...rows.map((columns) => columns.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    sendOk(res, {
      filename: `cashier-report-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv',
      content
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to export reports.');
  }
});

app.get('/api/integrated-flow', requireAuth, async (req, res) => {
  try {
    const requestedDepartment = cleanTextValue(req.query?.department || 'Cashier') || 'Cashier';
    const graph = buildDepartmentFlowGraph();
    const departmentKey = requestedDepartment.toLowerCase();
    const incoming = graph.edges.filter((edge) => edge.to.toLowerCase() === departmentKey);
    const outgoing = graph.edges.filter((edge) => edge.from.toLowerCase() === departmentKey);

    sendOk(res, {
      flow: graph,
      department: requestedDepartment,
      incoming,
      outgoing
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load the integrated flow graph.');
  }
});

app.get('/api/cashier/department-handoffs', requireAuth, async (_req, res) => {
  try {
    const payload = await buildDepartmentHandoffSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load cashier department handoffs.');
  }
});

app.get('/api/student-billing', requireAuth, async (req, res) => {
  try {
    const view = String(req.query?.view || 'verification').trim().toLowerCase();
    if (!['verification', 'management'].includes(view)) {
      sendError(res, 400, 'Unsupported billing view.');
      return;
    }

    const payload = await buildStudentBillingSnapshot(view);
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load billing records.');
  }
});

app.get('/api/cashier-registrar-student-enrollment-feed', requireAuth, async (req, res) => {
  try {
    const payload = await buildCashierRegistrarEnrollmentFeedSnapshot({
      search: req.query?.search,
      status: req.query?.status,
      semester: req.query?.semester,
      source: req.query?.source,
      office: req.query?.office,
      page: req.query?.page,
      perPage: req.query?.per_page
    });
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load cashier registrar enrollment feed.');
  }
});

app.post('/api/cashier-registrar-student-enrollment-feed', requireAuth, async (req, res) => {
  try {
    const action = cleanTextValue(req.body?.action).toLowerCase();
    const id = Number(req.body?.id || 0);
    const batchId = cleanTextValue(req.body?.batchId) || `REG-ENR-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    const source = cleanTextValue(req.body?.source) || 'Registrar';
    const office = cleanTextValue(req.body?.office) || 'Registrar';
    const studentNo = cleanTextValue(req.body?.studentNo);
    const studentName = cleanTextValue(req.body?.studentName);
    const classCode = cleanTextValue(req.body?.classCode) || null;
    const subject = cleanTextValue(req.body?.subject) || null;
    const academicYear = cleanTextValue(req.body?.academicYear) || null;
    const semester = cleanTextValue(req.body?.semester) || null;
    const status = cleanTextValue(req.body?.status) || 'Pending';
    const downpaymentAmount = Number(req.body?.downpaymentAmount || 0);
    const remarks = cleanTextValue(req.body?.remarks);
    const reason = cleanTextValue(req.body?.reason);
    const payloadJson = JSON.stringify({
      batch_id: batchId,
      source,
      office,
      student_no: studentNo,
      student_name: studentName,
      class_code: classCode,
      subject,
      academic_year: academicYear,
      semester,
      status,
      downpayment_amount: Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0
    });

    if (action === 'create') {
      if (!studentNo || !studentName) {
        sendError(res, 422, 'studentNo and studentName are required.');
        return;
      }

      const [rows] = await pool.query(
        `INSERT INTO public.cashier_registrar_student_enrollment_feed (
           batch_id, source, office, student_no, student_name, class_code, subject, academic_year, semester, status, downpayment_amount, payload, sent_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, NOW(), NOW())
         RETURNING id`,
        [batchId, source, office, studentNo, studentName, classCode, subject, academicYear, semester, status, Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0, payloadJson]
      );
      const item = await fetchEnrollmentFeedRowById(Number(rows[0]?.id || 0));
      sendOk(res, item, 'Enrollment feed record created.');
      return;
    }

    if (action === 'update') {
      if (!id) {
        sendError(res, 422, 'A valid enrollment feed id is required.');
        return;
      }
      if (!studentNo || !studentName) {
        sendError(res, 422, 'studentNo and studentName are required.');
        return;
      }

      const [rows] = await pool.query(
        `UPDATE public.cashier_registrar_student_enrollment_feed
         SET batch_id = ?,
             source = ?,
             office = ?,
             student_no = ?,
             student_name = ?,
             class_code = ?,
             subject = ?,
             academic_year = ?,
             semester = ?,
             status = ?,
             downpayment_amount = ?,
             payload = ?::jsonb,
             sent_at = NOW()
         WHERE id = ?
         RETURNING id`,
        [batchId, source, office, studentNo, studentName, classCode, subject, academicYear, semester, status, Number.isFinite(downpaymentAmount) ? downpaymentAmount : 0, payloadJson, id]
      );
      if (!rows[0]) {
        sendError(res, 404, 'Enrollment feed record not found.');
        return;
      }
      const item = await fetchEnrollmentFeedRowById(id);
      sendOk(res, item, 'Enrollment feed record updated.');
      return;
    }

    if (action === 'delete') {
      if (!id) {
        sendError(res, 422, 'A valid enrollment feed id is required.');
        return;
      }
      await pool.query(`DELETE FROM public.cashier_registrar_student_enrollment_feed WHERE id = ?`, [id]);
      sendOk(res, { id }, 'Enrollment feed record deleted.');
      return;
    }

    if (['approve', 'hold', 'return'].includes(action)) {
      if (!id) {
        sendError(res, 422, 'A valid enrollment feed id is required.');
        return;
      }

      const [feedRows] = await pool.query(`SELECT * FROM public.cashier_registrar_student_enrollment_feed WHERE id = ? LIMIT 1`, [id]);
      const feedRow = feedRows[0];
      if (!feedRow) {
        sendError(res, 404, 'Enrollment feed record not found.');
        return;
      }

      const actorName = req.currentUser?.full_name || req.currentUser?.username || 'Cashier';
      const actionAtIso = new Date().toISOString();
      const previousStatus = normalizeEnrollmentFeedStatus(feedRow.status, feedRow.linked_billing_id);
      let nextStatus = action === 'approve' ? 'Approved' : action === 'hold' ? 'On Hold' : 'Returned To Registrar';
      let nextStage = WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
      let linkedBillingId = feedRow.linked_billing_id ? Number(feedRow.linked_billing_id) : null;
      let linkedBillingCode = cleanTextValue(feedRow.linked_billing_code);
      let actionMessage = '';
      let beforeStage = linkedBillingId ? WORKFLOW_STAGES.STUDENT_PORTAL_BILLING : null;

      if (action === 'approve') {
        const billingResult = await upsertEnrollmentFeedBilling(feedRow, req.currentUser, remarks || 'Approved from registrar enrollment feed.');
        linkedBillingId = billingResult.billingId;
        linkedBillingCode = billingResult.billingCode;
        nextStage = billingResult.workflowStage || WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
        beforeStage = billingResult.reused ? nextStage : null;
        actionMessage = billingResult.locked
          ? `${billingResult.billingCode} already exists and remains in ${workflowStageLabel(nextStage)}.`
          : billingResult.reused
            ? `${billingResult.billingCode} was refreshed from the registrar feed and remains in ${workflowStageLabel(nextStage)}.`
            : `${billingResult.billingCode} was created and queued in ${workflowStageLabel(nextStage)}.`;
      } else if (linkedBillingId || linkedBillingCode) {
        let billingRow = null;
        if (linkedBillingId) {
          const [billingRows] = await pool.query(
            `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
             FROM billing_records
             WHERE id = ?
             LIMIT 1`,
            [linkedBillingId]
          );
          billingRow = billingRows[0] || null;
        } else if (linkedBillingCode) {
          const [billingRows] = await pool.query(
            `SELECT id, billing_code, billing_status, workflow_stage, paid_amount, balance_amount
             FROM billing_records
             WHERE billing_code = ?
             LIMIT 1`,
            [linkedBillingCode]
          );
          billingRow = billingRows[0] || null;
        }
        if (billingRow) {
          if (isEnrollmentBillingLocked(billingRow)) {
            sendError(res, 409, 'Linked billing already progressed beyond cashier review and can no longer be changed from this feed.');
            return;
          }

          beforeStage = normalizeWorkflowStage(
            billingRow.workflow_stage,
            resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount, billingRow.workflow_stage)
          );
          linkedBillingId = Number(billingRow.id);
          linkedBillingCode = cleanTextValue(billingRow.billing_code);
          nextStage = WORKFLOW_STAGES.STUDENT_PORTAL_BILLING;
          const combinedRemarks =
            action === 'return'
              ? [reason || 'Registrar correction required.', remarks].filter(Boolean).join(' ')
              : remarks || 'Enrollment feed placed on hold for cashier review.';

          await pool.query(
            `UPDATE billing_records
             SET billing_status = ?,
                 workflow_stage = ?,
                 previous_workflow_stage = ?,
                 action_by = ?,
                 action_at = ?,
                 remarks = ?,
                 audit_reference = ?,
                 returned_to = ?,
                 returned_by = ?,
                 returned_at = ?,
                 is_returned = ?,
                 needs_correction = ?,
                 correction_reason = ?,
                 correction_notes = ?,
                 updated_at = ?
             WHERE id = ?`,
            [
              action === 'hold' ? 'on_hold' : 'correction',
              WORKFLOW_STAGES.STUDENT_PORTAL_BILLING,
              beforeStage,
              req.currentUser?.id || null,
              nowSql(),
              combinedRemarks,
              `ENR-FEED-${action.toUpperCase()}-${id}-${Date.now()}`,
              action === 'return' ? 'Registrar' : null,
              action === 'return' ? req.currentUser?.id || null : null,
              action === 'return' ? nowSql() : null,
              action === 'return' ? 1 : 0,
              action === 'return' ? 1 : 0,
              action === 'return' ? reason || 'Registrar correction required.' : null,
              action === 'return' ? remarks || null : null,
              nowSql(),
              billingRow.id
            ]
          );
        }

        actionMessage =
          action === 'hold'
            ? `${feedRow.student_name} was placed on hold for cashier review.`
            : `${feedRow.student_name} was returned to registrar for correction.`;
      } else {
        actionMessage =
          action === 'hold'
            ? `${feedRow.student_name} was placed on hold for cashier review.`
            : `${feedRow.student_name} was returned to registrar for correction.`;
      }

      const finalRemarks =
        action === 'return' ? [reason || 'Registrar correction required.', remarks].filter(Boolean).join(' ') : remarks;
      const decisionPayload = JSON.stringify(
        buildEnrollmentDecisionPayload(feedRow, {
          action,
          status: nextStatus,
          remarks: finalRemarks,
          actorName,
          actionAt: actionAtIso,
          linkedBillingId,
          linkedBillingCode
        })
      );

      await pool.query(
        `UPDATE public.cashier_registrar_student_enrollment_feed
         SET status = ?,
             decision_notes = ?,
             linked_billing_id = ?,
             linked_billing_code = ?,
             last_action = ?,
             action_by = ?,
             action_at = ?,
             payload = ?::jsonb
         WHERE id = ?`,
        [nextStatus, finalRemarks || null, linkedBillingId, linkedBillingCode || null, action, req.currentUser?.id || null, nowSql(), decisionPayload, id]
      );

      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction:
          action === 'approve'
            ? 'BILLING_PORTAL_ENROLLMENT_APPROVE'
            : action === 'hold'
              ? 'BILLING_PORTAL_ENROLLMENT_HOLD'
              : 'BILLING_PORTAL_ENROLLMENT_RETURN',
        action:
          action === 'approve'
            ? 'Enrollment Approved'
            : action === 'hold'
              ? 'Enrollment On Hold'
              : 'Enrollment Returned',
        description:
          action === 'approve'
            ? `${feedRow.student_name} enrollment feed was approved. ${actionMessage}`
            : action === 'hold'
              ? `${feedRow.student_name} enrollment feed was placed on hold. ${finalRemarks || ''}`.trim()
              : `${feedRow.student_name} enrollment feed was returned to registrar. ${finalRemarks || ''}`.trim(),
        moduleKey: 'billing_verification',
        entityType: 'enrollment_feed',
        entityId: id,
        beforeStatus: previousStatus,
        afterStatus: nextStatus,
        beforeStage,
        afterStage: nextStage,
        notification: {
          recipientRole: 'cashier',
          type:
            action === 'approve'
              ? 'billing_activated'
              : action === 'hold'
                ? 'billing_on_hold'
                : 'billing_returned',
          title:
            action === 'approve'
              ? 'Enrollment approved'
              : action === 'hold'
                ? 'Enrollment placed on hold'
                : 'Enrollment returned',
          message:
            action === 'approve'
              ? `${feedRow.student_name} is now linked to ${linkedBillingCode || 'a billing record'} in ${workflowStageLabel(nextStage)}.`
              : action === 'hold'
                ? `${feedRow.student_name} remains on hold pending cashier validation.`
                : `${feedRow.student_name} was returned to registrar for correction.`
        }
      });

      const item = await fetchEnrollmentFeedRowById(id);
      sendOk(
        res,
        {
          ...buildWorkflowActionPayload(actionMessage, nextStatus, nextStage),
          billingId: linkedBillingId,
          billingCode: linkedBillingCode || null,
          item
        },
        actionMessage
      );
      return;
    }

    sendError(res, 400, 'Unsupported enrollment feed action.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update cashier registrar enrollment feed.');
  }
});

app.get('/api/crad-student-list-feed', requireAuth, async (_req, res) => {
  try {
    const [eligibleRows] = await pool.query(
      `SELECT
         f.id AS enrollment_feed_id,
         f.linked_billing_id AS billing_id,
         f.batch_id,
         f.student_no,
         f.student_name,
         f.semester,
         f.academic_year,
         f.downpayment_amount,
         b.paid_amount,
         c.id AS sent_id,
         c.sent_at::text AS sent_at
       FROM public.cashier_registrar_student_enrollment_feed f
       INNER JOIN billing_records b ON b.id = f.linked_billing_id
       LEFT JOIN crad_student_list_feed c ON c.enrollment_feed_id = f.id
       WHERE COALESCE(f.downpayment_amount, 0) > 0
         AND LOWER(COALESCE(f.last_action, '')) = 'approve'
         AND COALESCE(b.paid_amount, 0) >= COALESCE(f.downpayment_amount, 0)
       ORDER BY f.id DESC`
    );

    const eligibleItems = (Array.isArray(eligibleRows) ? eligibleRows : []).map((row) => ({
      enrollmentFeedId: Number(row.enrollment_feed_id || 0),
      billingId: Number(row.billing_id || 0) || null,
      batchId: cleanTextValue(row.batch_id),
      studentNo: cleanTextValue(row.student_no),
      studentName: cleanTextValue(row.student_name),
      semester: cleanTextValue(row.semester),
      academicYear: cleanTextValue(row.academic_year),
      downpaymentAmount: Number(row.downpayment_amount || 0),
      downpaymentAmountFormatted: formatCurrency(row.downpayment_amount || 0),
      paidAmount: Number(row.paid_amount || 0),
      paidAmountFormatted: formatCurrency(row.paid_amount || 0),
      alreadySent: Boolean(row.sent_id),
      sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null
    }));

    const [sentRows] = await pool.query(
      `SELECT id, enrollment_feed_id, student_no, student_name, semester, academic_year, downpayment_amount, paid_amount, status, sent_at::text AS sent_at
       FROM crad_student_list_feed
       ORDER BY sent_at DESC, id DESC
       LIMIT 200`
    );

    const sentItems = (Array.isArray(sentRows) ? sentRows : []).map((row) => ({
      id: Number(row.id || 0),
      enrollmentFeedId: Number(row.enrollment_feed_id || 0) || null,
      studentNo: cleanTextValue(row.student_no),
      studentName: cleanTextValue(row.student_name),
      semester: cleanTextValue(row.semester),
      academicYear: cleanTextValue(row.academic_year),
      downpaymentAmount: Number(row.downpayment_amount || 0),
      downpaymentAmountFormatted: formatCurrency(row.downpayment_amount || 0),
      paidAmount: Number(row.paid_amount || 0),
      paidAmountFormatted: formatCurrency(row.paid_amount || 0),
      status: cleanTextValue(row.status) || 'queued',
      sentAt: row.sent_at ? new Date(String(row.sent_at)).toISOString() : null
    }));

    sendOk(res, {
      stats: [
        {
          title: 'Eligible Paid Students',
          value: String(eligibleItems.filter((item) => !item.alreadySent).length),
          subtitle: 'Ready for CRAD feed insertion',
          icon: 'mdi-account-check-outline',
          tone: 'green'
        },
        {
          title: 'Already Sent',
          value: String(sentItems.length),
          subtitle: 'Rows in crad_student_list_feed',
          icon: 'mdi-send-check-outline',
          tone: 'blue'
        },
        {
          title: 'Downpayment Cleared',
          value: String(eligibleItems.length),
          subtitle: 'Paid >= required downpayment',
          icon: 'mdi-cash-check',
          tone: 'purple'
        },
        {
          title: 'Pending Send',
          value: String(eligibleItems.filter((item) => !item.alreadySent).length),
          subtitle: 'Eligible rows not yet sent',
          icon: 'mdi-clock-outline',
          tone: 'orange'
        }
      ],
      eligibleItems,
      sentItems
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load CRAD paid student feed.');
  }
});

app.post('/api/crad-student-list-feed', requireAuth, async (req, res) => {
  try {
    const action = cleanTextValue(req.body?.action).toLowerCase();
    if (action !== 'send') {
      sendError(res, 400, 'Unsupported CRAD student list feed action.');
      return;
    }

    const enrollmentFeedId = Number(req.body?.enrollmentFeedId || 0);
    if (!enrollmentFeedId) {
      sendError(res, 422, 'A valid enrollmentFeedId is required.');
      return;
    }

    const [existingRows] = await pool.query(
      `SELECT id FROM crad_student_list_feed WHERE enrollment_feed_id = ? LIMIT 1`,
      [enrollmentFeedId]
    );
    if (existingRows[0]) {
      sendOk(res, { id: Number(existingRows[0].id || 0) }, 'Student already sent to CRAD student list feed.');
      return;
    }

    const [eligibleRows] = await pool.query(
      `SELECT
         f.id AS enrollment_feed_id,
         f.linked_billing_id AS billing_id,
         f.batch_id,
         f.student_no,
         f.student_name,
         f.semester,
         f.academic_year,
         f.downpayment_amount,
         f.payload,
         b.paid_amount
       FROM public.cashier_registrar_student_enrollment_feed f
       INNER JOIN billing_records b ON b.id = f.linked_billing_id
       WHERE f.id = ?
         AND COALESCE(f.downpayment_amount, 0) > 0
         AND LOWER(COALESCE(f.last_action, '')) = 'approve'
         AND COALESCE(b.paid_amount, 0) >= COALESCE(f.downpayment_amount, 0)
       LIMIT 1`,
      [enrollmentFeedId]
    );

    const row = eligibleRows[0];
    if (!row) {
      sendError(res, 404, 'Eligible paid downpayment student not found.');
      return;
    }

    const insertPayload = JSON.stringify({
      enrollment_feed_id: Number(row.enrollment_feed_id || 0),
      billing_id: Number(row.billing_id || 0) || null,
      batch_id: cleanTextValue(row.batch_id),
      student_no: cleanTextValue(row.student_no),
      student_name: cleanTextValue(row.student_name),
      semester: cleanTextValue(row.semester),
      academic_year: cleanTextValue(row.academic_year),
      downpayment_amount: Number(row.downpayment_amount || 0),
      paid_amount: Number(row.paid_amount || 0),
      source_payload: row.payload && typeof row.payload === 'object' ? row.payload : null
    });

    const [insertRows] = await pool.query(
      `INSERT INTO crad_student_list_feed (
         enrollment_feed_id, billing_id, batch_id, student_no, student_name, semester, academic_year, downpayment_amount, paid_amount, status, payload, sent_by, sent_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, NOW(), NOW())
       RETURNING id`,
      [
        Number(row.enrollment_feed_id || 0),
        Number(row.billing_id || 0) || null,
        cleanTextValue(row.batch_id),
        cleanTextValue(row.student_no),
        cleanTextValue(row.student_name),
        cleanTextValue(row.semester),
        cleanTextValue(row.academic_year),
        Number(row.downpayment_amount || 0),
        Number(row.paid_amount || 0),
        'queued',
        insertPayload,
        req.currentUser?.id || null
      ]
    );

    sendOk(
      res,
      { id: Number(insertRows[0]?.id || 0) },
      `${cleanTextValue(row.student_name)} was sent to crad_student_list_feed.`
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to send paid student to CRAD feed.');
  }
});

app.get('/api/module-activity', requireAuth, async (req, res) => {
  try {
    const moduleFilter = String(req.query?.module || 'all').trim().toLowerCase();
    const actorFilter = String(req.query?.actor || '').trim().toLowerCase();
    const searchFilter = String(req.query?.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query?.page || 1));
    const perPage = Math.min(25, Math.max(1, Number(req.query?.per_page || 8)));

    const [rows] = await pool.query(
      `SELECT l.id, l.action, l.raw_action, l.description, l.created_at, u.full_name AS actor_name
       FROM admin_activity_logs l
       LEFT JOIN admin_users u ON u.id = l.user_id
       ORDER BY l.created_at DESC, l.id DESC`
    );

    const filteredRows = (Array.isArray(rows) ? rows : [])
      .map((row) => {
        const module = inferModuleFromRawAction(row.raw_action, row.description);
        return {
          id: Number(row.id),
          module,
          action: row.action,
          detail: row.description,
          actor: row.actor_name || 'Cashier System Administrator',
          entity_type: module,
          entity_key: extractEntityKey(row.description),
          metadata: {
            rawAction: row.raw_action
          },
          created_at: new Date(row.created_at).toISOString()
        };
      })
      .filter((row) => {
        const matchesModule = moduleFilter === 'all' || row.module === moduleFilter;
        const matchesActor = !actorFilter || String(row.actor || '').toLowerCase().includes(actorFilter);
        const haystack = `${row.action} ${row.detail} ${row.entity_key || ''}`.toLowerCase();
        const matchesSearch = !searchFilter || haystack.includes(searchFilter);
        return matchesModule && matchesActor && matchesSearch;
      });

    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const startIndex = (page - 1) * perPage;

    sendOk(res, {
      items: filteredRows.slice(startIndex, startIndex + perPage),
      meta: {
        page,
        perPage,
        total,
        totalPages
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load module activity.';
    const isConnectivityTimeout = /timeout exceeded when trying to connect|connect etimedout|econnrefused|failed to query database after multiple retries/i.test(
      message
    );

    if (isConnectivityTimeout) {
      const page = Math.max(1, Number(req.query?.page || 1));
      const perPage = Math.min(25, Math.max(1, Number(req.query?.per_page || 8)));
      sendOk(
        res,
        {
          items: [],
          meta: {
            page,
            perPage,
            total: 0,
            totalPages: 1
          }
        },
        'Activity logs are temporarily unavailable while database connectivity recovers.'
      );
      return;
    }

    sendError(res, 500, message);
  }
});

app.get('/api/process-payment', requireAuth, async (_req, res) => {
  try {
    const payload = await buildPaymentSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load payment queue.');
  }
});

app.post('/api/process-payment', requireAuth, async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const paymentId = Number(req.body?.paymentId || req.body?.billingId || 0);
    if (!paymentId || Number.isNaN(paymentId)) {
      sendError(res, 422, 'A valid payment record is required.');
      return;
    }

    const result = await executeGatewayAction({
      paymentId,
      action,
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: req.body || {}
    });

    sendOk(res, result, result.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update payment queue.';
    const statusCode = message === 'Payment transaction not found.' ? 404 : message === 'Unsupported gateway action.' ? 400 : 500;
    sendError(res, statusCode, message);
  }
});

app.get('/api/generate-receipt', requireAuth, async (_req, res) => {
  try {
    const payload = await buildReceiptSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load receipt queue.');
  }
});

app.post('/api/generate-receipt', requireAuth, async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const paymentId = Number(req.body?.paymentId || 0);
    const remarks = String(
      req.body?.remarks || req.body?.verificationNotes || req.body?.completionNotes || req.body?.notes || ''
    ).trim();
    if (!paymentId || Number.isNaN(paymentId)) {
      sendError(res, 422, 'A valid payment record is required.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT p.id, p.reference_number, s.full_name
       FROM payment_transactions p
       INNER JOIN billing_records b ON b.id = p.billing_id
       INNER JOIN students s ON s.id = b.student_id
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = rows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment record not found.');
      return;
    }

    if (action === 'generate') {
      const receiptNumber = nextReceiptNumber(paymentId);
      await pool.query(
        `INSERT INTO receipt_records (payment_id, receipt_number, issued_date, receipt_status, remarks, created_at)
         VALUES (?, ?, ?, 'generated', 'Receipt document was generated from the successful payment.', ?)
         ON CONFLICT (receipt_number) DO UPDATE SET
           issued_date = EXCLUDED.issued_date,
           receipt_status = 'generated',
           remarks = EXCLUDED.remarks`,
        [paymentId, receiptNumber, nowSql(), nowSql()]
      );
      const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
      const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;
      if (receiptId) {
        await ensureProofDocument(paymentId, receiptId, req.currentUser.id);
        await upsertReconciliationRecord(paymentId, receiptId, 'pending_review');
      }
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'COMPLIANCE_RECEIPT_GENERATE',
        action: 'Receipt Generated',
        description: `Receipt ${receiptNumber} was generated for ${paymentRow.reference_number}.`,
        moduleKey: 'generate_receipt',
        entityType: 'receipt',
        entityId: receiptId || paymentId,
        beforeStatus: 'Receipt Pending',
        afterStatus: 'Receipt Generated',
        notification: {
          recipientRole: 'accounting',
          type: 'receipt_generated',
          title: 'Receipt generated',
          message: `${receiptNumber} is ready for proof verification.`
        }
      });
      sendOk(
        res,
        buildWorkflowActionPayload(
          `${receiptNumber} was generated successfully and remains in Compliance & Documentation.`,
          'Receipt Generated',
          WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
          { receipt_no: receiptNumber }
        ),
        `${receiptNumber} was generated successfully.`
      );
      return;
    }

    if (action === 'verify') {
      await pool.query(
        `UPDATE receipt_records
         SET receipt_status = 'verified',
             remarks = ?
         WHERE payment_id = ?`,
        [remarks || 'Proof of payment was verified by cashier staff.', paymentId]
      );
      await pool.query(`UPDATE proof_documents SET status = 'verified', verified_by = ?, verified_at = ? WHERE payment_id = ?`, [
        req.currentUser.id,
        nowSql(),
        paymentId
      ]);
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'COMPLIANCE_PROOF_VERIFY',
        action: 'Proof Verified',
        description: `Payment proof was verified for ${paymentRow.reference_number}.`,
        moduleKey: 'generate_receipt',
        entityType: 'payment',
        entityId: paymentId,
        beforeStatus: 'Receipt Generated',
        afterStatus: 'Proof Verified',
        remarks: remarks || null
      });
      sendOk(
        res,
        buildWorkflowActionPayload(
          `Payment proof verified for ${paymentRow.reference_number}.`,
          'Proof Verified',
          WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION
        ),
        `Payment proof verified for ${paymentRow.reference_number}.`
      );
      return;
    }

    if (action === 'complete') {
      await pool.query(
        `UPDATE receipt_records
         SET receipt_status = 'completed',
             workflow_stage = ?,
             remarks = ?
         WHERE payment_id = ?`,
        [
          WORKFLOW_STAGES.REPORTING_RECONCILIATION,
          remarks || 'Documentation package was completed and archived for reconciliation.',
          paymentId
        ]
      );
      await pool.query(`UPDATE payment_transactions SET workflow_stage = ? WHERE id = ?`, [WORKFLOW_STAGES.REPORTING_RECONCILIATION, paymentId]);
      const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
      const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;
      await upsertReconciliationRecord(paymentId, receiptId, 'pending_review', {
        workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
      });
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'COMPLIANCE_DOCUMENT_COMPLETE',
        action: 'Documentation Completed',
        description: `Documentation was completed for ${paymentRow.reference_number}.`,
        moduleKey: 'generate_receipt',
        entityType: 'payment',
        entityId: paymentId,
        beforeStatus: 'Proof Verified',
        afterStatus: 'Documentation Completed',
        beforeStage: WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION,
        afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        remarks: remarks || null
      });
      sendOk(
        res,
        buildWorkflowActionPayload(
          `Documentation completed for ${paymentRow.reference_number}.`,
          'Documentation Completed',
          WORKFLOW_STAGES.REPORTING_RECONCILIATION
        ),
        `Documentation completed for ${paymentRow.reference_number}.`
      );
      return;
    }

    sendError(res, 400, 'Unsupported receipt action.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update receipt queue.');
  }
});

app.get('/api/reporting-reconciliation', requireAuth, async (_req, res) => {
  try {
    const payload = await buildReportingSnapshot();
    sendOk(res, payload);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to load reporting and reconciliation data.');
  }
});

app.post('/api/reporting-reconciliation', requireAuth, async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const paymentId = Number(req.body?.paymentId || 0);
    const note = String(req.body?.remarks || req.body?.note || req.body?.notes || '').trim();
    if (!paymentId || Number.isNaN(paymentId)) {
      sendError(res, 422, 'A valid payment record is required.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT
          p.id,
          p.reference_number,
          p.reporting_status,
          p.payment_status,
          p.workflow_stage,
          b.billing_code,
          b.source_module,
          b.source_department,
          b.source_category,
          b.integration_profile,
          b.target_department,
          COALESCE(r.receipt_status, 'queued') AS receipt_status
       FROM payment_transactions p
       INNER JOIN billing_records b ON b.id = p.billing_id
       LEFT JOIN receipt_records r ON r.payment_id = p.id
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reporting record not found.');
      return;
    }

    if (action === 'reconcile') {
      if (!['paid', 'posted'].includes(String(row.payment_status || '').toLowerCase())) {
        sendError(res, 409, 'Only paid transactions can be reconciled.');
        return;
      }
      if (!['generated', 'verified', 'completed', 'released'].includes(String(row.receipt_status || '').toLowerCase())) {
        sendError(res, 409, 'Documentation must be generated before reconciliation.');
        return;
      }

      const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
      const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;
      await pool.query('UPDATE payment_transactions SET reporting_status = ? WHERE id = ?', ['reconciled', paymentId]);
      await upsertReconciliationRecord(paymentId, receiptId, 'reconciled', {
        reconciledBy: req.currentUser.id,
        reconciledAt: nowSql(),
        workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        handoffStatus: 'ready'
      });
      await pool.query('UPDATE payment_transactions SET workflow_stage = ? WHERE id = ?', [WORKFLOW_STAGES.REPORTING_RECONCILIATION, paymentId]);
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'REPORTING_RECONCILE',
        action: 'Reporting Reconciled',
        description: `${row.reference_number} was reconciled against ${row.billing_code}.`,
        moduleKey: 'reports',
        entityType: 'reconciliation',
        entityId: paymentId,
        beforeStatus: mapReportingStatus(row.reporting_status),
        afterStatus: 'Reconciled',
        beforeStage: normalizeWorkflowStage(
          row.workflow_stage,
          resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
        ),
        afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION
      });
      sendOk(
        res,
        buildWorkflowActionPayload(
          `${row.reference_number} was reconciled successfully and remains in Reporting & Reconciliation.`,
          'Reconciled',
          WORKFLOW_STAGES.REPORTING_RECONCILIATION
        ),
        `${row.reference_number} was reconciled successfully and remains in Reporting & Reconciliation.`
      );
      return;
    }

    if (action === 'report') {
      if (String(row.reporting_status || '').toLowerCase() !== 'reconciled') {
        sendError(res, 409, 'Only reconciled records can be handed off to another department.');
        return;
      }

      const integration = resolveCashierIntegrationProfile({
        billingCode: row.billing_code,
        sourceModule: row.source_module,
        sourceDepartment: row.source_department,
        sourceCategory: row.source_category,
        integrationProfile: row.integration_profile,
        targetDepartment: row.target_department
      });
      const targetDepartment = cleanTextValue(req.body?.targetDepartment || req.body?.handoffDepartment) || integration.reportingDepartment;
      const requestReference = cleanTextValue(req.body?.requestReference || req.body?.departmentRequestReference);
      const handoffReference = nextDepartmentHandoffReference(targetDepartment, paymentId);
      const handoffArtifact = targetDepartment === integration.operationalTargetDepartment ? integration.operationalArtifact : integration.reportingArtifact;

      await pool.query('UPDATE payment_transactions SET reporting_status = ? WHERE id = ?', ['reported', paymentId]);
      const [reconciliationRows] = await pool.query(`SELECT receipt_id FROM reconciliations WHERE payment_id = ? LIMIT 1`, [paymentId]);
      await upsertReconciliationRecord(paymentId, reconciliationRows[0]?.receipt_id || null, 'reported', {
        reportedAt: nowSql(),
        workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        handoffDepartment: targetDepartment,
        handoffArtifact,
        handoffReference,
        handoffStatus: 'sent',
        requestReference: requestReference || null,
        handoffNotes: note || `${handoffArtifact} sent from Cashier to ${targetDepartment}.`
      });
      await pool.query('UPDATE payment_transactions SET workflow_stage = ? WHERE id = ?', [WORKFLOW_STAGES.REPORTING_RECONCILIATION, paymentId]);
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'REPORTING_REPORT',
        action: 'Reporting Published',
        description: `${row.reference_number} was sent to ${targetDepartment} as ${handoffReference}.`,
        moduleKey: 'reports',
        entityType: 'reconciliation',
        entityId: paymentId,
        beforeStatus: mapReportingStatus(row.reporting_status),
        afterStatus: 'Reported',
        beforeStage: normalizeWorkflowStage(
          row.workflow_stage,
          resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
        ),
        afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        notification: {
          recipientRole: resolveDepartmentRecipientRole(targetDepartment),
          recipientName: targetDepartment,
          type: 'department_handoff',
          title: `Cashier handoff for ${targetDepartment}`,
          message: `${row.reference_number} was sent to ${targetDepartment} as ${handoffReference}.${requestReference ? ` Request: ${requestReference}.` : ''}`
        }
      });
      sendOk(
        res,
        {
          ...buildWorkflowActionPayload(
            `${row.reference_number} was sent to ${targetDepartment} as ${handoffReference}.`,
            'Reported',
            WORKFLOW_STAGES.REPORTING_RECONCILIATION
          ),
          next_module: targetDepartment,
          handoff_department: targetDepartment,
          handoff_reference: handoffReference
        },
        `${row.reference_number} was sent to ${targetDepartment} as ${handoffReference}.`
      );
      return;
    }

    if (action === 'discrepancy') {
      const discrepancyNote = note || 'Discrepancy flagged during reconciliation review.';
      await pool.query(
        `UPDATE reconciliations
         SET status = 'discrepancy', workflow_stage = ?, discrepancy_note = ?, updated_at = ?
         WHERE payment_id = ?`,
        [WORKFLOW_STAGES.REPORTING_RECONCILIATION, discrepancyNote, nowSql(), paymentId]
      );
      await pool.query('UPDATE payment_transactions SET reporting_status = ? WHERE id = ?', ['logged', paymentId]);
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'REPORTING_DISCREPANCY',
        action: 'Discrepancy Flagged',
        description: discrepancyNote,
        moduleKey: 'reports',
        entityType: 'reconciliation',
        entityId: paymentId,
        beforeStatus: mapReportingStatus(row.reporting_status),
        afterStatus: 'With Discrepancy',
        beforeStage: normalizeWorkflowStage(
          row.workflow_stage,
          resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
        ),
        afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        remarks: discrepancyNote,
        notification: {
          recipientRole: 'accounting',
          type: 'discrepancy_flagged',
          title: 'Discrepancy flagged',
          message: discrepancyNote
        }
      });
      sendOk(
        res,
        buildWorkflowActionPayload('Discrepancy flagged successfully.', 'With Discrepancy', WORKFLOW_STAGES.REPORTING_RECONCILIATION),
        'Discrepancy flagged successfully.'
      );
      return;
    }

    if (action === 'archive') {
      await pool.query('UPDATE payment_transactions SET reporting_status = ?, workflow_stage = ? WHERE id = ?', [
        'archived',
        WORKFLOW_STAGES.COMPLETED,
        paymentId
      ]);
      await pool.query('UPDATE receipt_records SET workflow_stage = ? WHERE payment_id = ?', [WORKFLOW_STAGES.COMPLETED, paymentId]);
      const [reconciliationRows] = await pool.query(`SELECT receipt_id FROM reconciliations WHERE payment_id = ? LIMIT 1`, [paymentId]);
      await upsertReconciliationRecord(paymentId, reconciliationRows[0]?.receipt_id || null, 'archived', {
        archivedAt: nowSql(),
        workflowStage: WORKFLOW_STAGES.COMPLETED,
        handoffStatus: 'archived'
      });
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'REPORTING_ARCHIVE',
        action: 'Reporting Archived',
        description: `${row.reference_number} was archived in reconciliation records.`,
        moduleKey: 'reports',
        entityType: 'reconciliation',
        entityId: paymentId,
        beforeStatus: mapReportingStatus(row.reporting_status),
        afterStatus: 'Archived',
        beforeStage: normalizeWorkflowStage(
          row.workflow_stage,
          resolvePaymentWorkflowStage(row.payment_status, null, row.reporting_status)
        ),
        afterStage: WORKFLOW_STAGES.COMPLETED
      });
      sendOk(
        res,
        buildWorkflowActionPayload(`${row.reference_number} was archived and moved to Completed.`, 'Archived', WORKFLOW_STAGES.COMPLETED),
        `${row.reference_number} was archived and moved to Completed.`
      );
      return;
    }

    sendError(res, 400, 'Unsupported reporting action.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update reporting and reconciliation data.');
  }
});

app.post('/api/workflow/:id/verify', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const remarks = String(req.body?.remarks || 'Billing verified and ready for payment.').trim();

    if (!billingId || currentModule !== WORKFLOW_STAGES.STUDENT_PORTAL_BILLING) {
      sendError(res, 422, 'Verify can only be triggered from Student Portal & Billing.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT id, billing_code, billing_status, workflow_stage, balance_amount
       FROM billing_records
       WHERE id = ?
       LIMIT 1`,
      [billingId]
    );
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    if (Number(billingRow.balance_amount || 0) <= 0) {
      sendError(res, 409, 'Only billings with an outstanding balance can be verified.');
      return;
    }

    await pool.query(
      `UPDATE billing_records
       SET billing_status = 'verified',
           workflow_stage = ?,
           previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_completed = 0,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL,
           updated_at = ?
       WHERE id = ?`,
      [
        WORKFLOW_STAGES.PAY_BILLS,
        currentModule,
        req.currentUser.id,
        nowSql(),
        remarks,
        `VERIFY-${billingId}-${Date.now()}`,
        nowSql(),
        billingId
      ]
    );

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'WORKFLOW_VERIFY',
      action: 'Billing Verified',
      description: `${billingRow.billing_code} was verified and moved to Pay Bills. ${remarks}`,
      moduleKey: workflowModuleKey(currentModule),
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
      afterStatus: 'Pending Payment',
      beforeStage: normalizeWorkflowStage(billingRow.workflow_stage, currentModule),
      afterStage: WORKFLOW_STAGES.PAY_BILLS,
      notification: {
        recipientRole: 'cashier',
        type: 'billing_verified',
        title: 'Billing verified',
        message: `${billingRow.billing_code} was verified and moved to Pay Bills.`,
        entityType: 'billing',
        entityId: billingId
      }
    });

    sendOk(
      res,
      buildWorkflowActionPayload('Billing verified successfully.', 'Verified', WORKFLOW_STAGES.PAY_BILLS),
      'Billing verified successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to verify billing.');
  }
});

app.post('/api/workflow/:id/approve', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const billingId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const paymentMethod = String(req.body?.payment_method || req.body?.paymentMethod || 'Online').trim();
    const remarks = String(req.body?.remarks || 'Payment request approved for processing.').trim();

    if (!billingId || currentModule !== WORKFLOW_STAGES.PAY_BILLS) {
      sendError(res, 422, 'Approve can only be triggered from Pay Bills.');
      return;
    }

    const [rows] = await pool.query(`SELECT balance_amount FROM billing_records WHERE id = ? LIMIT 1`, [billingId]);
    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    if (Number(billingRow.balance_amount || 0) <= 0) {
      sendError(res, 409, 'The billing is already fully settled.');
      return;
    }

    const payment = await createPaymentRequest({
      billingId,
      paymentMethod,
      requestedAmount: Number(billingRow.balance_amount || 0),
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: { ...req.body, approved: true },
      moduleKey: 'manage_billing',
      rawAction: 'WORKFLOW_APPROVE',
      actionLabel: 'Payment Approved',
      notificationTitle: 'Payment approved',
      notificationType: 'payment_pending',
      descriptionPrefix: 'was approved'
    });

    await pool.query(
      `UPDATE billing_records
       SET previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL
       WHERE id = ?`,
      [currentModule, req.currentUser.id, nowSql(), remarks, `APPROVE-${billingId}-${Date.now()}`, billingId]
    );

    sendOk(
      res,
      {
        ...payment,
        status: 'Approved',
        workflow_stage: WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
        next_module: workflowStageLabel(WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY)
      },
      'Payment request approved successfully.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to approve payment request.';
    sendError(res, 500, message);
  }
});

app.post('/api/workflow/:id/confirm-paid', requireAuth, requireRole('admin', 'cashier'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const remarks = String(req.body?.remarks || 'Payment confirmed successfully.').trim();

    if (!paymentId || currentModule !== WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY) {
      sendError(res, 422, 'Confirm Paid can only be triggered from Payment Processing & Gateway.');
      return;
    }

    const result = await executeGatewayAction({
      paymentId,
      action: 'confirm',
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      requestPayload: { ...req.body, confirmed: true }
    });

    await pool.query(
      `UPDATE payment_transactions
       SET previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL
       WHERE id = ?`,
      [currentModule, req.currentUser.id, nowSql(), remarks, `CONFIRM-${paymentId}-${Date.now()}`, paymentId]
    );

    sendOk(
      res,
      {
        ...result,
        next_module: workflowStageLabel(WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION)
      },
      'Payment confirmed successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to confirm payment.');
  }
});

app.post('/api/workflow/:id/generate-receipt', requireAuth, requireRole('admin', 'cashier', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const remarks = String(req.body?.remarks || 'Official receipt generated.').trim();

    if (!paymentId || currentModule !== WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION) {
      sendError(res, 422, 'Generate Receipt can only be triggered from Compliance & Documentation.');
      return;
    }

    const [paymentRows] = await pool.query(
      `SELECT p.id, p.reference_number, p.payment_status, p.workflow_stage
       FROM payment_transactions p
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const paymentRow = paymentRows[0];
    if (!paymentRow) {
      sendError(res, 404, 'Payment record not found.');
      return;
    }
    if (String(paymentRow.payment_status || '').toLowerCase() !== 'paid') {
      sendError(res, 409, 'Only paid transactions can generate a receipt.');
      return;
    }

    const receiptNumber = nextReceiptNumber(paymentId);
    await pool.query(
      `INSERT INTO receipt_records (
         payment_id, receipt_number, issued_date, receipt_status, workflow_stage, remarks, previous_workflow_stage, action_by, action_at, audit_reference, is_completed, is_returned, needs_correction, created_at
       )
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)
       ON CONFLICT (receipt_number) DO UPDATE SET
         receipt_number = EXCLUDED.receipt_number,
         issued_date = EXCLUDED.issued_date,
         receipt_status = 'completed',
         workflow_stage = EXCLUDED.workflow_stage,
         remarks = EXCLUDED.remarks,
         previous_workflow_stage = EXCLUDED.previous_workflow_stage,
         action_by = EXCLUDED.action_by,
         action_at = EXCLUDED.action_at,
         audit_reference = EXCLUDED.audit_reference,
         is_completed = 1,
         is_returned = 0,
         needs_correction = 0,
         correction_reason = NULL,
         correction_notes = NULL`,
      [
        paymentId,
        receiptNumber,
        nowSql(),
        WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        remarks,
        currentModule,
        req.currentUser.id,
        nowSql(),
        `RECEIPT-${paymentId}-${Date.now()}`,
        nowSql()
      ]
    );
    const [receiptRows] = await pool.query(`SELECT id FROM receipt_records WHERE payment_id = ? ORDER BY id DESC LIMIT 1`, [paymentId]);
    const receiptId = receiptRows[0] ? Number(receiptRows[0].id) : null;

    if (receiptId) {
      await ensureProofDocument(paymentId, receiptId, req.currentUser.id);
    }

    await pool.query(
      `UPDATE payment_transactions
       SET workflow_stage = ?,
           previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_returned = 0,
           needs_correction = 0,
           correction_reason = NULL,
           correction_notes = NULL
       WHERE id = ?`,
      [WORKFLOW_STAGES.REPORTING_RECONCILIATION, currentModule, req.currentUser.id, nowSql(), remarks, `RECEIPT-${paymentId}-${Date.now()}`, paymentId]
    );
    await upsertReconciliationRecord(paymentId, receiptId, 'pending_review', {
      workflowStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
      actionBy: req.currentUser.id,
      actionAt: nowSql(),
      auditReference: `RECEIPT-${paymentId}-${Date.now()}`,
      isCompleted: 0
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'WORKFLOW_GENERATE_RECEIPT',
      action: 'Receipt Generated',
      description: `${paymentRow.reference_number} receipt was generated and moved to Reporting & Reconciliation. ${remarks}`,
      moduleKey: workflowModuleKey(currentModule),
      entityType: 'receipt',
      entityId: receiptId || paymentId,
      beforeStatus: 'Receipt Pending',
      afterStatus: 'Documentation Completed',
      beforeStage: currentModule,
      afterStage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
      notification: {
        recipientRole: 'accounting',
        type: 'receipt_generated',
        title: 'Receipt generated',
        message: `${receiptNumber} was generated and moved to Reporting & Reconciliation.`,
        entityType: 'receipt',
        entityId: receiptId || paymentId
      }
    });

    sendOk(
      res,
      {
        message: 'Receipt generated successfully.',
        status: 'Documentation Completed',
        workflow_stage: WORKFLOW_STAGES.REPORTING_RECONCILIATION,
        next_module: workflowStageLabel(WORKFLOW_STAGES.REPORTING_RECONCILIATION),
        receipt_no: receiptNumber
      },
      'Receipt generated successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to generate receipt.');
  }
});

app.post('/api/workflow/:id/reconcile', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const paymentId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const remarks = String(req.body?.remarks || 'Payment and receipt records matched successfully.').trim();

    if (!paymentId || currentModule !== WORKFLOW_STAGES.REPORTING_RECONCILIATION) {
      sendError(res, 422, 'Reconcile can only be triggered from Reporting & Reconciliation.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT rec.id, rec.receipt_id, p.reference_number, p.payment_status, p.workflow_stage, COALESCE(r.receipt_status, 'queued') AS receipt_status
       FROM payment_transactions p
       LEFT JOIN reconciliations rec ON rec.payment_id = p.id
       LEFT JOIN receipt_records r ON r.id = rec.receipt_id
       WHERE p.id = ?
       LIMIT 1`,
      [paymentId]
    );
    const row = rows[0];
    if (!row) {
      sendError(res, 404, 'Reporting record not found.');
      return;
    }
    if (!['paid', 'posted'].includes(String(row.payment_status || '').toLowerCase())) {
      sendError(res, 409, 'Only paid transactions can be reconciled.');
      return;
    }
    if (!['generated', 'verified', 'completed', 'released'].includes(String(row.receipt_status || '').toLowerCase())) {
      sendError(res, 409, 'A completed receipt or proof document is required before reconciliation.');
      return;
    }

    await pool.query(
      `UPDATE payment_transactions
       SET reporting_status = 'archived',
           workflow_stage = ?,
           previous_workflow_stage = ?,
           action_by = ?,
           action_at = ?,
           remarks = ?,
           audit_reference = ?,
           is_completed = 1
       WHERE id = ?`,
      [WORKFLOW_STAGES.COMPLETED, currentModule, req.currentUser.id, nowSql(), remarks, `RECONCILE-${paymentId}-${Date.now()}`, paymentId]
    );
    await pool.query(`UPDATE receipt_records SET workflow_stage = ?, is_completed = 1 WHERE payment_id = ?`, [WORKFLOW_STAGES.COMPLETED, paymentId]);
    await upsertReconciliationRecord(paymentId, row.receipt_id ? Number(row.receipt_id) : null, 'reconciled', {
      archivedAt: nowSql(),
      workflowStage: WORKFLOW_STAGES.COMPLETED,
      reconciledBy: req.currentUser.id,
      reconciledAt: nowSql(),
      actionBy: req.currentUser.id,
      actionAt: nowSql(),
      auditReference: `RECONCILE-${paymentId}-${Date.now()}`,
      isCompleted: 1
    });
    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: 'WORKFLOW_RECONCILE',
      action: 'Record Reconciled',
      description: `${row.reference_number} was reconciled and moved to archive. ${remarks}`,
      moduleKey: workflowModuleKey(currentModule),
      entityType: 'reconciliation',
      entityId: paymentId,
      beforeStatus: 'Pending Review',
      afterStatus: 'Reconciled',
      beforeStage: currentModule,
      afterStage: WORKFLOW_STAGES.COMPLETED,
      notification: {
        recipientRole: 'accounting',
        type: 'reconciliation_completed',
        title: 'Record reconciled',
        message: `${row.reference_number} was reconciled and archived.`,
        entityType: 'reconciliation',
        entityId: paymentId
      }
    });

    sendOk(
      res,
      {
        message: 'Record reconciled successfully.',
        status: 'Reconciled',
        workflow_stage: WORKFLOW_STAGES.COMPLETED,
        next_module: 'Archive'
      },
      'Record reconciled successfully.'
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to reconcile record.');
  }
});

app.post('/api/workflow/:id/return-for-correction', requireAuth, requireRole('admin', 'cashier', 'account', 'compliance'), async (req, res) => {
  try {
    const recordId = Number(req.params.id || 0);
    const currentModule = normalizeWorkflowStage(String(req.body?.current_module || req.body?.currentModule || '').trim(), '');
    const reason = String(req.body?.reason || '').trim();
    const remarks = String(req.body?.remarks || req.body?.notes || '').trim();

    if (!recordId || Number.isNaN(recordId)) {
      sendError(res, 422, 'A valid workflow record is required.');
      return;
    }
    if (!currentModule) {
      sendError(res, 422, 'current_module is required.');
      return;
    }
    if (!reason) {
      sendError(res, 422, 'Correction reason is required.');
      return;
    }

    const targetStage = workflowCorrectionTarget(currentModule);
    const returnedAt = nowSql();
    const notificationRole = workflowCorrectionNotificationRole(targetStage);
    const correctionMessage = remarks ? `${reason}. ${remarks}` : reason;

    if ([WORKFLOW_STAGES.STUDENT_PORTAL_BILLING, WORKFLOW_STAGES.PAY_BILLS].includes(currentModule)) {
      const [rows] = await pool.query(
        `SELECT b.id, b.student_id, b.billing_code, b.billing_status, b.workflow_stage, b.balance_amount, s.full_name
         FROM billing_records b
         INNER JOIN students s ON s.id = b.student_id
         WHERE b.id = ?
         LIMIT 1`,
        [recordId]
      );
      const billingRow = rows[0];
      if (!billingRow) {
        sendError(res, 404, 'Billing record not found.');
        return;
      }

      await pool.query(
        `UPDATE billing_records
         SET billing_status = 'correction',
             workflow_stage = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1,
             updated_at = ?
         WHERE id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, returnedAt, recordId]
      );

      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'WORKFLOW_RETURN_CORRECTION',
        action: 'Correction Requested',
        description: `Correction Requested\nRecord: ${billingRow.billing_code}\nFrom: ${workflowStageLabel(currentModule)}\nTo: ${workflowStageLabel(targetStage)}\nReason: ${reason}${remarks ? `\nRemarks: ${remarks}` : ''}`,
        moduleKey: workflowModuleKey(currentModule),
        entityType: 'billing',
        entityId: recordId,
        beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
        afterStatus: 'Needs Correction',
        beforeStage: normalizeWorkflowStage(billingRow.workflow_stage, currentModule),
        afterStage: targetStage,
        notification: {
          recipientRole: notificationRole,
          type: 'correction_required',
          title: 'Billing record returned for correction',
          message: `${billingRow.billing_code} was sent back to ${workflowStageLabel(targetStage)}. Reason: ${correctionMessage}`,
          entityType: 'billing',
          entityId: recordId
        }
      });

      sendOk(
        res,
        {
          message: 'Record returned for correction successfully.',
          status: 'Needs Correction',
          workflow_stage: targetStage,
          returned_to: workflowStageLabel(targetStage),
          next_module: workflowStageLabel(targetStage)
        },
        'Record returned for correction successfully.'
      );
      return;
    }

    if (currentModule === WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY) {
      const [rows] = await pool.query(
        `SELECT
            p.id,
            p.billing_id,
            p.reference_number,
            p.amount_paid,
            p.payment_status,
            p.workflow_stage,
            b.billing_code,
            b.total_amount,
            b.paid_amount,
            b.balance_amount,
            b.billing_status,
            s.full_name
         FROM payment_transactions p
         INNER JOIN billing_records b ON b.id = p.billing_id
         INNER JOIN students s ON s.id = b.student_id
         WHERE p.id = ?
         LIMIT 1`,
        [recordId]
      );
      const paymentRow = rows[0];
      if (!paymentRow) {
        sendError(res, 404, 'Payment transaction not found.');
        return;
      }

      const revertedPaidAmount = Math.max(0, Number(paymentRow.paid_amount || 0) - Number(paymentRow.amount_paid || 0));
      const revertedBalanceAmount = Math.min(Number(paymentRow.total_amount || 0), Number(paymentRow.balance_amount || 0) + Number(paymentRow.amount_paid || 0));
      const reopenedBillingStatus = revertedPaidAmount > 0 ? 'partial' : 'verified';

      await pool.query(
        `UPDATE payment_transactions
         SET payment_status = 'cancelled',
             workflow_stage = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1,
             payment_date = ?
         WHERE id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, returnedAt, recordId]
      );
      await pool.query(
        `UPDATE billing_records
         SET paid_amount = ?,
             balance_amount = ?,
             billing_status = ?,
             workflow_stage = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1,
             updated_at = ?
         WHERE id = ?`,
        [
          revertedPaidAmount,
          revertedBalanceAmount,
          reopenedBillingStatus,
          targetStage,
          reason,
          remarks || null,
          currentModule,
          targetStage,
          req.currentUser.id,
          returnedAt,
          returnedAt,
          paymentRow.billing_id
        ]
      );
      await createPaymentAttempt({
        paymentId: recordId,
        billingId: Number(paymentRow.billing_id),
        referenceNumber: paymentRow.reference_number,
        attemptStatus: 'cancelled',
        requestPayload: { correction: true, reason, remarks },
        responsePayload: { returnedTo: targetStage },
        remarks: `Returned for correction: ${correctionMessage}`,
        createdBy: req.currentUser.id
      });
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'WORKFLOW_RETURN_CORRECTION',
        action: 'Correction Requested',
        description: `Correction Requested\nRecord: ${paymentRow.reference_number}\nFrom: ${workflowStageLabel(currentModule)}\nTo: ${workflowStageLabel(targetStage)}\nReason: ${reason}${remarks ? `\nRemarks: ${remarks}` : ''}`,
        moduleKey: workflowModuleKey(currentModule),
        entityType: 'payment',
        entityId: recordId,
        beforeStatus: mapPaymentStatus(paymentRow.payment_status),
        afterStatus: 'Needs Correction',
        beforeStage: normalizeWorkflowStage(paymentRow.workflow_stage, currentModule),
        afterStage: targetStage,
        notification: {
          recipientRole: notificationRole,
          type: 'correction_required',
          title: 'Payment request sent back from gateway review',
          message: `${paymentRow.reference_number} was returned to ${workflowStageLabel(targetStage)}. Reason: ${correctionMessage}`,
          entityType: 'payment',
          entityId: recordId
        }
      });

      sendOk(
        res,
        {
          message: 'Record returned for correction successfully.',
          status: 'Needs Correction',
          workflow_stage: targetStage,
          returned_to: workflowStageLabel(targetStage),
          next_module: workflowStageLabel(targetStage)
        },
        'Record returned for correction successfully.'
      );
      return;
    }

    if (currentModule === WORKFLOW_STAGES.COMPLIANCE_DOCUMENTATION) {
      const [rows] = await pool.query(
        `SELECT
            r.id,
            r.payment_id,
            r.receipt_number,
            r.receipt_status,
            r.workflow_stage,
            p.reference_number,
            p.payment_status
         FROM receipt_records r
         INNER JOIN payment_transactions p ON p.id = r.payment_id
         WHERE r.payment_id = ?
         ORDER BY r.id DESC
         LIMIT 1`,
        [recordId]
      );
      const receiptRow = rows[0];
      if (!receiptRow) {
        sendError(res, 404, 'Compliance record not found.');
        return;
      }

      await pool.query(
        `UPDATE receipt_records
         SET receipt_status = 'queued',
             workflow_stage = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1,
             remarks = ?
         WHERE id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, `Returned for correction: ${correctionMessage}`, receiptRow.id]
      );
      await pool.query(`UPDATE proof_documents SET status = 'pending' WHERE receipt_id = ?`, [receiptRow.id]);
      await pool.query(
        `UPDATE payment_transactions
         SET payment_status = 'authorized',
             reporting_status = 'logged',
             workflow_stage = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1
         WHERE id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, recordId]
      );
      await pool.query(`UPDATE reconciliations SET workflow_stage = ?, updated_at = ? WHERE payment_id = ?`, [targetStage, returnedAt, recordId]);
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'WORKFLOW_RETURN_CORRECTION',
        action: 'Correction Requested',
        description: `Correction Requested\nRecord: ${receiptRow.receipt_number}\nFrom: ${workflowStageLabel(currentModule)}\nTo: ${workflowStageLabel(targetStage)}\nReason: ${reason}${remarks ? `\nRemarks: ${remarks}` : ''}`,
        moduleKey: workflowModuleKey(currentModule),
        entityType: 'receipt',
        entityId: Number(receiptRow.id),
        beforeStatus: mapReceiptStatus(receiptRow.receipt_status),
        afterStatus: 'Needs Correction',
        beforeStage: normalizeWorkflowStage(receiptRow.workflow_stage, currentModule),
        afterStage: targetStage,
        notification: {
          recipientRole: notificationRole,
          type: 'correction_required',
          title: 'Documentation requires correction before reconciliation',
          message: `${receiptRow.receipt_number} was returned to ${workflowStageLabel(targetStage)}. Reason: ${correctionMessage}`,
          entityType: 'receipt',
          entityId: Number(receiptRow.id)
        }
      });

      sendOk(
        res,
        {
          message: 'Record returned for correction successfully.',
          status: 'Needs Correction',
          workflow_stage: targetStage,
          returned_to: workflowStageLabel(targetStage),
          next_module: workflowStageLabel(targetStage)
        },
        'Record returned for correction successfully.'
      );
      return;
    }

    if (currentModule === WORKFLOW_STAGES.REPORTING_RECONCILIATION) {
      const [rows] = await pool.query(
        `SELECT
            rec.id,
            rec.payment_id,
            rec.status,
            rec.workflow_stage,
            rec.receipt_id,
            p.reference_number,
            r.receipt_number,
            r.receipt_status
         FROM reconciliations rec
         INNER JOIN payment_transactions p ON p.id = rec.payment_id
         LEFT JOIN receipt_records r ON r.id = rec.receipt_id
         WHERE rec.payment_id = ?
         LIMIT 1`,
        [recordId]
      );
      const reconciliationRow = rows[0];
      if (!reconciliationRow) {
        sendError(res, 404, 'Reporting record not found.');
        return;
      }

      await pool.query(
        `UPDATE reconciliations
         SET status = 'discrepancy',
             workflow_stage = ?,
             discrepancy_note = ?,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1,
             updated_at = ?
         WHERE id = ?`,
        [targetStage, correctionMessage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, returnedAt, reconciliationRow.id]
      );
      await pool.query(
        `UPDATE payment_transactions
         SET workflow_stage = ?,
             reporting_status = 'logged',
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1
         WHERE id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, recordId]
      );
      await pool.query(
        `UPDATE receipt_records
         SET workflow_stage = ?,
             receipt_status = CASE WHEN receipt_status IN ('completed', 'released') THEN 'generated' ELSE receipt_status END,
             correction_reason = ?,
             correction_notes = ?,
             returned_from = ?,
             returned_to = ?,
             returned_by = ?,
             returned_at = ?,
             is_returned = 1,
             needs_correction = 1
         WHERE payment_id = ?`,
        [targetStage, reason, remarks || null, currentModule, targetStage, req.currentUser.id, returnedAt, recordId]
      );
      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: 'WORKFLOW_RETURN_CORRECTION',
        action: 'Correction Requested',
        description: `Correction Requested\nRecord: ${reconciliationRow.reference_number}\nFrom: ${workflowStageLabel(currentModule)}\nTo: ${workflowStageLabel(targetStage)}\nReason: ${reason}${remarks ? `\nRemarks: ${remarks}` : ''}`,
        moduleKey: workflowModuleKey(currentModule),
        entityType: 'reconciliation',
        entityId: Number(reconciliationRow.id),
        beforeStatus: mapReconciliationStatus(reconciliationRow.status),
        afterStatus: 'With Discrepancy',
        beforeStage: normalizeWorkflowStage(reconciliationRow.workflow_stage, currentModule),
        afterStage: targetStage,
        notification: {
          recipientRole: notificationRole,
          type: 'discrepancy_flagged',
          title: 'Reconciliation returned to compliance',
          message: `${reconciliationRow.reference_number} was sent back to ${workflowStageLabel(targetStage)}. Reason: ${correctionMessage}`,
          entityType: 'reconciliation',
          entityId: Number(reconciliationRow.id)
        }
      });

      sendOk(
        res,
        {
          message: 'Record returned for correction successfully.',
          status: 'Needs Correction',
          workflow_stage: targetStage,
          returned_to: workflowStageLabel(targetStage),
          next_module: workflowStageLabel(targetStage)
        },
        'Record returned for correction successfully.'
      );
      return;
    }

    sendError(res, 400, 'Unsupported workflow correction module.');
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to return record for correction.');
  }
});

app.post('/api/student-billing', requireAuth, async (req, res) => {
  try {
    const action = String(req.body?.action || '').trim().toLowerCase();
    const billingId = Number(req.body?.billingId || 0);

    if (!billingId || Number.isNaN(billingId)) {
      sendError(res, 422, 'A valid billing record is required.');
      return;
    }

    const [rows] = await pool.query(
      `SELECT b.id, b.student_id, b.billing_code, b.billing_status, b.workflow_stage, b.total_amount, b.paid_amount, b.balance_amount, s.full_name
       FROM billing_records b
       INNER JOIN students s ON s.id = b.student_id
       WHERE b.id = ?
       LIMIT 1`,
      [billingId]
    );

    const billingRow = rows[0];
    if (!billingRow) {
      sendError(res, 404, 'Billing record not found.');
      return;
    }

    if (action === 'settle_full' || action === 'settle_partial' || action === 'mark_failed') {
      const currentPaid = Number(billingRow.paid_amount || 0);
      const currentBalance = Number(billingRow.balance_amount || 0);
      const totalAmount = Number(billingRow.total_amount || 0);
      const postedAmount =
        action === 'settle_full'
          ? currentBalance > 0
            ? currentBalance
            : Math.max(0, totalAmount - currentPaid)
          : action === 'settle_partial'
            ? Math.max(500, Math.min(currentBalance || totalAmount, Math.round((currentBalance || totalAmount) / 2)))
            : 0;

      if (action === 'mark_failed') {
        await pool.query(
          'UPDATE billing_records SET billing_status = ?, workflow_stage = ?, updated_at = ? WHERE id = ?',
          ['failed', WORKFLOW_STAGES.PAY_BILLS, nowSql(), billingId]
        );
        await recordWorkflowEvent({
          actorUser: req.currentUser,
          ipAddress: req.ip || '127.0.0.1',
          rawAction: 'PAY_BILLS_MARK_FAILED',
          action: 'Payment Failed',
          description: `${billingRow.billing_code} was marked as a failed bill payment.`,
          moduleKey: 'manage_billing',
          entityType: 'billing',
          entityId: billingId,
          beforeStatus: mapManagementStatus(billingRow.billing_status),
          afterStatus: 'Payment Failed',
          beforeStage: normalizeWorkflowStage(
            billingRow.workflow_stage,
            resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
          ),
          afterStage: WORKFLOW_STAGES.PAY_BILLS,
          notification: {
            type: 'payment_failed',
            title: 'Payment failed',
            message: `${billingRow.billing_code} was marked as payment failed and needs review.`
          }
        });
        sendOk(
          res,
          buildWorkflowActionPayload(
            `${billingRow.billing_code} was marked as payment failed and remains in Pay Bills.`,
            'Payment Failed',
            WORKFLOW_STAGES.PAY_BILLS
          ),
          `${billingRow.billing_code} was marked as payment failed and remains in Pay Bills.`
        );
        return;
      }

      const nextPaidAmount = Math.min(totalAmount, currentPaid + postedAmount);
      const nextBalanceAmount = Math.max(0, totalAmount - nextPaidAmount);
      const nextBillingStatus = nextBalanceAmount <= 0 ? 'paid' : 'partial';
      const nextBillingStage = nextBalanceAmount <= 0 ? WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY : WORKFLOW_STAGES.PAY_BILLS;
      const referenceNumber = `${nextPaymentReference(billingId)}-${action === 'settle_full' ? 'F' : 'P'}`;

      await pool.query(
        `UPDATE billing_records
         SET paid_amount = ?,
             balance_amount = ?,
             billing_status = ?,
             workflow_stage = ?,
             updated_at = ?
         WHERE id = ?`,
        [nextPaidAmount, nextBalanceAmount, nextBillingStatus, nextBillingStage, nowSql(), billingId]
      );

      await pool.query(
        `INSERT INTO payment_transactions (
          billing_id, reference_number, amount_paid, payment_method, payment_status, reporting_status, workflow_stage, payment_date, processed_by, created_at
        )
        VALUES (?, ?, ?, 'Online', 'processing', 'logged', ?, ?, ?, ?)`,
        [billingId, referenceNumber, postedAmount, WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY, nowSql(), req.currentUser.id, nowSql()]
      );
      const [paymentRows] = await pool.query(`SELECT id FROM payment_transactions WHERE reference_number = ? LIMIT 1`, [referenceNumber]);
      const paymentId = paymentRows[0] ? Number(paymentRows[0].id) : null;

      if (paymentId) {
        await createPaymentAttempt({
          paymentId,
          billingId,
          referenceNumber,
          attemptStatus: 'processing',
          requestPayload: { action, postedAmount },
          responsePayload: { queued: true, module: 'Payment Processing & Gateway' },
          remarks: 'Payment request created from Pay Bills.',
          createdBy: req.currentUser.id
        });
      }

      const successMessage =
        action === 'settle_full'
          ? `${billingRow.billing_code} was forwarded to Payment Processing & Gateway as a full payment.`
          : `${billingRow.billing_code} was forwarded to Payment Processing & Gateway as an installment payment.`;

      await recordWorkflowEvent({
        actorUser: req.currentUser,
        ipAddress: req.ip || '127.0.0.1',
        rawAction: action === 'settle_full' ? 'PAY_BILLS_FULL_PAYMENT' : 'PAY_BILLS_PARTIAL_PAYMENT',
        action: action === 'settle_full' ? 'Full Payment Applied' : 'Installment Applied',
        description: successMessage,
        moduleKey: 'manage_billing',
        entityType: 'payment',
        entityId: paymentId || billingId,
        beforeStatus: mapManagementStatus(billingRow.billing_status),
        afterStatus: nextBalanceAmount <= 0 ? 'Fully Paid' : 'Partially Paid',
        beforeStage: normalizeWorkflowStage(
          billingRow.workflow_stage,
          resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
        ),
        afterStage: action === 'settle_full' ? WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY : WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY,
        notification: {
          type: 'payment_pending',
          title: 'Payment request pending',
          message: `${referenceNumber} was queued in Payment Processing & Gateway.`
        }
      });
      sendOk(
        res,
        buildWorkflowActionPayload(successMessage, nextBalanceAmount <= 0 ? 'Fully Paid' : 'Partially Paid', WORKFLOW_STAGES.PAYMENT_PROCESSING_GATEWAY),
        successMessage
      );
      return;
    }

    const mutation = resolveBillingMutation(action, billingRow);
    if (!mutation) {
      sendError(res, 400, 'Unsupported billing action.');
      return;
    }

    if (action === 'notify') {
      const currentStatus = String(billingRow.billing_status || '').toLowerCase();
      const notificationType =
        currentStatus === 'verified' ? 'billing_verified' : currentStatus === 'correction' || currentStatus === 'rejected' || currentStatus === 'on_hold' ? 'correction_required' : 'payment_reminder';
      const subject =
        currentStatus === 'verified' ? 'Billing Verified' : currentStatus === 'correction' || currentStatus === 'rejected' || currentStatus === 'on_hold' ? 'Correction Required' : 'Payment Reminder';
      const message =
        currentStatus === 'verified'
          ? `${billingRow.billing_code} verified for cashier payment.`
          : currentStatus === 'correction' || currentStatus === 'rejected' || currentStatus === 'on_hold'
            ? `${billingRow.billing_code} returned for correction and registrar review.`
            : `${billingRow.billing_code} is waiting for payment completion.`;

      await pool.query(
        `INSERT INTO billing_notifications (
          billing_id, student_id, notification_type, subject, message, recipient_name, recipient_email, status, created_by, created_at
        )
        SELECT
          b.id,
          b.student_id,
          ?,
          ?,
          ?,
          s.full_name,
          s.email,
          'sent',
          ?,
          ?
        FROM billing_records b
        INNER JOIN students s ON s.id = b.student_id
        WHERE b.id = ?`,
        [notificationType, subject, message, req.currentUser.id, nowSql(), billingId]
      );

      await insertSystemNotification({
        recipientRole: currentStatus === 'verified' ? 'student' : 'cashier',
        recipientName: billingRow.full_name,
        type: notificationType,
        title: subject,
        message,
        entityType: 'billing',
        entityId: billingId
      });
    }

    if (mutation.nextStatus !== String(billingRow.billing_status || '').toLowerCase()) {
      await pool.query('UPDATE billing_records SET billing_status = ?, workflow_stage = ?, updated_at = ? WHERE id = ?', [
        mutation.nextStatus,
        mutation.nextStage,
        nowSql(),
        billingId
      ]);
    }

    const actionLabel =
      action === 'approve' ? 'Billing Verified' : action === 'reject' ? 'Correction Requested' : action === 'notify' ? 'Billing Notification Sent' : `Billing ${action}`;

    await recordWorkflowEvent({
      actorUser: req.currentUser,
      ipAddress: req.ip || '127.0.0.1',
      rawAction: action === 'approve' ? 'BILLING_PORTAL_APPROVE' : action === 'reject' ? 'BILLING_PORTAL_REJECT' : 'BILLING_PORTAL_NOTIFY',
      action: actionLabel,
      description: `${mutation.message} (${billingRow.billing_code})`,
      moduleKey: 'billing_verification',
      entityType: 'billing',
      entityId: billingId,
      beforeStatus: mapBillingWorkflowStatus(billingRow.billing_status, billingRow.balance_amount),
      afterStatus: mapBillingWorkflowStatus(mutation.nextStatus, billingRow.balance_amount),
      beforeStage: normalizeWorkflowStage(
        billingRow.workflow_stage,
        resolveBillingWorkflowStage(billingRow.billing_status, billingRow.balance_amount)
      ),
      afterStage: mutation.nextStage,
      notification:
        action === 'approve'
          ? {
              type: 'billing_activated',
              title: 'Billing ready for payment',
              message: `${billingRow.billing_code} was verified and moved to Pay Bills.`
            }
          : action === 'reject'
            ? {
                type: 'correction_required',
                title: 'Billing returned for correction',
                message: `${billingRow.billing_code} was sent back for correction.`
              }
            : null
    });

    sendOk(
      res,
      buildWorkflowActionPayload(mutation.message, mapBillingWorkflowStatus(mutation.nextStatus, billingRow.balance_amount), mutation.nextStage),
      mutation.message
    );
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Unable to update billing record.');
  }
});

app.use((_req, res) => {
  sendError(res, 404, 'API route not found.');
});

async function start() {
  try {
    await ensureSchema();
    if (process.argv.includes('--seed')) {
      if (pool?.end) {
        await pool.end();
      }
      console.log('Cashier database schema verified and seeded.');
      return;
    }

    app.listen(port, () => {
      console.log(`Cashier API running at http://localhost:${port}`);
      console.log(`Frontend origins allowed: ${frontendOrigins.join(', ')}`);
    });
  } catch (error) {
    console.error('Failed to start Cashier API:', error);
    process.exit(1);
  }
}

start();
