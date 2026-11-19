export type RoleId = 'owner' | 'finance' | 'operations' | 'commercial' | 'sales';

export type WorkspaceSection = 'home' | 'reports' | 'analysis' | 'decisions' | 'data' | 'trust';

export type VerificationStatus = 'verified' | 'partial' | 'rejected';

export type DeploymentMode = 'hybrid' | 'fully_private' | 'managed_cloud';

export type EpistemicLevel =
  | 'calculated_fact'
  | 'analytical_conclusion'
  | 'hypothesis'
  | 'recommendation'
  | 'execution_outcome';

export type DecisionStage =
  | 'detection'
  | 'verification'
  | 'diagnosis'
  | 'decision_design'
  | 'assignment_approval'
  | 'execution'
  | 'outcome_measurement';

export type SourceType = 'database_direct' | 'data_warehouse' | 'watched_folder' | 'manual_upload';

export interface RoleDefinition {
  id: RoleId;
  code: string;
  titleAr: string;
  workspaceName: string;
  description: string;
  dataScopes: string[];
  allowedActions: Array<'view' | 'analyze' | 'export' | 'comment' | 'propose' | 'approve' | 'admin'>;
}

export interface DataSourceConfig {
  id: string;
  name: string;
  type: SourceType;
  engineLabel: string;
  readOnly: boolean;
  priority: number;
  connectionSummary: string;
  tablesOrPath: string[];
  schedule: string;
  lastSyncAt: string;
  status: 'connected' | 'watching' | 'standby';
  recordCount: number;
}

export interface VerificationCheckItem {
  ruleName: string;
  passed: boolean;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
}

export interface IngestionBatch {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  importedBy: string;
  importedAt: string;
  period: string;
  fileHash: string;
  rowCount: number;
  status: VerificationStatus;
  coverageNote: string;
  checks: VerificationCheckItem[];
  blockedMetrics: string[];
}

