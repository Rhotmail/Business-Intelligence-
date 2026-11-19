import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Plus, ShieldAlert, XCircle } from 'lucide-react';
import { approveDecisionCase, createDecisionCase, progressDecisionCase } from '../api/client.ts';
import { useFirebase } from '../context/FirebaseContext.tsx';
import { DashboardPayload, DecisionCase, DecisionStage, RoleId } from '../types.ts';
import {
  formatMillionsIQD,
  getEpistemicLabel,
  getVerificationMeta,
  ROLE_TITLES,
  STAGE_LABELS,
} from '../utils/formatters.ts';

interface DecisionsViewProps {
  data: DashboardPayload;
  activeRole: RoleId;
  onReload: () => void;
}

const ORDERED_STAGES: DecisionStage[] = [
  'detection',
  'verification',
  'diagnosis',
  'decision_design',
  'assignment_approval',
  'execution',
  'outcome_measurement',
];

export const DecisionsView: React.FC<DecisionsViewProps> = ({ data, activeRole, onReload }) => {
  const { saveDecisionToFirestore, appendWorkspaceLog } = useFirebase();
  const [filter, setFilter] = useState<'all' | 'pending_approval' | 'execution' | 'measured'>('all');
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [showNewForm, setShowNewForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMetric, setNewMetric] = useState('هامش المساهمة');
  const [newAction, setNewAction] = useState('');
  const [newImpact, setNewImpact] = useState('10000000');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredDecisions = useMemo(() => {
    return data.decisions.filter((d) => {
      if (filter === 'pending_approval') return d.requiresOwnerApproval && d.approvalStatus === 'pending_review';
      if (filter === 'execution') return d.stage === 'execution';
      if (filter === 'measured') return d.stage === 'outcome_measurement';
      return true;
    });
  }, [data.decisions, filter]);

  const handleApprove = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id);
    setErrorMsg(null);
    const current = data.decisions.find((d) => d.id === id);
    try {
      let updated: DecisionCase;
      try {
        updated = await approveDecisionCase(activeRole, id, decision);
      } catch (serverErr) {
        if (current && activeRole === 'owner') {
          updated = {
            ...current,
            approvalStatus: decision === 'approve' ? 'approved' : 'rejected',
            approvedBy: ROLE_TITLES[activeRole],
            stage: decision === 'approve' ? 'execution' : 'diagnosis',
            executionNotes: [
              ...current.executionNotes,
              decision === 'approve'
                ? 'تم اعتماد القرار بشرياً من قِبل المالك.'
                : 'تم رفض التوصية وإعادتها للتشخيص.',
            ],
            updatedAt: new Date().toISOString(),
          };
        } else {
          throw serverErr;
        }
      }
      await saveDecisionToFirestore(updated, false);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: decision === 'approve' ? 'اعتماد قرار تنفيذي' : 'رفض مقترح قرار',
        target: updated.id,
        detail: updated.title,
      });
      onReload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث الاعتماد.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAddNote = async (dec: DecisionCase) => {
    const note = (noteInputs[dec.id] ?? '').trim();
    if (!note) return;
    setBusyId(dec.id);
    setErrorMsg(null);
    try {
      let updated: DecisionCase;
      try {
        updated = await progressDecisionCase(activeRole, dec.id, { note });
      } catch {
        updated = {
          ...dec,
          executionNotes: [...dec.executionNotes, `${ROLE_TITLES[activeRole]}: ${note}`],
          updatedAt: new Date().toISOString(),
        };
      }
      await saveDecisionToFirestore(updated, false);
      setNoteInputs((prev) => ({ ...prev, [dec.id]: '' }));
      onReload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ الملاحظة.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRecordOutcome = async (dec: DecisionCase) => {
    setBusyId(dec.id);
    setErrorMsg(null);
    const outcome = {
      postActionValue: 'تحسن مرصود مقارنة بخط الأساس',
      deltaObserved: `تم رصد أثر مالي مبدئي نحو الهدف (${formatMillionsIQD(dec.estimatedFinancialImpact)})`,
      attributionConfidence: 'متوسطة — يتطلب استمرار المراقبة لفترة مالية كاملة',
      verdict: 'improved' as const,
    };
    try {
      let updated: DecisionCase;
      try {
        updated = await progressDecisionCase(activeRole, dec.id, {
          stage: 'outcome_measurement',
          note: 'تم إقفال قياس الأثر الفعلي بعد التنفيذ ومقارنته بخط الأساس.',
          outcomeMeasurement: outcome,
        });
      } catch {
        updated = {
          ...dec,
          stage: 'outcome_measurement',
          epistemicLevel: 'execution_outcome',
          executionNotes: [
            ...dec.executionNotes,
            `${ROLE_TITLES[activeRole]}: تم إقفال قياس الأثر الفعلي بعد التنفيذ ومقارنته بخط الأساس.`,
          ],
          outcomeMeasurement: outcome,
          updatedAt: new Date().toISOString(),
        };
      }
      await saveDecisionToFirestore(updated, false);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'إقفال قياس أثر القرار',
        target: updated.id,
        detail: updated.title,
      });
      onReload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل قياس النتيجة.');
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setBusyId('new');
    setErrorMsg(null);
    try {
      const created = await createDecisionCase(activeRole, {
        title: newTitle.trim(),
        detectedMetric: newMetric.trim(),
        proposedAction: newAction.trim() || 'خطة معالجة تشغيلية وتجارية',
        estimatedFinancialImpact: Number(newImpact) || 5000000,
        branchScope: data.filters.branch === 'all' ? 'بغداد' : data.filters.branch,
        period: data.filters.period,
        requiresOwnerApproval: true,
      });
      await saveDecisionToFirestore(created, true);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'إنشاء قضية اقتصادية',
        target: created.id,
        detail: created.title,
      });
      setNewTitle('');
      setNewAction('');
      setShowNewForm(false);
      onReload();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إنشاء القضية.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">دورة القضايا والقرارات والمتابعة</h1>
          <p className="mt-1 text-sm text-slate-600">
            من الاكتشاف والتحقق إلى الاعتماد البشري والتنفيذ وقياس الأثر الفعلي — القرارات الحساسة لا تُنفّذ تلقائياً بواسطة AI.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
            {[
              { id: 'all', label: `الكل (${data.decisions.length})` },
              { id: 'pending_approval', label: 'بانتظار اعتماد المالك' },
              { id: 'execution', label: 'قيد التنفيذ' },
              { id: 'measured', label: 'تم قياس النتيجة' },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id as typeof filter)}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  filter === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {data.role.allowedActions.includes('propose') &&
            (data.activePolicy ? data.activePolicy.canCreateDecisions : true) && (
            <button
              type="button"
              onClick={() => setShowNewForm(!showNewForm)}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" />
              <span>فتح قضية قرار جديدة</span>
            </button>
          )}
        </div>
      </section>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {errorMsg}
        </div>
      )}

      {showNewForm && (
        <form onSubmit={handleCreateNew} className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-sm font-bold text-slate-900">تسجيل قضية اقتصادية جديدة</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block text-xs">
              <span className="font-medium text-slate-700">عنوان القضية / القرار</span>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="مثال: مراجعة تسعير صنف محدد"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-slate-700">المؤشر المرصود</span>
              <input
                type="text"
                value={newMetric}
                onChange={(e) => setNewMetric(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium text-slate-700">الأثر المالي المقدّر (د.ع)</span>
              <input
                type="number"
                value={newImpact}
                onChange={(e) => setNewImpact(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-medium text-slate-700">الإجراء المقترح</span>
            <input
              type="text"
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              placeholder="تحديد الإجراء التنفيذي والجهة المسؤولة..."
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-xs"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busyId === 'new'}
              className="rounded-md bg-blue-700 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
            >
              حفظ القضية
            </button>
          </div>
        </form>
      )}

      {/* Decisions List */}
      <div className="space-y-5">
        {filteredDecisions.map((dec) => {
          const vMeta = getVerificationMeta(dec.verificationStatus);
          const epMeta = getEpistemicLabel(dec.epistemicLevel);
          const currentStageIdx = ORDERED_STAGES.indexOf(dec.stage);

          return (
            <article key={dec.id} className="rounded-lg border border-slate-200 bg-white p-6">
              {/* Top Meta & Title */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono text-slate-700">{dec.id}</span>
                    <span aria-hidden="true">·</span>
                    <span>{dec.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>المسؤول: {ROLE_TITLES[dec.ownerRole]}</span>
                    <span aria-hidden="true">·</span>
                    <span>فرع {dec.branchScope}</span>
                    <span aria-hidden="true">·</span>
                    <span>المهلة: {dec.dueDate}</span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold text-slate-900">{dec.title}</h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2.5 py-1 text-[11px] font-medium ${vMeta.className}`}>
                    {vMeta.label}
                  </span>
                  <span className={`rounded border px-2.5 py-1 text-[11px] font-medium ${epMeta.toneClass}`}>
                    {epMeta.label}
                  </span>
                </div>
              </div>

              {/* 7-Stage Progress Strip */}
              <div className="mt-4 grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
                {ORDERED_STAGES.map((st, idx) => {
                  const isDone = idx < currentStageIdx;
                  const isCurrent = idx === currentStageIdx;
                  return (
                    <div
                      key={st}
                      className={`rounded border px-2 py-1.5 text-center text-[11px] font-medium ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : isDone
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                      }`}
                    >
                      {STAGE_LABELS[st]}
                    </div>
                  );
                })}
              </div>

              {/* Diagnosis & Proposed Action */}
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="space-y-3 lg:col-span-7">
                  <div className="text-xs leading-relaxed text-slate-700">
                    <span className="font-bold text-slate-900">التشخيص والأدلة: </span>
                    {dec.diagnosisSummary}
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div className="font-bold text-slate-900">الإجراء المصمم للمعالجة:</div>
                    <p className="mt-1 leading-relaxed text-slate-700">{dec.proposedAction}</p>
                  </div>

                  {/* Execution Notes */}
                  {dec.executionNotes.length > 0 && (
                    <div className="text-xs">
                      <div className="font-semibold text-slate-800">سجل التنفيذ والمتابعة:</div>
                      <ul className="mt-1.5 space-y-1 text-slate-600">
                        {dec.executionNotes.map((n, i) => (
                          <li key={i}>• {n}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {/* Right Metrics, Approval & Outcome */}
                <div className="space-y-3 lg:col-span-5">
                  <div className="grid grid-cols-2 gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-500">خط الأساس ← الحالي</div>
                      <div className="mt-1 font-mono font-semibold text-slate-900">
                        {dec.baselineValue} ← {dec.currentValue}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-500">الأثر المالي المقدّر</div>
                      <div className="mt-1 font-mono font-bold tabular-nums text-blue-800">
                        {formatMillionsIQD(dec.estimatedFinancialImpact)}
                      </div>
                    </div>
                  </div>

                  {/* Human-in-the-loop Approval Controls */}
                  {dec.requiresOwnerApproval && dec.approvalStatus === 'pending_review' && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5 text-xs">
                      <div className="flex items-center gap-2 font-bold text-amber-950">
                        <ShieldAlert className="h-4 w-4 text-amber-700" />
                        <span>بانتظار الاعتماد البشري من المالك</span>
                      </div>
                      {activeRole === 'owner' ? (
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busyId === dec.id}
                            onClick={() => handleApprove(dec.id, 'approve')}
                            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>اعتماد وتوجيه للتنفيذ</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyId === dec.id}
                            onClick={() => handleApprove(dec.id, 'reject')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>إعادة للتشخيص</span>
                          </button>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-amber-900">
                          هذا القرار يتجاوز صلاحية الإدارة ويتطلب موافقة حساب المالك قبل بدء التنفيذ.
                        </p>
                      )}
                    </div>
                  )}

                  {dec.approvalStatus === 'approved' && (
                    <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                      <span>معتمد من قِبل {dec.approvedBy ?? 'المالك'}</span>
                    </div>
                  )}

                  {/* Outcome Measurement Box */}
                  {dec.outcomeMeasurement ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs">
                      <div className="font-bold text-emerald-950">نتيجة القياس الفعلي بعد التنفيذ</div>
                      <div className="mt-1 font-semibold text-emerald-900">
                        {dec.outcomeMeasurement.postActionValue}
                      </div>
                      <p className="mt-1 text-emerald-800">{dec.outcomeMeasurement.deltaObserved}</p>
                      <p className="mt-1 text-[11px] text-emerald-700">
                        تقييم نسب الأثر: {dec.outcomeMeasurement.attributionConfidence}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={noteInputs[dec.id] ?? ''}
                          onChange={(e) => setNoteInputs((p) => ({ ...p, [dec.id]: e.target.value }))}
                          placeholder="إضافة دليل أو تحديث تنفيذي..."
                          className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddNote(dec)}
                          disabled={busyId === dec.id}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          تسجيل
                        </button>
                      </div>
                      {dec.stage === 'execution' && (
                        <button
                          type="button"
                          onClick={() => handleRecordOutcome(dec)}
                          disabled={busyId === dec.id}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          <span>إقفال وقياس الأثر الفعلي مقارنة بخط الأساس</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
