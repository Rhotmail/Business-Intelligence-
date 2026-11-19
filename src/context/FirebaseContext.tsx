import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  testConnection,
} from '../firebase.ts';
import {
  AlertThresholdRule,
  AuditLogEntry,
  BudgetAccessPolicy,
  BudgetControlledRoleId,
  BudgetLineItemDef,
  BudgetLineItemId,
  DecisionCase,
  ManagedRoleId,
  RoleAccessPolicy,
  RoleId,
  WorkspaceSection,
} from '../types.ts';

export type ExecutiveAccountRole = 'owner' | 'operations' | 'finance' | 'sales';

export interface ExecutiveAccount {
  roleId: ExecutiveAccountRole;
  code: string;
  titleAr: string;
  email: string;
  defaultPassword: string;
  scopeLabel: string;
  description: string;
}

export const WORKSPACE_ID = 'enterprise_main';

export const EXECUTIVE_ACCOUNTS: ExecutiveAccount[] = [
  {
    roleId: 'owner',
    code: '01',
    titleAr: 'المالك',
    email: 'owner@owner-ai.iq',
    defaultPassword: 'Owner@2026!',
    scopeLabel: 'الشركة كاملة (بغداد · البصرة · أربيل)',
    description: 'صلاحية تنفيذية شاملة، اعتماد القرارات الحساسة، وإدارة الحوكمة والخصوصية.',
  },
  {
    roleId: 'operations',
    code: '03',
    titleAr: 'مدير العمليات',
    email: 'operations@owner-ai.iq',
    defaultPassword: 'Ops@2026!',
    scopeLabel: 'فرع أربيل والعمليات التشغيلية',
    description: 'مراقبة دوران المخزون والهدر التشغيلي والالتزام بمستويات SLA.',
  },
  {
    roleId: 'finance',
    code: '02',
    titleAr: 'المدير المالي',
    email: 'finance@owner-ai.iq',
    defaultPassword: 'Finance@2026!',
    scopeLabel: 'الشركة كاملة (النطاق المالي والذمم)',
    description: 'الرقابة على السيولة المحتجزة، الذمم المدينة، جسر التباين، وحسم تعارض المصادر.',
  },
  {
    roleId: 'sales',
    code: '05',
    titleAr: 'مدير المبيعات',
    email: 'sales@owner-ai.iq',
    defaultPassword: 'Sales@2026!',
    scopeLabel: 'فرع بغداد — المبيعات والخصومات',
    description: 'متابعة صافي المبيعات، انحراف الخصومات التجارية، وتحقيق أهداف الفروع.',
  },
];

export function resolveExecutiveAccount(identifier: string): ExecutiveAccount | undefined {
  const normalized = identifier.trim().toLowerCase();
  return EXECUTIVE_ACCOUNTS.find(
    (acc) =>
      acc.email.toLowerCase() === normalized ||
      acc.roleId.toLowerCase() === normalized ||
      acc.titleAr === identifier.trim()
  );
}

export const COMPANY_DIVISIONS: Array<{ id: WorkspaceSection; label: string; description: string }> = [
  { id: 'home', label: 'الرئيسية التنفيذية', description: 'ملخص المؤشرات والأولويات الأسبوعية' },
  { id: 'reports', label: 'مكتبة التقارير', description: 'التقارير المعتمدة ومؤشرات الأداء' },
  { id: 'analysis', label: 'التحليل والتوأم الاقتصادي', description: 'جسر التباين، المقارنات، التنبؤات، والتنبيهات' },
  { id: 'decisions', label: 'القرارات والمتابعة', description: 'دورة القضايا والاعتمادات وقياس الأثر' },
  { id: 'data', label: 'مصادر البيانات والتحقق', description: 'موصلات ERP وDWH وحسم التعارضات' },
  { id: 'trust', label: 'طبقة الحماية والحوكمة', description: 'قاموس الرموز Trust Vault وسجل التدقيق' },
];

export const COMPANY_BRANCHES: string[] = ['الشركة كاملة', 'بغداد', 'البصرة', 'أربيل'];

export const REPORT_CATEGORIES: string[] = [
  'الربحية والهوامش',
  'السيولة والذمم',
  'المخزون والتوريد',
  'الكفاءة التشغيلية',
  'التجارية والتسعير',
  'المبيعات والنمو',
];