export interface SourceConflict {
  id: string;
  period: string;
  branch: string;
  metricKey: string;
  metricLabel: string;
  primarySourceId: string;
  primarySourceName: string;
  primaryValue: number;
  secondarySourceId: string;
  secondarySourceName: string;
  secondaryValue: number;
  variancePct: number;
  status: 'pending' | 'resolved_primary' | 'resolved_secondary';
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface EconomicTransaction {
  id: string;
  period: string;
  branch: string;
  channel: string;
  customer: string;
  product: string;
  supplier: string;
  unitsSold: number;
  listPrice: number;
  grossRevenue: number;
  discountAmount: number;
  netRevenue: number;
  cogs: number;
  variableCost: number | null;
  opexAllocated: number | null;
  inventoryValue: number;
  inventoryDays: number;
  arBalance: number;
  arDays: number;
  wasteCost: number;
  slaFulfillmentPct: number;
  sourceId: string;
  verificationStatus: VerificationStatus;
}

export interface KpiProvenance {
  key: string;
  label: string;
  value: number | null;
  formattedValue: string;
  unit: string;
  deltaPct: number | null;
  deltaLabel: string;
  trendDirection: 'up' | 'down' | 'flat';
  favorable: boolean;
  source: string;
  period: string;
  lastUpdated: string;
  formula: string;
  verificationStatus: VerificationStatus;
  unavailableReason?: string;
}

export interface VarianceBridgeStep {
  label: string;
  amount: number;
  type: 'base' | 'positive' | 'negative' | 'total';
  explanation: string;
}

export interface EntityProfitabilityRow {
  entityName: string;
  entityType: 'product' | 'customer' | 'channel' | 'supplier' | 'branch';
  netRevenue: number;
  discountRatePct: number;
  grossMarginPct: number;
  contributionMarginPct: number | null;
  trappedCapital: number;
  status: 'healthy' | 'watch' | 'leakage';
}

export interface ReportComparisonMetric {
  key: string;
  label: string;
  value: number;
  unit: 'م.د.ع' | '%' | 'يوم';
}

export interface ReportForecastPoint {
  period: string;
  actual: number | null;
  forecast: number | null;
  lowerBound: number | null;
  upperBound: number | null;
}

export interface ReportForecastMetricSeries {
  metricKey: string;
  metricLabel: string;
  unit: 'م.د.ع' | '%' | 'يوم';
  slopePerQuarter: number;
  trendLabel: string;
  points: ReportForecastPoint[];
}

export interface ReportDefinition {
  id: string;
  roleScope: RoleId[];
  ownerPrivate?: boolean;
  category: string;
  title: string;
  summary: string;
  period: string;
  dataScope: string;
  confidenceStatus: VerificationStatus;
  confidenceLabel: string;
  resultHeadline: string;
  resultValue: string;
  causes: Array<{ text: string; level: EpistemicLevel }>;
  evidence: Array<{ metric: string; value: string; source: string; status: VerificationStatus }>;
  comparisonMetrics?: ReportComparisonMetric[];
  forecastSeries?: ReportForecastMetricSeries[];
  risks: string[];
  suggestedActions: Array<{ action: string; expectedImpact: string; ownerRole: RoleId }>;
  isSupportedByData: boolean;
  missingDataNote?: string;
}

export interface DecisionCase {
  id: string;
  title: string;
  category: string;
  stage: DecisionStage;
  severity: 'high' | 'medium' | 'low';
  ownerRole: RoleId;
  branchScope: string;
  period: string;
  detectedMetric: string;
  baselineValue: string;
  currentValue: string;
  estimatedFinancialImpact: number;
  verificationStatus: VerificationStatus;
  diagnosisSummary: string;
  epistemicLevel: EpistemicLevel;
  proposedAction: string;
  requiresOwnerApproval: boolean;
  approvalStatus: 'pending_review' | 'approved' | 'rejected' | 'not_required';
  approvedBy?: string;
  dueDate: string;
  executionNotes: string[];
  outcomeMeasurement?: {
    postActionValue: string;
    deltaObserved: string;
    attributionConfidence: string;
    verdict: 'improved' | 'unchanged' | 'worsened';
  };
  createdAt: string;
  updatedAt: string;
}

export interface TrustVaultEntry {
  token: string;
  entityType: 'COMPANY' | 'CUSTOMER' | 'SUPPLIER' | 'PRODUCT' | 'BRANCH';
  realName: string;
  createdAt: string;
}

export interface AiAnalysisResponse {
  epistemicSummary: Array<{
    statement: string;
    level: EpistemicLevel;
    verifiedAgainstEngine: boolean;
    verificationNote?: string;
  }>;
  executiveNarrative: string;
  tokenizedPromptPreview: string;
  rawModelResponsePreview: string;
  restoredTokensCount: number;
  deploymentMode: DeploymentMode;
  modelUsed: string;
}

export interface WeeklyBrief {
  generatedAt: string;
  period: string;
  improved: string[];
  declined: string[];
  topEconomicIssues: string[];
  evidenceBackedCauses: string[];
  decisionsNeedingOwner: string[];
  delayedActions: string[];
  changesSinceLastBrief: string[];
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorRole: RoleId;
  action: string;
  target: string;
  detail: string;
}

export interface AlertThresholdRule {
  id: string;
  metricKey: string;
  metricLabel: string;
  unit: 'م.د.ع' | '%' | 'يوم';
  comparator: 'gt' | 'lt';
  threshold: number;
  enabled: boolean;
  updatedBy: RoleId;
  updatedAt: string;
}

export interface ProactiveAlertNotification {
  id: string;
  reportId: string;
  reportTitle: string;
  reportCategory: string;
  metricKey: string;
  metricLabel: string;
  unit: 'م.د.ع' | '%' | 'يوم';
  actualValue: number;
  thresholdValue: number;
  comparator: 'gt' | 'lt';
  deviationAmount: number;
  deviationPct: number;
  severity: 'critical' | 'warning';
  status: 'active' | 'acknowledged' | 'escalated';
  period: string;
  branchScope: string;
  recommendedAction: string;
  targetRole: RoleId;
  detectedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export type ManagedRoleId = 'operations' | 'finance' | 'sales';

export type BudgetControlledRoleId = 'operations' | 'sales';

export type BudgetLineItemId =
  | 'revenue_budget'
  | 'cogs_budget'
  | 'discounts_budget'
  | 'opex_budget'
  | 'variable_cost_budget'
  | 'inventory_budget'
  | 'ar_credit_budget'
  | 'waste_budget';

export interface BudgetLineItemDef {
  id: BudgetLineItemId;
  code: string;
  titleAr: string;
  categoryAr: string;
  description: string;
  quarterlyAllocationM: number;
  actualSpentM: number;
  sensitiveLevel: 'high' | 'medium' | 'standard';
  mappedMetricKeys: string[];
}

export interface BudgetAccessPolicy {
  id: BudgetControlledRoleId;
  roleTitleAr: string;
  allowedBudgetItems: BudgetLineItemId[];
  strictControlEnabled: boolean;
  updatedByRole: 'finance' | 'owner';
  updatedByEmail?: string;
  updatedAt: string;
}

export interface RoleAccessPolicy {
  id: ManagedRoleId;
  roleTitleAr: string;
  allowedSections: WorkspaceSection[];
  allowedBranches: string[];
  allowedReportCategories: string[];
  canViewFinancialMargins: boolean;
  canViewTrustVault: boolean;
  canViewAuditLogs: boolean;
  canRunAiAnalysis: boolean;
  canExportReports: boolean;
  canManageAlerts: boolean;
  canResolveConflicts: boolean;
  canCreateDecisions: boolean;
  updatedByEmail?: string;
  updatedAt: string;
}

export interface DashboardPayload {
  role: RoleDefinition;
  deploymentMode: DeploymentMode;
  filters: {
    period: string;
    branch: string;
    availablePeriods: string[];
    availableBranches: string[];
  };
  kpis: KpiProvenance[];
  weeklyBrief: WeeklyBrief;
  varianceBridge: VarianceBridgeStep[];
  entityMatrix: EntityProfitabilityRow[];
  reports: ReportDefinition[];
  decisions: DecisionCase[];
  sources: DataSourceConfig[];
  batches: IngestionBatch[];
  conflicts: SourceConflict[];
  alertRules: AlertThresholdRule[];
  proactiveAlerts: ProactiveAlertNotification[];
  trustVaultCount: number;
  trustVaultSample: TrustVaultEntry[];
  auditLogs: AuditLogEntry[];
  favorites: string[];
  recentReports: string[];
  activePolicy?: RoleAccessPolicy;
  activeBudgetPolicy?: BudgetAccessPolicy;
}
