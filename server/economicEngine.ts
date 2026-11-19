import {
  EconomicTransaction,
  EntityProfitabilityRow,
  KpiProvenance,
  ProactiveAlertNotification,
  ReportComparisonMetric,
  ReportDefinition,
  ReportForecastMetricSeries,
  ReportForecastPoint,
  RoleId,
  VarianceBridgeStep,
  VerificationStatus,
  WeeklyBrief,
} from '../src/types.ts';
import { EnterpriseStoreState } from './storage.ts';

export function formatIQD(amount: number): string {
  const millions = amount / 1_000_000;
  if (Math.abs(millions) >= 1) {
    return `${millions.toFixed(1)} م.د.ع`;
  }
  return `${Math.round(amount).toLocaleString('en-US')} د.ع`;
}

export interface AggregatedMetrics {
  grossRevenue: number;
  discountAmount: number;
  discountRatePct: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  contributionProfit: number | null;
  contributionMarginPct: number | null;
  contributionCoverageNote: string;
  netProfit: number | null;
  netMarginPct: number | null;
  netProfitUnavailableReason?: string;
  inventoryValue: number;
  avgInventoryDays: number;
  arBalance: number;
  avgArDays: number;
  trappedCapital: number;
  wasteCost: number;
  avgSlaPct: number;
  cashConversionCycleDays: number;
  overallStatus: VerificationStatus;
}

export function filterTransactions(
  transactions: EconomicTransaction[],
  period: string,
  branch: string
): EconomicTransaction[] {
  return transactions.filter((tx) => {
    if (tx.verificationStatus === 'rejected') return false;
    if (period !== 'all' && tx.period !== period) return false;
    if (branch !== 'all' && branch !== 'الشركة كاملة' && tx.branch !== branch) return false;
    return true;
  });
}

export function aggregateMetrics(rows: EconomicTransaction[]): AggregatedMetrics {
  if (rows.length === 0) {
    return {
      grossRevenue: 0,
      discountAmount: 0,
      discountRatePct: 0,
      netRevenue: 0,
      cogs: 0,
      grossProfit: 0,
      grossMarginPct: 0,
      contributionProfit: null,
      contributionMarginPct: null,
      contributionCoverageNote: 'لا توجد سجلات معتمدة ضمن النطاق المحدد',
      netProfit: null,
      netMarginPct: null,
      netProfitUnavailableReason: 'لا توجد بيانات معتمدة ضمن النطاق المحدد',
      inventoryValue: 0,
      avgInventoryDays: 0,
      arBalance: 0,
      avgArDays: 0,
      trappedCapital: 0,
      wasteCost: 0,
      avgSlaPct: 0,
      cashConversionCycleDays: 0,
      overallStatus: 'partial',
    };
  }

  let grossRevenue = 0;
  let discountAmount = 0;
  let netRevenue = 0;
  let cogs = 0;
  let inventoryValue = 0;
  let arBalance = 0;
  let wasteCost = 0;
  let weightedInvDays = 0;
  let weightedArDays = 0;
  let slaSum = 0;

  let hasAllVariableCost = true;
  let variableCostSum = 0;
  let variableCoveredRevenue = 0;

  let hasAllOpex = true;
  let opexSum = 0;

  let anyPartial = false;

  for (const tx of rows) {
    if (tx.verificationStatus === 'partial') anyPartial = true;
    grossRevenue += tx.grossRevenue;
    discountAmount += tx.discountAmount;
    netRevenue += tx.netRevenue;
    cogs += tx.cogs;
    inventoryValue += tx.inventoryValue;
    arBalance += tx.arBalance;
    wasteCost += tx.wasteCost;
    weightedInvDays += tx.inventoryDays * tx.inventoryValue;
    weightedArDays += tx.arDays * tx.arBalance;
    slaSum += tx.slaFulfillmentPct;

    if (tx.variableCost !== null) {
      variableCostSum += tx.variableCost;
      variableCoveredRevenue += tx.netRevenue;
    } else {
      hasAllVariableCost = false;
    }

    if (tx.opexAllocated !== null) {
      opexSum += tx.opexAllocated;
    } else {
      hasAllOpex = false;
    }
  }

  const grossProfit = netRevenue - cogs;
  const grossMarginPct = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
  const discountRatePct = grossRevenue > 0 ? (discountAmount / grossRevenue) * 100 : 0;

  const contributionProfit =
    hasAllVariableCost || variableCoveredRevenue > 0
      ? netRevenue - cogs - variableCostSum
      : null;
  const contributionMarginPct =
    contributionProfit !== null && netRevenue > 0
      ? (contributionProfit / netRevenue) * 100
      : null;

  const netProfit =
    hasAllOpex && hasAllVariableCost
      ? netRevenue - cogs - variableCostSum - opexSum
      : null;
  const netMarginPct = netProfit !== null && netRevenue > 0 ? (netProfit / netRevenue) * 100 : null;

  const avgInventoryDays = inventoryValue > 0 ? weightedInvDays / inventoryValue : 0;
  const avgArDays = arBalance > 0 ? weightedArDays / arBalance : 0;
  const avgSlaPct = rows.length > 0 ? slaSum / rows.length : 0;
  const estimatedPayableDays = 28;
  const cashConversionCycleDays = Math.round(avgInventoryDays + avgArDays - estimatedPayableDays);

  // Capital trapped in inventory > 45 days and AR > 40 days
  const trappedInventory = rows.reduce(
    (sum, r) => sum + (r.inventoryDays > 45 ? r.inventoryValue * ((r.inventoryDays - 45) / r.inventoryDays) : 0),
    0
  );
  const trappedAr = rows.reduce(
    (sum, r) => sum + (r.arDays > 40 ? r.arBalance * ((r.arDays - 40) / r.arDays) : 0),
    0
  );

  return {
    grossRevenue,
    discountAmount,
    discountRatePct,
    netRevenue,
    cogs,
    grossProfit,
    grossMarginPct,
    contributionProfit,
    contributionMarginPct,
    contributionCoverageNote: hasAllVariableCost
      ? 'تغطية كاملة للتكاليف المتغيرة'
      : 'تغطية جزئية للتكاليف المتغيرة — يُعرض مع بيان الحدود',
    netProfit,
    netMarginPct,
    netProfitUnavailableReason: hasAllOpex
      ? undefined
      : 'معلّق لعدم اكتمال بيانات المصروفات التشغيلية (OpEx) في جزء من النطاق المحدد',
    inventoryValue,
    avgInventoryDays,
    arBalance,
    avgArDays,
    trappedCapital: trappedInventory + trappedAr,
    wasteCost,
    avgSlaPct,
    cashConversionCycleDays,
    overallStatus: anyPartial || !hasAllOpex ? 'partial' : 'verified',
  };
}