export const DEFAULT_ROLE_PERMISSIONS: Record<ManagedRoleId, RoleAccessPolicy> = {
  operations: {
    id: 'operations',
    roleTitleAr: 'مدير العمليات',
    allowedSections: ['home', 'reports', 'analysis', 'decisions', 'data'],
    allowedBranches: ['بغداد', 'البصرة', 'أربيل'],
    allowedReportCategories: ['المخزون والتوريد', 'الكفاءة التشغيلية'],
    canViewFinancialMargins: false,
    canViewTrustVault: false,
    canViewAuditLogs: false,
    canRunAiAnalysis: true,
    canExportReports: true,
    canManageAlerts: true,
    canResolveConflicts: false,
    canCreateDecisions: true,
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  finance: {
    id: 'finance',
    roleTitleAr: 'المدير المالي',
    allowedSections: ['home', 'reports', 'analysis', 'decisions', 'data', 'trust'],
    allowedBranches: ['الشركة كاملة', 'بغداد', 'البصرة', 'أربيل'],
    allowedReportCategories: [
      'الربحية والهوامش',
      'السيولة والذمم',
      'المخزون والتوريد',
      'الكفاءة التشغيلية',
      'التجارية والتسعير',
      'المبيعات والنمو',
    ],
    canViewFinancialMargins: true,
    canViewTrustVault: true,
    canViewAuditLogs: true,
    canRunAiAnalysis: true,
    canExportReports: true,
    canManageAlerts: true,
    canResolveConflicts: true,
    canCreateDecisions: true,
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  sales: {
    id: 'sales',
    roleTitleAr: 'مدير المبيعات',
    allowedSections: ['home', 'reports', 'analysis', 'decisions'],
    allowedBranches: ['بغداد', 'البصرة', 'أربيل'],
    allowedReportCategories: ['المبيعات والنمو', 'التجارية والتسعير'],
    canViewFinancialMargins: false,
    canViewTrustVault: false,
    canViewAuditLogs: false,
    canRunAiAnalysis: true,
    canExportReports: false,
    canManageAlerts: false,
    canResolveConflicts: false,
    canCreateDecisions: true,
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
};

export const BUDGET_LINE_ITEMS: BudgetLineItemDef[] = [
  {
    id: 'revenue_budget',
    code: 'B-101',
    titleAr: 'ميزانية الإيرادات الصافية والمبيعات',
    categoryAr: 'الإيرادات',
    description: 'المستهدف الربع سنوي لإجمالي المبيعات وصافي الإيرادات التشغيلية بعد العوائد.',
    quarterlyAllocationM: 240.0,
    actualSpentM: 228.4,
    sensitiveLevel: 'standard',
    mappedMetricKeys: ['net_revenue', 'gross_revenue'],
  },
  {
    id: 'cogs_budget',
    code: 'B-201',
    titleAr: 'ميزانية كلفة البضاعة والمشتريات (COGS)',
    categoryAr: 'التكاليف المباشرة',
    description: 'سقف تكاليف التوريد المباشرة وأسعار الموردين وكلفة البضاعة والربح الإجمالي.',
    quarterlyAllocationM: 145.0,
    actualSpentM: 151.2,
    sensitiveLevel: 'high',
    mappedMetricKeys: ['cogs', 'gross_profit', 'gross_margin'],
  },
  {
    id: 'discounts_budget',
    code: 'B-202',
    titleAr: 'ميزانية الخصومات والحوافز التجارية',
    categoryAr: 'السياسة التسعيرية',
    description: 'مخصصات الخصم المسموحة لقنوات البيع وكبار العملاء وحدود الانحراف السعري.',
    quarterlyAllocationM: 14.5,
    actualSpentM: 18.6,
    sensitiveLevel: 'medium',
    mappedMetricKeys: ['discount_amount', 'discount_rate'],
  },
  {
    id: 'opex_budget',
    code: 'B-301',
    titleAr: 'ميزانية المصروفات التشغيلية الإدارية (OpEx)',
    categoryAr: 'المصاريف العمومية',
    description: 'مصاريف الإدارة العامة والرواتب المركزية وصافي الربح التشغيلي.',
    quarterlyAllocationM: 26.0,
    actualSpentM: 24.8,
    sensitiveLevel: 'high',
    mappedMetricKeys: ['net_profit', 'net_margin'],
  },
  {
    id: 'variable_cost_budget',
    code: 'B-302',
    titleAr: 'ميزانية التكاليف المتغيرة واللوجستية',
    categoryAr: 'التشغيل والنقل',
    description: 'مخصصات النقل والمناولة والتشغيل المتغير المرتبط بحجم الطلبيات وهامش المساهمة.',
    quarterlyAllocationM: 19.5,
    actualSpentM: 18.9,
    sensitiveLevel: 'medium',
    mappedMetricKeys: ['contribution_margin'],
  },
  {
    id: 'inventory_budget',
    code: 'B-401',
    titleAr: 'ميزانية المخزون ورأس المال العامل المخزني',
    categoryAr: 'المخزون',
    description: 'الحد الأعلى لقيمة المخزون المحتفظ به ومعدل دوران المخزون (DIO).',
    quarterlyAllocationM: 62.0,
    actualSpentM: 69.4,
    sensitiveLevel: 'standard',
    mappedMetricKeys: ['inventory_value', 'inventory_days'],
  },
  {
    id: 'ar_credit_budget',
    code: 'B-402',
    titleAr: 'ميزانية الذمم المدينة والائتمان التجاري',
    categoryAr: 'التحصيل والسيولة',
    description: 'سقف الائتمان الممنوح للعملاء وأيام التحصيل (DSO) والسيولة المحتجزة.',
    quarterlyAllocationM: 48.0,
    actualSpentM: 54.3,
    sensitiveLevel: 'high',
    mappedMetricKeys: ['ar_balance', 'ar_days', 'ccc_days', 'trapped_capital'],
  },
  {
    id: 'waste_budget',
    code: 'B-501',
    titleAr: 'ميزانية الهدر والتلف التشغيلي',
    categoryAr: 'الجودة والهدر',
    description: 'مخصصات الفاقد والتلف الميداني ومعايير الالتزام بمستوى الخدمة (SLA).',
    quarterlyAllocationM: 4.2,
    actualSpentM: 5.1,
    sensitiveLevel: 'standard',
    mappedMetricKeys: ['waste_cost', 'ops_waste', 'sla_pct'],
  },
];

const VALID_BUDGET_ITEM_IDS = BUDGET_LINE_ITEMS.map((item) => item.id);

export const DEFAULT_BUDGET_PERMISSIONS: Record<BudgetControlledRoleId, BudgetAccessPolicy> = {
  operations: {
    id: 'operations',
    roleTitleAr: 'مدير العمليات',
    allowedBudgetItems: ['inventory_budget', 'waste_budget', 'variable_cost_budget'],
    strictControlEnabled: true,
    updatedByRole: 'finance',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
  sales: {
    id: 'sales',
    roleTitleAr: 'مدير المبيعات',
    allowedBudgetItems: ['revenue_budget', 'discounts_budget', 'ar_credit_budget'],
    strictControlEnabled: true,
    updatedByRole: 'finance',
    updatedAt: '2026-11-19T00:00:00.000Z',
  },
};

export function getBlockedMetricKeysForBudgetPolicy(policy?: BudgetAccessPolicy): Set<string> {
  const blocked = new Set<string>();
  if (!policy || !policy.strictControlEnabled) return blocked;
  for (const item of BUDGET_LINE_ITEMS) {
    if (!policy.allowedBudgetItems.includes(item.id)) {
      for (const mk of item.mappedMetricKeys) {
        blocked.add(mk);
      }
    }
  }
  return blocked;
}

export interface UserProfilePreferences {
  displayName: string;
  activeRole: ExecutiveAccountRole;
  preferredPeriod: string;
  preferredBranch: string;
  favoriteReportIds: string[];
  recentReportIds: string[];
}

export interface PersistedAlertState {
  id: string;
  alertKey: string;
  status: 'acknowledged' | 'escalated';
  by: string;
  updatedAt: string;
}

interface FirebaseContextValue {
  user: User | null;
  activeAccount: ExecutiveAccount | null;
  accountRole: ExecutiveAccountRole | null;
  authReady: boolean;
  connectionOk: boolean;
  firestoreSynced: boolean;
  signingIn: boolean;
  authError: string | null;
  needsEmailProviderSetup: boolean;
  profile: UserProfilePreferences | null;
  persistedDecisions: DecisionCase[] | null;
  persistedAlertRules: AlertThresholdRule[] | null;
  persistedAlertStates: Record<string, PersistedAlertState>;
  persistedLogs: AuditLogEntry[];
  rolePermissions: Record<ManagedRoleId, RoleAccessPolicy>;
  rolePermissionsLoaded: boolean;
  budgetPermissions: Record<BudgetControlledRoleId, BudgetAccessPolicy>;
  budgetPermissionsLoaded: boolean;
  signInWithAccount: (identifier: string, password: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  saveProfilePreferences: (patch: Partial<Omit<UserProfilePreferences, 'activeRole'>>) => Promise<void>;
  seedWorkspaceIfEmpty: (decisions: DecisionCase[], alertRules: AlertThresholdRule[]) => Promise<void>;
  saveDecisionToFirestore: (decision: DecisionCase, isNew: boolean) => Promise<void>;
  saveAlertRuleToFirestore: (rule: AlertThresholdRule) => Promise<void>;
  saveAlertStatesToFirestore: (
    entries: Array<{ alertKey: string; status: 'acknowledged' | 'escalated'; by: string }>
  ) => Promise<void>;
  saveRolePermission: (policy: RoleAccessPolicy) => Promise<void>;
  resetRolePermission: (roleId: ManagedRoleId) => Promise<void>;
  saveBudgetPermission: (policy: BudgetAccessPolicy) => Promise<void>;
  resetBudgetPermission: (roleId: BudgetControlledRoleId) => Promise<void>;
  appendWorkspaceLog: (entry: {
    actorRole: RoleId;
    action: string;
    target: string;
    detail: string;
  }) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function sanitizeId(raw: string, maxLen = 64): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  const trimmed = cleaned.slice(0, maxLen);
  return trimmed.length > 0 ? trimmed : 'id_default';
}

function hashSafeId(prefix: string, raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${prefix}_${hex1}${hex2}`;
}

function clampStr(val: unknown, max: number, fallback: string): string {
  const str = String(val ?? '').trim();
  if (!str) return fallback.slice(0, max);
  return str.slice(0, max);
}

function toIsoString(ts: unknown): string {
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (typeof ts === 'string') return ts;
  return new Date().toISOString();
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [activeAccount, setActiveAccount] = useState<ExecutiveAccount | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [connectionOk, setConnectionOk] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const [firestoreSynced, setFirestoreSynced] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsEmailProviderSetup, setNeedsEmailProviderSetup] = useState(false);

  const [profile, setProfile] = useState<UserProfilePreferences | null>(null);
  const [persistedDecisions, setPersistedDecisions] = useState<DecisionCase[] | null>(null);
  const [persistedAlertRules, setPersistedAlertRules] = useState<AlertThresholdRule[] | null>(null);
  const [persistedAlertStates, setPersistedAlertStates] = useState<Record<string, PersistedAlertState>>({});
  const [persistedLogs, setPersistedLogs] = useState<AuditLogEntry[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<ManagedRoleId, RoleAccessPolicy>>(
    DEFAULT_ROLE_PERMISSIONS
  );
  const [rolePermissionsLoaded, setRolePermissionsLoaded] = useState(false);
  const [budgetPermissions, setBudgetPermissions] = useState<
    Record<BudgetControlledRoleId, BudgetAccessPolicy>
  >(DEFAULT_BUDGET_PERMISSIONS);
  const [budgetPermissionsLoaded, setBudgetPermissionsLoaded] = useState(false);

  useEffect(() => {
    testConnection().then((ok) => setConnectionOk(ok));
  }, []);

  const ensureUserAndWorkspaceDocuments = useCallback(async (u: User, account: ExecutiveAccount) => {
    const safeUid = sanitizeId(u.uid, 128);
    const userPath = `users/${safeUid}`;
    const userRef = doc(db, 'users', safeUid);

    try {
      const snap = await getDoc(userRef);
      const displayName = clampStr(account.titleAr, 120, 'حساب تنفيذي');

      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: safeUid,
          displayName,
          activeRole: account.roleId,
          preferredPeriod: '2026-Q3',
          preferredBranch:
            account.roleId === 'operations'
              ? 'أربيل'
              : account.roleId === 'sales'
                ? 'بغداد'
                : 'all',
          favoriteReportIds:
            account.roleId === 'owner'
              ? ['rep_owner_exec', 'rep_owner_leakage']
              : account.roleId === 'finance'
                ? ['rep_fin_cash', 'rep_fin_ar']
                : account.roleId === 'operations'
                  ? ['rep_ops_inv', 'rep_ops_waste']
                  : ['rep_sales_perf'],
          recentReportIds: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const privateRef = doc(db, 'users', safeUid, 'private', 'info');
      const privSnap = await getDoc(privateRef);
      const safeEmail = clampStr(u.email ?? account.email, 254, account.email);

      if (!privSnap.exists()) {
        await setDoc(privateRef, {
          uid: safeUid,
          email: safeEmail,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email: safeEmail,
          updatedAt: serverTimestamp(),
        });
      }

      const workspaceRef = doc(db, 'workspaces', WORKSPACE_ID);
      const wsSnap = await getDoc(workspaceRef);
      if (!wsSnap.exists()) {
        await setDoc(workspaceRef, {
          id: WORKSPACE_ID,
          name: 'OWNER AI Enterprise',
          createdByUid: safeUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setProfileReady(false);
      setFirestoreSynced(false);
      setProfile(null);
      setPersistedDecisions(null);
      setPersistedAlertRules(null);
      setPersistedAlertStates({});
      setPersistedLogs([]);

      setRolePermissionsLoaded(false);
      setRolePermissions(DEFAULT_ROLE_PERMISSIONS);
      setBudgetPermissionsLoaded(false);
      setBudgetPermissions(DEFAULT_BUDGET_PERMISSIONS);

      if (nextUser) {
        const matchedAccount = nextUser.email ? resolveExecutiveAccount(nextUser.email) : undefined;
        if (!matchedAccount) {
          // Reject any Google or non-designated account session
          await signOut(auth);
          setUser(null);
          setActiveAccount(null);
          setAuthError('تم إنهاء الجلسة: الدخول مقتصر على حسابات المالك ومدير العمليات والمدير المالي ومدير المبيعات فقط.');
          setAuthReady(true);
          return;
        }

        setUser(nextUser);
        setActiveAccount(matchedAccount);
        try {
          await ensureUserAndWorkspaceDocuments(nextUser, matchedAccount);
          setProfileReady(true);
        } catch (err) {
          setAuthError(
            err instanceof Error ? err.message : 'تعذر تهيئة ملف الحساب التنفيذي في Firestore.'
          );
        }
      } else {
        setUser(null);
        setActiveAccount(null);
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, [ensureUserAndWorkspaceDocuments]);

  // Real-time Firestore listeners (only active after authReady && user && activeAccount && profileReady)
  useEffect(() => {
    if (!authReady || !user || !activeAccount || !profileReady) return;
    const safeUid = sanitizeId(user.uid, 128);

    const unsubProfile = onSnapshot(
      doc(db, 'users', safeUid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setProfile({
            displayName: clampStr(d.displayName, 120, activeAccount.titleAr),
            activeRole: activeAccount.roleId,
            preferredPeriod: clampStr(d.preferredPeriod, 16, '2026-Q3'),
            preferredBranch: clampStr(d.preferredBranch, 64, 'all'),
            favoriteReportIds: Array.isArray(d.favoriteReportIds) ? d.favoriteReportIds : [],
            recentReportIds: Array.isArray(d.recentReportIds) ? d.recentReportIds : [],
          });
        }
        setFirestoreSynced(true);
      },
      (error) => handleFirestoreError(error, OperationType.GET, `users/${safeUid}`)
    );

    const decisionsPath = `workspaces/${WORKSPACE_ID}/decisions`;
    const decisionsQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'decisions'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const unsubDecisions = onSnapshot(
      decisionsQuery,
      (snap) => {
        const list: DecisionCase[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: String(d.id),
              title: String(d.title),
              category: String(d.category),
              stage: d.stage,
              severity: d.severity,
              ownerRole: d.ownerRole,
              branchScope: String(d.branchScope),
              period: String(d.period),
              detectedMetric: String(d.detectedMetric),
              baselineValue: String(d.baselineValue),
              currentValue: String(d.currentValue),
              estimatedFinancialImpact: Number(d.estimatedFinancialImpact ?? 0),
              verificationStatus: d.verificationStatus,
              diagnosisSummary: String(d.diagnosisSummary),
              epistemicLevel: d.epistemicLevel,
              proposedAction: String(d.proposedAction),
              requiresOwnerApproval: Boolean(d.requiresOwnerApproval),
              approvalStatus: d.approvalStatus,
              approvedBy: d.approvedBy ? String(d.approvedBy) : undefined,
              dueDate: String(d.dueDate),
              executionNotes: Array.isArray(d.executionNotes) ? d.executionNotes : [],
              outcomeMeasurement: d.outcomeMeasurement,
              createdAt: toIsoString(d.createdAt),
              updatedAt: toIsoString(d.updatedAt),
            } as DecisionCase;
          })
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setPersistedDecisions(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, decisionsPath)
    );

    const rulesPath = `workspaces/${WORKSPACE_ID}/alertRules`;
    const rulesQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'alertRules'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const unsubRules = onSnapshot(
      rulesQuery,
      (snap) => {
        const list: AlertThresholdRule[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id),
            metricKey: String(d.metricKey),
            metricLabel: String(d.metricLabel),
            unit: d.unit,
            comparator: d.comparator,
            threshold: Number(d.threshold),
            enabled: Boolean(d.enabled),
            updatedBy: d.updatedBy,
            updatedAt: toIsoString(d.updatedAt),
          } as AlertThresholdRule;
        });
        setPersistedAlertRules(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, rulesPath)
    );

    const statesPath = `workspaces/${WORKSPACE_ID}/alertStates`;
    const statesQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'alertStates'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const unsubStates = onSnapshot(
      statesQuery,
      (snap) => {
        const map: Record<string, PersistedAlertState> = {};
        for (const docSnap of snap.docs) {
          const d = docSnap.data();
          const key = String(d.alertKey);
          map[key] = {
            id: String(d.id),
            alertKey: key,
            status: d.status,
            by: String(d.by),
            updatedAt: toIsoString(d.updatedAt),
          };
        }
        setPersistedAlertStates(map);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, statesPath)
    );

    const logsPath = `workspaces/${WORKSPACE_ID}/workspaceLogs`;
    const logsQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'workspaceLogs'),
      where('workspaceId', '==', WORKSPACE_ID),
      orderBy('createdAt', 'desc')
    );
    const unsubLogs = onSnapshot(
      logsQuery,
      (snap) => {
        const list: AuditLogEntry[] = snap.docs.slice(0, 30).map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id),
            timestamp: toIsoString(d.createdAt),
            actorRole: d.actorRole,
            action: String(d.action),
            target: String(d.target),
            detail: String(d.detail),
          };
        });
        setPersistedLogs(list);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, logsPath)
    );

    const permsPath = `workspaces/${WORKSPACE_ID}/rolePermissions`;
    const permsQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'rolePermissions'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const unsubRolePerms = onSnapshot(
      permsQuery,
      (snap) => {
        const merged: Record<ManagedRoleId, RoleAccessPolicy> = {
          operations: { ...DEFAULT_ROLE_PERMISSIONS.operations },
          finance: { ...DEFAULT_ROLE_PERMISSIONS.finance },
          sales: { ...DEFAULT_ROLE_PERMISSIONS.sales },
        };
        for (const docSnap of snap.docs) {
          const d = docSnap.data();
          const roleId = String(d.id) as ManagedRoleId;
          if (roleId === 'operations' || roleId === 'finance' || roleId === 'sales') {
            merged[roleId] = {
              id: roleId,
              roleTitleAr: clampStr(d.roleTitleAr, 80, DEFAULT_ROLE_PERMISSIONS[roleId].roleTitleAr),
              allowedSections: Array.isArray(d.allowedSections)
                ? (d.allowedSections as WorkspaceSection[])
                : DEFAULT_ROLE_PERMISSIONS[roleId].allowedSections,
              allowedBranches:
                Array.isArray(d.allowedBranches) && d.allowedBranches.length > 0
                  ? (d.allowedBranches as string[])
                  : DEFAULT_ROLE_PERMISSIONS[roleId].allowedBranches,
              allowedReportCategories: Array.isArray(d.allowedReportCategories)
                ? (d.allowedReportCategories as string[])
                : DEFAULT_ROLE_PERMISSIONS[roleId].allowedReportCategories,
              canViewFinancialMargins: Boolean(d.canViewFinancialMargins),
              canViewTrustVault: Boolean(d.canViewTrustVault),
              canViewAuditLogs: Boolean(d.canViewAuditLogs),
              canRunAiAnalysis: Boolean(d.canRunAiAnalysis),
              canExportReports: Boolean(d.canExportReports),
              canManageAlerts: Boolean(d.canManageAlerts),
              canResolveConflicts: Boolean(d.canResolveConflicts),
              canCreateDecisions: Boolean(d.canCreateDecisions),
              updatedByEmail: d.updatedByEmail ? String(d.updatedByEmail) : undefined,
              updatedAt: toIsoString(d.updatedAt),
            };
          }
        }
        setRolePermissions(merged);
        setRolePermissionsLoaded(true);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, permsPath)
    );

    const budgetPermsPath = `workspaces/${WORKSPACE_ID}/budgetPermissions`;
    const budgetPermsQuery = query(
      collection(db, 'workspaces', WORKSPACE_ID, 'budgetPermissions'),
      where('workspaceId', '==', WORKSPACE_ID)
    );
    const unsubBudgetPerms = onSnapshot(
      budgetPermsQuery,
      (snap) => {
        const merged: Record<BudgetControlledRoleId, BudgetAccessPolicy> = {
          operations: { ...DEFAULT_BUDGET_PERMISSIONS.operations },
          sales: { ...DEFAULT_BUDGET_PERMISSIONS.sales },
        };
        for (const docSnap of snap.docs) {
          const d = docSnap.data();
          const roleId = String(d.id) as BudgetControlledRoleId;
          if (roleId === 'operations' || roleId === 'sales') {
            merged[roleId] = {
              id: roleId,
              roleTitleAr: clampStr(d.roleTitleAr, 80, DEFAULT_BUDGET_PERMISSIONS[roleId].roleTitleAr),
              allowedBudgetItems: Array.isArray(d.allowedBudgetItems)
                ? (d.allowedBudgetItems.filter((item) =>
                    VALID_BUDGET_ITEM_IDS.includes(item as BudgetLineItemId)
                  ) as BudgetLineItemId[])
                : DEFAULT_BUDGET_PERMISSIONS[roleId].allowedBudgetItems,
              strictControlEnabled: Boolean(d.strictControlEnabled),
              updatedByRole: d.updatedByRole === 'owner' ? 'owner' : 'finance',
              updatedByEmail: d.updatedByEmail ? String(d.updatedByEmail) : undefined,
              updatedAt: toIsoString(d.updatedAt),
            };
          }
        }
        setBudgetPermissions(merged);
        setBudgetPermissionsLoaded(true);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, budgetPermsPath)
    );

    return () => {
      unsubProfile();
      unsubDecisions();
      unsubRules();
      unsubStates();
      unsubLogs();
      unsubRolePerms();
      unsubBudgetPerms();
    };
  }, [authReady, user, activeAccount, profileReady]);

  const signInWithAccount = useCallback(async (identifier: string, password: string) => {
    const account = resolveExecutiveAccount(identifier);
    if (!account) {
      setAuthError('هذا الحساب غير مخوّل. الدخول مقتصر على الحسابات المحددة للمالك ومدير العمليات والمدير المالي ومدير المبيعات.');
      return;
    }
    if (!password) {
      setAuthError('يرجى إدخال كلمة المرور الخاصة بالحساب.');
      return;
    }

    setSigningIn(true);
    setAuthError(null);
    setNeedsEmailProviderSetup(false);

    try {
      await signInWithEmailAndPassword(auth, account.email, password);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';

      if (code === 'auth/operation-not-allowed' || code === 'auth/configuration-not-found') {
        setNeedsEmailProviderSetup(true);
        setAuthError(
          'مزود تسجيل الدخول بالبريد وكلمة المرور (Email/Password) غير مفعّل بعد في لوحة Firebase Console.'
        );
      } else if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        // Handle first-time provisioning when Firebase Email Enumeration Protection is active
        if (password === account.defaultPassword) {
          try {
            const cred = await createUserWithEmailAndPassword(auth, account.email, password);
            await updateProfile(cred.user, { displayName: account.titleAr });
          } catch (createErr: unknown) {
            const createCode = (createErr as { code?: string })?.code ?? '';
            if (createCode === 'auth/operation-not-allowed' || createCode === 'auth/configuration-not-found') {
              setNeedsEmailProviderSetup(true);
              setAuthError(
                'مزود تسجيل الدخول بالبريد وكلمة المرور (Email/Password) غير مفعّل بعد في لوحة Firebase Console.'
              );
            } else if (createCode === 'auth/email-already-in-use') {
              setAuthError(`كلمة المرور غير صحيحة لحساب ${account.titleAr}.`);
            } else {
              setAuthError(
                createErr instanceof Error ? createErr.message : 'تعذر تهيئة الحساب التنفيذي.'
              );
            }
          }
        } else {
          setAuthError(`بيانات الدخول غير صحيحة لحساب ${account.titleAr}.`);
        }
      } else if (code === 'auth/wrong-password') {
        setAuthError(`كلمة المرور غير صحيحة لحساب ${account.titleAr}.`);
      } else if (code === 'auth/too-many-requests') {
        setAuthError('تم تجاوز عدد محاولات الدخول المسموح بها مؤقتاً. يرجى المحاولة بعد قليل.');
      } else {
        setAuthError(err instanceof Error ? err.message : 'تعذر تسجيل الدخول.');
      }
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    setAuthError(null);
    await signOut(auth);
  }, []);

  const saveProfilePreferences = useCallback(
    async (patch: Partial<Omit<UserProfilePreferences, 'activeRole'>>) => {
      if (!user) return;
      const safeUid = sanitizeId(user.uid, 128);
      const userPath = `users/${safeUid}`;
      try {
        const payload: Record<string, unknown> = {
          updatedAt: serverTimestamp(),
        };
        if (patch.displayName !== undefined) {
          payload.displayName = clampStr(patch.displayName, 120, 'حساب تنفيذي');
        }
        if (patch.preferredPeriod !== undefined) {
          payload.preferredPeriod = clampStr(patch.preferredPeriod, 16, '2026-Q3');
        }
        if (patch.preferredBranch !== undefined) {
          payload.preferredBranch = clampStr(patch.preferredBranch, 64, 'all');
        }
        if (patch.favoriteReportIds !== undefined) {
          payload.favoriteReportIds = patch.favoriteReportIds
            .slice(0, 20)
            .map((id) => clampStr(id, 64, 'rep'));
        }
        if (patch.recentReportIds !== undefined) {
          payload.recentReportIds = patch.recentReportIds
            .slice(0, 10)
            .map((id) => clampStr(id, 64, 'rep'));
        }
        await updateDoc(doc(db, 'users', safeUid), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userPath);
      }
    },
    [user]
  );

  const saveDecisionToFirestore = useCallback(
    async (decision: DecisionCase, isNew: boolean) => {
      if (!user) return;
      const safeUid = sanitizeId(user.uid, 128);
      const safeDecId = sanitizeId(decision.id, 64);
      const path = `workspaces/${WORKSPACE_ID}/decisions/${safeDecId}`;
      const ref = doc(db, 'workspaces', WORKSPACE_ID, 'decisions', safeDecId);

      const safeNotes = (decision.executionNotes ?? [])
        .slice(0, 50)
        .map((n) => clampStr(n, 400, 'ملاحظة'));

      const payload: Record<string, unknown> = {
        id: safeDecId,
        workspaceId: WORKSPACE_ID,
        createdByUid: safeUid,
        title: clampStr(decision.title, 240, 'قضية اقتصادية'),
        category: clampStr(decision.category, 100, 'الربحية والهوامش'),
        stage: decision.stage,
        severity: decision.severity,
        ownerRole: decision.ownerRole,
        branchScope: clampStr(decision.branchScope, 64, 'بغداد'),
        period: clampStr(decision.period, 24, '2026-Q3'),
        detectedMetric: clampStr(decision.detectedMetric, 160, 'مؤشر اقتصادي'),
        baselineValue: clampStr(decision.baselineValue, 120, 'غير محدد'),
        currentValue: clampStr(decision.currentValue, 120, 'مرصود'),
        estimatedFinancialImpact: Number(decision.estimatedFinancialImpact ?? 0),
        verificationStatus: decision.verificationStatus,
        diagnosisSummary: clampStr(decision.diagnosisSummary, 1000, 'ملخص التشخيص'),
        epistemicLevel: decision.epistemicLevel,
        proposedAction: clampStr(decision.proposedAction, 1000, 'الإجراء المقترح'),
        requiresOwnerApproval: Boolean(decision.requiresOwnerApproval),
        approvalStatus: decision.approvalStatus,
        dueDate: clampStr(decision.dueDate, 32, '2026-12-08'),
        executionNotes: safeNotes,
        updatedAt: serverTimestamp(),
      };

      if (decision.approvedBy) {
        payload.approvedBy = clampStr(decision.approvedBy, 120, 'المالك');
      }
      if (decision.outcomeMeasurement) {
        payload.outcomeMeasurement = {
          postActionValue: clampStr(decision.outcomeMeasurement.postActionValue, 200, '—'),
          deltaObserved: clampStr(decision.outcomeMeasurement.deltaObserved, 400, '—'),
          attributionConfidence: clampStr(decision.outcomeMeasurement.attributionConfidence, 240, 'مرتفعة'),
          verdict: decision.outcomeMeasurement.verdict,
        };
      }

      try {
        if (isNew) {
          payload.createdAt = serverTimestamp();
          await setDoc(ref, payload);
        } else {
          const existingSnap = await getDoc(ref);
          if (!existingSnap.exists()) {
            payload.createdAt = serverTimestamp();
            await setDoc(ref, payload);
          } else {
            const updatePatch: Record<string, unknown> = {
              stage: payload.stage,
              executionNotes: payload.executionNotes,
              updatedAt: serverTimestamp(),
            };
            if (decision.approvalStatus !== existingSnap.data().approvalStatus) {
              updatePatch.approvalStatus = payload.approvalStatus;
            }
            if (payload.approvedBy !== undefined) {
              updatePatch.approvedBy = payload.approvedBy;
            }
            if (payload.epistemicLevel !== existingSnap.data().epistemicLevel) {
              updatePatch.epistemicLevel = payload.epistemicLevel;
            }
            if (payload.outcomeMeasurement !== undefined) {
              updatePatch.outcomeMeasurement = payload.outcomeMeasurement;
            }
            await updateDoc(ref, updatePatch);
          }
        }
      } catch (error) {
        handleFirestoreError(error, isNew ? OperationType.CREATE : OperationType.UPDATE, path);
      }
    },
    [user]
  );

  const saveAlertRuleToFirestore = useCallback(
    async (rule: AlertThresholdRule) => {
      if (!user) return;
      const safeUid = sanitizeId(user.uid, 128);
      const safeRuleId = sanitizeId(rule.id, 64);
      const path = `workspaces/${WORKSPACE_ID}/alertRules/${safeRuleId}`;
      const ref = doc(db, 'workspaces', WORKSPACE_ID, 'alertRules', safeRuleId);

      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: safeRuleId,
            workspaceId: WORKSPACE_ID,
            createdByUid: safeUid,
            metricKey: sanitizeId(rule.metricKey, 64),
            metricLabel: clampStr(rule.metricLabel, 120, rule.metricKey),
            unit: rule.unit,
            comparator: rule.comparator,
            threshold: Math.max(0, Math.min(1000000, Number(rule.threshold))),
            enabled: Boolean(rule.enabled),
            updatedBy: rule.updatedBy,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            threshold: Math.max(0, Math.min(1000000, Number(rule.threshold))),
            comparator: rule.comparator,
            enabled: Boolean(rule.enabled),
            updatedBy: rule.updatedBy,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [user]
  );

  const saveAlertStatesToFirestore = useCallback(
    async (entries: Array<{ alertKey: string; status: 'acknowledged' | 'escalated'; by: string }>) => {
      if (!user || entries.length === 0) return;
      const safeUid = sanitizeId(user.uid, 128);

      for (const item of entries) {
        const docId = hashSafeId('AST', item.alertKey);
        const path = `workspaces/${WORKSPACE_ID}/alertStates/${docId}`;
        const ref = doc(db, 'workspaces', WORKSPACE_ID, 'alertStates', docId);
        try {
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            await setDoc(ref, {
              id: docId,
              workspaceId: WORKSPACE_ID,
              createdByUid: safeUid,
              alertKey: clampStr(item.alertKey, 160, docId),
              status: item.status,
              by: clampStr(item.by, 100, 'المستخدم'),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(ref, {
              status: item.status,
              by: clampStr(item.by, 100, 'المستخدم'),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, path);
        }
      }
    },
    [user]
  );

  const appendWorkspaceLog = useCallback(
    async (entry: { actorRole: RoleId; action: string; target: string; detail: string }) => {
      if (!user) return;
      const safeUid = sanitizeId(user.uid, 128);
      const logId = `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const path = `workspaces/${WORKSPACE_ID}/workspaceLogs/${logId}`;
      try {
        await setDoc(doc(db, 'workspaces', WORKSPACE_ID, 'workspaceLogs', logId), {
          id: logId,
          workspaceId: WORKSPACE_ID,
          createdByUid: safeUid,
          actorRole: entry.actorRole,
          action: clampStr(entry.action, 160, 'نشاط'),
          target: clampStr(entry.target, 120, 'النظام'),
          detail: clampStr(entry.detail, 400, 'تم تنفيذ الإجراء.'),
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    },
    [user]
  );

  const saveRolePermission = useCallback(
    async (policy: RoleAccessPolicy) => {
      if (!user || activeAccount?.roleId !== 'owner') {
        throw new Error('تعديل صلاحيات الوصول المخصصة متاح للمالك / Admin فقط.');
      }
      const safeUid = sanitizeId(user.uid, 128);
      const roleId = policy.id;
      const path = `workspaces/${WORKSPACE_ID}/rolePermissions/${roleId}`;
      const ref = doc(db, 'workspaces', WORKSPACE_ID, 'rolePermissions', roleId);

      const validBranches = policy.allowedBranches.filter((b) => COMPANY_BRANCHES.includes(b));
      const safeBranches = validBranches.length > 0 ? validBranches.slice(0, 10) : ['بغداد'];
      const safeSections = policy.allowedSections
        .filter((s) => COMPANY_DIVISIONS.some((d) => d.id === s))
        .slice(0, 6);
      const safeCategories = policy.allowedReportCategories
        .filter((c) => REPORT_CATEGORIES.includes(c))
        .slice(0, 10);
      const safeEmail = clampStr(user.email ?? activeAccount.email, 254, activeAccount.email);

      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: roleId,
            workspaceId: WORKSPACE_ID,
            createdByUid: safeUid,
            roleTitleAr: clampStr(policy.roleTitleAr, 80, DEFAULT_ROLE_PERMISSIONS[roleId].roleTitleAr),
            allowedSections: safeSections,
            allowedBranches: safeBranches,
            allowedReportCategories: safeCategories,
            canViewFinancialMargins: Boolean(policy.canViewFinancialMargins),
            canViewTrustVault: Boolean(policy.canViewTrustVault),
            canViewAuditLogs: Boolean(policy.canViewAuditLogs),
            canRunAiAnalysis: Boolean(policy.canRunAiAnalysis),
            canExportReports: Boolean(policy.canExportReports),
            canManageAlerts: Boolean(policy.canManageAlerts),
            canResolveConflicts: Boolean(policy.canResolveConflicts),
            canCreateDecisions: Boolean(policy.canCreateDecisions),
            updatedByEmail: safeEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            roleTitleAr: clampStr(policy.roleTitleAr, 80, DEFAULT_ROLE_PERMISSIONS[roleId].roleTitleAr),
            allowedSections: safeSections,
            allowedBranches: safeBranches,
            allowedReportCategories: safeCategories,
            canViewFinancialMargins: Boolean(policy.canViewFinancialMargins),
            canViewTrustVault: Boolean(policy.canViewTrustVault),
            canViewAuditLogs: Boolean(policy.canViewAuditLogs),
            canRunAiAnalysis: Boolean(policy.canRunAiAnalysis),
            canExportReports: Boolean(policy.canExportReports),
            canManageAlerts: Boolean(policy.canManageAlerts),
            canResolveConflicts: Boolean(policy.canResolveConflicts),
            canCreateDecisions: Boolean(policy.canCreateDecisions),
            updatedByEmail: safeEmail,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [user, activeAccount]
  );

  const resetRolePermission = useCallback(
    async (roleId: ManagedRoleId) => {
      await saveRolePermission({
        ...DEFAULT_ROLE_PERMISSIONS[roleId],
        updatedAt: new Date().toISOString(),
      });
    },
    [saveRolePermission]
  );

  const saveBudgetPermission = useCallback(
    async (policy: BudgetAccessPolicy) => {
      if (!user || (activeAccount?.roleId !== 'finance' && activeAccount?.roleId !== 'owner')) {
        throw new Error('تحديد بنود الميزانية وتفعيل الرقابة المالية متاح للمدير المالي أو المالك فقط.');
      }
      const safeUid = sanitizeId(user.uid, 128);
      const roleId = policy.id;
      const path = `workspaces/${WORKSPACE_ID}/budgetPermissions/${roleId}`;
      const ref = doc(db, 'workspaces', WORKSPACE_ID, 'budgetPermissions', roleId);

      const safeItems = Array.from(
        new Set(policy.allowedBudgetItems.filter((item) => VALID_BUDGET_ITEM_IDS.includes(item)))
      ).slice(0, 10);
      const safeEmail = clampStr(user.email ?? activeAccount.email, 254, activeAccount.email);
      const updatedByRole: 'finance' | 'owner' = activeAccount.roleId === 'owner' ? 'owner' : 'finance';

      try {
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            id: roleId,
            workspaceId: WORKSPACE_ID,
            createdByUid: safeUid,
            roleTitleAr: clampStr(policy.roleTitleAr, 80, DEFAULT_BUDGET_PERMISSIONS[roleId].roleTitleAr),
            allowedBudgetItems: safeItems,
            strictControlEnabled: Boolean(policy.strictControlEnabled),
            updatedByRole,
            updatedByEmail: safeEmail,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await updateDoc(ref, {
            roleTitleAr: clampStr(policy.roleTitleAr, 80, DEFAULT_BUDGET_PERMISSIONS[roleId].roleTitleAr),
            allowedBudgetItems: safeItems,
            strictControlEnabled: Boolean(policy.strictControlEnabled),
            updatedByRole,
            updatedByEmail: safeEmail,
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
    [user, activeAccount]
  );

  const resetBudgetPermission = useCallback(
    async (roleId: BudgetControlledRoleId) => {
      await saveBudgetPermission({
        ...DEFAULT_BUDGET_PERMISSIONS[roleId],
        updatedByRole: activeAccount?.roleId === 'owner' ? 'owner' : 'finance',
        updatedAt: new Date().toISOString(),
      });
    },
    [saveBudgetPermission, activeAccount]
  );

  const seedAttemptedRef = React.useRef<string | null>(null);
  const seedWorkspaceIfEmpty = useCallback(
    async (decisions: DecisionCase[], alertRules: AlertThresholdRule[]) => {
      if (!user || !profileReady || persistedDecisions === null || persistedAlertRules === null) return;
      if (seedAttemptedRef.current === user.uid) return;
      seedAttemptedRef.current = user.uid;

      if (persistedDecisions.length === 0) {
        for (const d of decisions) {
          const existingSnap = await getDoc(doc(db, 'workspaces', WORKSPACE_ID, 'decisions', sanitizeId(d.id, 64)));
          if (!existingSnap.exists()) {
            await saveDecisionToFirestore(d, true);
          }
        }
      }
      if (persistedAlertRules.length === 0) {
        for (const r of alertRules) {
          await saveAlertRuleToFirestore(r);
        }
      }
      if (activeAccount?.roleId === 'owner') {
        for (const roleId of ['operations', 'finance', 'sales'] as ManagedRoleId[]) {
          const permRef = doc(db, 'workspaces', WORKSPACE_ID, 'rolePermissions', roleId);
          const permSnap = await getDoc(permRef);
          if (!permSnap.exists()) {
            await saveRolePermission(DEFAULT_ROLE_PERMISSIONS[roleId]);
          }
        }
      }
      if (activeAccount?.roleId === 'owner' || activeAccount?.roleId === 'finance') {
        for (const roleId of ['operations', 'sales'] as BudgetControlledRoleId[]) {
          const budgetRef = doc(db, 'workspaces', WORKSPACE_ID, 'budgetPermissions', roleId);
          const budgetSnap = await getDoc(budgetRef);
          if (!budgetSnap.exists()) {
            await saveBudgetPermission(DEFAULT_BUDGET_PERMISSIONS[roleId]);
          }
        }
      }
    },
    [
      user,
      activeAccount,
      profileReady,
      persistedDecisions,
      persistedAlertRules,
      saveDecisionToFirestore,
      saveAlertRuleToFirestore,
      saveRolePermission,
      saveBudgetPermission,
    ]
  );

  return (
    <FirebaseContext.Provider
      value={{
        user,
        activeAccount,
        accountRole: activeAccount?.roleId ?? null,
        authReady,
        connectionOk,
        firestoreSynced,
        signingIn,
        authError,
        needsEmailProviderSetup,
        profile,
        persistedDecisions,
        persistedAlertRules,
        persistedAlertStates,
        persistedLogs,
        rolePermissions,
        rolePermissionsLoaded,
        budgetPermissions,
        budgetPermissionsLoaded,
        signInWithAccount,
        signOutUser,
        saveProfilePreferences,
        seedWorkspaceIfEmpty,
        saveDecisionToFirestore,
        saveAlertRuleToFirestore,
        saveAlertStatesToFirestore,
        saveRolePermission,
        resetRolePermission,
        saveBudgetPermission,
        resetBudgetPermission,
        appendWorkspaceLog,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside FirebaseProvider');
  }
  return ctx;
}
