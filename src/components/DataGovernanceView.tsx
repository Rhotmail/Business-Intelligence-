import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FolderSearch,
  Lock,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import {
  resolveSourceConflict,
  scanWatchedFolderApi,
  syncDatabaseSource,
  updateDeploymentMode,
  uploadManualFile,
} from '../api/client.ts';
import { DashboardPayload, DeploymentMode, RoleId } from '../types.ts';
import {
  DEPLOYMENT_MODE_LABELS,
  formatMillionsIQD,
  getVerificationMeta,
  ROLE_TITLES,
} from '../utils/formatters.ts';
import { BudgetGovernanceManager } from './BudgetGovernanceManager.tsx';
import { RolePermissionsManager } from './RolePermissionsManager.tsx';

interface DataGovernanceViewProps {
  mode: 'data' | 'trust';
  data: DashboardPayload;
  activeRole: RoleId;
  onReload: () => void;
}

export const DataGovernanceView: React.FC<DataGovernanceViewProps> = ({
  mode,
  data,
  activeRole,
  onReload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dataSubTab, setDataSubTab] = useState<'sources' | 'budget' | 'permissions'>('sources');

  const isAdminOwner = activeRole === 'owner';
  const canViewVault = isAdminOwner || (data.activePolicy ? data.activePolicy.canViewTrustVault : activeRole === 'finance');
  const canViewLogs = isAdminOwner || (data.activePolicy ? data.activePolicy.canViewAuditLogs : activeRole === 'finance');
  const canResolveConflicts = isAdminOwner || (data.activePolicy ? data.activePolicy.canResolveConflicts : activeRole === 'finance');

  const handleManualFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusyAction('upload');
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Content = btoa(binary);
      const res = await uploadManualFile(activeRole, {
        fileName: file.name,
        base64Content,
      });

      if (res.duplicateSkipped) {
        setErrorMessage('تم منع الاستيراد المكرر: هذا الملف مطابق لبصمة دفعة مستوردة مسبقاً.');
      } else {
        setStatusMessage(
          `تمت معالجة الملف (${file.name}) عبر محرك التحقق: أُضيف ${res.acceptedCount} سجل إلى القاعدة الموحدة.`
        );
      }
      onReload();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'فشل رفع الملف.');
    } finally {
      setBusyAction(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadSampleCsv = () => {
    const csv = [
      'period,branch,channel,customer,product,supplier,unitsSold,listPrice,discountAmount,cogs,variableCost,opexAllocated,inventoryValue,inventoryDays,arBalance,arDays,wasteCost,slaFulfillmentPct',
      '2026-Q3,بغداد,الجملة المباشرة,العميل النور,منتج روابي,المورد الأصيل,2200,12500,1375000,17600000,2100000,1800000,12000000,40,5500000,35,310000,96.5',
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'owner_ai_upload_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleScanWatched = async (dropSample: boolean) => {
    setBusyAction('watched');
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await scanWatchedFolderApi(activeRole, dropSample);
      setStatusMessage(
        `فحص المجلد المراقَب (OWNER_AI_DATA): وُجد ${res.filesScanned.length} ملف، استُورد ${res.newBatches.length} دفعة جديدة، وتُخطي ${res.skippedDuplicates} ملف مكرر.`
      );
      onReload();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر فحص المجلد المراقب.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncDb = async (sourceId: string) => {
    setBusyAction(sourceId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const res = await syncDatabaseSource(activeRole, sourceId);
      setStatusMessage(res.message);
      onReload();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذرت المزامنة.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResolveConflict = async (conflictId: string, choice: 'primary' | 'secondary') => {
    setBusyAction(conflictId);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await resolveSourceConflict(activeRole, conflictId, choice);
      setStatusMessage('تم اعتماد مصدر الحقيقة وحسم التعارض في السجل الرسمي.');
      onReload();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حسم التعارض.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeploymentModeChange = async (nextMode: DeploymentMode) => {
    setBusyAction('mode');
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateDeploymentMode(activeRole, nextMode);
      setStatusMessage(`تم تحديث نموذج التشغيل إلى: ${DEPLOYMENT_MODE_LABELS[nextMode].title}`);
      onReload();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر تغيير نموذج النشر.');
    } finally {
      setBusyAction(null);
    }
  };

  if (mode === 'trust') {
    return (
      <div className="space-y-8">
        <section className="border-b border-slate-200 pb-5">
          <h1 className="text-2xl font-bold text-slate-900">طبقة الحماية المحلية — Enterprise AI Trust والحوكمة</h1>
          <p className="mt-1 text-sm text-slate-600">
            تُستبدل أسماء الشركات والعملاء والموردين والمنتجات برموز ثابتة داخل خادم الشركة، ولا يُرسل قاموس الرموز إلى الخارج إطلاقاً.
          </p>
        </section>

        {statusMessage && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
            {errorMessage}
          </div>
        )}

        {/* Deployment Models */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-base font-bold text-slate-900">نموذج التشغيل والخصوصية (Deployment Architecture)</h2>
          <p className="mt-1 text-xs text-slate-500">
            يُغيَّر نموذج النشر بواسطة المالك فقط. في وضع الخصوصية الكاملة (Fully Private) يُمنع أي اتصال خارجي بنماذج الذكاء الاصطناعي.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {(['hybrid', 'fully_private', 'managed_cloud'] as DeploymentMode[]).map((dm) => {
              const isSelected = data.deploymentMode === dm;
              return (
                <button
                  key={dm}
                  type="button"
                  disabled={activeRole !== 'owner' || busyAction === 'mode'}
                  onClick={() => handleDeploymentModeChange(dm)}
                  className={`rounded-lg border p-4 text-right transition-colors ${
                    isSelected
                      ? 'border-blue-600 bg-blue-50/70'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  } disabled:cursor-not-allowed disabled:opacity-80`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">{DEPLOYMENT_MODE_LABELS[dm].title}</span>
                    {isSelected && <CheckCircle2 className="h-4 w-4 text-blue-700" />}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-600">{DEPLOYMENT_MODE_LABELS[dm].subtitle}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Local Trust Vault Dictionary */}
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <div>
                <h2 className="text-base font-bold text-slate-900">قاموس الرموز المحلي (Trust Vault)</h2>
                <p className="text-xs text-slate-500">
                  الترميز وفك الترميز يتمّان محلياً بالكامل دون استدعاء أي API خارجي
                </p>
              </div>
            </div>
            <span className="font-mono text-xs font-semibold text-slate-700">
              {data.trustVaultCount} كيان محمي
            </span>
          </div>

          {!canViewVault ? (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
              <Lock className="h-4 w-4 text-slate-500" />
              <span>صلاحيات دور ({ROLE_TITLES[activeRole]}) تحجب استعراض جدول الربط الحساس؛ الرموز محمية على الخادم.</span>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">داخل الشركة (الاسم الحقيقي)</th>
                    <th className="px-4 py-2.5 font-semibold">لدى الذكاء الاصطناعي الخارجي</th>
                    <th className="px-4 py-2.5 font-semibold">تصنيف الكيان</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.trustVaultSample.map((entry) => (
                    <tr key={entry.token}>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{entry.realName}</td>
                      <td className="px-4 py-2.5 font-mono text-blue-800">{entry.token}</td>
                      <td className="px-4 py-2.5 font-mono text-slate-500">{entry.entityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Finance Director Strict Budget Governance */}
        <BudgetGovernanceManager activeRole={activeRole} />

        {/* Admin RBAC Permissions Matrix */}
        <RolePermissionsManager isAdminOwner={isAdminOwner} currentRoleId={activeRole} />

        {/* Audit Log */}
        {canViewLogs && (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="text-base font-bold text-slate-900">سجل العمليات والتدقيق (Audit Log)</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">الوقت</th>
                    <th className="px-4 py-2.5 font-semibold">الدور</th>
                    <th className="px-4 py-2.5 font-semibold">الإجراء</th>
                    <th className="px-4 py-2.5 font-semibold">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">
                        {new Date(log.timestamp).toLocaleString('ar-IQ')}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800">{ROLE_TITLES[log.actorRole]}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-900">{log.action}</td>
                      <td className="px-4 py-2.5 text-slate-600">{log.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    );
  }

  // mode === 'data' -> Ingestion & Verification Engine + Admin RBAC Tab
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">منظومة استقبال البيانات والتحقق وإدارة الصلاحيات</h1>
          <p className="mt-1 text-sm text-slate-600">
            بنية استقبال متعددة المصادر (قواعد بيانات ERP، مستودع البيانات، المجلد المراقَب، والتحميل اليدوي الدائم) وإدارة صلاحيات الوصول المخصصة للأدوار.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setDataSubTab('sources')}
            className={`rounded px-3 py-1.5 font-semibold transition-colors ${
              dataSubTab === 'sources'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            مصادر البيانات والتحقق
          </button>
          <button
            type="button"
            onClick={() => setDataSubTab('budget')}
            className={`rounded px-3 py-1.5 font-semibold transition-colors ${
              dataSubTab === 'budget'
                ? 'bg-white text-emerald-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {activeRole === 'finance' || activeRole === 'owner'
              ? 'بنود الميزانية والرقابة المالية'
              : 'بنود الميزانية المصرّح بها'}
          </button>
          <button
            type="button"
            onClick={() => setDataSubTab('permissions')}
            className={`rounded px-3 py-1.5 font-semibold transition-colors ${
              dataSubTab === 'permissions'
                ? 'bg-white text-blue-800 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {isAdminOwner ? 'إدارة صلاحيات الوصول (Admin)' : 'صلاحيات الوصول المخصصة'}
          </button>
        </div>
      </section>

      {dataSubTab === 'budget' ? (
        <BudgetGovernanceManager activeRole={activeRole} />
      ) : dataSubTab === 'permissions' ? (
        <RolePermissionsManager isAdminOwner={isAdminOwner} currentRoleId={activeRole} />
      ) : (
        <>

      {statusMessage && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          {statusMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {errorMessage}
        </div>
      )}

      {/* 4 Ingestion Connectors */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {data.sources.map((src) => (
          <div key={src.id} className="flex flex-col justify-between rounded-lg border border-slate-200 bg-white p-5">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-blue-700" />
                  <h2 className="text-sm font-bold text-slate-900">{src.name}</h2>
                </div>
                <span className="font-mono text-[11px] text-slate-500">أولوية #{src.priority}</span>
              </div>

              <div className="mt-2 text-xs text-slate-600">{src.engineLabel}</div>
              <div className="mt-1 font-mono text-[11px] text-slate-500">{src.connectionSummary}</div>
              <div className="mt-3 text-[11px] text-slate-500">
                الجدولة: {src.schedule} · السجلات: <span className="font-mono tabular-nums">{src.recordCount}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {(src.type === 'database_direct' || src.type === 'data_warehouse') && (
                <button
                  type="button"
                  disabled={busyAction === src.id}
                  onClick={() => handleSyncDb(src.id)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busyAction === src.id ? 'animate-spin' : ''}`} />
                  <span>فحص ومزامنة (قراءة فقط)</span>
                </button>
              )}

              {src.type === 'watched_folder' && (
                <>
                  <button
                    type="button"
                    disabled={busyAction === 'watched'}
                    onClick={() => handleScanWatched(false)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <FolderSearch className="h-3.5 w-3.5" />
                    <span>فحص OWNER_AI_DATA الآن</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyAction === 'watched'}
                    onClick={() => handleScanWatched(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900"
                  >
                    <span>توليد واستيراد ملف جديد في المجلد</span>
                  </button>
                </>
              )}

              {src.type === 'manual_upload' && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,.json"
                    onChange={handleManualFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={busyAction === 'upload'}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>{busyAction === 'upload' ? 'جارٍ التحقق...' : 'رفع ملف Excel / CSV / JSON'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadSampleCsv}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>تنزيل نموذج CSV</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Source Priority Conflicts */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900">سياسة أولوية المصادر وحسم التعارضات</h2>
        <p className="mt-1 text-xs text-slate-500">
          لا تُجمع البيانات المتكررة ولا يُستبدل المصدر المعتمد تلقائياً؛ تُعرض التعارضات للاعتماد الصريح.
        </p>

        <div className="mt-4 space-y-3">
          {data.conflicts.map((conf) => (
            <div key={conf.id} className="rounded-md border border-slate-200 p-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span>{conf.metricLabel}</span>
                </div>
                <span className="font-mono text-slate-500">
                  {conf.period} · فرع {conf.branch} · تفاوت {conf.variancePct}%
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] text-slate-500">{conf.primarySourceName}</div>
                  <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900">
                    {formatMillionsIQD(conf.primaryValue)}
                  </div>
                  {conf.status === 'pending' && canResolveConflicts && (
                    <button
                      type="button"
                      disabled={busyAction === conf.id}
                      onClick={() => handleResolveConflict(conf.id, 'primary')}
                      className="mt-2 rounded bg-blue-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-800"
                    >
                      اعتماد هذا المصدر كحقيقة
                    </button>
                  )}
                </div>

                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[11px] text-slate-500">{conf.secondarySourceName}</div>
                  <div className="mt-1 font-mono text-base font-bold tabular-nums text-slate-900">
                    {formatMillionsIQD(conf.secondaryValue)}
                  </div>
                  {conf.status === 'pending' && canResolveConflicts && (
                    <button
                      type="button"
                      disabled={busyAction === conf.id}
                      onClick={() => handleResolveConflict(conf.id, 'secondary')}
                      className="mt-2 rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                    >
                      اعتماد الملف اليدوي بدلاً منه
                    </button>
                  )}
                </div>
              </div>

              {conf.status !== 'pending' && (
                <div className="mt-2.5 text-emerald-800 font-medium">
                  حُسم التعارض لصالح {conf.status === 'resolved_primary' ? conf.primarySourceName : conf.secondarySourceName} بواسطة{' '}
                  {conf.resolvedBy}.
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Verification Engine History */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900">سجل دفعات التحقق من البيانات (Evidence &amp; Verification)</h2>
        <div className="mt-4 space-y-4">
          {data.batches.map((batch) => {
            const vMeta = getVerificationMeta(batch.status);
            return (
              <div key={batch.id} className="rounded-md border border-slate-200 p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-slate-900">{batch.id}</span>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="font-semibold text-slate-800">{batch.sourceName}</span>
                  </div>
                  <span className={`rounded border px-2.5 py-0.5 text-[11px] font-semibold ${vMeta.className}`}>
                    {vMeta.label}
                  </span>
                </div>

                <div className="mt-1.5 text-[11px] text-slate-500">
                  المستورد: {batch.importedBy} · الفترة: {batch.period} · الصفوف: {batch.rowCount} · البصمة:{' '}
                  <span className="font-mono">{batch.fileHash}</span>
                </div>

                <p className="mt-2.5 font-medium text-slate-800">{batch.coverageNote}</p>

                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {batch.checks.map((chk, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 rounded border border-slate-100 bg-slate-50 px-3 py-2"
                    >
                      <span
                        className={`mt-0.5 font-bold ${
                          chk.passed ? 'text-emerald-700' : chk.severity === 'critical' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {chk.passed ? '✓' : '✕'}
                      </span>
                      <div>
                        <div className="font-semibold text-slate-800">{chk.ruleName}</div>
                        <div className="text-[11px] text-slate-600">{chk.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {batch.blockedMetrics.length > 0 && (
                  <div className="mt-2.5 text-[11px] font-semibold text-red-800">
                    المؤشرات المحجوبة تلقائياً: {batch.blockedMetrics.join(' ، ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
        </>
      )}
    </div>
  );
};