function resolvePreviousPeriod(period: string): string {
  if (period === '2026-Q3') return '2026-Q2';
  if (period === '2026-Q2') return '2026-Q1';
  return '2026-Q1';
}

export function buildRoleKpis(
  roleId: RoleId,
  state: EnterpriseStoreState,
  period: string,
  branch: string
): KpiProvenance[] {
  const currentRows = filterTransactions(state.transactions, period, branch);
  const prevPeriod = resolvePreviousPeriod(period);
  const prevRows = filterTransactions(state.transactions, prevPeriod, branch);

  const cur = aggregateMetrics(currentRows);
  const prev = aggregateMetrics(prevRows);
  const lastSync = state.sources[0]?.lastSyncAt ?? new Date().toISOString();

  const revDelta =
    prev.netRevenue > 0 ? ((cur.netRevenue - prev.netRevenue) / prev.netRevenue) * 100 : null;
  const cmDelta =
    cur.contributionMarginPct !== null && prev.contributionMarginPct !== null
      ? cur.contributionMarginPct - prev.contributionMarginPct
      : null;

  const kpiRevenue: KpiProvenance = {
    key: 'net_revenue',
    label: 'صافي الإيرادات',
    value: cur.netRevenue,
    formattedValue: formatIQD(cur.netRevenue),
    unit: 'IQD',
    deltaPct: revDelta !== null ? Number(revDelta.toFixed(1)) : null,
    deltaLabel: revDelta !== null ? `${revDelta >= 0 ? '+' : ''}${revDelta.toFixed(1)}% عن الفترة السابقة` : 'خط أساس',
    trendDirection: revDelta === null ? 'flat' : revDelta >= 0 ? 'up' : 'down',
    favorable: revDelta === null ? true : revDelta >= 0,
    source: 'ERP Read-Only + DWH',
    period,
    lastUpdated: lastSync,
    formula: 'إجمالي المبيعات − الخصومات التجارية',
    verificationStatus: currentRows.some((r) => r.verificationStatus === 'partial') ? 'partial' : 'verified',
  };

  const kpiContribution: KpiProvenance = {
    key: 'contribution_margin',
    label: 'هامش المساهمة',
    value: cur.contributionMarginPct,
    formattedValue: cur.contributionMarginPct !== null ? `${cur.contributionMarginPct.toFixed(1)}%` : 'غير متاح',
    unit: '%',
    deltaPct: cmDelta !== null ? Number(cmDelta.toFixed(1)) : null,
    deltaLabel:
      cmDelta !== null
        ? `${cmDelta >= 0 ? '+' : ''}${cmDelta.toFixed(1)} نقطة مئوية`
        : cur.contributionCoverageNote,
    trendDirection: cmDelta === null ? 'flat' : cmDelta >= 0 ? 'up' : 'down',
    favorable: cmDelta === null ? true : cmDelta >= 0,
    source: 'Profit & Commercial Engine',
    period,
    lastUpdated: lastSync,
    formula: '(صافي الإيراد − كلفة البضاعة − التكاليف المتغيرة) ÷ صافي الإيراد',
    verificationStatus: cur.contributionMarginPct !== null ? 'verified' : 'partial',
  };

  const kpiNetProfit: KpiProvenance = {
    key: 'net_profit',
    label: 'صافي الربح التشغيلي',
    value: cur.netProfit,
    formattedValue: cur.netProfit !== null ? formatIQD(cur.netProfit) : 'معلّق (نقص OpEx)',
    unit: 'IQD',
    deltaPct: null,
    deltaLabel:
      cur.netProfit !== null
        ? `هامش صافي ${cur.netMarginPct?.toFixed(1)}%`
        : 'موقوف لحماية الدقة المالية',
    trendDirection: cur.netProfit !== null ? 'up' : 'flat',
    favorable: cur.netProfit !== null,
    source: 'DWH + ERP Ledger',
    period,
    lastUpdated: lastSync,
    formula: 'هامش المساهمة − المصروفات التشغيلية المعتمدة (OpEx)',
    verificationStatus: cur.netProfit !== null ? 'verified' : 'partial',
    unavailableReason: cur.netProfitUnavailableReason,
  };

  const kpiDiscount: KpiProvenance = {
    key: 'discount_rate',
    label: 'معدل الخصومات التجارية',
    value: cur.discountRatePct,
    formattedValue: `${cur.discountRatePct.toFixed(1)}%`,
    unit: '%',
    deltaPct: Number((cur.discountRatePct - prev.discountRatePct).toFixed(1)),
    deltaLabel: `${(cur.discountRatePct - prev.discountRatePct) >= 0 ? '+' : ''}${(cur.discountRatePct - prev.discountRatePct).toFixed(1)} نقطة (مقارنة بالأساس)`,
    trendDirection: cur.discountRatePct >= prev.discountRatePct ? 'up' : 'down',
    favorable: cur.discountRatePct <= prev.discountRatePct,
    source: 'ERP Sales Ledger',
    period,
    lastUpdated: lastSync,
    formula: 'إجمالي الخصومات ÷ المبيعات الإجمالية',
    verificationStatus: 'verified',
  };

  const kpiTrappedCapital: KpiProvenance = {
    key: 'trapped_capital',
    label: 'السيولة المحتجزة (مخزون + ذمم)',
    value: cur.trappedCapital,
    formattedValue: formatIQD(cur.trappedCapital),
    unit: 'IQD',
    deltaPct: null,
    deltaLabel: `دورة نقدية ${cur.cashConversionCycleDays} يوم`,
    trendDirection: 'up',
    favorable: cur.trappedCapital < 40_000_000,
    source: 'Capital & Operating Engine',
    period,
    lastUpdated: lastSync,
    formula: 'فائض المخزون (>45 يوم) + الذمم المتأخرة (>40 يوم)',
    verificationStatus: cur.overallStatus,
  };

  const kpiArDays: KpiProvenance = {
    key: 'ar_days',
    label: 'متوسط أيام التحصيل (DSO)',
    value: cur.avgArDays,
    formattedValue: `${Math.round(cur.avgArDays)} يوم`,
    unit: 'يوم',
    deltaPct: Number((cur.avgArDays - prev.avgArDays).toFixed(1)),
    deltaLabel: `رصيد الذمم ${formatIQD(cur.arBalance)}`,
    trendDirection: cur.avgArDays >= prev.avgArDays ? 'up' : 'down',
    favorable: cur.avgArDays <= 45,
    source: 'ERP AR Aging View',
    period,
    lastUpdated: lastSync,
    formula: 'المتوسط المرجح لأيام تحصيل الذمم المدينة',
    verificationStatus: 'verified',
  };

  const kpiInventoryDays: KpiProvenance = {
    key: 'inventory_days',
    label: 'دوران المخزون (DIO)',
    value: cur.avgInventoryDays,
    formattedValue: `${Math.round(cur.avgInventoryDays)} يوم`,
    unit: 'يوم',
    deltaPct: Number((cur.avgInventoryDays - prev.avgInventoryDays).toFixed(1)),
    deltaLabel: `قيمة المخزون ${formatIQD(cur.inventoryValue)}`,
    trendDirection: cur.avgInventoryDays >= prev.avgInventoryDays ? 'up' : 'down',
    favorable: cur.avgInventoryDays <= 55,
    source: 'ERP Inventory View',
    period,
    lastUpdated: lastSync,
    formula: 'المتوسط المرجح لأيام بقاء المخزون',
    verificationStatus: cur.overallStatus,
  };

  const kpiWaste: KpiProvenance = {
    key: 'ops_waste',
    label: 'الهدر والتكاليف التشغيلية غير المباشرة',
    value: cur.wasteCost,
    formattedValue: formatIQD(cur.wasteCost),
    unit: 'IQD',
    deltaPct: prev.wasteCost > 0 ? Number((((cur.wasteCost - prev.wasteCost) / prev.wasteCost) * 100).toFixed(1)) : null,
    deltaLabel: `مستوى الخدمة SLA: ${cur.avgSlaPct.toFixed(1)}%`,
    trendDirection: cur.wasteCost >= prev.wasteCost ? 'up' : 'down',
    favorable: cur.wasteCost <= prev.wasteCost,
    source: 'Operations & SLA Monitor',
    period,
    lastUpdated: lastSync,
    formula: 'تكاليف التلف والهدر التشغيلي المسجلة',
    verificationStatus: cur.overallStatus,
  };

  switch (roleId) {
    case 'owner':
      return [kpiRevenue, kpiContribution, kpiNetProfit, kpiTrappedCapital];
    case 'finance':
      return [kpiNetProfit, kpiContribution, kpiArDays, kpiTrappedCapital];
    case 'operations':
      return [kpiInventoryDays, kpiWaste, kpiTrappedCapital, kpiRevenue];
    case 'commercial':
      return [kpiContribution, kpiDiscount, kpiRevenue, kpiInventoryDays];
    case 'sales':
      return [kpiRevenue, kpiDiscount, kpiArDays, kpiContribution];
  }
}

