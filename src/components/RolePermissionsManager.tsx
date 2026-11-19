import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  RotateCcw,
  Save,
  Shield,
  Users,
} from 'lucide-react';
import {
  COMPANY_BRANCHES,
  COMPANY_DIVISIONS,
  DEFAULT_ROLE_PERMISSIONS,
  REPORT_CATEGORIES,
  useFirebase,
} from '../context/FirebaseContext.tsx';
import { ManagedRoleId, RoleAccessPolicy, WorkspaceSection } from '../types.ts';

const MANAGED_ROLES: Array<{ id: ManagedRoleId; code: string; titleAr: string; subtitle: string }> = [
  {
    id: 'operations',
    code: '03',
    titleAr: 'مدير العمليات',
    subtitle: 'المخزون، الهدر التشغيلي، الالتزام بـ SLA، وفروع التشغيل',
  },
  {
    id: 'finance',
    code: '02',
    titleAr: 'المدير المالي',
    subtitle: 'الربحية، التدفقات، الذمم، تعارضات المصادر، وسجل التدقيق',
  },
  {
    id: 'sales',
    code: '05',
    titleAr: 'مدير المبيعات',
    subtitle: 'صافي المبيعات، الخصومات التجارية، وأداء العملاء والفروع',
  },
];

const CAPABILITY_CONTROLS: Array<{
  key: keyof Pick<
    RoleAccessPolicy,
    | 'canViewFinancialMargins'
    | 'canViewTrustVault'
    | 'canViewAuditLogs'
    | 'canRunAiAnalysis'
    | 'canExportReports'
    | 'canManageAlerts'
    | 'canResolveConflicts'
    | 'canCreateDecisions'
  >;
  label: string;
  detail: string;
}> = [
  {
    key: 'canViewFinancialMargins',
    label: 'رؤية الأرباح والهوامش الحساسة',
    detail: 'عرض هوامش الربح الإجمالي والمساهمة وجسر التباين المالي.',
  },
  {
    key: 'canViewTrustVault',
    label: 'رؤية قاموس الرموز (Trust Vault)',
    detail: 'الاطلاع على جدول ربط الأسماء الحقيقية بالرموز المحلية.',
  },
  {
    key: 'canViewAuditLogs',
    label: 'رؤية سجل العمليات والتدقيق',
    detail: 'استعراض سجل الحوكمة والنشاطات الإدارية.',
  },
  {
    key: 'canRunAiAnalysis',
    label: 'تشغيل التحليل الذكي المحمي (AI)',
    detail: 'طرح أسئلة تحليلية واستخدام محرك الاستخبارات المحمي.',
  },
  {
    key: 'canExportReports',
    label: 'تصدير التقارير والمقارنات (PDF / CSV)',
    detail: 'تنزيل جداول المقارنة والتقارير بصيغة CSV أو طباعة PDF.',
  },
  {
    key: 'canManageAlerts',
    label: 'إدارة تنبيهات الانحراف الاستباقية',
    detail: 'تعديل حدود الانحراف المسموح بها وتأكيد أو تصعيد التنبيهات.',
  },
  {
    key: 'canResolveConflicts',
    label: 'حسم تعارضات مصادر البيانات',
    detail: 'اعتماد المصدر الرسمي عند وجود اختلاف بين ERP والملفات.',
  },
  {
    key: 'canCreateDecisions',
    label: 'إنشاء ومتابعة قضايا القرارات',
    detail: 'فتح قضايا جديدة وإضافة ملاحظات التنفيذ والنتائج.',
  },
];

interface RolePermissionsManagerProps {
  isAdminOwner: boolean;
  currentRoleId: string;
}

