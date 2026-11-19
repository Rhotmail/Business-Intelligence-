import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart2,
  Bell,
  BellRing,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileDown,
  FileSpreadsheet,
  GitCompare,
  Lock,
  Send,
  Shield,
  Sliders,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  acknowledgeAlertsApi,
  escalateAlertApi,
  runAiAnalysis,
  updateAlertRuleApi,
} from '../api/client.ts';
import { useFirebase } from '../context/FirebaseContext.tsx';
import {
  AiAnalysisResponse,
  AlertThresholdRule,
  DashboardPayload,
  ProactiveAlertNotification,
  RoleId,
} from '../types.ts';
import { exportComparisonToCsv, exportComparisonToPdf } from '../utils/exportComparison.ts';
import { formatMillionsIQD, getEpistemicLabel, getVerificationMeta, ROLE_TITLES } from '../utils/formatters.ts';

interface AnalysisViewProps {
  data: DashboardPayload;
  activeRole: RoleId;
  entityGroup: string;
  onChangeEntityGroup: (group: string) => void;
  onReload: () => Promise<void> | void;
}

const ENTITY_GROUPS = [
  { id: 'product', label: 'المنتجات' },
  { id: 'customer', label: 'العملاء' },
  { id: 'channel', label: 'القنوات' },
  { id: 'supplier', label: 'الموردون' },
  { id: 'branch', label: 'الفروع' },
];

const GUIDED_QUESTIONS = [
  'لماذا ارتفعت المبيعات بينما انخفض هامش المساهمة؟',
  'ما أثر تركز المخزون في أربيل على السيولة وما البديل الأفضل؟',
  'أي العملاء والقنوات يستهلكون الخصومات دون مساهمة اقتصادية مناسبة؟',
];