export function buildVarianceBridge(
  state: EnterpriseStoreState,
  period: string,
  branch: string
): VarianceBridgeStep[] {
  const prevPeriod = resolvePreviousPeriod(period);
  const currentRows = filterTransactions(state.transactions, period, branch);
  const prevRows = filterTransactions(state.transactions, prevPeriod, branch);

  const cur = aggregateMetrics(currentRows);
  const prev = aggregateMetrics(prevRows);

  const prevContrib = prev.contributionProfit ?? 0;
  const curContrib = cur.contributionProfit ?? 0;

  // Deterministic decomposition: Gross Volume lift vs Discount erosion vs COGS/VarCost shift
  const grossSalesChange = cur.grossRevenue - prev.grossRevenue;
  const prevCogsRatio = prev.grossRevenue > 0 ? (prev.cogs + (prev.grossRevenue - prev.discountAmount - prev.cogs - prevContrib)) / prev.grossRevenue : 0.72;
  const volumeContributionLift = grossSalesChange * (1 - prevCogsRatio);
  const discountErosion = -(cur.discountAmount - prev.discountAmount);
  const residualCostShift = curContrib - (prevContrib + volumeContributionLift + discountErosion);

  return [
    {
      label: `مساهمة الأساس (${prevPeriod.replace('2026-', '')})`,
      amount: Math.round(prevContrib),
      type: 'base',
      explanation: 'هامش المساهمة المحقق في فترة المقارنة',
    },
    {
      label: 'أثر نمو الحجم البيعي',
      amount: Math.round(volumeContributionLift),
      type: volumeContributionLift >= 0 ? 'positive' : 'negative',
      explanation: 'العائد الإضافي من ارتفاع الكميات المباعة قبل أثر الخصم والتكلفة',
    },
    {
      label: 'نزيف الخصومات الإضافية',
      amount: Math.round(discountErosion),
      type: discountErosion >= 0 ? 'positive' : 'negative',
      explanation: 'الفرق الناتج عن توسع الخصومات فوق نسبة الفترة السابقة',
    },
    {
      label: 'ارتفاع التكلفة والمزيج',
      amount: Math.round(residualCostShift),
      type: residualCostShift >= 0 ? 'positive' : 'negative',
      explanation: 'تغير كلفة الموردين والمزيج السلعي والتكاليف المتغيرة',
    },
    {
      label: 'صافي المساهمة الحالية',
      amount: Math.round(curContrib),
      type: 'total',
      explanation: 'المساهمة الاقتصادية الفعلية المعتمدة للفترة الحالية',
    },
  ];
}

