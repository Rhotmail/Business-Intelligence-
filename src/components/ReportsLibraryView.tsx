import React, { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Lock, PlusCircle, Search, Star } from 'lucide-react';
import { DashboardPayload, ReportDefinition, RoleId } from '../types.ts';
import { getEpistemicLabel, getVerificationMeta, ROLE_TITLES } from '../utils/formatters.ts';

interface ReportsLibraryViewProps {
  data: DashboardPayload;
  activeRole: RoleId;
  selectedReport: ReportDefinition | null;
  onSelectReport: (report: ReportDefinition | null) => void;
  onToggleFavorite: (reportId: string) => void;
  onConvertToDecision: (report: ReportDefinition) => Promise<void>;
}

export const ReportsLibraryView: React.FC<ReportsLibraryViewProps> = ({
  data,
  activeRole,
  selectedReport,
  onSelectReport,
  onToggleFavorite,
  onConvertToDecision,
}) => {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'favorites'>('all');
  const [converting, setConverting] = useState(false);
  const [convertedMsg, setConvertedMsg] = useState<string | null>(null);

  const filteredReports = useMemo(() => {
    return data.reports.filter((rep) => {
      if (tab === 'favorites' && !data.favorites.includes(rep.id)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          rep.title.toLowerCase().includes(q) ||
          rep.category.toLowerCase().includes(q) ||
          rep.summary.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data.reports, data.favorites, tab, search]);

  const recentList = useMemo(
    () =>
      data.recentReports
        .map((id) => data.reports.find((r) => r.id === id))
        .filter((r): r is ReportDefinition => Boolean(r)),
    [data.recentReports, data.reports]
  );

  // Unified Report Reader View
  if (selectedReport) {
    const vMeta = getVerificationMeta(selectedReport.confidenceStatus);
    const canPropose =
      data.role.allowedActions.includes('propose') &&
      (data.activePolicy ? data.activePolicy.canCreateDecisions : true);

    const handleCreateCase = async () => {
      setConverting(true);
      setConvertedMsg(null);
      try {
        await onConvertToDecision(selectedReport);
        setConvertedMsg('تم تحويل نتيجة التقرير إلى قضية اقتصادية في سجل القرارات والمتابعة.');
      } finally {
        setConverting(false);
      }
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <button
            type="button"
            onClick={() => {
              setConvertedMsg(null);
              onSelectReport(null);
            }}
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 hover:text-blue-700"
          >
            <ArrowRight className="h-4 w-4" />
            <span>العودة إلى مكتبة التقارير</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onToggleFavorite(selectedReport.id)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Star
                className={`h-3.5 w-3.5 ${
                  data.favorites.includes(selectedReport.id)
                    ? 'fill-amber-400 text-amber-500'
                    : 'text-slate-400'
                }`}
              />
              <span>{data.favorites.includes(selectedReport.id) ? 'في المفضلة' : 'إضافة للمفضلة'}</span>
            </button>

            {canPropose && (
              <button
                type="button"
                onClick={handleCreateCase}
                disabled={converting}
                className="inline-flex items-center gap-2 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
              >
                <PlusCircle className="h-4 w-4" />
                <span>{converting ? 'جارٍ الإنشاء...' : 'تحويل إلى قضية اقتصادية'}</span>
              </button>
            )}
          </div>
        </div>

        {convertedMsg && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
            <span>{convertedMsg}</span>
          </div>
        )}

        {/* Standardized Report Template */}
        <article className="rounded-lg border border-slate-200 bg-white p-7">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{selectedReport.category}</span>
                <span aria-hidden="true">·</span>
                <span>الفترة: {selectedReport.period}</span>
                <span aria-hidden="true">·</span>
                <span>النطاق: {selectedReport.dataScope}</span>
                {selectedReport.ownerPrivate && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                      <Lock className="h-3 w-3" /> خاص بالمالك
                    </span>
                  </>
                )}
              </div>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">{selectedReport.title}</h1>
              <p className="mt-1 text-sm text-slate-600">{selectedReport.summary}</p>
            </div>

            <div className={`rounded border px-3 py-1.5 text-xs font-semibold ${vMeta.className}`}>
              مؤشر الثقة: {selectedReport.confidenceLabel}
            </div>
          </div>

          {selectedReport.missingDataNote && (
            <div className="mt-5 flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <span className="font-semibold">بيان حدود البيانات: </span>
                <span>{selectedReport.missingDataNote}</span>
              </div>
            </div>
          )}

          {/* Result Banner */}
          <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-5">
            <div className="text-xs font-medium text-slate-500">النتيجة المعتمدة</div>
            <div className="mt-1 text-base font-bold text-slate-900">{selectedReport.resultHeadline}</div>
            <div className="mt-2 font-mono text-xl font-bold tabular-nums text-blue-800">
              {selectedReport.resultValue}
            </div>
          </div>

          {/* Causes & Epistemic Classification */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">الأسباب والتشخيص</h2>
              <div className="mt-3 space-y-3">
                {selectedReport.causes.map((c, idx) => {
                  const ep = getEpistemicLabel(c.level);
                  return (
                    <div key={idx} className="rounded-md border border-slate-200 p-3.5">
                      <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${ep.toneClass}`}>
                        {ep.label}
                      </span>
                      <p className="mt-2 text-xs leading-relaxed text-slate-800">{c.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Evidence Table */}
            <div>
              <h2 className="text-sm font-bold text-slate-900">الأدلة ومصادر المطابقة</h2>
              <div className="mt-3 overflow-hidden rounded-md border border-slate-200">
                <table className="w-full text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold">المؤشر / الدليل</th>
                      <th className="px-3.5 py-2.5 font-semibold">القيمة</th>
                      <th className="px-3.5 py-2.5 font-semibold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedReport.evidence.map((ev, idx) => {
                      const evMeta = getVerificationMeta(ev.status);
                      return (
                        <tr key={idx}>
                          <td className="px-3.5 py-2.5 font-medium text-slate-900">
                            <div>{ev.metric}</div>
                            <div className="text-[11px] text-slate-400">{ev.source}</div>
                          </td>
                          <td className="px-3.5 py-2.5 font-mono tabular-nums text-slate-800">{ev.value}</td>
                          <td className="px-3.5 py-2.5">
                            <span className={`rounded border px-2 py-0.5 text-[11px] ${evMeta.className}`}>
                              {evMeta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Risks & Suggested Actions */}
          <div className="mt-6 grid grid-cols-1 gap-6 border-t border-slate-100 pt-6 lg:grid-cols-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">المخاطر المرصودة</h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-slate-700">
                {selectedReport.risks.map((risk, idx) => (
                  <li key={idx}>• {risk}</li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-bold text-slate-900">الإجراءات المقترحة (تتطلب اعتماداً بشرياً)</h2>
              <div className="mt-3 space-y-2.5">
                {selectedReport.suggestedActions.map((act, idx) => (
                  <div key={idx} className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div className="font-semibold text-slate-900">{act.action}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-slate-600">
                      <span>الأثر المتوقع: {act.expectedImpact}</span>
                      <span aria-hidden="true">·</span>
                      <span>المسؤول: {ROLE_TITLES[act.ownerRole]}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </article>
      </div>
    );
  }

  // Library Grid View
  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">مكتبة التقارير المتخصصة</h1>
          <p className="mt-1 text-sm text-slate-600">
            تُعرض فقط التقارير المصرح بها لحساب ({ROLE_TITLES[activeRole]}) والمستندة إلى مصادر بيانات متحققة.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث في التقارير..."
              className="w-56 rounded-md border border-slate-300 bg-white py-2 pr-9 pl-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              جميع التقارير ({data.reports.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('favorites')}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                tab === 'favorites' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              المفضلة ({data.favorites.length})
            </button>
          </div>
        </div>
      </section>

      {/* Recent Reports Quick Strip */}
      {recentList.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-slate-500">التقارير الأخيرة:</span>
          {recentList.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelectReport(r)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-slate-700 hover:border-blue-400 hover:text-blue-800"
            >
              {r.title}
            </button>
          ))}
        </div>
      )}

      {/* Report Cards */}
      {filteredReports.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">لا توجد تقارير مطابقة لمرشح البحث الحالي.</p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setTab('all');
            }}
            className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            إعادة ضبط البحث
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredReports.map((rep) => {
            const vMeta = getVerificationMeta(rep.confidenceStatus);
            const isFav = data.favorites.includes(rep.id);
            return (
              <div
                key={rep.id}
                className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <FileText className="h-3.5 w-3.5 text-blue-700" />
                      <span>{rep.category}</span>
                      {rep.ownerPrivate && <Lock className="h-3 w-3 text-slate-500" />}
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(rep.id)}
                      aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-amber-500"
                    >
                      <Star className={`h-4 w-4 ${isFav ? 'fill-amber-400 text-amber-500' : ''}`} />
                    </button>
                  </div>

                  <h3 className="mt-3 text-base font-bold text-slate-900">{rep.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{rep.summary}</p>

                  <div className="mt-4 rounded border border-slate-100 bg-slate-50 px-3 py-2 font-mono text-xs font-semibold tabular-nums text-slate-900">
                    {rep.resultValue}
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${vMeta.className}`}>
                    {vMeta.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectReport(rep)}
                    className="text-xs font-semibold text-blue-700 hover:text-blue-800"
                  >
                    فتح التقرير الكامل
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