export const RolePermissionsManager: React.FC<RolePermissionsManagerProps> = ({
  isAdminOwner,
  currentRoleId,
}) => {
  const {
    rolePermissions,
    rolePermissionsLoaded,
    saveRolePermission,
    resetRolePermission,
    appendWorkspaceLog,
  } = useFirebase();

  const [selectedRole, setSelectedRole] = useState<ManagedRoleId>('operations');
  const [draft, setDraft] = useState<RoleAccessPolicy>(rolePermissions.operations);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(rolePermissions[selectedRole]);
  }, [rolePermissions, selectedRole]);

  const toggleSection = (sec: WorkspaceSection) => {
    setDraft((prev) => {
      const exists = prev.allowedSections.includes(sec);
      return {
        ...prev,
        allowedSections: exists
          ? prev.allowedSections.filter((s) => s !== sec)
          : [...prev.allowedSections, sec],
      };
    });
  };

  const toggleBranch = (branchName: string) => {
    setDraft((prev) => {
      const exists = prev.allowedBranches.includes(branchName);
      if (exists && prev.allowedBranches.length <= 1) {
        setErrorMessage('يجب الإبقاء على نطاق فرع واحد على الأقل لكل مدير.');
        return prev;
      }
      setErrorMessage(null);
      return {
        ...prev,
        allowedBranches: exists
          ? prev.allowedBranches.filter((b) => b !== branchName)
          : [...prev.allowedBranches, branchName],
      };
    });
  };

  const toggleCategory = (cat: string) => {
    setDraft((prev) => {
      const exists = prev.allowedReportCategories.includes(cat);
      return {
        ...prev,
        allowedReportCategories: exists
          ? prev.allowedReportCategories.filter((c) => c !== cat)
          : [...prev.allowedReportCategories, cat],
      };
    });
  };

  const toggleCapability = (
    key: (typeof CAPABILITY_CONTROLS)[number]['key']
  ) => {
    setDraft((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      await saveRolePermission(draft);
      await appendWorkspaceLog({
        actorRole: 'owner',
        action: 'تحديث صلاحيات الوصول المخصصة',
        target: draft.roleTitleAr,
        detail: `الأقسام (${draft.allowedSections.length}) · الفروع (${draft.allowedBranches.join('، ')}) · فئات التقارير (${draft.allowedReportCategories.length})`,
      });
      setSaveMessage(`تم حفظ وتطبيق صلاحيات "${draft.roleTitleAr}" في Firestore بنجاح.`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حفظ صلاحيات الوصول.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      await resetRolePermission(selectedRole);
      await appendWorkspaceLog({
        actorRole: 'owner',
        action: 'استعادة الصلاحيات الافتراضية',
        target: DEFAULT_ROLE_PERMISSIONS[selectedRole].roleTitleAr,
        detail: 'تمت إعادة ضبط مصفوفة الوصول إلى الإعداد المرجعي.',
      });
      setSaveMessage(`تمت استعادة الإعدادات الافتراضية لحساب "${DEFAULT_ROLE_PERMISSIONS[selectedRole].roleTitleAr}".`);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر استعادة الصلاحيات الافتراضية.');
    } finally {
      setSaving(false);
    }
  };

  // Non-Admin View: Transparent read-only policy summary for the currently signed-in director
  if (!isAdminOwner) {
    const activeManagedRole =
      currentRoleId === 'operations' || currentRoleId === 'finance' || currentRoleId === 'sales'
        ? rolePermissions[currentRoleId]
        : null;

    if (!activeManagedRole) return null;

    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <Lock className="h-5 w-5 text-blue-700" />
            <div>
              <h2 className="text-base font-bold text-slate-900">
                سياسة الوصول المخصصة لحسابك ({activeManagedRole.roleTitleAr})
              </h2>
              <p className="text-xs text-slate-500">
                تُدار هذه الصلاحيات من قِبل المالك (Admin) وتُطبق مباشرة على الأقسام والبيانات المرئية لك.
              </p>
            </div>
          </div>
          <span className="rounded bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
            قراءة فقط — إدارة الصلاحيات للمالك
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="font-semibold text-slate-800">الأقسام المتاحة</div>
            <div className="mt-2 space-y-1">
              {COMPANY_DIVISIONS.map((div) => {
                const allowed = activeManagedRole.allowedSections.includes(div.id);
                return (
                  <div key={div.id} className="flex items-center justify-between gap-2">
                    <span className={allowed ? 'text-slate-900' : 'text-slate-400 line-through'}>
                      {div.label}
                    </span>
                    <span className={allowed ? 'text-emerald-700 font-semibold' : 'text-red-700'}>
                      {allowed ? 'مرئي' : 'محجوب'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="font-semibold text-slate-800">فروع الشركة وفئات التقارير</div>
            <div className="mt-2 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-800">الفروع المصرّح بها: </span>
              {activeManagedRole.allowedBranches.join(' · ')}
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
              <span className="font-semibold text-slate-800">التقارير المرئية: </span>
              {activeManagedRole.allowedReportCategories.length > 0
                ? activeManagedRole.allowedReportCategories.join(' · ')
                : 'لا توجد فئات تقارير مفعّلة'}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="font-semibold text-slate-800">البيانات الحساسة والإجراءات</div>
            <div className="mt-2 space-y-1">
              {CAPABILITY_CONTROLS.map((cap) => {
                const enabled = activeManagedRole[cap.key];
                return (
                  <div key={cap.key} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={enabled ? 'text-slate-800' : 'text-slate-400'}>{cap.label}</span>
                    <span className={enabled ? 'text-emerald-700 font-semibold' : 'text-slate-500'}>
                      {enabled ? 'مسموح' : 'ممنوع'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  }

  const currentRoleMeta = MANAGED_ROLES.find((r) => r.id === selectedRole)!;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-blue-50 p-2 text-blue-700">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              إدارة صلاحيات الوصول المخصصة للأدوار (Admin RBAC Control)
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              تحكّم بصلاحيات كل من مدير العمليات، المدير المالي، ومدير المبيعات على مستوى أقسام الشركة، الفروع، فئات التقارير، والبيانات الحساسة — يُحفظ في Firestore ويُطبق فوراً.
            </p>
          </div>
        </div>
        <span className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
          {rolePermissionsLoaded ? 'متزامن مع Firestore' : 'الوضع المرجعي'}
        </span>
      </div>

      {saveMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{saveMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
          {errorMessage}
        </div>
      )}

      {/* Target Role Selector Tabs */}
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {MANAGED_ROLES.map((role) => {
          const policy = rolePermissions[role.id];
          const isSelected = selectedRole === role.id;
          return (
            <button
              key={role.id}
              type="button"
              onClick={() => {
                setSelectedRole(role.id);
                setSaveMessage(null);
                setErrorMessage(null);
              }}
              className={`rounded-md border p-4 text-right transition-colors ${
                isSelected
                  ? 'border-blue-700 bg-blue-50/70 ring-1 ring-blue-700'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Users className={`h-4 w-4 ${isSelected ? 'text-blue-700' : 'text-slate-400'}`} />
                  <span>{role.titleAr}</span>
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                  {role.code}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-600">{role.subtitle}</p>
              <div className="mt-2.5 flex flex-wrap gap-2 border-t border-slate-200/70 pt-2 text-[11px] font-medium text-slate-700">
                <span>الأقسام: {policy.allowedSections.length}/6</span>
                <span>·</span>
                <span>الفروع: {policy.allowedBranches.length}</span>
                <span>·</span>
                <span>التقارير: {policy.allowedReportCategories.length}/6</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Role Editor */}
      <div className="mt-6 space-y-6 rounded-lg border border-slate-200 bg-slate-50/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              تعديل مصفوفة الوصول: {currentRoleMeta.titleAr}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              حدّد بالضبط ما يستطيع رؤيته وما يُحجب عنه على مستوى أقسام الشركة والعمليات.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>استعادة الافتراضي</span>
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق الصلاحيات'}</span>
            </button>
          </div>
        </div>

        {/* 1. Workspace Divisions */}
        <div>
          <h4 className="text-xs font-bold text-slate-800">
            1. أقسام المنصة المسموح برؤيتها (ما يراه وما لا يراه في القائمة الجانبية)
          </h4>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {COMPANY_DIVISIONS.map((div) => {
              const allowed = draft.allowedSections.includes(div.id);
              return (
                <button
                  key={div.id}
                  type="button"
                  onClick={() => toggleSection(div.id)}
                  className={`flex items-start justify-between gap-3 rounded-md border p-3 text-right transition-colors ${
                    allowed
                      ? 'border-emerald-300 bg-white'
                      : 'border-slate-200 bg-slate-100/80 opacity-80'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold text-slate-900">{div.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{div.description}</div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                      allowed
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {allowed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    <span>{allowed ? 'مرئي' : 'محجوب'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Company Branches & Report Categories */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-bold text-slate-800">
              2. أقسام وفروع الشركة المصرّح برؤية بياناتها
            </h4>
            <p className="mt-0.5 text-[11px] text-slate-500">
              عند إزالة فرع معين، لن يتمكن المدير من اختيار بياناته أو تصفية التقارير عليه.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {COMPANY_BRANCHES.map((branchName) => {
                const allowed = draft.allowedBranches.includes(branchName);
                return (
                  <label
                    key={branchName}
                    className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-xs ${
                      allowed
                        ? 'border-blue-300 bg-blue-50/50 font-semibold text-slate-900'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={() => toggleBranch(branchName)}
                        className="h-3.5 w-3.5 accent-blue-700"
                      />
                      <span>{branchName}</span>
                    </span>
                    <span className="text-[10px]">{allowed ? 'مسموح' : 'محجوب'}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4">
            <h4 className="text-xs font-bold text-slate-800">
              3. فئات التقارير الاقتصادية المسموح برؤيتها
            </h4>
            <p className="mt-0.5 text-[11px] text-slate-500">
              تُحجب تقارير أي فئة غير محددة تلقائياً من مكتبة التقارير وأداة المقارنة والتنبيهات.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {REPORT_CATEGORIES.map((cat) => {
                const allowed = draft.allowedReportCategories.includes(cat);
                return (
                  <label
                    key={cat}
                    className={`flex cursor-pointer items-center justify-between rounded border px-3 py-2 text-xs ${
                      allowed
                        ? 'border-blue-300 bg-blue-50/50 font-semibold text-slate-900'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={() => toggleCategory(cat)}
                        className="h-3.5 w-3.5 accent-blue-700"
                      />
                      <span>{cat}</span>
                    </span>
                    <span className="text-[10px]">{allowed ? 'مرئي' : 'محجوب'}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 4. Granular Sensitive Visibility & Operational Permissions */}
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <h4 className="text-xs font-bold text-slate-800">
            4. صلاحيات البيانات الحساسة والإجراءات التفصيلية
          </h4>
          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {CAPABILITY_CONTROLS.map((cap) => {
              const enabled = draft[cap.key];
              return (
                <label
                  key={cap.key}
                  className={`flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3 transition-colors ${
                    enabled
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggleCapability(cap.key)}
                      className="mt-0.5 h-4 w-4 accent-blue-700"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-900">{cap.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{cap.detail}</div>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                      enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {enabled ? 'مسموح' : 'محجوب'}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live Comparison Matrix Across All 3 Directors */}
      <div className="mt-6">
        <h3 className="mb-3 text-sm font-bold text-slate-900">
          ملخص مصفوفة الصلاحيات المطبّقة حالياً
        </h3>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-2.5 font-semibold">البند / القسم</th>
                {MANAGED_ROLES.map((r) => (
                  <th key={r.id} className="px-4 py-2.5 font-semibold">
                    {r.titleAr}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-2.5 font-medium text-slate-800">الأقسام المرئية</td>
                {MANAGED_ROLES.map((r) => (
                  <td key={r.id} className="px-4 py-2.5 text-[11px] text-slate-600">
                    {rolePermissions[r.id].allowedSections.length} / 6 أقسام
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium text-slate-800">الفروع المصرّح بها</td>
                {MANAGED_ROLES.map((r) => (
                  <td key={r.id} className="px-4 py-2.5 text-[11px] text-slate-600">
                    {rolePermissions[r.id].allowedBranches.join(' · ')}
                  </td>
                ))}
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium text-slate-800">فئات التقارير</td>
                {MANAGED_ROLES.map((r) => (
                  <td key={r.id} className="px-4 py-2.5 text-[11px] text-slate-600">
                    {rolePermissions[r.id].allowedReportCategories.length > 0
                      ? rolePermissions[r.id].allowedReportCategories.join('، ')
                      : 'لا شيء'}
                  </td>
                ))}
              </tr>
              {CAPABILITY_CONTROLS.map((cap) => (
                <tr key={cap.key}>
                  <td className="px-4 py-2 font-medium text-slate-800">{cap.label}</td>
                  {MANAGED_ROLES.map((r) => {
                    const ok = rolePermissions[r.id][cap.key];
                    return (
                      <td key={r.id} className="px-4 py-2">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                            ok ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {ok ? 'يستطيع الرؤية / التنفيذ' : 'محجوب'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
