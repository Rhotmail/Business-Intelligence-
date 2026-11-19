import React from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Star, TrendingDown, TrendingUp } from 'lucide-react';
import { DashboardPayload, ReportDefinition, WorkspaceSection } from '../types.ts';
import { formatMillionsIQD, getVerificationMeta, STAGE_LABELS } from '../utils/formatters.ts';

interface HomeViewProps {
  data: DashboardPayload;
  onOpenReport: (report: ReportDefinition) => void;
  onNavigate: (section: WorkspaceSection) => void;
}

export const HomeView: React.FC<HomeViewProps> = ({ data, onOpenReport, onNavigate }) => {
  const { weeklyBrief, kpis, decisions, reports, favorites, conflicts } = data;
  const favoriteReports = reports.filter((r) => favorites.includes(r.id));
  const urgentDecisions = decisions.filter(
    (d) => d.approvalStatus === 'pending_review' || d.severity === 'high'
  );
  const pendingConflicts = conflicts.filter((c) => c.status === 'pending');

  return (
    <div className="space-y-8">
      {/* Executive Role Summary Header */}
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{data.role.workspaceName}</h1>
          <p className="mt-1 text-sm text-slate-600">{data.role.description}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('analysis')}
            className="rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-800"
          >
            فتح التحليل والتوأم الاقتصادي
          </button>
          <button
            type="button"
            onClick={() => onNavigate('decisions')}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            متابعة القرارات ({decisions.length})
          </button>
        </div>
      </section>

      {/* Pending Data Conflict Banner (If Any) */}
      {pendingConflicts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-5 py-3.5 text-sm text-amber-950">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <span className="font-semibold">تعارض مصادر بيانات بانتظار الاعتماد: </span>
              <span>{pendingConflicts[0].metricLabel} (فارق {pendingConflicts[0].variancePct}%)</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('data')}
            className="whitespace-nowrap rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            مراجعة وحسم المصدر
          </button>
        </div>
      )}

      {/* 4 Core KPIs with Strict Provenance & Verification State */}
      <section aria-label="المؤشرات الاقتصادية المعتمدة">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => {
            const vMeta = getVerificationMeta(kpi.verificationStatus);
            return (
              <div
                key={kpi.key}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">{kpi.label}</span>
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${vMeta.className}`}>
                      {vMeta.label}
                    </span>
                  </div>
                  <div className="mt-3 font-mono text-2xl font-bold tabular-nums text-slate-900">
                    {kpi.formattedValue}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    {kpi.trendDirection === 'up' && (
                      <TrendingUp
                        className={`h-3.5 w-3.5 shrink-0 ${kpi.favorable ? 'text-emerald-700' : 'text-red-700'}`}
                      />
                    )}
                    {kpi.trendDirection === 'down' && (
                      <TrendingDown
                        className={`h-3.5 w-3.5 shrink-0 ${kpi.favorable ? 'text-emerald-700' : 'text-red-700'}`}
                      />
                    )}
                    <span className={kpi.favorable ? 'text-emerald-800' : 'text-red-800'}>{kpi.deltaLabel}</span>
                  </div>
                  {kpi.unavailableReason && (
                    <p className="mt-2 text-xs leading-relaxed text-amber-800">{kpi.unavailableReason}</p>
                  )}
                </div>

                <div className="mt-4 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                  <div>{kpi.source} · {kpi.period}</div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Weekly Smart Executive Brief + Priority Decisions */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Weekly Brief (7 cols) */}
        <div className="rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">التقرير التنفيذي الذكي الدوري</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                ملخص مخصص لاختصاص ({data.role.titleAr}) مستند إلى محركات الحساب والتحقق — {weeklyBrief.period}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-bold text-emerald-800">ما تحسّن</h3>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-700">
                {weeklyBrief.improved.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold text-red-800">ما تراجع</h3>
              <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-700">
                {weeklyBrief.declined.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold text-slate-900">أهم المشكلات والأسباب المدعومة بالبيانات</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700">
              {weeklyBrief.evidenceBackedCauses.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold text-slate-900">التغيير منذ التقرير السابق</h3>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-600">
              {weeklyBrief.changesSinceLastBrief.map((c, i) => (
                <li key={i}>• {c}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Priority Cases & Favorite Reports (5 cols) */}
        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">القضايا التي تستحق التدخل</h2>
              <button
                type="button"
                onClick={() => onNavigate('decisions')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                <span>عرض الكل</span>
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 divide-y divide-slate-100">
              {urgentDecisions.length === 0 ? (
                <p className="py-4 text-xs text-slate-500">لا توجد قضايا حرجة مفتوحة ضمن نطاقك.</p>
              ) : (
                urgentDecisions.slice(0, 3).map((dec) => (
                  <div key={dec.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{dec.title}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{STAGE_LABELS[dec.stage]}</span>
                      <span aria-hidden="true">·</span>
                      <span>فرع {dec.branchScope}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-800">
                        أثر مقدّر: {formatMillionsIQD(dec.estimatedFinancialImpact)}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900">التقارير المفضلة السريعة</h2>
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800"
              >
                <span>مكتبة التقارير</span>
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-4 space-y-2.5">
              {(favoriteReports.length > 0 ? favoriteReports : reports.slice(0, 2)).map((rep) => (
                <button
                  key={rep.id}
                  type="button"
                  onClick={() => onOpenReport(rep)}
                  className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3.5 py-2.5 text-right transition-colors hover:border-blue-300 hover:bg-slate-50"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-slate-900">{rep.title}</div>
                      <div className="truncate text-[11px] text-slate-500">{rep.resultValue}</div>
                    </div>
                  </div>
                  <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