export function buildEntityMatrix(
  state: EnterpriseStoreState,
  period: string,
  branch: string,
  groupBy: 'product' | 'customer' | 'channel' | 'supplier' | 'branch' = 'product'
): EntityProfitabilityRow[] {
  const rows = filterTransactions(state.transactions, period, branch);
  const map = new Map<string, EconomicTransaction[]>();

  for (const r of rows) {
    const key = r[groupBy];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  const result: EntityProfitabilityRow[] = [];
  for (const [entityName, groupRows] of map.entries()) {
    const agg = aggregateMetrics(groupRows);
    const cm = agg.contributionMarginPct;
    let status: EntityProfitabilityRow['status'] = 'healthy';
    if ((cm !== null && cm < 14) || agg.discountRatePct > 10 || agg.trappedCapital > 25_000_000) {
      status = 'leakage';
    } else if ((cm !== null && cm < 20) || agg.discountRatePct > 7) {
      status = 'watch';
    }

    result.push({
      entityName,
      entityType: groupBy,
      netRevenue: agg.netRevenue,
      discountRatePct: Number(agg.discountRatePct.toFixed(1)),
      grossMarginPct: Number(agg.grossMarginPct.toFixed(1)),
      contributionMarginPct: cm !== null ? Number(cm.toFixed(1)) : null,
      trappedCapital: Math.round(agg.trappedCapital),
      status,
    });
  }

  return result.sort((a, b) => b.netRevenue - a.netRevenue);
}

function extractComparisonMetricValue(agg: AggregatedMetrics, key: string): number {
  switch (key) {
    case 'net_revenue':
      return Number((agg.netRevenue / 1_000_000).toFixed(1));
    case 'gross_revenue':
      return Number((agg.grossRevenue / 1_000_000).toFixed(1));
    case 'gross_profit':
      return Number((agg.grossProfit / 1_000_000).toFixed(1));
    case 'discount_amount':
      return Number((agg.discountAmount / 1_000_000).toFixed(1));
    case 'trapped_capital':
      return Number((agg.trappedCapital / 1_000_000).toFixed(1));
    case 'cogs':
      return Number((agg.cogs / 1_000_000).toFixed(1));
    case 'ar_balance':
      return Number((agg.arBalance / 1_000_000).toFixed(1));
    case 'inventory_value':
      return Number((agg.inventoryValue / 1_000_000).toFixed(1));
    case 'waste_cost':
      return Number((agg.wasteCost / 1_000_000).toFixed(1));
    case 'contribution_margin':
      return Number((agg.contributionMarginPct ?? 0).toFixed(1));
    case 'gross_margin':
      return Number(agg.grossMarginPct.toFixed(1));
    case 'discount_rate':
      return Number(agg.discountRatePct.toFixed(1));
    case 'sla_pct':
      return Number(agg.avgSlaPct.toFixed(1));
    case 'ar_days':
      return Math.round(agg.avgArDays);
    case 'ccc_days':
      return agg.cashConversionCycleDays;
    case 'inventory_days':
      return Math.round(agg.avgInventoryDays);
    default:
      return 0;
  }
}

function generateNextQuarterLabels(lastPeriod: string, count: number): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(lastPeriod);
  let year = match ? Number(match[1]) : 2026;
  let quarter = match ? Number(match[2]) : 3;

  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    quarter += 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
    labels.push(`${year}-Q${quarter} (توقعات)`);
  }
  return labels;
}

function roundForUnit(val: number, unit: 'م.د.ع' | '%' | 'يوم'): number {
  const clamped = unit === '%' ? Math.min(100, Math.max(0, val)) : Math.max(0, val);
  return unit === 'يوم' ? Math.round(clamped) : Number(clamped.toFixed(1));
}

