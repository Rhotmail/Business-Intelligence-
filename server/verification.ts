import crypto from 'crypto';
import {
  EconomicTransaction,
  IngestionBatch,
  SourceConflict,
  SourceType,
  VerificationCheckItem,
  VerificationStatus,
} from '../src/types.ts';
import { EnterpriseStoreState } from './storage.ts';

export interface RawIngestRow {
  period?: string;
  branch?: string;
  channel?: string;
  customer?: string;
  product?: string;
  supplier?: string;
  unitsSold?: number | string;
  listPrice?: number | string;
  discountAmount?: number | string;
  cogs?: number | string;
  variableCost?: number | string | null;
  opexAllocated?: number | string | null;
  inventoryValue?: number | string;
  inventoryDays?: number | string;
  arBalance?: number | string;
  arDays?: number | string;
  wasteCost?: number | string;
  slaFulfillmentPct?: number | string;
}

export function computeContentHash(content: string | Buffer): string {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function toNum(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function verifyAndStageRows(
  rows: RawIngestRow[],
  meta: {
    sourceId: string;
    sourceName: string;
    sourceType: SourceType;
    importedBy: string;
    fileHash: string;
  },
  state: EnterpriseStoreState
): {
  batch: IngestionBatch;
  acceptedTransactions: EconomicTransaction[];
  detectedConflicts: SourceConflict[];
  duplicateSkipped: boolean;
} {
  if (state.processedFileHashes.includes(meta.fileHash)) {
    const duplicateBatch: IngestionBatch = {
      id: `BATCH-${Date.now().toString().slice(-6)}`,
      sourceId: meta.sourceId,
      sourceName: meta.sourceName,
      sourceType: meta.sourceType,
      importedBy: meta.importedBy,
      importedAt: new Date().toISOString(),
      period: 'غير محدد',
      fileHash: meta.fileHash,
      rowCount: rows.length,
      status: 'rejected',
      coverageNote: 'تم منع الاستيراد المكرر تلقائياً: بصمة الملف مطابقة لدفعة مستوردة مسبقاً.',
      checks: [
        {
          ruleName: 'منع التكرارات وبصمة الملف',
          passed: false,
          severity: 'critical',
          detail: `البصمة ${meta.fileHash} مسجلة مسبقاً في سجل الدفعات.`,
        },
      ],
      blockedMetrics: ['جميع السجلات المكررة'],
    };
    return {
      batch: duplicateBatch,
      acceptedTransactions: [],
      detectedConflicts: [],
      duplicateSkipped: true,
    };
  }

  const checks: VerificationCheckItem[] = [];
  const blockedMetrics: string[] = [];
  let missingCoreCount = 0;
  let negativeAnomalyCount = 0;
  let missingVariableCostCount = 0;
  let missingOpexCount = 0;

  const parsed: EconomicTransaction[] = [];
  const periodsFound = new Set<string>();

  rows.forEach((r, idx) => {
    const period = String(r.period ?? '').trim();
    const branch = String(r.branch ?? '').trim();
    const customer = String(r.customer ?? '').trim();
    const product = String(r.product ?? '').trim();
    const supplier = String(r.supplier ?? 'مورد غير محدد').trim();
    const channel = String(r.channel ?? 'قناة عامة').trim();

    const unitsSold = toNum(r.unitsSold, null);
    const listPrice = toNum(r.listPrice, null);
    const discountAmount = toNum(r.discountAmount, 0) ?? 0;
    const cogs = toNum(r.cogs, null);
    const variableCost = toNum(r.variableCost, null);
    const opexAllocated = toNum(r.opexAllocated, null);

    if (!period || !branch || !customer || !product || unitsSold === null || listPrice === null || cogs === null) {
      missingCoreCount++;
      return;
    }

    if (unitsSold < 0 || listPrice < 0 || cogs < 0 || discountAmount < 0) {
      negativeAnomalyCount++;
      return;
    }

    if (variableCost === null) missingVariableCostCount++;
    if (opexAllocated === null) missingOpexCount++;

    periodsFound.add(period);
    const grossRevenue = unitsSold * listPrice;
    const netRevenue = Math.max(0, grossRevenue - discountAmount);

    parsed.push({
      id: `TX-ING-${Date.now().toString().slice(-5)}-${idx + 1}`,
      period,
      branch,
      channel,
      customer,
      product,
      supplier,
      unitsSold,
      listPrice,
      grossRevenue,
      discountAmount,
      netRevenue,
      cogs,
      variableCost,
      opexAllocated,
      inventoryValue: toNum(r.inventoryValue, 0) ?? 0,
      inventoryDays: toNum(r.inventoryDays, 30) ?? 30,
      arBalance: toNum(r.arBalance, 0) ?? 0,
      arDays: toNum(r.arDays, 30) ?? 30,
      wasteCost: toNum(r.wasteCost, 0) ?? 0,
      slaFulfillmentPct: toNum(r.slaFulfillmentPct, 95) ?? 95,
      sourceId: meta.sourceId,
      verificationStatus: 'verified',
    });
  });

  checks.push({
    ruleName: 'سلامة الحقول والأنواع الأساسية',
    passed: missingCoreCount === 0 && rows.length > 0,
    severity: missingCoreCount > 0 ? 'critical' : 'info',
    detail:
      rows.length === 0
        ? 'الملف لا يحتوي على صفوف بيانات صالحة.'
        : missingCoreCount === 0
        ? `تم التحقق من ${parsed.length} صف مكتمل الحقول الإلزامية.`
        : `${missingCoreCount} صفوف تفتقر إلى حقول إلزامية (الفترة/الفرع/العميل/الصنف/الكمية/التكلفة).`,
  });

  checks.push({
    ruleName: 'رصد القيم الشاذة والسالبة',
    passed: negativeAnomalyCount === 0,
    severity: negativeAnomalyCount > 0 ? 'critical' : 'info',
    detail:
      negativeAnomalyCount === 0
        ? 'جميع الكميات والأسعار والتكاليف ضمن النطاق المنطقي الموجب.'
        : `رصد ${negativeAnomalyCount} سجلات بقيم سالبة غير مفسرة.`,
  });

  checks.push({
    ruleName: 'اكتمال التكاليف المتغيرة لاحتساب هامش المساهمة',
    passed: missingVariableCostCount === 0,
    severity: missingVariableCostCount > 0 ? 'warning' : 'info',
    detail:
      missingVariableCostCount === 0
        ? 'التكاليف المتغيرة مكتملة لجميع الصفوف.'
        : `تغيب التكاليف المتغيرة في ${missingVariableCostCount} صفوف — سيتم حجب هامش المساهمة لها.`,
  });

  checks.push({
    ruleName: 'اكتمال المصروفات التشغيلية (OpEx) لصافي الربح',
    passed: missingOpexCount === 0,
    severity: missingOpexCount > 0 ? 'warning' : 'info',
    detail:
      missingOpexCount === 0
        ? 'المصروفات التشغيلية مخصصة بالكامل.'
        : `تغيب بيانات OpEx في ${missingOpexCount} صفوف — سيُمنع احتساب صافي الربح الموحد لها.`,
  });

  let status: VerificationStatus = 'verified';
  if (rows.length === 0 || parsed.length === 0 || missingCoreCount > rows.length * 0.3 || negativeAnomalyCount > 0) {
    status = 'rejected';
    blockedMetrics.push('جميع المؤشرات المعتمدة لهذه الدفعة');
  } else if (missingCoreCount > 0 || missingVariableCostCount > 0 || missingOpexCount > 0) {
    status = 'partial';
    if (missingVariableCostCount > 0) blockedMetrics.push('هامش المساهمة للبنود ناقصة التكلفة المتغيرة');
    if (missingOpexCount > 0) blockedMetrics.push('صافي الربح للبنود ناقصة OpEx');
  }

  parsed.forEach((tx) => {
    tx.verificationStatus = status;
  });

  // Check for Source Priority Conflicts against higher-priority verified records
  const detectedConflicts: SourceConflict[] = [];
  if (status !== 'rejected') {
    const incomingSource = state.sources.find((s) => s.id === meta.sourceId);
    const incomingPriority = incomingSource?.priority ?? 4;

    for (const tx of parsed) {
      const existingSameScope = state.transactions.filter(
        (e) =>
          e.verificationStatus !== 'rejected' &&
          e.period === tx.period &&
          e.branch === tx.branch &&
          e.product === tx.product &&
          e.sourceId !== tx.sourceId
      );

      if (existingSameScope.length > 0) {
        const existingSource = state.sources.find((s) => s.id === existingSameScope[0].sourceId);
        const existingPriority = existingSource?.priority ?? 1;
        const existingRev = existingSameScope.reduce((acc, item) => acc + item.netRevenue, 0);
        if (Math.abs(existingRev - tx.netRevenue) / Math.max(1, existingRev) > 0.03) {
          const isIncomingHigher = incomingPriority < existingPriority;
          detectedConflicts.push({
            id: `CONF-${Date.now().toString().slice(-5)}-${detectedConflicts.length + 1}`,
            period: tx.period,
            branch: tx.branch,
            metricKey: `net_revenue_${tx.product}`,
            metricLabel: `صافي إيراد ${tx.product} — فرع ${tx.branch}`,
            primarySourceId: isIncomingHigher ? meta.sourceId : existingSameScope[0].sourceId,
            primarySourceName: isIncomingHigher ? meta.sourceName : existingSource?.name ?? 'مصدر ERP',
            primaryValue: isIncomingHigher ? tx.netRevenue : existingRev,
            secondarySourceId: isIncomingHigher ? existingSameScope[0].sourceId : meta.sourceId,
            secondarySourceName: isIncomingHigher ? existingSource?.name ?? 'مصدر حالي' : meta.sourceName,
            secondaryValue: isIncomingHigher ? existingRev : tx.netRevenue,
            variancePct: Number(((Math.abs(existingRev - tx.netRevenue) / Math.max(1, existingRev)) * 100).toFixed(1)),
            status: 'pending',
          });
        }
      }
    }
  }

  const periodLabel = Array.from(periodsFound).join(', ') || '2026-Q3';
  const batch: IngestionBatch = {
    id: `BATCH-${Date.now().toString().slice(-6)}`,
    sourceId: meta.sourceId,
    sourceName: meta.sourceName,
    sourceType: meta.sourceType,
    importedBy: meta.importedBy,
    importedAt: new Date().toISOString(),
    period: periodLabel,
    fileHash: meta.fileHash,
    rowCount: rows.length,
    status,
    coverageNote:
      status === 'verified'
        ? `تم اعتماد ${parsed.length} صف بنجاح ومطابقة التكاليف.`
        : status === 'partial'
        ? `قبول جزئي لـ ${parsed.length} صف مع تقييد المؤشرات التي تفتقر لمدخلاتها.`
        : 'تم رفض الدفعة ومنع دخولها إلى الحسابات المعتمدة لعدم استيفاء شروط السلامة.',
    checks,
    blockedMetrics,
  };

  return {
    batch,
    acceptedTransactions: status === 'rejected' ? [] : parsed,
    detectedConflicts,
    duplicateSkipped: false,
  };
}
