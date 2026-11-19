import fs from 'fs';
import path from 'path';
import {
  AlertThresholdRule,
  AuditLogEntry,
  DataSourceConfig,
  DecisionCase,
  DeploymentMode,
  EconomicTransaction,
  IngestionBatch,
  RoleId,
  SourceConflict,
  TrustVaultEntry,
} from '../src/types.ts';
import {
  DEFAULT_DEPLOYMENT_MODE,
  INITIAL_ALERT_RULES,
  INITIAL_AUDIT_LOGS,
  INITIAL_BATCHES,
  INITIAL_CONFLICTS,
  INITIAL_DECISIONS,
  INITIAL_SOURCES,
  INITIAL_TRANSACTIONS,
  INITIAL_TRUST_VAULT,
} from './seedData.ts';

export interface AlertStateRecord {
  status: 'acknowledged' | 'escalated';
  by: string;
  at: string;
}

export interface EnterpriseStoreState {
  deploymentMode: DeploymentMode;
  sources: DataSourceConfig[];
  transactions: EconomicTransaction[];
  batches: IngestionBatch[];
  conflicts: SourceConflict[];
  decisions: DecisionCase[];
  trustVault: TrustVaultEntry[];
  auditLogs: AuditLogEntry[];
  favoritesByRole: Record<RoleId, string[]>;
  recentReportsByRole: Record<RoleId, string[]>;
  processedFileHashes: string[];
  alertRules: AlertThresholdRule[];
  alertStates: Record<string, AlertStateRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'owner_ai_store.json');
export const WATCHED_FOLDER_PATH = path.resolve(process.cwd(), 'OWNER_AI_DATA');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(WATCHED_FOLDER_PATH)) {
    fs.mkdirSync(WATCHED_FOLDER_PATH, { recursive: true });
    // Place a clean README/sample template inside OWNER_AI_DATA so the watched directory is real on disk
    const sampleCsv = [
      'period,branch,channel,customer,product,supplier,unitsSold,listPrice,discountAmount,cogs,variableCost,opexAllocated,inventoryValue,inventoryDays,arBalance,arDays,wasteCost,slaFulfillmentPct',
      '2026-Q3,البصرة,الجملة المباشرة,العميل النور,منتج روابي,المورد الأصيل,1500,12500,900000,11800000,1450000,1100000,7200000,34,3500000,29,180000,97.2',
    ].join('\n');
    fs.writeFileSync(path.join(WATCHED_FOLDER_PATH, 'README_TEMPLATE.txt'),
      'OWNER AI Enterprise Watched Folder (OWNER_AI_DATA)\nDrop .csv, .xlsx, or .json files here for automatic deduplicated ingestion and verification.\n',
      'utf8'
    );
    fs.writeFileSync(path.join(WATCHED_FOLDER_PATH, 'sample_basra_adjustment.csv.example'), sampleCsv, 'utf8');
  }
}

function createInitialState(): EnterpriseStoreState {
  return {
    deploymentMode: DEFAULT_DEPLOYMENT_MODE,
    sources: structuredClone(INITIAL_SOURCES),
    transactions: structuredClone(INITIAL_TRANSACTIONS),
    batches: structuredClone(INITIAL_BATCHES),
    conflicts: structuredClone(INITIAL_CONFLICTS),
    decisions: structuredClone(INITIAL_DECISIONS),
    trustVault: structuredClone(INITIAL_TRUST_VAULT),
    auditLogs: structuredClone(INITIAL_AUDIT_LOGS),
    favoritesByRole: {
      owner: ['rep_owner_exec', 'rep_owner_leakage'],
      finance: ['rep_fin_profit', 'rep_fin_ar'],
      operations: ['rep_ops_inventory', 'rep_ops_waste'],
      commercial: ['rep_com_margin', 'rep_com_discount'],
      sales: ['rep_sales_target', 'rep_sales_region'],
    },
    recentReportsByRole: {
      owner: ['rep_owner_exec'],
      finance: ['rep_fin_profit'],
      operations: ['rep_ops_inventory'],
      commercial: ['rep_com_margin'],
      sales: ['rep_sales_target'],
    },
    processedFileHashes: INITIAL_BATCHES.map((b) => b.fileHash),
    alertRules: structuredClone(INITIAL_ALERT_RULES),
    alertStates: {},
  };
}

let cachedState: EnterpriseStoreState | null = null;

export function loadStore(): EnterpriseStoreState {
  ensureDirectories();
  if (cachedState) return cachedState;

  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as EnterpriseStoreState;
      let mutated = false;
      const hasQ1 = parsed.transactions.some((t) => t.period === '2026-Q1');
      if (!hasQ1) {
        const q1Seed = structuredClone(INITIAL_TRANSACTIONS.filter((t) => t.period === '2026-Q1'));
        parsed.transactions = [...q1Seed, ...parsed.transactions];
        mutated = true;
      }
      if (!Array.isArray(parsed.alertRules) || parsed.alertRules.length === 0) {
        parsed.alertRules = structuredClone(INITIAL_ALERT_RULES);
        mutated = true;
      }
      if (!parsed.alertStates) {
        parsed.alertStates = {};
        mutated = true;
      }
      if (mutated) {
        saveStore(parsed);
        return parsed;
      }
      cachedState = parsed;
      return cachedState;
    } catch {
      // Fallback to fresh initial state if corrupted
    }
  }
  cachedState = createInitialState();
  saveStore(cachedState);
  return cachedState;
}

export function saveStore(state: EnterpriseStoreState): void {
  ensureDirectories();
  cachedState = state;
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export function appendAuditLog(
  state: EnterpriseStoreState,
  actorRole: RoleId,
  action: string,
  target: string,
  detail: string
): void {
  const entry: AuditLogEntry = {
    id: `AUD-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actorRole,
    action,
    target,
    detail,
  };
  state.auditLogs.unshift(entry);
  if (state.auditLogs.length > 100) {
    state.auditLogs = state.auditLogs.slice(0, 100);
  }
}