function buildReportForecastSeries(
  transactions: EconomicTransaction[],
  branch: string,
  comparisonMetrics: ReportComparisonMetric[]
): ReportForecastMetricSeries[] {
  const validRows = transactions.filter(
    (tx) => tx.verificationStatus !== 'rejected' && (branch === 'all' || branch === 'الشركة كاملة' || tx.branch === branch)
  );
  const periods = Array.from(new Set(validRows.map((tx) => tx.period))).sort();
  if (periods.length === 0) return [];

  const aggByPeriod = new Map<string, AggregatedMetrics>();
  for (const p of periods) {
    aggByPeriod.set(
      p,
      aggregateMetrics(validRows.filter((tx) => tx.period === p))
    );
  }

  const futureLabels = generateNextQuarterLabels(periods[periods.length - 1], 3);
  const n = periods.length;

  return comparisonMetrics.map((metric) => {
    const historicalValues = periods.map((p) =>
      extractComparisonMetricValue(aggByPeriod.get(p)!, metric.key)
    );

    let slope = 0;
    let intercept = historicalValues[0] ?? 0;

    if (n >= 2) {
      const xMean = (n - 1) / 2;
      const yMean = historicalValues.reduce((s, v) => s + v, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (historicalValues[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      slope = den > 0 ? num / den : 0;
      intercept = yMean - slope * xMean;
    }

    const points: ReportForecastPoint[] = periods.map((p, idx) => {
      const actualVal = historicalValues[idx];
      const isAnchor = idx === n - 1;
      return {
        period: p,
        actual: actualVal,
        forecast: isAnchor ? actualVal : null,
        lowerBound: isAnchor ? actualVal : null,
        upperBound: isAnchor ? actualVal : null,
      };
    });

    const lastActual = historicalValues[n - 1] ?? 0;
    const regressionEnd = intercept + slope * (n - 1);
    // Anchor the projection smoothly from the last realized actual using the historical OLS slope
    for (let step = 1; step <= futureLabels.length; step++) {
      const rawProjected = lastActual + slope * step + (regressionEnd - lastActual) * 0.15;
      const forecastVal = roundForUnit(rawProjected, metric.unit);
      const minStepMargin = metric.unit === '%' ? 0.9 * step : metric.unit === 'يوم' ? 2 * step : 1.8 * step;
      const pctBand = Math.abs(forecastVal) * (0.045 * step);
      const band = Math.max(minStepMargin, pctBand);

      points.push({
        period: futureLabels[step - 1],
        actual: null,
        forecast: forecastVal,
        lowerBound: roundForUnit(forecastVal - band, metric.unit),
        upperBound: roundForUnit(forecastVal + band, metric.unit),
      });
    }

    const roundedSlope = metric.unit === 'يوم' ? Math.round(slope) : Number(slope.toFixed(1));
    const stabilityThreshold = metric.unit === 'يوم' ? 1 : 0.25;
    const trendLabel =
      Math.abs(roundedSlope) < stabilityThreshold
        ? 'استقرار نسبي'
        : roundedSlope > 0
        ? 'اتجاه تاريخي صاعد'
        : 'اتجاه تاريخي هابط';

    return {
      metricKey: metric.key,
      metricLabel: metric.label,
      unit: metric.unit,
      slopePerQuarter: roundedSlope,
      trendLabel,
      points,
    };
  });
}

export function buildReportsForRole(
  roleId: RoleId,
  state: EnterpriseStoreState,
  period: string,
  branch: string
): ReportDefinition[] {
  const rows = filterTransactions(state.transactions, period, branch);
  const agg = aggregateMetrics(rows);
  const products = buildEntityMatrix(state, period, branch, 'product');
  const customers = buildEntityMatrix(state, period, branch, 'customer');

  const weakestProduct = [...products].sort(
    (a, b) => (a.contributionMarginPct ?? 99) - (b.contributionMarginPct ?? 99)
  )[0];
  const highestDiscountCustomer = [...customers].sort((a, b) => b.discountRatePct - a.discountRatePct)[0];

  const allReports: ReportDefinition[] = [
    // Owner Reports
    {
      id: 'rep_owner_exec',
      roleScope: ['owner'],
      ownerPrivate: true,
      category: 'تقارير المالك',
      title: 'الملخص التنفيذي الاقتصادي الشامل',
      summary: 'رؤية موحدة تربط نمو المبيعات بتآكل الهوامش واحتجاز السيولة وحالة الثقة بالبيانات.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: agg.overallStatus,
      confidenceLabel: agg.overallStatus === 'verified' ? 'بيانات معتمدة' : 'بيانات جزئية (نقص OpEx أربيل)',
      resultHeadline: 'نمو في المبيعات يقابله تآكل في هامش المساهمة',
      resultValue: `صافي الإيراد ${formatIQD(agg.netRevenue)} · المساهمة ${agg.contributionMarginPct?.toFixed(1) ?? '—'}%`,
      causes: [
        { text: `اتساع معدل الخصومات التجارية إلى ${agg.discountRatePct.toFixed(1)}% مقابل 5.0% في خط الأساس.`, level: 'calculated_fact' },
        { text: 'ارتفاع كلفة التوريد في الأصناف الرئيسية وتضخم المخزون في أربيل.', level: 'analytical_conclusion' },
      ],
      evidence: [
        { metric: 'صافي الإيرادات', value: formatIQD(agg.netRevenue), source: 'ERP Read-Only', status: 'verified' },
        { metric: 'السيولة المحتجزة', value: formatIQD(agg.trappedCapital), source: 'Capital Engine', status: agg.overallStatus },
        { metric: 'صافي الربح الموحد', value: agg.netProfit !== null ? formatIQD(agg.netProfit) : 'معلّق', source: 'DWH', status: agg.netProfit !== null ? 'verified' : 'partial' },
      ],
      comparisonMetrics: [
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'gross_profit', label: 'الربح الإجمالي', value: Number((agg.grossProfit / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_amount', label: 'الخصومات التجارية', value: Number((agg.discountAmount / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'trapped_capital', label: 'السيولة المحتجزة', value: Number((agg.trappedCapital / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'contribution_margin', label: 'هامش المساهمة', value: Number((agg.contributionMarginPct ?? 0).toFixed(1)), unit: '%' },
        { key: 'discount_rate', label: 'نسبة الخصم', value: Number(agg.discountRatePct.toFixed(1)), unit: '%' },
      ],
      risks: ['استمرار البيع بالخصم المرتفع سيحوّل النمو إلى استنزاف للسيولة.', 'عدم توفر OpEx لفرع أربيل يمنع إقفال صافي الربح النهائي.'],
      suggestedActions: [
        { action: 'اعتماد سقف خصم ملزم 6.5% وربط الحوافز بالتحصيل الفعلي.', expectedImpact: '+18.5 م.د.ع هامش مساهمة', ownerRole: 'commercial' },
        { action: 'استكمال تحميل كشف OpEx لفرع أربيل عبر البوابة المعتمدة.', expectedImpact: 'اكتمال 100% لصافي الربح', ownerRole: 'finance' },
      ],
      isSupportedByData: true,
    },
    {
      id: 'rep_owner_leakage',
      roleScope: ['owner'],
      ownerPrivate: true,
      category: 'تقارير المالك (مساحة خاصة)',
      title: 'تقرير التسربات الاقتصادية وأداء الإدارات',
      summary: 'حصر مناطق النزيف المالي في الخصومات والهدر والمخزون الراكد، خاص بغرفة المالك.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: agg.overallStatus,
      confidenceLabel: 'تقرير حساس خاص بالمالك',
      resultHeadline: 'إجمالي التسرب والسيولة المحتجزة القابلة للاسترداد',
      resultValue: formatIQD(agg.discountAmount + agg.wasteCost + agg.trappedCapital * 0.25),
      causes: [
        { text: `تجاوز الخصومات الممنوحة لدى ${highestDiscountCustomer?.entityName ?? 'العملاء'} النسبة القياسية.`, level: 'calculated_fact' },
        { text: `انخفاض مساهمة ${weakestProduct?.entityName ?? 'الصنف الأضعف'} إلى ${weakestProduct?.contributionMarginPct ?? '—'}%.`, level: 'calculated_fact' },
      ],
      evidence: [
        { metric: 'إجمالي الخصومات', value: formatIQD(agg.discountAmount), source: 'ERP Sales', status: 'verified' },
        { metric: 'تكلفة الهدر التشغيلي', value: formatIQD(agg.wasteCost), source: 'Operations', status: agg.overallStatus },
      ],
      comparisonMetrics: [
        { key: 'discount_amount', label: 'الخصومات التجارية', value: Number((agg.discountAmount / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'waste_cost', label: 'الهدر التشغيلي', value: Number((agg.wasteCost / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'trapped_capital', label: 'السيولة المحتجزة', value: Number((agg.trappedCapital / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_rate', label: 'نسبة الخصم', value: Number(agg.discountRatePct.toFixed(1)), unit: '%' },
      ],
      risks: ['تكرار استثناءات التسعير دون رفع تقارير مقارنة للإدارة العليا.'],
      suggestedActions: [
        { action: 'تفعيل موافقة المالك المسبقة لأي خصم يتجاوز 7% أو مدة ائتمان تفوق 45 يوماً.', expectedImpact: 'خفض النزيف بنسبة 45%', ownerRole: 'owner' },
      ],
      isSupportedByData: true,
    },

    // Finance Reports
    {
      id: 'rep_fin_profit',
      roleScope: ['owner', 'finance'],
      category: 'التقارير المالية',
      title: 'الربحية المالية وتحليل التكلفة والمصروفات',
      summary: 'مطابقة الإيرادات مع كلفة البضاعة والمصروفات التشغيلية وبيان مواضع النقص البياني.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: agg.netProfit !== null ? 'verified' : 'partial',
      confidenceLabel: agg.netProfit !== null ? 'مكتمل ومعتمد' : 'جزئي — OpEx مفقود جزئياً',
      resultHeadline: 'الربح الإجمالي وهامش المساهمة مقابل صافي الربح',
      resultValue: `الربح الإجمالي ${formatIQD(agg.grossProfit)} (${agg.grossMarginPct.toFixed(1)}%)`,
      causes: [
        { text: `تغطية المصروفات التشغيلية غير مكتملة لفرع أربيل لذا حُجب صافي الربح الموحد منعاً للتقدير غير المثبت.`, level: 'calculated_fact' },
      ],
      evidence: [
        { metric: 'كلفة البضاعة (COGS)', value: formatIQD(agg.cogs), source: 'ERP COGS', status: 'verified' },
        { metric: 'هامش المساهمة', value: `${agg.contributionMarginPct?.toFixed(1) ?? '—'}%`, source: 'Profit Engine', status: 'verified' },
      ],
      comparisonMetrics: [
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'cogs', label: 'كلفة البضاعة (COGS)', value: Number((agg.cogs / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'gross_profit', label: 'الربح الإجمالي', value: Number((agg.grossProfit / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'gross_margin', label: 'هامش الربح الإجمالي', value: Number(agg.grossMarginPct.toFixed(1)), unit: '%' },
        { key: 'contribution_margin', label: 'هامش المساهمة', value: Number((agg.contributionMarginPct ?? 0).toFixed(1)), unit: '%' },
      ],
      risks: ['تأخر إقفال مصروفات الفروع يؤخر تقييم الربحية الصافية للشركة.'],
      suggestedActions: [
        { action: 'إلزام رفع ملف OpEx الشهري لفرع أربيل ضمن المجلد المراقب OWNER_AI_DATA.', expectedImpact: 'توثيق صافي الربح 100%', ownerRole: 'finance' },
      ],
      isSupportedByData: true,
      missingDataNote: agg.netProfitUnavailableReason,
    },
    {
      id: 'rep_fin_ar',
      roleScope: ['owner', 'finance', 'sales'],
      category: 'التقارير المالية',
      title: 'التحصيل والذمم ورأس المال العامل',
      summary: 'تحليل أرصدة الذمم المدينة وأيام التحصيل (DSO) وأثرها المباشر على السيولة التشغيلية.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: 'verified',
      confidenceLabel: 'بيانات معتمدة',
      resultHeadline: 'متوسط التحصيل وأرصدة الذمم المفتوحة',
      resultValue: `${Math.round(agg.avgArDays)} يوم · ${formatIQD(agg.arBalance)}`,
      causes: [
        { text: 'توسع البيع الآجل في فرع بغداد دون ربط حوافز التحصيل.', level: 'analytical_conclusion' },
      ],
      evidence: [
        { metric: 'رصيد الذمم الكلي', value: formatIQD(agg.arBalance), source: 'ERP AR Aging', status: 'verified' },
        { metric: 'دورة التحويل النقدي (CCC)', value: `${agg.cashConversionCycleDays} يوم`, source: 'Capital Engine', status: 'verified' },
      ],
      comparisonMetrics: [
        { key: 'ar_balance', label: 'رصيد الذمم الكلي', value: Number((agg.arBalance / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'trapped_capital', label: 'السيولة المحتجزة', value: Number((agg.trappedCapital / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'ar_days', label: 'أيام التحصيل (DSO)', value: Math.round(agg.avgArDays), unit: 'يوم' },
        { key: 'ccc_days', label: 'الدورة النقدية (CCC)', value: agg.cashConversionCycleDays, unit: 'يوم' },
      ],
      risks: ['تباطؤ التحصيل يضغط على القدرة الشرائية وسداد الموردين.'],
      suggestedActions: [
        { action: 'تعميم نموذج البصرة في ربط عمولة المبيعات بالتحصيل الفعلي.', expectedImpact: 'تحرير 15 م.د.ع سيولة', ownerRole: 'finance' },
      ],
      isSupportedByData: true,
    },

    // Operations Reports
    {
      id: 'rep_ops_inventory',
      roleScope: ['owner', 'operations'],
      category: 'التقارير التشغيلية',
      title: 'المخزون والدوران والأصناف بطيئة الحركة',
      summary: 'قياس أيام دوران المخزون (DIO) وكشف الأموال المحتجزة في المستودعات.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: agg.overallStatus,
      confidenceLabel: 'مراقبة المخزون التشغيلية',
      resultHeadline: 'قيمة المخزون ومتوسط أيام البقاء',
      resultValue: `${formatIQD(agg.inventoryValue)} · ${Math.round(agg.avgInventoryDays)} يوم`,
      causes: [
        { text: 'تراكم مخزون فرع أربيل إلى 112 يوم دوران مقارنة بـ 36 يوماً في البصرة.', level: 'calculated_fact' },
      ],
      evidence: [
        { metric: 'رأس المال المحتجز بالمخزون والذمم', value: formatIQD(agg.trappedCapital), source: 'Capital Engine', status: agg.overallStatus },
      ],
      comparisonMetrics: [
        { key: 'inventory_value', label: 'قيمة المخزون', value: Number((agg.inventoryValue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'trapped_capital', label: 'السيولة المحتجزة', value: Number((agg.trappedCapital / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'inventory_days', label: 'دوران المخزون (DIO)', value: Math.round(agg.avgInventoryDays), unit: 'يوم' },
      ],
      risks: ['احتمال تقادم أو تلف المخزون الراكد وارتفاع كلفة التخزين.'],
      suggestedActions: [
        { action: 'إعادة توزيع 40% من الفائض نحو البصرة وتجميد الشراء مؤقتاً.', expectedImpact: 'تخفيض DIO بـ 28 يوماً', ownerRole: 'operations' },
      ],
      isSupportedByData: true,
    },
    {
      id: 'rep_ops_waste',
      roleScope: ['owner', 'operations'],
      category: 'التقارير التشغيلية',
      title: 'الهدر التشغيلي ومستويات الخدمة (SLA)',
      summary: 'مراقبة كلفة الهدر والتلف والالتزام بمواعيد التجهيز في الفروع.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: agg.overallStatus,
      confidenceLabel: 'معتمد تشغيلياً',
      resultHeadline: 'كلفة الهدر التشغيلي ونسبة التزام SLA',
      resultValue: `${formatIQD(agg.wasteCost)} · SLA ${agg.avgSlaPct.toFixed(1)}%`,
      causes: [
        { text: 'انخفاض SLA في أربيل إلى 84.8% تزامناً مع اختناقات المناولة.', level: 'calculated_fact' },
      ],
      evidence: [
        { metric: 'الهدر المسجل', value: formatIQD(agg.wasteCost), source: 'Operations Log', status: agg.overallStatus },
      ],
      comparisonMetrics: [
        { key: 'waste_cost', label: 'الهدر التشغيلي', value: Number((agg.wasteCost / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'inventory_value', label: 'قيمة المخزون', value: Number((agg.inventoryValue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'sla_pct', label: 'الالتزام بـ SLA', value: Number(agg.avgSlaPct.toFixed(1)), unit: '%' },
      ],
      risks: ['استمرار الهدر يضاعف الكلفة الحقيقية للوحدة المباعة.'],
      suggestedActions: [
        { action: 'مراجعة إجراءات التخزين والمناولة في مستودع أربيل.', expectedImpact: 'توفير 2.1 م.د.ع فصلياً', ownerRole: 'operations' },
      ],
      isSupportedByData: true,
    },

    // Commercial Reports
    {
      id: 'rep_com_margin',
      roleScope: ['owner', 'commercial', 'finance'],
      category: 'التقارير التجارية',
      title: 'ربحية المنتجات وهامش المساهمة',
      summary: 'ترتيب المنتجات حسب المساهمة الاقتصادية الصافية وليس حسب حجم المبيعات فقط.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: 'verified',
      confidenceLabel: 'بيانات معتمدة',
      resultHeadline: 'تفاوت هامش المساهمة بين الأصناف',
      resultValue: weakestProduct
        ? `الأضعف: ${weakestProduct.entityName} (${weakestProduct.contributionMarginPct ?? '—'}%)`
        : '—',
      causes: [
        { text: 'خصومات التسويق المفرطة على الأصناف الاقتصادية قلّصت المساهمة الصافية.', level: 'calculated_fact' },
      ],
      evidence: products.slice(0, 3).map((p) => ({
        metric: p.entityName,
        value: `مساهمة ${p.contributionMarginPct ?? '—'}% · خصم ${p.discountRatePct}%`,
        source: 'Commercial Engine',
        status: 'verified' as VerificationStatus,
      })),
      comparisonMetrics: [
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'gross_profit', label: 'الربح الإجمالي', value: Number((agg.grossProfit / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'contribution_margin', label: 'هامش المساهمة', value: Number((agg.contributionMarginPct ?? 0).toFixed(1)), unit: '%' },
        { key: 'gross_margin', label: 'هامش الربح الإجمالي', value: Number(agg.grossMarginPct.toFixed(1)), unit: '%' },
      ],
      risks: ['التوسع في بيع الأصناف منخفضة الهامش يستنزف رأس المال العامل دون عائد.'],
      suggestedActions: [
        { action: 'إعادة تسعير الحزم التجارية ورفع حصة الأصناف عالية المساهمة.', expectedImpact: '+3.1 نقطة هامش', ownerRole: 'commercial' },
      ],
      isSupportedByData: true,
    },
    {
      id: 'rep_com_discount',
      roleScope: ['owner', 'commercial', 'sales'],
      category: 'التقارير التجارية',
      title: 'التسعير والخصومات وأداء الموردين',
      summary: 'تحليل أثر الخصومات الاستثنائية وتغير أسعار الموردين على هامش الشركة.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: 'verified',
      confidenceLabel: 'بيانات معتمدة',
      resultHeadline: 'نسبة الخصم الفعلي مقابل السقف القياسي (6.5%)',
      resultValue: `${agg.discountRatePct.toFixed(1)}% (${formatIQD(agg.discountAmount)})`,
      causes: [
        { text: 'منح خصومات 11%–14% في قنوات الجملة والأسواق السريعة لتحقيق مستهدفات الحجم.', level: 'analytical_conclusion' },
      ],
      evidence: [
        { metric: 'إجمالي الخصومات الممنوحة', value: formatIQD(agg.discountAmount), source: 'ERP Sales', status: 'verified' },
      ],
      comparisonMetrics: [
        { key: 'discount_amount', label: 'الخصومات التجارية', value: Number((agg.discountAmount / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_rate', label: 'نسبة الخصم', value: Number(agg.discountRatePct.toFixed(1)), unit: '%' },
        { key: 'contribution_margin', label: 'هامش المساهمة', value: Number((agg.contributionMarginPct ?? 0).toFixed(1)), unit: '%' },
      ],
      risks: ['اعتقاد العملاء بأن السعر المخفض هو السعر الدائم يضعف القدرة التفاوضية.'],
      suggestedActions: [
        { action: 'التفاوض مع المورد الأصيل لتثبيت كلفة التوريد وتقليص خصومات الجملة.', expectedImpact: '+12 م.د.ع ربحية', ownerRole: 'commercial' },
      ],
      isSupportedByData: true,
    },

    // Sales Reports
    {
      id: 'rep_sales_target',
      roleScope: ['owner', 'sales'],
      category: 'تقارير المبيعات',
      title: 'تحقيق الأهداف واتجاهات الطلب',
      summary: 'قياس أحجام البيع المحققة مقابل المستهدف مع رصد استثناءات الخصم.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: 'verified',
      confidenceLabel: 'بيانات معتمدة',
      resultHeadline: 'إجمالي المبيعات الإجمالية وصافي الإيراد',
      resultValue: `${formatIQD(agg.grossRevenue)} إجمالي · ${formatIQD(agg.netRevenue)} صافي`,
      causes: [
        { text: 'نمو الحجم البيعي في بغداد والبصرة بنسبة +14.8% مع تباطؤ نسبي في أربيل.', level: 'calculated_fact' },
      ],
      evidence: [
        { metric: 'صافي المبيعات', value: formatIQD(agg.netRevenue), source: 'ERP Sales', status: 'verified' },
      ],
      comparisonMetrics: [
        { key: 'gross_revenue', label: 'المبيعات الإجمالية', value: Number((agg.grossRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_amount', label: 'الخصومات التجارية', value: Number((agg.discountAmount / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_rate', label: 'نسبة الخصم', value: Number(agg.discountRatePct.toFixed(1)), unit: '%' },
      ],
      risks: ['تحقيق أهداف الحجم على حساب جودة التحصيل والخصومات المرتفعة.'],
      suggestedActions: [
        { action: 'اعتماد مستهدفات مزدوجة للفريق: (حجم مبيعات + حد أقصى للخصم).', expectedImpact: 'حماية الهامش مع النمو', ownerRole: 'sales' },
      ],
      isSupportedByData: true,
    },
    {
      id: 'rep_sales_region',
      roleScope: ['owner', 'sales'],
      category: 'تقارير المبيعات',
      title: 'المبيعات حسب المنطقة والعملاء',
      summary: 'مقارنة أداء الفروع والعملاء الرئيسيين من حيث النمو والخصم والالتزام بالتحصيل.',
      period,
      dataScope: branch === 'all' ? 'الشركة كاملة' : branch,
      confidenceStatus: 'verified',
      confidenceLabel: 'بيانات معتمدة',
      resultHeadline: 'توزيع المبيعات حسب العملاء الرئيسيين',
      resultValue: `${customers.length} عملاء رئيسيين نشطين`,
      causes: [
        { text: 'تركز النمو في فرعي بغداد والبصرة مقابل ضغط ائتماني في بغداد.', level: 'calculated_fact' },
      ],
      evidence: customers.map((c) => ({
        metric: c.entityName,
        value: `${formatIQD(c.netRevenue)} (خصم ${c.discountRatePct}%)`,
        source: 'ERP Sales',
        status: 'verified' as VerificationStatus,
      })),
      comparisonMetrics: [
        { key: 'net_revenue', label: 'صافي الإيرادات', value: Number((agg.netRevenue / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'ar_balance', label: 'رصيد الذمم الكلي', value: Number((agg.arBalance / 1_000_000).toFixed(1)), unit: 'م.د.ع' },
        { key: 'discount_rate', label: 'نسبة الخصم', value: Number(agg.discountRatePct.toFixed(1)), unit: '%' },
        { key: 'ar_days', label: 'أيام التحصيل (DSO)', value: Math.round(agg.avgArDays), unit: 'يوم' },
      ],
      risks: ['تزايد تركز المبيعات لدى عميل واحد مع ارتفاع أيام سداده.'],
      suggestedActions: [
        { action: 'توسيع قاعدة عملاء التجزئة المنظمة على غرار نموذج البصرة.', expectedImpact: 'تنويع المخاطر الائتمانية', ownerRole: 'sales' },
      ],
      isSupportedByData: true,
    },
  ];

  // Server-side 3D RBAC enforcement: only return reports authorized for this role,
  // enriched with historical-to-future linear forecast series per indicator.
  return allReports
    .filter((rep) => {
      if (rep.ownerPrivate && roleId !== 'owner') return false;
      return rep.roleScope.includes(roleId);
    })
    .map((rep) => ({
      ...rep,
      forecastSeries: buildReportForecastSeries(
        state.transactions,
        branch,
        rep.comparisonMetrics ?? []
      ),
    }));
}

export function buildWeeklyBrief(
  roleId: RoleId,
  state: EnterpriseStoreState,
  period: string,
  branch: string
): WeeklyBrief {
  const rows = filterTransactions(state.transactions, period, branch);
  const agg = aggregateMetrics(rows);
  const pendingOwnerDecisions = state.decisions.filter((d) => d.requiresOwnerApproval && d.approvalStatus === 'pending_review');
  const pendingConflicts = state.conflicts.filter((c) => c.status === 'pending');

  return {
    generatedAt: new Date().toISOString(),
    period,
    improved: [
      `ارتفعت المبيعات الصافية إلى ${formatIQD(agg.netRevenue)} مع أداء منضبط في فرع البصرة (نمو +13.1% وخصم 5% فقط).`,
      'تحسن متوسط فترة التحصيل في البصرة إلى 31 يوماً بعد ربط عمولة المبيعات بالتحصيل الفعلي.',
    ],
    declined: [
      `ارتفع معدل الخصومات التجارية الإجمالي إلى ${agg.discountRatePct.toFixed(1)}% مما خفّض هامش المساهمة الإجمالي.`,
      `تضاعف عمر المخزون في فرع أربيل إلى 112 يوماً مما احتجز سيولة تشغيلية عالية.`,
    ],
    topEconomicIssues: [
      `نزيف الخصومات في بغداد يستهلك ${formatIQD(agg.discountAmount)} من العائد المحتمل.`,
      `احتجاز ${formatIQD(agg.trappedCapital)} من رأس المال العامل في المخزون البطيء والذمم المتأخرة.`,
    ],
    evidenceBackedCauses: [
      'بيانات ERP المعتمدة تثبت ارتفاع خصومات فرع بغداد من 5% إلى 12.7% بين Q2 وQ3.',
      'غياب كشف المصروفات التشغيلية (OpEx) لفرع أربيل يمنع إصدار صافي الربح النهائي الموحد بدقة.',
    ],
    decisionsNeedingOwner:
      roleId === 'owner'
        ? pendingOwnerDecisions.map((d) => `${d.title} (أثر مقدّر: ${formatIQD(d.estimatedFinancialImpact)})`)
        : ['قرار تحديد سقف الخصومات التجارية مرفوع حالياً لاعتماد المالك.'],
    delayedActions: [
      ...(pendingConflicts.length > 0
        ? [`يوجد تعارض مصدر بيانات بانتظار الاعتماد: ${pendingConflicts[0].metricLabel}.`]
        : []),
      'استكمال نقل الدفعة الثانية من مخزون أربيل الفائض إلى البصرة.',
    ],
    changesSinceLastBrief: [
      'تم رفض ملف تحميل يدوي غير مطابق (BATCH-2026-118C) تلقائياً عند بوابة التحقق.',
      'سُجّل تحسن موثق بمقدار 12.4 م.د.ع في سيولة فرع البصرة بعد قرار التحصيل.',
    ],
  };
}

export function buildProactiveAlerts(
  reports: ReportDefinition[],
  state: EnterpriseStoreState,
  period: string,
  branch: string
): ProactiveAlertNotification[] {
  const alerts: ProactiveAlertNotification[] = [];
  const enabledRules = state.alertRules.filter((r) => r.enabled);
  const branchLabel = branch === 'all' ? 'الشركة كاملة' : branch;

  for (const rep of reports) {
    const metrics = rep.comparisonMetrics ?? [];
    for (const metric of metrics) {
      const rule = enabledRules.find((r) => r.metricKey === metric.key);
      if (!rule) continue;

      const breached =
        (rule.comparator === 'gt' && metric.value > rule.threshold) ||
        (rule.comparator === 'lt' && metric.value < rule.threshold);

      if (!breached) continue;

      const diff = Math.abs(metric.value - rule.threshold);
      const deviationAmount = metric.unit === 'يوم' ? Math.round(diff) : Number(diff.toFixed(1));
      const deviationPct =
        rule.threshold > 0
          ? Number(((diff / rule.threshold) * 100).toFixed(1))
          : 100;

      const severity: ProactiveAlertNotification['severity'] =
        deviationPct >= 20 ? 'critical' : 'warning';

      const alertId = `${rep.id}__${metric.key}__${period}__${branch}`;
      const savedState = state.alertStates[alertId];
      const primaryAction = rep.suggestedActions[0];

      alerts.push({
        id: alertId,
        reportId: rep.id,
        reportTitle: rep.title,
        reportCategory: rep.category,
        metricKey: metric.key,
        metricLabel: metric.label,
        unit: metric.unit,
        actualValue: metric.value,
        thresholdValue: rule.threshold,
        comparator: rule.comparator,
        deviationAmount,
        deviationPct,
        severity,
        status: savedState?.status ?? 'active',
        period,
        branchScope: branchLabel,
        recommendedAction:
          primaryAction?.action ?? `مراجعة انحراف مؤشر ${metric.label} في تقرير ${rep.title}.`,
        targetRole: primaryAction?.ownerRole ?? 'owner',
        detectedAt: state.sources[0]?.lastSyncAt ?? new Date().toISOString(),
        acknowledgedAt: savedState?.at,
        acknowledgedBy: savedState?.by,
      });
    }
  }

  return alerts.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (a.severity !== 'critical' && b.severity === 'critical') return 1;
    return b.deviationPct - a.deviationPct;
  });
}