export const AnalysisView: React.FC<AnalysisViewProps> = ({
  data,
  activeRole,
  entityGroup,
  onChangeEntityGroup,
  onReload,
}) => {
  const {
    saveAlertRuleToFirestore,
    saveAlertStatesToFirestore,
    saveDecisionToFirestore,
    appendWorkspaceLog,
  } = useFirebase();

  const strictBudgetActive = Boolean(
    activeRole !== 'owner' &&
      activeRole !== 'finance' &&
      data.activeBudgetPolicy?.strictControlEnabled
  );
  const allowedBudgetSet = new Set(data.activeBudgetPolicy?.allowedBudgetItems ?? []);
  const canViewRevenueBudget = !strictBudgetActive || allowedBudgetSet.has('revenue_budget');
  const canViewDiscountsBudget = !strictBudgetActive || allowedBudgetSet.has('discounts_budget');
  const canViewCogsBudget =
    (activeRole === 'owner' || (data.activePolicy ? data.activePolicy.canViewFinancialMargins : true)) &&
    (!strictBudgetActive || allowedBudgetSet.has('cogs_budget'));
  const canViewFinancialMargins =
    (activeRole === 'owner' || (data.activePolicy ? data.activePolicy.canViewFinancialMargins : true)) &&
    (!strictBudgetActive || allowedBudgetSet.has('variable_cost_budget'));
  const canViewTrappedCapitalBudget =
    !strictBudgetActive ||
    allowedBudgetSet.has('ar_credit_budget') ||
    allowedBudgetSet.has('inventory_budget');
  const canRunAiAnalysis =
    activeRole === 'owner' || (data.activePolicy ? data.activePolicy.canRunAiAnalysis : true);
  const canExportReports =
    activeRole === 'owner' ||
    (data.activePolicy ? data.activePolicy.canExportReports : data.role.allowedActions.includes('export'));
  const canManageAlerts =
    activeRole === 'owner' || (data.activePolicy ? data.activePolicy.canManageAlerts : true);
  // Interactive Economic Twin Sliders (Hypothetical Simulator)
  const [targetDiscountCapPct, setTargetDiscountCapPct] = useState(6.5);
  const [cogsSavingsPct, setCogsSavingsPct] = useState(2.0);
  const [slowInventoryReleasePct, setSlowInventoryReleasePct] = useState(35);

  // Enterprise AI Analyst state
  const [question, setQuestion] = useState(GUIDED_QUESTIONS[0]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiAnalysisResponse | null>(null);
  const [showTrustInspector, setShowTrustInspector] = useState(false);

  // Side-by-side Data Comparison Modal state
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [leftReportId, setLeftReportId] = useState<string>(() => data.reports[0]?.id ?? '');
  const [rightReportId, setRightReportId] = useState<string>(
    () => data.reports[1]?.id ?? data.reports[0]?.id ?? ''
  );

  // Future Performance Forecast (Recharts LineChart) state
  const [showForecastPanel, setShowForecastPanel] = useState(true);
  const forecastSectionRef = useRef<HTMLElement>(null);
  const [forecastReportId, setForecastReportId] = useState<string>(() => data.reports[0]?.id ?? '');
  const [forecastMetricKey, setForecastMetricKey] = useState<string>(
    () => data.reports[0]?.forecastSeries?.[0]?.metricKey ?? ''
  );
  const [showBounds, setShowBounds] = useState(true);

  useEffect(() => {
    const validIds = new Set(data.reports.map((r) => r.id));
    if (!validIds.has(leftReportId)) {
      setLeftReportId(data.reports[0]?.id ?? '');
    }
    if (!validIds.has(rightReportId)) {
      setRightReportId(data.reports[1]?.id ?? data.reports[0]?.id ?? '');
    }
    if (!validIds.has(forecastReportId)) {
      setForecastReportId(data.reports[0]?.id ?? '');
    }
  }, [data.reports, leftReportId, rightReportId, forecastReportId]);

  const selectedForecastReport = useMemo(
    () => data.reports.find((r) => r.id === forecastReportId) ?? data.reports[0] ?? null,
    [data.reports, forecastReportId]
  );

  const availableForecastSeries = useMemo(
    () => selectedForecastReport?.forecastSeries ?? [],
    [selectedForecastReport]
  );

  useEffect(() => {
    if (
      availableForecastSeries.length > 0 &&
      !availableForecastSeries.some((s) => s.metricKey === forecastMetricKey)
    ) {
      setForecastMetricKey(availableForecastSeries[0].metricKey);
    }
  }, [availableForecastSeries, forecastMetricKey]);

  const activeForecastSeries = useMemo(
    () =>
      availableForecastSeries.find((s) => s.metricKey === forecastMetricKey) ??
      availableForecastSeries[0] ??
      null,
    [availableForecastSeries, forecastMetricKey]
  );

  const forecastSummary = useMemo(() => {
    if (!activeForecastSeries || activeForecastSeries.points.length === 0) return null;
    const actualPoints = activeForecastSeries.points.filter((p) => p.actual !== null);
    const lastActual = actualPoints[actualPoints.length - 1] ?? null;
    const lastProjected = activeForecastSeries.points[activeForecastSeries.points.length - 1] ?? null;
    return {
      lastActualPeriod: lastActual?.period ?? '',
      lastActualValue: lastActual?.actual ?? 0,
      horizonPeriod: lastProjected?.period ?? '',
      horizonValue: lastProjected?.forecast ?? 0,
      horizonLower: lastProjected?.lowerBound ?? 0,
      horizonUpper: lastProjected?.upperBound ?? 0,
    };
  }, [activeForecastSeries]);

  useEffect(() => {
    if (!isCompareModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCompareModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCompareModalOpen]);

  const leftReport = useMemo(
    () => data.reports.find((r) => r.id === leftReportId) ?? data.reports[0] ?? null,
    [data.reports, leftReportId]
  );
  const rightReport = useMemo(
    () => data.reports.find((r) => r.id === rightReportId) ?? data.reports[1] ?? data.reports[0] ?? null,
    [data.reports, rightReportId]
  );

  const maxEvidenceRows = Math.max(
    leftReport?.evidence.length ?? 0,
    rightReport?.evidence.length ?? 0
  );

  // Recharts Comparison Chart State & Data
  const [chartUnit, setChartUnit] = useState<'م.د.ع' | '%' | 'يوم'>('م.د.ع');
  const [excludedMetricKeys, setExcludedMetricKeys] = useState<string[]>([]);

  const allComparisonMetricsForPair = useMemo(() => {
    if (!leftReport || !rightReport) return [];
    const map = new Map<
      string,
      { key: string; label: string; unit: 'م.د.ع' | '%' | 'يوم'; reportA: number | null; reportB: number | null }
    >();

    for (const m of leftReport.comparisonMetrics ?? []) {
      map.set(m.key, { key: m.key, label: m.label, unit: m.unit, reportA: m.value, reportB: null });
    }
    for (const m of rightReport.comparisonMetrics ?? []) {
      const existing = map.get(m.key);
      if (existing) {
        existing.reportB = m.value;
      } else {
        map.set(m.key, { key: m.key, label: m.label, unit: m.unit, reportA: null, reportB: m.value });
      }
    }
    return Array.from(map.values());
  }, [leftReport, rightReport]);

  const availableUnits = useMemo(() => {
    const units = new Set(allComparisonMetricsForPair.map((m) => m.unit));
    return (['م.د.ع', '%', 'يوم'] as const).filter((u) => units.has(u));
  }, [allComparisonMetricsForPair]);

  useEffect(() => {
    if (availableUnits.length > 0 && !availableUnits.includes(chartUnit)) {
      setChartUnit(availableUnits[0]);
    }
  }, [availableUnits, chartUnit]);

  const unitScopedMetrics = useMemo(
    () => allComparisonMetricsForPair.filter((m) => m.unit === chartUnit),
    [allComparisonMetricsForPair, chartUnit]
  );

  const activeBarChartData = useMemo(
    () =>
      unitScopedMetrics
        .filter((m) => !excludedMetricKeys.includes(m.key))
        .map((m) => ({
          label: m.label,
          reportA: m.reportA ?? 0,
          reportB: m.reportB ?? 0,
          unit: m.unit,
        })),
    [unitScopedMetrics, excludedMetricKeys]
  );

  const toggleMetricKey = (key: string) => {
    setExcludedMetricKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  // Export Comparison (PDF & CSV)
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const selectedUnitRowsForExport = useMemo(
    () =>
      unitScopedMetrics
        .filter((m) => !excludedMetricKeys.includes(m.key))
        .map((m) => ({
          label: m.label,
          reportA: m.reportA,
          reportB: m.reportB,
          unit: m.unit,
        })),
    [unitScopedMetrics, excludedMetricKeys]
  );

  const handleExportCsv = () => {
    if (!leftReport || !rightReport) return;
    exportComparisonToCsv({
      leftReport,
      rightReport,
      chartMetrics: selectedUnitRowsForExport,
      chartUnit,
      period: data.filters.period,
      branch: data.filters.branch,
    });
    setExportNotice('تم تصدير جدول المقارنة بصيغة CSV بنجاح.');
  };

  const handleExportPdf = async () => {
    if (!leftReport || !rightReport) return;
    setExportingPdf(true);
    setExportNotice(null);
    try {
      await exportComparisonToPdf({
        leftReport,
        rightReport,
        chartMetrics: selectedUnitRowsForExport,
        chartUnit,
        period: data.filters.period,
        branch: data.filters.branch,
        chartContainer: chartContainerRef.current,
      });
      setExportNotice('تم تصدير ملف PDF متضمناً الرسم البياني وجدول المقارنة.');
    } catch {
      setExportNotice('تعذر إنشاء ملف PDF، يرجى المحاولة مرة أخرى.');
    } finally {
      setExportingPdf(false);
    }
  };

  // Deterministic Economic Twin Simulation based on real verified totals
  const twinOutcome = useMemo(() => {
    const totalRev = data.entityMatrix.reduce((s, r) => s + r.netRevenue, 0);
    const totalTrapped = data.entityMatrix.reduce((s, r) => s + r.trappedCapital, 0);
    const avgDisc =
      data.entityMatrix.length > 0
        ? data.entityMatrix.reduce((s, r) => s + r.discountRatePct * r.netRevenue, 0) / Math.max(1, totalRev)
        : 0;

    const discountRecovery =
      avgDisc > targetDiscountCapPct ? totalRev * ((avgDisc - targetDiscountCapPct) / 100) : 0;
    const cogsRecovery = totalRev * 0.72 * (cogsSavingsPct / 100);
    const cashReleased = totalTrapped * (slowInventoryReleasePct / 100);

    return {
      discountRecovery: Math.round(discountRecovery),
      cogsRecovery: Math.round(cogsRecovery),
      totalProfitGain: Math.round(discountRecovery + cogsRecovery),
      cashReleased: Math.round(cashReleased),
    };
  }, [data.entityMatrix, targetDiscountCapPct, cogsSavingsPct, slowInventoryReleasePct]);

  const maxBridgeVal = useMemo(
    () => Math.max(1, ...data.varianceBridge.map((b) => Math.abs(b.amount))),
    [data.varianceBridge]
  );

  const handleAskAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await runAiAnalysis(activeRole, {
        question,
        period: data.filters.period,
        branch: data.filters.branch,
      });
      setAiResult(res);
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'تعذر تشغيل التحليل المحمي.');
    } finally {
      setAiLoading(false);
    }
  };

  // Proactive Deviation Alert & Notification System
  const [showAlertsPanel, setShowAlertsPanel] = useState(true);
  const [showRulesConfig, setShowRulesConfig] = useState(false);
  const [alertFilterTab, setAlertFilterTab] = useState<'active' | 'critical' | 'all' | 'handled'>('active');
  const [alertReportFilter, setAlertReportFilter] = useState<string>('all');
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, { threshold: string; comparator: 'gt' | 'lt'; enabled: boolean }>>({});
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [toastNotifications, setToastNotifications] = useState<
    Array<{
      uid: string;
      title: string;
      message: string;
      severity: 'critical' | 'warning' | 'info';
      reportTitle?: string;
    }>
  >([]);
  const notifiedBatchKeyRef = useRef<string>('');
  const alertsSectionRef = useRef<HTMLElement>(null);

  // Sync draft rule inputs from server rules
  useEffect(() => {
    const nextDrafts: Record<string, { threshold: string; comparator: 'gt' | 'lt'; enabled: boolean }> = {};
    for (const r of data.alertRules ?? []) {
      nextDrafts[r.id] = {
        threshold: String(r.threshold),
        comparator: r.comparator,
        enabled: r.enabled,
      };
    }
    setRuleDrafts(nextDrafts);
  }, [data.alertRules]);

  const activeAlerts = useMemo(
    () => (data.proactiveAlerts ?? []).filter((a) => a.status === 'active'),
    [data.proactiveAlerts]
  );

  const criticalAlerts = useMemo(
    () => (data.proactiveAlerts ?? []).filter((a) => a.severity === 'critical' && a.status === 'active'),
    [data.proactiveAlerts]
  );

  const handledAlerts = useMemo(
    () => (data.proactiveAlerts ?? []).filter((a) => a.status !== 'active'),
    [data.proactiveAlerts]
  );

  const filteredAlerts = useMemo(() => {
    return (data.proactiveAlerts ?? []).filter((a) => {
      if (alertReportFilter !== 'all' && a.reportId !== alertReportFilter) return false;
      if (alertFilterTab === 'active') return a.status === 'active';
      if (alertFilterTab === 'critical') return a.status === 'active' && a.severity === 'critical';
      if (alertFilterTab === 'handled') return a.status !== 'active';
      return true;
    });
  }, [data.proactiveAlerts, alertFilterTab, alertReportFilter]);

  const pushToast = (toast: {
    title: string;
    message: string;
    severity: 'critical' | 'warning' | 'info';
    reportTitle?: string;
  }) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToastNotifications((prev) => [{ uid, ...toast }, ...prev].slice(0, 3));
  };

  const dispatchActiveBreachNotifications = (force = false) => {
    const active = activeAlerts;
    if (active.length === 0) {
      if (force) {
        pushToast({
          title: 'لا توجد تجاوزات نشطة',
          message: 'جميع المؤشرات الاقتصادية في تقاريرك ضمن حدود الانحراف المسموح بها.',
          severity: 'info',
        });
      }
      return;
    }

    const batchKey = `${activeRole}|${data.filters.period}|${data.filters.branch}|${active.map((a) => `${a.id}:${a.actualValue}:${a.thresholdValue}`).join(',')}`;
    if (!force && notifiedBatchKeyRef.current === batchKey) return;
    notifiedBatchKeyRef.current = batchKey;

    const topAlert = active[0];
    const affectedReports = new Set(active.map((a) => a.reportId)).size;
    const comparatorText = topAlert.comparator === 'gt' ? 'الحد الأقصى' : 'الحد الأدنى';

    pushToast({
      title: `إشعار استباقي: ${active.length} تجاوزاً في ${affectedReports} تقارير`,
      message: `أعلى انحراف في "${topAlert.reportTitle}": ${topAlert.metricLabel} بلغ ${topAlert.actualValue} ${topAlert.unit} مقابل ${comparatorText} (${topAlert.thresholdValue} ${topAlert.unit}).`,
      severity: criticalAlerts.length > 0 ? 'critical' : 'warning',
      reportTitle: topAlert.reportTitle,
    });
  };

  // Automatically emit proactive notification whenever new active deviations appear for the active scope/role
  useEffect(() => {
    if (activeAlerts.length > 0) {
      dispatchActiveBreachNotifications(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRole, data.filters.period, data.filters.branch, data.proactiveAlerts]);

  const handleSaveRule = async (rule: AlertThresholdRule) => {
    const draft = ruleDrafts[rule.id];
    if (!draft) return;
    const numericThreshold = Number(draft.threshold);
    if (!Number.isFinite(numericThreshold) || numericThreshold < 0) {
      setAlertError(`يرجى إدخال قيمة حد صالحة لمؤشر ${rule.metricLabel}.`);
      return;
    }
    setSavingRuleId(rule.id);
    setAlertError(null);
    try {
      await updateAlertRuleApi(activeRole, rule.id, {
        threshold: numericThreshold,
        comparator: draft.comparator,
        enabled: draft.enabled,
      });
      await saveAlertRuleToFirestore({
        ...rule,
        threshold: numericThreshold,
        comparator: draft.comparator,
        enabled: draft.enabled,
        updatedBy: activeRole,
        updatedAt: new Date().toISOString(),
      });
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'تحديث حد الانحراف الاستباقي',
        target: rule.metricLabel,
        detail: `الحد الجديد: ${draft.comparator === 'gt' ? '>' : '<'} ${numericThreshold} ${rule.unit}`,
      });
      notifiedBatchKeyRef.current = '';
      await onReload();
      pushToast({
        title: 'تم تحديث حد الانحراف المسموح به',
        message: `أُعيد فحص جميع التقارير لقاعدة "${rule.metricLabel}" (${draft.comparator === 'gt' ? '≤' : '≥'} ${numericThreshold} ${rule.unit}).`,
        severity: 'info',
      });
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : 'تعذر حفظ حد الانحراف.');
    } finally {
      setSavingRuleId(null);
    }
  };

  const handleAcknowledgeAlerts = async (alertIds: string[]) => {
    if (alertIds.length === 0) return;
    setBusyAlertId(alertIds.length === 1 ? alertIds[0] : '__ALL__');
    setAlertError(null);
    try {
      await acknowledgeAlertsApi(activeRole, alertIds);
      await saveAlertStatesToFirestore(
        alertIds.map((key) => ({
          alertKey: key,
          status: 'acknowledged' as const,
          by: ROLE_TITLES[activeRole],
        }))
      );
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'تأكيد استلام تنبيه انحراف',
        target: `${alertIds.length} تنبيه`,
        detail: 'تمت مراجعة وتأكيد استلام إشعارات الانحراف في Firestore.',
      });
      await onReload();
      pushToast({
        title: 'تم تأكيد استلام الإشعار',
        message: `تم توثيق مراجعة ${alertIds.length} تنبيه انحراف في سجل الحوكمة.`,
        severity: 'info',
      });
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : 'تعذر تأكيد استلام التنبيه.');
    } finally {
      setBusyAlertId(null);
    }
  };

  const handleEscalateAlert = async (alert: ProactiveAlertNotification) => {
    setBusyAlertId(alert.id);
    setAlertError(null);
    try {
      const created = await escalateAlertApi(activeRole, {
        alertId: alert.id,
        reportTitle: alert.reportTitle,
        reportCategory: alert.reportCategory,
        metricLabel: alert.metricLabel,
        actualValueText: `${alert.actualValue} ${alert.unit}`,
        thresholdValueText: `${alert.comparator === 'gt' ? '≤' : '≥'} ${alert.thresholdValue} ${alert.unit}`,
        recommendedAction: alert.recommendedAction,
        targetRole: alert.targetRole,
        period: alert.period,
        branchScope: alert.branchScope,
        severity: alert.severity,
      });
      await saveDecisionToFirestore(created, true);
      await saveAlertStatesToFirestore([
        {
          alertKey: alert.id,
          status: 'escalated',
          by: ROLE_TITLES[activeRole],
        },
      ]);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'تصعيد تنبيه انحراف إلى قرار',
        target: created.id,
        detail: created.title,
      });
      await onReload();
      pushToast({
        title: `تم التصعيد إلى قضية قرار (${created.id})`,
        message: `أُدرج تجاوز "${alert.metricLabel}" في دورة القضايا والقرارات للمتابعة والاعتماد.`,
        severity: 'info',
      });
    } catch (err: unknown) {
      setAlertError(err instanceof Error ? err.message : 'تعذر تصعيد التنبيه إلى قرار.');
    } finally {
      setBusyAlertId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">التحليل الاقتصادي والتوأم التشغيلي</h1>
          <p className="mt-1 text-sm text-slate-600">
            فصل واضح بين الحسابات المحتمة المحلية، ومحاكاة السيناريوهات الافتراضية، والتفسير المرمّز بالذكاء الاصطناعي.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !showAlertsPanel;
              setShowAlertsPanel(next);
              if (next) {
                setTimeout(() => {
                  alertsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
              }
            }}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-4 py-2 text-xs font-semibold transition-colors ${
              activeAlerts.length > 0
                ? 'border-red-300 bg-red-50 text-red-900 hover:bg-red-100'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <BellRing className={`h-4 w-4 shrink-0 ${activeAlerts.length > 0 ? 'text-red-700' : 'text-slate-600'}`} />
            <span>
              تنبيهات الانحراف (
              <span className="font-mono tabular-nums">{activeAlerts.length}</span> نشط)
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !showForecastPanel;
              setShowForecastPanel(next);
              if (next) {
                setTimeout(() => {
                  forecastSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 50);
              }
            }}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-4 py-2 text-xs font-semibold transition-colors ${
              showForecastPanel
                ? 'border-amber-600 bg-amber-50 text-amber-900 hover:bg-amber-100'
                : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
            }`}
          >
            <TrendingUp className="h-4 w-4 shrink-0 text-amber-700" />
            <span>{showForecastPanel ? 'إخفاء تنبؤات الأداء' : 'تنبؤات الأداء المستقبلية'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsCompareModalOpen(true)}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-blue-700 bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800"
          >
            <GitCompare className="h-4 w-4 shrink-0" />
            <span>مقارنة البيانات</span>
          </button>
        </div>
      </section>

      {/* 0. Proactive Deviation Alert & Notification System */}
      {showAlertsPanel && (
        <section
          ref={alertsSectionRef}
          className="rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-2.5">
              <BellRing className={`mt-0.5 h-5 w-5 shrink-0 ${activeAlerts.length > 0 ? 'text-red-700' : 'text-emerald-700'}`} />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  نظام التنبيهات الاستباقي لحدود الانحراف المسموح بها
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  مراقبة تلقائية لمؤشرات جميع التقارير المعتمدة للدور وإرسال إشعارات فورية عند تجاوز الحدود القياسية.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => dispatchActiveBreachNotifications(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50"
              >
                <Send className="h-3.5 w-3.5 text-blue-700" />
                <span>فحص وإرسال الإشعارات</span>
              </button>

              {canManageAlerts && (
                <button
                  type="button"
                  onClick={() => setShowRulesConfig(!showRulesConfig)}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                    showRulesConfig
                      ? 'border-slate-800 bg-slate-800 text-white'
                      : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>حدود الانحراف ({data.alertRules?.filter((r) => r.enabled).length ?? 0})</span>
                </button>
              )}

              {canManageAlerts && activeAlerts.length > 0 && (
                <button
                  type="button"
                  disabled={busyAlertId !== null}
                  onClick={() => handleAcknowledgeAlerts(activeAlerts.map((a) => a.id))}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>تأكيد استلام الكل ({activeAlerts.length})</span>
                </button>
              )}
            </div>
          </div>

          {alertError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
              {alertError}
            </div>
          )}

          {/* Threshold Rules Configuration Panel */}
          {showRulesConfig && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-bold text-slate-900">
                  إدارة حدود الانحراف المسموح بها عبر المؤشرات الاقتصادية
                </div>
                <span className="text-[11px] text-slate-500">
                  تعديل أي حد يعيد فحص جميع التقارير تلقائياً ويرسل إشعاراً بالتجاوزات الجديدة
                </span>
              </div>

              <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-right text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">المؤشر الاقتصادي</th>
                      <th className="px-3 py-2.5 font-semibold">شرط إطلاق التنبيه</th>
                      <th className="px-3 py-2.5 font-semibold">الحد المسموح</th>
                      <th className="px-3 py-2.5 font-semibold">الحالة</th>
                      <th className="px-3 py-2.5 font-semibold">حفظ التعديل</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.alertRules ?? []).map((rule) => {
                      const draft = ruleDrafts[rule.id] ?? {
                        threshold: String(rule.threshold),
                        comparator: rule.comparator,
                        enabled: rule.enabled,
                      };
                      const isDirty =
                        draft.threshold !== String(rule.threshold) ||
                        draft.comparator !== rule.comparator ||
                        draft.enabled !== rule.enabled;

                      return (
                        <tr key={rule.id} className="hover:bg-slate-50/70">
                          <td className="px-3 py-2.5 font-semibold text-slate-900">
                            {rule.metricLabel}{' '}
                            <span className="text-[11px] font-normal text-slate-500">({rule.unit})</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <select
                              value={draft.comparator}
                              onChange={(e) =>
                                setRuleDrafts((prev) => ({
                                  ...prev,
                                  [rule.id]: {
                                    ...draft,
                                    comparator: e.target.value === 'lt' ? 'lt' : 'gt',
                                  },
                                }))
                              }
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
                            >
                              <option value="gt">تنبيه عند التجاوز أعلى من (&gt;)</option>
                              <option value="lt">تنبيه عند الهبوط دون (&lt;)</option>
                            </select>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="number"
                                step={rule.unit === 'يوم' ? 1 : 0.5}
                                min={0}
                                value={draft.threshold}
                                onChange={(e) =>
                                  setRuleDrafts((prev) => ({
                                    ...prev,
                                    [rule.id]: { ...draft, threshold: e.target.value },
                                  }))
                                }
                                className="w-24 rounded border border-slate-300 bg-white px-2.5 py-1 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none"
                              />
                              <span className="text-[11px] text-slate-500">{rule.unit}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() =>
                                setRuleDrafts((prev) => ({
                                  ...prev,
                                  [rule.id]: { ...draft, enabled: !draft.enabled },
                                }))
                              }
                              className={`rounded border px-2.5 py-1 text-[11px] font-medium ${
                                draft.enabled
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  : 'border-slate-200 bg-slate-100 text-slate-600'
                              }`}
                            >
                              {draft.enabled ? 'مراقبة مفعّلة' : 'موقفة'}
                            </button>
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              disabled={!isDirty || savingRuleId === rule.id}
                              onClick={() => handleSaveRule(rule)}
                              className="rounded-md bg-blue-700 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-500"
                            >
                              {savingRuleId === rule.id ? 'جارٍ الحفظ...' : 'حفظ وتطبيق'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Alert Filter Bar */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
              {[
                { id: 'active' as const, label: `التنبيهات النشطة (${activeAlerts.length})` },
                { id: 'critical' as const, label: `الحرجة فقط (${criticalAlerts.length})` },
                { id: 'handled' as const, label: `المؤكدة والمصعّدة (${handledAlerts.length})` },
                { id: 'all' as const, label: `الكل (${data.proactiveAlerts?.length ?? 0})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAlertFilterTab(tab.id)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    alertFilterTab === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-xs">
              <span className="font-medium text-slate-600">تصفية حسب التقرير:</span>
              <select
                value={alertReportFilter}
                onChange={(e) => setAlertReportFilter(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                <option value="all">جميع التقارير المعتمدة</option>
                {data.reports.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Alerts Feed */}
          {filteredAlerts.length === 0 ? (
            <div className="mt-4 flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-xs text-slate-600">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <span>لا توجد تجاوزات مطابقة للتصفية الحالية ضمن حدود الانحراف المعتمدة.</span>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-200 rounded-md border border-slate-200">
              {filteredAlerts.map((alert) => {
                const isCritical = alert.severity === 'critical';
                const limitSymbol = alert.comparator === 'gt' ? '≤' : '≥';
                const isBusy = busyAlertId === alert.id || busyAlertId === '__ALL__';

                return (
                  <div
                    key={alert.id}
                    className={`flex flex-col gap-3 p-4 transition-colors md:flex-row md:items-center md:justify-between ${
                      alert.status === 'active'
                        ? isCritical
                          ? 'bg-red-50/30'
                          : 'bg-amber-50/25'
                        : 'bg-slate-50/60'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 font-bold ${
                            alert.status !== 'active'
                              ? 'text-slate-600'
                              : isCritical
                              ? 'text-red-800'
                              : 'text-amber-800'
                          }`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>{isCritical ? 'تجاوز حرج للحد' : 'انحراف تحذيري'}</span>
                        </span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-900">{alert.reportTitle}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-slate-500">{alert.reportCategory}</span>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-slate-500">
                          {alert.branchScope} ({alert.period})
                        </span>
                      </div>

                      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
                        <span>
                          <span className="text-slate-500">المؤشر: </span>
                          <span className="font-semibold text-slate-900">{alert.metricLabel}</span>
                        </span>
                        <span>
                          <span className="text-slate-500">القيمة الفعلية: </span>
                          <span
                            className={`font-mono font-bold tabular-nums ${
                              isCritical ? 'text-red-700' : 'text-amber-800'
                            }`}
                          >
                            {alert.actualValue} {alert.unit}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">الحد المسموح: </span>
                          <span className="font-mono font-semibold tabular-nums text-slate-800">
                            {limitSymbol} {alert.thresholdValue} {alert.unit}
                          </span>
                        </span>
                        <span>
                          <span className="text-slate-500">مقدار الانحراف: </span>
                          <span className="font-mono font-bold tabular-nums text-slate-900">
                            {alert.deviationAmount} {alert.unit} ({alert.deviationPct}%)
                          </span>
                        </span>
                      </div>

                      <p className="text-[11px] leading-relaxed text-slate-600">
                        <span className="font-semibold text-slate-700">الإجراء المقترح: </span>
                        {alert.recommendedAction}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {alert.status === 'active' ? (
                        canManageAlerts ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleAcknowledgeAlerts([alert.id])}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
                            >
                              <Check className="h-3.5 w-3.5 text-emerald-700" />
                              <span>تأكيد الإشعار</span>
                            </button>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleEscalateAlert(alert)}
                              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-blue-700 bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
                            >
                              <Bell className="h-3.5 w-3.5" />
                              <span>تصعيد لقضية قرار</span>
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                            <Lock className="h-3 w-3" />
                            <span>إدارة التنبيهات محجوبة</span>
                          </span>
                        )
                      ) : (
                        <span className="text-[11px] font-medium text-emerald-800">
                          {alert.status === 'escalated'
                            ? `مُصعّد لقضية قرار (${alert.acknowledgedBy ?? ''})`
                            : `تم تأكيد الاستلام (${alert.acknowledgedBy ?? ''})`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* 1. Variance Bridge Decomposition (Profit & Commercial Intelligence) */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">جسر تفكيك التغير في هامش المساهمة</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              يوضح حسابياً لماذا لم ينعكس نمو المبيعات بالكامل في صافي المساهمة الاقتصادية (محسوب محلياً)
            </p>
          </div>
          <span className="text-xs font-medium text-emerald-800">محرك الربحية والتجارة · حقيقة محسوبة</span>
        </div>

        {!canViewFinancialMargins ? (
          <div className="mt-4 flex items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
            <Lock className="h-4 w-4 shrink-0 text-slate-500" />
            <span>تم حجب تفاصيل جسر تفكيك الأرباح والهوامش عن هذا الدور بقرار صلاحيات الوصول من الإدارة (Admin).</span>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-5">
            {data.varianceBridge.map((step, idx) => {
              const pctWidth = Math.max(12, Math.min(100, Math.round((Math.abs(step.amount) / maxBridgeVal) * 100)));
              const barColor =
                step.type === 'positive'
                  ? 'bg-emerald-600'
                  : step.type === 'negative'
                  ? 'bg-red-600'
                  : step.type === 'total'
                  ? 'bg-blue-700'
                  : 'bg-slate-600';

              return (
                <div key={idx} className="flex flex-col justify-between rounded-md border border-slate-200 p-4">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">{step.label}</div>
                    <div
                      className={`mt-2 font-mono text-lg font-bold tabular-nums ${
                        step.type === 'negative'
                          ? 'text-red-700'
                          : step.type === 'positive'
                          ? 'text-emerald-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {step.amount >= 0 && (step.type === 'positive' || step.type === 'negative') ? '+' : ''}
                      {formatMillionsIQD(step.amount)}
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
                      <div className={`h-full ${barColor}`} style={{ width: `${pctWidth}%` }} />
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{step.explanation}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 1.5 Future Performance Forecasts (Recharts LineChart per Report Indicator) */}
      {showForecastPanel && (
        <section
          ref={forecastSectionRef}
          className="rounded-lg border border-slate-200 bg-white p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-2.5">
              <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  تنبؤات الأداء المستقبلية حسب المؤشرات التاريخية للتقارير (Line Chart)
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  استقراء خطي للأرباع الثلاثة القادمة بالاعتماد على السلاسل التاريخية المعتمدة لكل تقرير ضمن نطاق {data.filters.branch === 'all' ? 'الشركة كاملة' : data.filters.branch}.
                </p>
              </div>
            </div>

            <span className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
              تقدير مستقبلي مبني على الاتجاه التاريخي — وليس حقيقة محققة
            </span>
          </div>

          {data.reports.length === 0 || !selectedForecastReport ? (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
              لا توجد تقارير متاحة ضمن صلاحيات هذا الدور لعرض التنبؤات المستقبلية.
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              {/* Report Selector + Bounds Toggle */}
              <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-end md:justify-between">
                <label className="block flex-1 text-xs">
                  <span className="font-semibold text-slate-700">اختيار التقرير للتنبؤ بأدائه المستقبلي</span>
                  <select
                    value={selectedForecastReport.id}
                    onChange={(e) => setForecastReportId(e.target.value)}
                    className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                  >
                    {data.reports.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.title} ({rep.category})
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => setShowBounds(!showBounds)}
                  className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 py-2 text-xs font-medium transition-colors ${
                    showBounds
                      ? 'border-slate-700 bg-slate-800 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>{showBounds ? 'إخفاء نطاق الثقة (الأعلى/الأدنى)' : 'إظهار نطاق الثقة (الأعلى/الأدنى)'}</span>
                </button>
              </div>

              {/* Metric Selector Tabs for Selected Report */}
              {availableForecastSeries.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-600">مؤشر التنبؤ:</span>
                  {availableForecastSeries.map((series) => {
                    const isActive = activeForecastSeries?.metricKey === series.metricKey;
                    return (
                      <button
                        key={series.metricKey}
                        type="button"
                        onClick={() => setForecastMetricKey(series.metricKey)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          isActive
                            ? 'border-blue-700 bg-blue-700 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-400 hover:text-blue-800'
                        }`}
                      >
                        {series.metricLabel} ({series.unit})
                      </button>
                    );
                  })}
                </div>
              )}

              {activeForecastSeries && forecastSummary ? (
                <>
                  {/* Forecast Summary Strip */}
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                      <div className="text-[11px] font-medium text-slate-500">
                        آخر أداء تاريخي محقق ({forecastSummary.lastActualPeriod})
                      </div>
                      <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-blue-800">
                        {forecastSummary.lastActualValue} {activeForecastSeries.unit}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        بيانات فعلية معتمدة من سجل التقرير
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4">
                      <div className="text-[11px] font-medium text-slate-500">
                        معدل التغير الربعي التاريخي (Slope)
                      </div>
                      <div
                        className={`mt-1.5 font-mono text-lg font-bold tabular-nums ${
                          activeForecastSeries.slopePerQuarter > 0
                            ? 'text-emerald-700'
                            : activeForecastSeries.slopePerQuarter < 0
                            ? 'text-red-700'
                            : 'text-slate-800'
                        }`}
                      >
                        {activeForecastSeries.slopePerQuarter > 0 ? '+' : ''}
                        {activeForecastSeries.slopePerQuarter} {activeForecastSeries.unit} / ربع
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {activeForecastSeries.trendLabel}
                      </div>
                    </div>

                    <div className="rounded-md border border-amber-200 bg-amber-50/50 p-4">
                      <div className="text-[11px] font-medium text-amber-900">
                        التقدير المستقبلي بنهاية الأفق ({forecastSummary.horizonPeriod})
                      </div>
                      <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-amber-800">
                        {forecastSummary.horizonValue} {activeForecastSeries.unit}
                      </div>
                      <div className="mt-1 font-mono text-[11px] tabular-nums text-slate-600">
                        نطاق التقدير: {forecastSummary.horizonLower} – {forecastSummary.horizonUpper}{' '}
                        {activeForecastSeries.unit}
                      </div>
                    </div>
                  </div>

                  {/* Recharts LineChart */}
                  <div className="rounded-md border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-900">
                        مسار {activeForecastSeries.metricLabel} — الأداء التاريخي مقابل التوقع المستقبلي ({activeForecastSeries.unit})
                      </span>
                      <span className="text-[11px] text-slate-500">
                        الخط الأزرق المتصل: محقق فعلياً · الخط البرتقالي المتقطع: توقعات مستقبلية
                      </span>
                    </div>

                    <div className="h-80 w-full" dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={activeForecastSeries.points}
                          margin={{ top: 18, right: 24, left: 12, bottom: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                          <XAxis
                            dataKey="period"
                            tick={{ fontSize: 11, fill: '#334155' }}
                            axisLine={{ stroke: '#CBD5E1' }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#475569' }}
                            axisLine={false}
                            tickLine={false}
                            width={52}
                          />
                          <Tooltip
                            formatter={(value, name) => [
                              value !== null && value !== undefined
                                ? `${value} ${activeForecastSeries.unit}`
                                : '—',
                              name,
                            ]}
                            contentStyle={{
                              borderRadius: '6px',
                              border: '1px solid #E2E8F0',
                              fontSize: '12px',
                              direction: 'rtl',
                              textAlign: 'right',
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                          {forecastSummary.lastActualPeriod && (
                            <ReferenceLine
                              x={forecastSummary.lastActualPeriod}
                              stroke="#64748B"
                              strokeDasharray="4 4"
                              label={{
                                value: 'حد الواقع التاريخي',
                                position: 'top',
                                fill: '#475569',
                                fontSize: 11,
                              }}
                            />
                          )}
                          <Line
                            type="monotone"
                            dataKey="actual"
                            name="الأداء التاريخي الفعلي"
                            stroke="#1D4ED8"
                            strokeWidth={2.75}
                            dot={{ r: 4.5, fill: '#1D4ED8', strokeWidth: 1.5, stroke: '#FFFFFF' }}
                            activeDot={{ r: 6 }}
                            connectNulls={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="forecast"
                            name="التنبؤ المستقبلي (اتجاه خطي)"
                            stroke="#D97706"
                            strokeWidth={2.75}
                            strokeDasharray="6 4"
                            dot={{ r: 4.5, fill: '#D97706', strokeWidth: 1.5, stroke: '#FFFFFF' }}
                            activeDot={{ r: 6 }}
                            connectNulls={false}
                          />
                          {showBounds && (
                            <>
                              <Line
                                type="monotone"
                                dataKey="upperBound"
                                name="الحد الأعلى المتوقع"
                                stroke="#94A3B8"
                                strokeWidth={1.5}
                                strokeDasharray="2 3"
                                dot={false}
                                connectNulls={false}
                              />
                              <Line
                                type="monotone"
                                dataKey="lowerBound"
                                name="الحد الأدنى المتوقع"
                                stroke="#94A3B8"
                                strokeWidth={1.5}
                                strokeDasharray="2 3"
                                dot={false}
                                connectNulls={false}
                              />
                            </>
                          )}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Period-by-Period Historical & Forecast Data Table */}
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-right text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                        <tr>
                          <th className="px-4 py-2.5 font-semibold">الفترة الزمنية</th>
                          <th className="px-4 py-2.5 font-semibold">التصنيف المنهجي</th>
                          <th className="px-4 py-2.5 font-semibold">القيمة ({activeForecastSeries.unit})</th>
                          <th className="px-4 py-2.5 font-semibold">نطاق التقدير (الأدنى – الأعلى)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeForecastSeries.points.map((pt) => {
                          const isActual = pt.actual !== null;
                          const displayVal = isActual ? pt.actual : pt.forecast;
                          return (
                            <tr key={pt.period} className={isActual ? 'bg-white' : 'bg-amber-50/25'}>
                              <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">{pt.period}</td>
                              <td className="px-4 py-2.5">
                                {isActual ? (
                                  <span className="rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                                    أداء تاريخي محقق
                                  </span>
                                ) : (
                                  <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                    تقدير مستقبلي محسوب
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono font-bold tabular-nums text-slate-900">
                                {displayVal !== null ? `${displayVal} ${activeForecastSeries.unit}` : '—'}
                              </td>
                              <td className="px-4 py-2.5 font-mono tabular-nums text-slate-600">
                                {!isActual && pt.lowerBound !== null && pt.upperBound !== null
                                  ? `${pt.lowerBound} – ${pt.upperBound} ${activeForecastSeries.unit}`
                                  : 'قيمة فعلية ثابتة'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  لا تتوفر مؤشرات رقمية كافية لهذا التقرير لإسقاط التنبؤ المستقبلي.
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* 2. Entity Profitability & Leakage Matrix */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">مصفوفة المساهمة الاقتصادية واستهلاك الموارد</h2>
            <p className="mt-0.5 text-xs text-slate-500">ترتيب الكيانات حسب صافي الإيراد والخصم وهامش المساهمة والسيولة المحتجزة</p>
          </div>

          <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
            {ENTITY_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onChangeEntityGroup(g.id)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  entityGroup === g.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-semibold">الكيان</th>
                <th className="px-4 py-3 font-semibold">صافي الإيراد</th>
                <th className="px-4 py-3 font-semibold">نسبة الخصم</th>
                <th className="px-4 py-3 font-semibold">الربح الإجمالي</th>
                <th className="px-4 py-3 font-semibold">هامش المساهمة</th>
                <th className="px-4 py-3 font-semibold">رأس مال محتجز</th>
                <th className="px-4 py-3 font-semibold">التصنيف الاقتصادي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.entityMatrix.map((row) => (
                <tr key={row.entityName} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.entityName}</td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-800">
                    {canViewRevenueBudget ? formatMillionsIQD(row.netRevenue) : 'محجوب رقابياً'}
                  </td>
                  <td
                    className={`px-4 py-3 font-mono tabular-nums ${
                      canViewDiscountsBudget && row.discountRatePct > 9 ? 'font-bold text-red-700' : 'text-slate-700'
                    }`}
                  >
                    {canViewDiscountsBudget ? `${row.discountRatePct.toFixed(1)}%` : 'محجوب رقابياً'}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-800">
                    {canViewCogsBudget ? `${row.grossMarginPct.toFixed(1)}%` : 'محجوب'}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums font-semibold text-slate-900">
                    {!canViewFinancialMargins
                      ? 'محجوب'
                      : row.contributionMarginPct !== null
                        ? `${row.contributionMarginPct.toFixed(1)}%`
                        : 'غير متاح'}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums text-slate-800">
                    {canViewTrappedCapitalBudget ? formatMillionsIQD(row.trappedCapital) : 'محجوب رقابياً'}
                  </td>
                  <td className="px-4 py-3">
                    {row.status === 'leakage' && (
                      <span className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-800">
                        استنزاف هامش / سيولة
                      </span>
                    )}
                    {row.status === 'watch' && (
                      <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        تحت المراقبة
                      </span>
                    )}
                    {row.status === 'healthy' && (
                      <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                        مساهمة صحية
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Economic Twin Simulator + Enterprise AI Trust Analyst */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Economic Twin (5 cols) */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-blue-700" />
              <h2 className="text-base font-bold text-slate-900">التوأم الاقتصادي — محاكاة الحساسية</h2>
            </div>
          </div>
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-900">
            تنبيه منهجي: هذه نتائج سيناريو افتراضي للاختبار وليست أرباحاً أو توفيراً محققاً فعلياً.
          </p>

          <div className="mt-5 space-y-5">
            <div>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700">سقف الخصم التجاري الأقصى</span>
                <span className="font-mono font-bold tabular-nums text-blue-800">{targetDiscountCapPct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={3}
                max={12}
                step={0.5}
                value={targetDiscountCapPct}
                onChange={(e) => setTargetDiscountCapPct(Number(e.target.value))}
                className="mt-2 w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700">تحسين التفاوض على كلفة التوريد (COGS)</span>
                <span className="font-mono font-bold tabular-nums text-blue-800">{cogsSavingsPct.toFixed(1)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={cogsSavingsPct}
                onChange={(e) => setCogsSavingsPct(Number(e.target.value))}
                className="mt-2 w-full accent-blue-700"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs">
                <span className="font-medium text-slate-700">نسبة تصفية/تدوير المخزون والذمم المحتجزة</span>
                <span className="font-mono font-bold tabular-nums text-blue-800">{slowInventoryReleasePct}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={70}
                step={5}
                value={slowInventoryReleasePct}
                onChange={(e) => setSlowInventoryReleasePct(Number(e.target.value))}
                className="mt-2 w-full accent-blue-700"
              />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <div className="text-[11px] text-slate-500">الأثر الافتراضي على المساهمة</div>
              <div className="mt-1 font-mono text-lg font-bold tabular-nums text-blue-800">
                +{formatMillionsIQD(twinOutcome.totalProfitGain)}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
              <div className="text-[11px] text-slate-500">السيولة القابلة للتحرير</div>
              <div className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-800">
                +{formatMillionsIQD(twinOutcome.cashReleased)}
              </div>
            </div>
          </div>
        </div>

        {/* Protected AI Economic Analyst (7 cols) */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-bold text-slate-900">المحلل التفسيري المحمي (Enterprise AI Trust)</h2>
            </div>
            <span className="text-[11px] text-slate-500">ترميز الكيانات محلياً قبل أي معالجة لغوية</span>
          </div>

          {!canRunAiAnalysis ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
              <Lock className="h-4 w-4 shrink-0 text-slate-500" />
              <span>تم تقييد استخدام محرك التحليل الذكي المحمي لهذا الدور وفق صلاحيات الإدارة (Admin).</span>
            </div>
          ) : (
            <form onSubmit={handleAskAi} className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {GUIDED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setQuestion(q)}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-700 hover:border-blue-400 hover:text-blue-800"
                  >
                    {q}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="اطرح سؤالاً تشخيصياً حول الربحية أو السيولة أو المخزون..."
                  className="flex-1 rounded-md border border-slate-300 px-3.5 py-2 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={aiLoading}
                  className="inline-flex items-center gap-2 whitespace-nowrap rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{aiLoading ? 'جارٍ التفسير...' : 'تحليل وتفسير'}</span>
                </button>
              </div>
            </form>
          )}

          {aiError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3.5 text-xs text-red-800">{aiError}</div>
          )}

          {aiResult && (
            <div className="mt-5 space-y-4 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  {aiResult.modelUsed} · أُعيد ربط {aiResult.restoredTokensCount} كيان محلياً
                </span>
                <button
                  type="button"
                  onClick={() => setShowTrustInspector(!showTrustInspector)}
                  className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-800"
                >
                  {showTrustInspector ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  <span>{showTrustInspector ? 'إخفاء معاينة الحماية' : 'معاينة الحماية والرموز المرسلة'}</span>
                </button>
              </div>

              {showTrustInspector && (
                <div className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-900 p-4 text-[11px] text-slate-200 md:grid-cols-2">
                  <div>
                    <div className="mb-1.5 font-semibold text-emerald-400">
                      1. النص المرسل للذكاء الاصطناعي (خالي من الأسماء الحقيقية)
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">
                      {aiResult.tokenizedPromptPreview}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1.5 font-semibold text-amber-300">
                      2. الرد الخام الوارد قبل فك الترميز المحلي
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-slate-300">
                      {aiResult.rawModelResponsePreview}
                    </pre>
                  </div>
                </div>
              )}

              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800">
                {aiResult.executiveNarrative}
              </div>

              <div className="space-y-2.5">
                {aiResult.epistemicSummary.map((item, idx) => {
                  const ep = getEpistemicLabel(item.level);
                  return (
                    <div key={idx} className="rounded-md border border-slate-200 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${ep.toneClass}`}>
                          {ep.label}
                        </span>
                        <span className={item.verifiedAgainstEngine ? 'text-emerald-700' : 'text-amber-700'}>
                          {item.verificationNote}
                        </span>
                      </div>
                      <p className="mt-2 leading-relaxed text-slate-800">{item.statement}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Data Comparison Modal Window */}
      {isCompareModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onClick={() => setIsCompareModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="compare-modal-title"
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <GitCompare className="h-5 w-5 text-blue-700" />
                <div>
                  <h2 id="compare-modal-title" className="text-base font-bold text-slate-900">
                    مقارنة البيانات والمؤشرات الاقتصادية
                  </h2>
                  <p className="text-xs text-slate-500">
                    اختر تقريرين من القائمة المتاحة لدورك لمقارنة مؤشراتهما الاقتصادية جنباً إلى جنب
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {canExportReports && data.reports.length >= 2 && leftReport && rightReport && (
                  <>
                    <button
                      type="button"
                      onClick={handleExportCsv}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                      <span>تصدير CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={exportingPdf}
                      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
                    >
                      <FileDown className="h-3.5 w-3.5" />
                      <span>{exportingPdf ? 'جارٍ التجهيز...' : 'تصدير PDF'}</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setIsCompareModalOpen(false)}
                  aria-label="إغلاق نافذة المقارنة"
                  className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {data.reports.length < 2 || !leftReport || !rightReport ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-600">
                  يتطلب تشغيل أداة مقارنة البيانات توفر تقريرين على الأقل ضمن نطاق صلاحيات هذا الحساب.
                </div>
              ) : (
                <>
                  {/* Selectors + Swap */}
                  <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-end">
                    <label className="block flex-1 text-xs">
                      <span className="font-semibold text-slate-700">التقرير الأول (أ)</span>
                      <select
                        value={leftReport.id}
                        onChange={(e) => setLeftReportId(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                      >
                        {data.reports.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.title} ({rep.category})
                          </option>
                        ))}
                      </select>
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setLeftReportId(rightReportId);
                        setRightReportId(leftReportId);
                      }}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                      <span>تبديل</span>
                    </button>

                    <label className="block flex-1 text-xs">
                      <span className="font-semibold text-slate-700">التقرير الثاني (ب)</span>
                      <select
                        value={rightReport.id}
                        onChange={(e) => setRightReportId(e.target.value)}
                        className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                      >
                        {data.reports.map((rep) => (
                          <option key={rep.id} value={rep.id}>
                            {rep.title} ({rep.category})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {leftReport.id === rightReport.id && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
                      تم اختيار التقرير نفسه في القائمتين؛ اختر تقريراً مختلفاً في إحدى القائمتين لإبراز الفروقات.
                    </div>
                  )}

                  {/* Recharts Side-by-Side Bar Chart */}
                  {unitScopedMetrics.length > 0 && (
                    <div className="rounded-md border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                          <BarChart2 className="h-4 w-4 text-blue-700" />
                          <div>
                            <h3 className="text-xs font-bold text-slate-900">
                              المقارنة البصرية للمؤشرات المختارة (Bar Chart)
                            </h3>
                            <p className="text-[11px] text-slate-500">
                              تمثيل بياني جنباً إلى جنب بوحدة القياس الموحدة ({chartUnit})
                            </p>
                          </div>
                        </div>

                        {availableUnits.length > 1 && (
                          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
                            {availableUnits.map((u) => (
                              <button
                                key={u}
                                type="button"
                                onClick={() => setChartUnit(u)}
                                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                  chartUnit === u
                                    ? 'bg-white text-slate-900 shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                {u === 'م.د.ع' ? 'القيم المالية (م.د.ع)' : u === '%' ? 'النسب (%)' : 'الأيام'}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Selectable Indicator Checkboxes */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-slate-600">المؤشرات المختارة:</span>
                        {unitScopedMetrics.map((m) => {
                          const isChecked = !excludedMetricKeys.includes(m.key);
                          return (
                            <button
                              key={m.key}
                              type="button"
                              onClick={() => toggleMetricKey(m.key)}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                                isChecked
                                  ? 'border-blue-600 bg-blue-50 text-blue-900'
                                  : 'border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700'
                              }`}
                            >
                              {isChecked ? '✓ ' : '+ '}
                              {m.label}
                            </button>
                          );
                        })}
                      </div>

                      {activeBarChartData.length === 0 ? (
                        <div className="mt-4 rounded border border-slate-100 bg-slate-50 py-10 text-center text-xs text-slate-500">
                          اختر مؤشراً واحداً على الأقل من الشريط أعلاه لعرض الرسم البياني.
                        </div>
                      ) : (
                        <div ref={chartContainerRef} className="mt-4 h-72 w-full" dir="ltr">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={activeBarChartData}
                              margin={{ top: 12, right: 16, left: 8, bottom: 8 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 11, fill: '#334155' }}
                                axisLine={{ stroke: '#CBD5E1' }}
                                tickLine={false}
                              />
                              <YAxis
                                tick={{ fontSize: 11, fill: '#475569' }}
                                axisLine={false}
                                tickLine={false}
                                width={44}
                              />
                              <Tooltip
                                formatter={(value, name) => [`${value} ${chartUnit}`, name]}
                                contentStyle={{
                                  borderRadius: '6px',
                                  border: '1px solid #E2E8F0',
                                  fontSize: '12px',
                                  direction: 'rtl',
                                  textAlign: 'right',
                                }}
                              />
                              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                              <Bar
                                dataKey="reportA"
                                name={`أ · ${leftReport.title}`}
                                fill="#1D4ED8"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={44}
                              />
                              <Bar
                                dataKey="reportB"
                                name={`ب · ${rightReport.title}`}
                                fill="#0F766E"
                                radius={[4, 4, 0, 0]}
                                maxBarSize={44}
                              />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Side-by-Side Comparison Table */}
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-right text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
                        <tr>
                          <th className="w-44 px-4 py-3 font-semibold">البند / المؤشر الاقتصادي</th>
                          <th className="border-r border-slate-200 px-4 py-3 font-bold text-slate-900">
                            أ · {leftReport.title}
                          </th>
                          <th className="border-r border-slate-200 px-4 py-3 font-bold text-slate-900">
                            ب · {rightReport.title}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr>
                          <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">التصنيف والفترة والنطاق</td>
                          <td className="border-r border-slate-200 px-4 py-3 text-slate-700">
                            {leftReport.category} · {leftReport.period} · {leftReport.dataScope}
                          </td>
                          <td className="border-r border-slate-200 px-4 py-3 text-slate-700">
                            {rightReport.category} · {rightReport.period} · {rightReport.dataScope}
                          </td>
                        </tr>

                        <tr>
                          <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">حالة التحقق والثقة</td>
                          {[leftReport, rightReport].map((rep, i) => {
                            const vMeta = getVerificationMeta(rep.confidenceStatus);
                            return (
                              <td key={`conf-${i}-${rep.id}`} className="border-r border-slate-200 px-4 py-3">
                                <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${vMeta.className}`}>
                                  {rep.confidenceLabel}
                                </span>
                                {rep.missingDataNote && (
                                  <div className="mt-1.5 text-[11px] text-amber-800">{rep.missingDataNote}</div>
                                )}
                              </td>
                            );
                          })}
                        </tr>

                        <tr>
                          <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">النتيجة الاقتصادية المعتمدة</td>
                          {[leftReport, rightReport].map((rep, i) => (
                            <td key={`res-${i}-${rep.id}`} className="border-r border-slate-200 px-4 py-3">
                              <div className="font-medium text-slate-800">{rep.resultHeadline}</div>
                              <div className="mt-1 font-mono text-sm font-bold tabular-nums text-blue-800">
                                {rep.resultValue}
                              </div>
                            </td>
                          ))}
                        </tr>

                        {Array.from({ length: maxEvidenceRows }).map((_, idx) => {
                          const evA = leftReport.evidence[idx];
                          const evB = rightReport.evidence[idx];
                          const metaA = evA ? getVerificationMeta(evA.status) : null;
                          const metaB = evB ? getVerificationMeta(evB.status) : null;

                          return (
                            <tr key={`ev-${idx}`} className="hover:bg-slate-50/60">
                              <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">
                                مؤشر اقتصادي #{idx + 1}
                              </td>

                              <td className="border-r border-slate-200 px-4 py-3">
                                {evA && metaA ? (
                                  <div>
                                    <div className="font-semibold text-slate-900">{evA.metric}</div>
                                    <div className="mt-1 font-mono font-bold tabular-nums text-slate-900">{evA.value}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                      <span>{evA.source}</span>
                                      <span aria-hidden="true">·</span>
                                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${metaA.className}`}>
                                        {metaA.label}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>

                              <td className="border-r border-slate-200 px-4 py-3">
                                {evB && metaB ? (
                                  <div>
                                    <div className="font-semibold text-slate-900">{evB.metric}</div>
                                    <div className="mt-1 font-mono font-bold tabular-nums text-slate-900">{evB.value}</div>
                                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                      <span>{evB.source}</span>
                                      <span aria-hidden="true">·</span>
                                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${metaB.className}`}>
                                        {metaB.label}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}

                        <tr>
                          <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">التشخيص والأسباب</td>
                          {[leftReport, rightReport].map((rep, i) => (
                            <td key={`causes-${i}-${rep.id}`} className="border-r border-slate-200 px-4 py-3 align-top">
                              <div className="space-y-2">
                                {rep.causes.map((c, cIdx) => {
                                  const ep = getEpistemicLabel(c.level);
                                  return (
                                    <div key={cIdx} className="rounded border border-slate-100 bg-slate-50 p-2">
                                      <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium ${ep.toneClass}`}>
                                        {ep.label}
                                      </span>
                                      <p className="mt-1 leading-relaxed text-slate-700">{c.text}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          ))}
                        </tr>

                        <tr>
                          <td className="bg-slate-50/50 px-4 py-3 font-semibold text-slate-700">الإجراءات والأثر المتوقع</td>
                          {[leftReport, rightReport].map((rep, i) => (
                            <td key={`actions-${i}-${rep.id}`} className="border-r border-slate-200 px-4 py-3 align-top">
                              <ul className="space-y-1.5 text-slate-700">
                                {rep.suggestedActions.map((act, aIdx) => (
                                  <li key={aIdx}>
                                    • {act.action}{' '}
                                    <span className="font-mono text-[11px] text-blue-800">({act.expectedImpact})</span>{' '}
                                    <span className="text-[11px] text-slate-500">· {ROLE_TITLES[act.ownerRole]}</span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3">
              <div className="text-xs font-medium text-emerald-800">{exportNotice ?? ''}</div>

              <div className="flex items-center gap-2">
                {data.reports.length >= 2 && leftReport && rightReport && (
                  canExportReports ? (
                    <>
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                        <span>تنزيل CSV</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleExportPdf}
                        disabled={exportingPdf}
                        className="inline-flex items-center gap-1.5 rounded-md border border-blue-700 bg-blue-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        <span>{exportingPdf ? 'جارٍ التصدير...' : 'تنزيل PDF للاجتماعات'}</span>
                      </button>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-500">
                      <Lock className="h-3 w-3" />
                      <span>التصدير محجوب حسب صلاحيات الدور</span>
                    </span>
                  )
                )}

                <button
                  type="button"
                  onClick={() => setIsCompareModalOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Proactive Notification Toast Stack */}
      {toastNotifications.length > 0 && (
        <div
          className="fixed bottom-5 left-5 z-40 flex w-96 max-w-[calc(100vw-2.5rem)] flex-col gap-2.5"
          aria-live="polite"
        >
          {toastNotifications.map((toast) => {
            const borderTone =
              toast.severity === 'critical'
                ? 'border-red-300 bg-white'
                : toast.severity === 'warning'
                ? 'border-amber-300 bg-white'
                : 'border-blue-200 bg-white';
            const iconColor =
              toast.severity === 'critical'
                ? 'text-red-700'
                : toast.severity === 'warning'
                ? 'text-amber-700'
                : 'text-blue-700';

            return (
              <div
                key={toast.uid}
                role="status"
                className={`rounded-lg border p-4 shadow-lg ${borderTone}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <BellRing className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
                    <div>
                      <div className="text-xs font-bold text-slate-900">{toast.title}</div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{toast.message}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="إغلاق الإشعار"
                    onClick={() =>
                      setToastNotifications((prev) => prev.filter((item) => item.uid !== toast.uid))
                    }
                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-2.5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAlertsPanel(true);
                      setToastNotifications((prev) => prev.filter((item) => item.uid !== toast.uid));
                      setTimeout(() => {
                        alertsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 50);
                    }}
                    className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-50"
                  >
                    مراجعة التنبيهات
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
