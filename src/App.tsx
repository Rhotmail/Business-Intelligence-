import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDecisionCase,
  fetchDashboard,
  recordRecentReport,
  toggleFavoriteReport,
} from './api/client.ts';
import { AnalysisView } from './components/AnalysisView.tsx';
import { AuthGate } from './components/AuthGate.tsx';
import { DataGovernanceView } from './components/DataGovernanceView.tsx';
import { DecisionsView } from './components/DecisionsView.tsx';
import { HomeView } from './components/HomeView.tsx';
import { ReportsLibraryView } from './components/ReportsLibraryView.tsx';
import { WorkspaceShell } from './components/WorkspaceShell.tsx';
import { getBlockedMetricKeysForBudgetPolicy, useFirebase } from './context/FirebaseContext.tsx';
import {
  DashboardPayload,
  ProactiveAlertNotification,
  ReportDefinition,
  RoleId,
  WorkspaceSection,
} from './types.ts';

export function App() {
  const {
    user,
    accountRole,
    authReady,
    profile,
    persistedDecisions,
    persistedAlertRules,
    persistedAlertStates,
    persistedLogs,
    rolePermissions,
    budgetPermissions,
    saveProfilePreferences,
    seedWorkspaceIfEmpty,
    saveDecisionToFirestore,
    appendWorkspaceLog,
  } = useFirebase();

  const [activeRole, setActiveRole] = useState<RoleId>('owner');
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('home');
  const [period, setPeriod] = useState<string>('2026-Q3');
  const [branch, setBranch] = useState<string>('all');
  const [entityGroup, setEntityGroup] = useState<string>('product');

  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportDefinition | null>(null);

  const hydratedProfileUidRef = useRef<string | null>(null);

  const activePolicy = useMemo(
    () => (accountRole && accountRole !== 'owner' ? rolePermissions[accountRole] : undefined),
    [accountRole, rolePermissions]
  );

  const activeBudgetPolicy = useMemo(
    () =>
      accountRole === 'operations' || accountRole === 'sales'
        ? budgetPermissions[accountRole]
        : undefined,
    [accountRole, budgetPermissions]
  );

  // Bind activeRole strictly to the signed-in executive account
  useEffect(() => {
    if (accountRole) {
      setActiveRole(accountRole);
      setSelectedReport(null);
      setActiveSection('home');
      if (accountRole === 'operations') setBranch('أربيل');
      else if (accountRole === 'sales') setBranch('بغداد');
      else setBranch('all');
    }
  }, [accountRole]);

  // Restore saved period & branch preferences from Firestore profile once per authenticated session
  useEffect(() => {
    if (!user || !profile) {
      if (!user) hydratedProfileUidRef.current = null;
      return;
    }
    if (hydratedProfileUidRef.current === user.uid) return;
    hydratedProfileUidRef.current = user.uid;

    setPeriod(profile.preferredPeriod);
    setBranch(profile.preferredBranch);
  }, [user, profile]);

  // Enforce Admin section, branch, and report-category restrictions reactively
  useEffect(() => {
    if (!activePolicy) return;
    if (
      activePolicy.allowedSections.length > 0 &&
      !activePolicy.allowedSections.includes(activeSection)
    ) {
      setActiveSection(activePolicy.allowedSections[0]);
      setSelectedReport(null);
    }
    if (activePolicy.allowedBranches.length > 0) {
      const currentBranchLabel = branch === 'all' ? 'الشركة كاملة' : branch;
      if (!activePolicy.allowedBranches.includes(currentBranchLabel)) {
        const fallback = activePolicy.allowedBranches[0];
        setBranch(fallback === 'الشركة كاملة' ? 'all' : fallback);
      }
    }
    if (
      selectedReport &&
      !activePolicy.allowedReportCategories.includes(selectedReport.category)
    ) {
      setSelectedReport(null);
    }
  }, [activePolicy, activeSection, branch, selectedReport]);

  const loadData = useCallback(
    async (isBackground = false) => {
      if (!user) return;
      if (isBackground) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const payload = await fetchDashboard(activeRole, period, branch, entityGroup);
        setData(payload);
        setSelectedReport((prev) => {
          if (!prev) return null;
          return payload.reports.find((r) => r.id === prev.id) ?? null;
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات المنصة.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, activeRole, period, branch, entityGroup]
  );

  useEffect(() => {
    if (authReady && user && accountRole && activeRole === accountRole) {
      loadData(Boolean(data));
    }
  }, [authReady, user, accountRole, activeRole, loadData]);

  // Seed Firestore shared workspace collections on initial login when empty
  useEffect(() => {
    if (user && data) {
      void seedWorkspaceIfEmpty(data.decisions, data.alertRules);
    }
  }, [user, data, seedWorkspaceIfEmpty]);

  // Merge Express analytical engine with Firestore-persisted user data, Admin RoleAccessPolicy, & Finance BudgetAccessPolicy
  const effectiveData = useMemo<DashboardPayload | null>(() => {
    if (!data) return null;

    const sensitiveMarginKeys = new Set([
      'contribution_margin',
      'gross_margin',
      'gross_profit',
      'net_profit',
      'net_margin',
    ]);
    const hideMargins = Boolean(activePolicy && !activePolicy.canViewFinancialMargins);
    const blockedBudgetMetrics = getBlockedMetricKeysForBudgetPolicy(activeBudgetPolicy);

    const isMetricRestricted = (metricKey: string) =>
      (hideMargins && sensitiveMarginKeys.has(metricKey)) || blockedBudgetMetrics.has(metricKey);

    const effectiveFavorites = profile ? profile.favoriteReportIds : data.favorites;
    const effectiveRecents = profile ? profile.recentReportIds : data.recentReports;

    const visibleReports = (
      activePolicy
        ? data.reports.filter((rep) => activePolicy.allowedReportCategories.includes(rep.category))
        : data.reports
    ).map((rep) => {
      if (!hideMargins && blockedBudgetMetrics.size === 0) return rep;
      return {
        ...rep,
        comparisonMetrics: rep.comparisonMetrics?.filter((m) => !isMetricRestricted(m.key)),
        forecastSeries: rep.forecastSeries?.filter((s) => !isMetricRestricted(s.metricKey)),
      };
    });

    const visibleReportIds = new Set(visibleReports.map((r) => r.id));

    const effectiveDecisions =
      persistedDecisions && persistedDecisions.length > 0
        ? persistedDecisions.filter((d) => {
            if (activeRole === 'owner') return true;
            if (branch !== 'all' && branch !== 'الشركة كاملة' && d.branchScope !== branch) return false;
            return true;
          })
        : data.decisions;

    const effectiveRules =
      persistedAlertRules && persistedAlertRules.length > 0
        ? persistedAlertRules
        : data.alertRules;

    // Re-evaluate proactive alerts locally against Firestore-persisted rules & alertStates
    const enabledRules = effectiveRules.filter((r) => r.enabled);
    const branchLabel = branch === 'all' ? 'الشركة كاملة' : branch;
    const computedAlerts: ProactiveAlertNotification[] = [];

    for (const rep of visibleReports) {
      if (!visibleReportIds.has(rep.id)) continue;
      for (const metric of rep.comparisonMetrics ?? []) {
        if (isMetricRestricted(metric.key)) continue;
        const rule = enabledRules.find((r) => r.metricKey === metric.key);
        if (!rule) continue;
        const breached =
          (rule.comparator === 'gt' && metric.value > rule.threshold) ||
          (rule.comparator === 'lt' && metric.value < rule.threshold);
        if (!breached) continue;

        const diff = Math.abs(metric.value - rule.threshold);
        const deviationAmount = metric.unit === 'يوم' ? Math.round(diff) : Number(diff.toFixed(1));
        const deviationPct =
          rule.threshold > 0 ? Number(((diff / rule.threshold) * 100).toFixed(1)) : 100;
        const severity: ProactiveAlertNotification['severity'] =
          deviationPct >= 20 ? 'critical' : 'warning';
        const alertId = `${rep.id}__${metric.key}__${data.filters.period}__${data.filters.branch}`;
        const fsState = persistedAlertStates[alertId];
        const primaryAction = rep.suggestedActions[0];

        computedAlerts.push({
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
          status: fsState?.status ?? 'active',
          period: data.filters.period,
          branchScope: branchLabel,
          recommendedAction:
            primaryAction?.action ?? `مراجعة انحراف مؤشر ${metric.label} في تقرير ${rep.title}.`,
          targetRole: primaryAction?.ownerRole ?? 'owner',
          detectedAt: data.sources[0]?.lastSyncAt ?? new Date().toISOString(),
          acknowledgedAt: fsState?.updatedAt,
          acknowledgedBy: fsState?.by,
        });
      }
    }

    computedAlerts.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (a.severity !== 'critical' && b.severity === 'critical') return 1;
      return b.deviationPct - a.deviationPct;
    });

    const combinedLogs =
      persistedLogs.length > 0
        ? [...persistedLogs, ...data.auditLogs.filter((l) => !persistedLogs.some((p) => p.id === l.id))].slice(0, 30)
        : data.auditLogs;

    const effectiveKpis =
      hideMargins || blockedBudgetMetrics.size > 0
        ? data.kpis.map((kpi) => {
            const budgetBlocked = blockedBudgetMetrics.has(kpi.key);
            const marginBlocked = hideMargins && sensitiveMarginKeys.has(kpi.key);
            if (!budgetBlocked && !marginBlocked) return kpi;
            return {
              ...kpi,
              value: null,
              formattedValue: budgetBlocked ? 'محجوب رقابياً' : 'محجوب',
              deltaPct: null,
              deltaLabel: budgetBlocked
                ? 'مقيّد وفق ضوابط بنود الميزانية'
                : 'مقيّد حسب صلاحيات الإدارة',
              trendDirection: 'flat' as const,
              favorable: true,
              unavailableReason: budgetBlocked
                ? 'تم حجب هذا البند بقرار المدير المالي لتفعيل الرقابة المالية الصارمة.'
                : 'تم تقييد عرض الهوامش والأرباح الحساسة لهذا الدور من قبل المالك (Admin).',
            };
          })
        : data.kpis;

    const hideCogs = hideMargins || blockedBudgetMetrics.has('gross_margin');
    const hideContrib = hideMargins || blockedBudgetMetrics.has('contribution_margin');
    const effectiveEntityMatrix =
      hideCogs || hideContrib
        ? data.entityMatrix.map((row) => ({
            ...row,
            grossMarginPct: hideCogs ? 0 : row.grossMarginPct,
            contributionMarginPct: hideContrib ? null : row.contributionMarginPct,
          }))
        : data.entityMatrix;

    const effectiveRole = activePolicy
      ? {
          ...data.role,
          dataScopes: activePolicy.allowedBranches,
        }
      : data.role;

    return {
      ...data,
      role: effectiveRole,
      kpis: effectiveKpis,
      varianceBridge: hideContrib ? [] : data.varianceBridge,
      entityMatrix: effectiveEntityMatrix,
      reports: visibleReports,
      favorites: effectiveFavorites.filter((id) => visibleReportIds.has(id)),
      recentReports: effectiveRecents.filter((id) => visibleReportIds.has(id)),
      decisions: effectiveDecisions,
      alertRules: effectiveRules,
      proactiveAlerts: computedAlerts,
      trustVaultCount: activePolicy && !activePolicy.canViewTrustVault ? 0 : data.trustVaultCount,
      trustVaultSample: activePolicy && !activePolicy.canViewTrustVault ? [] : data.trustVaultSample,
      auditLogs: activePolicy && !activePolicy.canViewAuditLogs ? [] : combinedLogs,
      activePolicy,
      activeBudgetPolicy,
    };
  }, [
    data,
    profile,
    persistedDecisions,
    persistedAlertRules,
    persistedAlertStates,
    persistedLogs,
    activeRole,
    activePolicy,
    activeBudgetPolicy,
    branch,
  ]);

  const handleOpenReport = async (report: ReportDefinition) => {
    setSelectedReport(report);
    setActiveSection('reports');
    try {
      await recordRecentReport(activeRole, report.id);
      const baseRecents = profile?.recentReportIds ?? effectiveData?.recentReports ?? [];
      const nextRecents = [report.id, ...baseRecents.filter((id) => id !== report.id)].slice(0, 5);
      await saveProfilePreferences({ recentReportIds: nextRecents });
      loadData(true);
    } catch {
      // Non-blocking recent report log
    }
  };

  const handleToggleFavorite = async (reportId: string) => {
    try {
      await toggleFavoriteReport(activeRole, reportId);
      const baseFavs = profile?.favoriteReportIds ?? effectiveData?.favorites ?? [];
      const nextFavs = baseFavs.includes(reportId)
        ? baseFavs.filter((id) => id !== reportId)
        : [reportId, ...baseFavs].slice(0, 20);
      await saveProfilePreferences({ favoriteReportIds: nextFavs });
      loadData(true);
    } catch {
      // ignore
    }
  };

  const handleConvertToDecision = async (report: ReportDefinition) => {
    const primaryAction = report.suggestedActions[0];
    const created = await createDecisionCase(activeRole, {
      title: `قرار مرتبط بتقرير: ${report.title}`,
      category: report.category,
      ownerRole: primaryAction?.ownerRole ?? activeRole,
      branchScope: branch === 'all' ? 'بغداد' : branch,
      period,
      detectedMetric: report.resultHeadline,
      baselineValue: 'مرجع التقرير',
      currentValue: report.resultValue,
      estimatedFinancialImpact: 12000000,
      verificationStatus: report.confidenceStatus,
      diagnosisSummary: report.causes.map((c) => c.text).join(' — '),
      epistemicLevel: report.causes[0]?.level ?? 'analytical_conclusion',
      proposedAction: primaryAction?.action ?? 'متابعة توصيات التقرير واعتماد خطة التنفيذ.',
      requiresOwnerApproval: true,
    });
    await saveDecisionToFirestore(created, true);
    await appendWorkspaceLog({
      actorRole: activeRole,
      action: 'إنشاء قضية من تقرير',
      target: created.id,
      detail: created.title,
    });
    await loadData(true);
  };

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" dir="rtl">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-slate-900">OWNER AI Enterprise</div>
          <p className="mt-2 text-xs text-slate-500">جارٍ التحقق من جلسة المصادقة والاتصال بقاعدة البيانات...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  if (loading && !effectiveData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" dir="rtl">
        <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-slate-900">OWNER AI Enterprise</div>
          <p className="mt-2 text-xs text-slate-500">جارٍ تحميل محركات الاستخبارات الاقتصادية وبيانات Firestore...</p>
        </div>
      </div>
    );
  }

  if (error && !effectiveData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" dir="rtl">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-white p-6 text-center">
          <div className="text-base font-bold text-red-800">تعذر الاتصال بالخادم</div>
          <p className="mt-2 text-xs text-slate-600">{error}</p>
          <button
            type="button"
            onClick={() => loadData(false)}
            className="mt-4 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (!effectiveData) return null;

  return (
    <WorkspaceShell
      data={effectiveData}
      activeSection={activeSection}
      onChangeSection={(sec) => {
        setActiveSection(sec);
        if (sec !== 'reports') setSelectedReport(null);
      }}
      period={period}
      onChangePeriod={(p) => {
        setPeriod(p);
        void saveProfilePreferences({ preferredPeriod: p });
      }}
      branch={branch}
      onChangeBranch={(b) => {
        setBranch(b);
        void saveProfilePreferences({ preferredBranch: b });
      }}
      onRefresh={() => loadData(true)}
      isRefreshing={refreshing}
    >
      {activeSection === 'home' && (
        <HomeView
          data={effectiveData}
          onOpenReport={handleOpenReport}
          onNavigate={setActiveSection}
        />
      )}

      {activeSection === 'reports' && (
        <ReportsLibraryView
          data={effectiveData}
          activeRole={activeRole}
          selectedReport={selectedReport}
          onSelectReport={(rep) => {
            if (rep) {
              handleOpenReport(rep);
            } else {
              setSelectedReport(null);
            }
          }}
          onToggleFavorite={handleToggleFavorite}
          onConvertToDecision={handleConvertToDecision}
        />
      )}

      {activeSection === 'analysis' && (
        <AnalysisView
          data={effectiveData}
          activeRole={activeRole}
          entityGroup={entityGroup}
          onChangeEntityGroup={setEntityGroup}
          onReload={() => loadData(true)}
        />
      )}

      {activeSection === 'decisions' && (
        <DecisionsView
          data={effectiveData}
          activeRole={activeRole}
          onReload={() => loadData(true)}
        />
      )}

      {(activeSection === 'data' || activeSection === 'trust') && (
        <DataGovernanceView
          mode={activeSection}
          data={effectiveData}
          activeRole={activeRole}
          onReload={() => loadData(true)}
        />
      )}
    </WorkspaceShell>
  );
}

export default App;
