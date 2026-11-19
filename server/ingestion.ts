import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { IngestionBatch, RoleId, SourceConflict, SourceType } from '../src/types.ts';
import { ensureTokenForEntity } from './aiTrust.ts';
import { appendAuditLog, EnterpriseStoreState, saveStore, WATCHED_FOLDER_PATH } from './storage.ts';
import { computeContentHash, RawIngestRow, verifyAndStageRows } from './verification.ts';

function registerNewEntitiesInTrustVault(rows: RawIngestRow[], state: EnterpriseStoreState) {
  for (const r of rows) {
    if (r.customer) ensureTokenForEntity(state, 'CUSTOMER', String(r.customer));
    if (r.product) ensureTokenForEntity(state, 'PRODUCT', String(r.product));
    if (r.supplier) ensureTokenForEntity(state, 'SUPPLIER', String(r.supplier));
    if (r.branch) ensureTokenForEntity(state, 'BRANCH', String(r.branch));
  }
}

export function parseUploadedBuffer(fileName: string, buffer: Buffer): RawIngestRow[] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.json') {
    const parsed = JSON.parse(buffer.toString('utf8'));
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  // Parse .xlsx, .xls, .csv via SheetJS
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json<RawIngestRow>(workbook.Sheets[firstSheet], {
    defval: null,
  });
  return rows;
}

export function ingestStructuredRows(params: {
  rows: RawIngestRow[];
  rawBytesForHash: Buffer | string;
  sourceId: string;
  sourceName: string;
  sourceType: SourceType;
  importedBy: string;
  actorRole: RoleId;
  state: EnterpriseStoreState;
}): {
  batch: IngestionBatch;
  conflictsAdded: SourceConflict[];
  acceptedCount: number;
  duplicateSkipped: boolean;
} {
  const { rows, rawBytesForHash, sourceId, sourceName, sourceType, importedBy, actorRole, state } = params;
  const fileHash = computeContentHash(rawBytesForHash);

  const result = verifyAndStageRows(
    rows,
    { sourceId, sourceName, sourceType, importedBy, fileHash },
    state
  );

  if (!result.duplicateSkipped) {
    state.processedFileHashes.push(fileHash);
    state.batches.unshift(result.batch);

    if (result.acceptedTransactions.length > 0) {
      registerNewEntitiesInTrustVault(rows, state);
      // Only append transactions if there are no conflicting pending records on exact same scope, or append non-conflicting and flag conflicts
      state.transactions.push(...result.acceptedTransactions);
    }

    if (result.detectedConflicts.length > 0) {
      state.conflicts.unshift(...result.detectedConflicts);
    }

    const src = state.sources.find((s) => s.id === sourceId);
    if (src) {
      src.lastSyncAt = new Date().toISOString();
      if (result.acceptedTransactions.length > 0) {
        src.recordCount += result.acceptedTransactions.length;
      }
    }

    appendAuditLog(
      state,
      actorRole,
      `استقبال بيانات (${sourceType})`,
      result.batch.id,
      `${sourceName} — الحالة: ${result.batch.status} (${result.acceptedTransactions.length} سجل معتمد)`
    );
    saveStore(state);
  }

  return {
    batch: result.batch,
    conflictsAdded: result.detectedConflicts,
    acceptedCount: result.acceptedTransactions.length,
    duplicateSkipped: result.duplicateSkipped,
  };
}

export function scanWatchedFolder(actorRole: RoleId, state: EnterpriseStoreState): {
  filesScanned: string[];
  newBatches: IngestionBatch[];
  skippedDuplicates: number;
} {
  const files = fs.existsSync(WATCHED_FOLDER_PATH) ? fs.readdirSync(WATCHED_FOLDER_PATH) : [];
  const supported = files.filter((f) => ['.csv', '.xlsx', '.xls', '.json'].includes(path.extname(f).toLowerCase()));

  const newBatches: IngestionBatch[] = [];
  let skippedDuplicates = 0;

  for (const fileName of supported) {
    const fullPath = path.join(WATCHED_FOLDER_PATH, fileName);
    const buffer = fs.readFileSync(fullPath);
    const hash = computeContentHash(buffer);

    if (state.processedFileHashes.includes(hash)) {
      skippedDuplicates++;
      continue;
    }

    const rows = parseUploadedBuffer(fileName, buffer);
    const outcome = ingestStructuredRows({
      rows,
      rawBytesForHash: buffer,
      sourceId: 'src_watched_folder',
      sourceName: `المجلد المراقَب — ${fileName}`,
      sourceType: 'watched_folder',
      importedBy: 'مراقب المجلد التلقائي (OWNER_AI_DATA)',
      actorRole,
      state,
    });

    if (!outcome.duplicateSkipped) {
      newBatches.push(outcome.batch);
    }
  }

  return {
    filesScanned: supported,
    newBatches,
    skippedDuplicates,
  };
}

export function dropSampleFileToWatchedFolder(): string {
  const fileName = `erp_branch_delta_${Date.now().toString().slice(-4)}.csv`;
  const csv = [
    'period,branch,channel,customer,product,supplier,unitsSold,listPrice,discountAmount,cogs,variableCost,opexAllocated,inventoryValue,inventoryDays,arBalance,arDays,wasteCost,slaFulfillmentPct',
    `2026-Q3,البصرة,التجزئة المنظمة,مجموعة الفاو التجارية,منتج دجلة المطور,مصنع الرافدين للمواد,1100,15000,750000,10400000,1150000,1050000,6100000,33,2900000,28,150000,97.8`,
  ].join('\n');
  fs.writeFileSync(path.join(WATCHED_FOLDER_PATH, fileName), csv, 'utf8');
  return fileName;
}
