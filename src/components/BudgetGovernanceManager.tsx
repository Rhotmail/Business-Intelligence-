import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  RotateCcw,
  Save,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  BUDGET_LINE_ITEMS,
  DEFAULT_BUDGET_PERMISSIONS,
  useFirebase,
} from '../context/FirebaseContext.tsx';
import {
  BudgetAccessPolicy,
  BudgetControlledRoleId,
  BudgetLineItemId,
  RoleId,
} from '../types.ts';

const CONTROLLED_ROLES: Array<{
  id: BudgetControlledRoleId;
  code: string;
  titleAr: string;
  subtitle: string;
}> = [
  {
    id: 'operations',
    code: '03',
    titleAr: 'مدير العمليات',
    subtitle: 'التحكم ببنود المخزون والهدر والتكاليف المتغيرة واللوجستيات',
  },
  {
    id: 'sales',
    code: '05',
    titleAr: 'مدير المبيعات',
    subtitle: 'التحكم ببنود الإيرادات والخصومات والذمم الائتمانية',
  },
];

const SENSITIVITY_BADGES: Record<'high' | 'medium' | 'standard', { label: string; cls: string }> = {
  high: { label: 'حساسية عالية', cls: 'border-red-200 bg-red-50 text-red-800' },
  medium: { label: 'حساسية متوسطة', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  standard: { label: 'تشغيلي قياسي', cls: 'border-slate-200 bg-slate-100 text-slate-700' },
};

interface BudgetGovernanceManagerProps {
  activeRole: RoleId;
}

export const BudgetGovernanceManager: React.FC<BudgetGovernanceManagerProps> = ({ activeRole }) => {
  const {
    budgetPermissions,
    budgetPermissionsLoaded,
    saveBudgetPermission,
    resetBudgetPermission,
    appendWorkspaceLog,
  } = useFirebase();

  const canManageBudgets = activeRole === 'finance' || activeRole === 'owner';

  const [selectedRole, setSelectedRole] = useState<BudgetControlledRoleId>('operations');
  const [draft, setDraft] = useState<BudgetAccessPolicy>(budgetPermissions.operations);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(budgetPermissions[selectedRole]);
  }, [budgetPermissions, selectedRole]);

  const toggleBudgetItem = (itemId: BudgetLineItemId) => {
    setDraft((prev) => {
      const exists = prev.allowedBudgetItems.includes(itemId);
      return {
        ...prev,
        allowedBudgetItems: exists
          ? prev.allowedBudgetItems.filter((id) => id !== itemId)
          : [...prev.allowedBudgetItems, itemId],
      };
    });
  };

  const applyStrictMinimalPreset = () => {
    const minimal: BudgetLineItemId[] =
      selectedRole === 'operations'
        ? ['inventory_budget', 'waste_budget']
        : ['revenue_budget', 'discounts_budget'];
    setDraft((prev) => ({
      ...prev,
      strictControlEnabled: true,
      allowedBudgetItems: minimal,
    }));
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const applyMaskHighSensitivityPreset = () => {
    const nonSensitive = BUDGET_LINE_ITEMS.filter((i) => i.sensitiveLevel !== 'high').map((i) => i.id);
    setDraft((prev) => ({
      ...prev,
      strictControlEnabled: true,
      allowedBudgetItems: nonSensitive,
    }));
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const applyAllowAllPreset = () => {
    setDraft((prev) => ({
      ...prev,
      allowedBudgetItems: BUDGET_LINE_ITEMS.map((i) => i.id),
    }));
    setSaveMessage(null);
    setErrorMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      await saveBudgetPermission(draft);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'تحديث صلاحيات بنود الميزانية (الرقابة المالية)',
        target: draft.roleTitleAr,
        detail: `البنود المصرّح بها: ${draft.allowedBudgetItems.length}/${BUDGET_LINE_ITEMS.length} · الرقابة الصارمة: ${
          draft.strictControlEnabled ? 'مفعّلة' : 'معلّقة'
        }`,
      });
      setSaveMessage(
        `تم حفظ وتفعيل قيود الميزانية لـ "${draft.roleTitleAr}" (${draft.allowedBudgetItems.length} من ${BUDGET_LINE_ITEMS.length} بنود مسموحة).`
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر حفظ صلاحيات بنود الميزانية.');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setErrorMessage(null);
    setSaveMessage(null);
    try {
      await resetBudgetPermission(selectedRole);
      await appendWorkspaceLog({
        actorRole: activeRole,
        action: 'استعادة ضوابط الميزانية الافتراضية',
        target: DEFAULT_BUDGET_PERMISSIONS[selectedRole].roleTitleAr,
        detail: 'تمت إعادة ضبط بنود الميزانية المصرّح بها إلى الإعداد المرجعي.',
      });
      setSaveMessage(
        `تمت استعادة الإعداد المرجعي لبنود ميزانية "${DEFAULT_BUDGET_PERMISSIONS[selectedRole].roleTitleAr}".`
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر استعادة الإعدادات الافتراضية.');
    } finally {
      setSaving(false);
    }
  };

  // Operations & Sales Read-Only Strict Enforced Schedule
  if (!canManageBudgets) {
    const myRoleId: BudgetControlledRoleId = activeRole === 'sales' ? 'sales' : 'operations';
    const myPolicy = budgetPermissions[myRoleId];
    const allowedCount = myPolicy.allowedBudgetItems.length;
    const blockedCount = BUDGET_LINE_ITEMS.length - allowedCount;

    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-md bg-amber-50 p-2 text-amber-700">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                بنود الميزانية المصرّح بها لحسابك ({myPolicy.roleTitleAr})
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                تُحدد بنود الميزانية المرئية حصرياً من قِبل المدير المالي لتطبيق الرقابة المالية الصارمة؛ تُحجب أرقام البنود غير المصرّح بها تلقائياً.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            <span
              className={`rounded border px-2.5 py-1 ${
                myPolicy.strictControlEnabled
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-100 text-slate-700'
              }`}
            >
              {myPolicy.strictControlEnabled ? 'الرقابة المالية الصارمة: مفعّلة' : 'وضع المراقبة القياسي'}
            </span>
            <span className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
              مسموح: {allowedCount} · محجوب: {blockedCount}
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-2.5 font-semibold">الرمز</th>
                <th className="px-4 py-2.5 font-semibold">بند الميزانية</th>
                <th className="px-4 py-2.5 font-semibold">التصنيف</th>
                <th className="px-4 py-2.5 font-semibold">المخصص الربع سنوي</th>
                <th className="px-4 py-2.5 font-semibold">المنفذ الفعلي</th>
                <th className="px-4 py-2.5 font-semibold">حالة الرقابة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BUDGET_LINE_ITEMS.map((item) => {
                const isAllowed = myPolicy.allowedBudgetItems.includes(item.id);
                const variancePct =
                  item.quarterlyAllocationM > 0
                    ? (((item.actualSpentM - item.quarterlyAllocationM) / item.quarterlyAllocationM) * 100).toFixed(1)
                    : '0.0';

                return (
                  <tr key={item.id} className={isAllowed ? 'bg-white' : 'bg-slate-50/70'}>
                    <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-slate-600">
                      {item.code}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className={`font-semibold ${isAllowed ? 'text-slate-900' : 'text-slate-400'}`}>
                        {item.titleAr}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {isAllowed ? item.description : 'تم حجب تفاصيل هذا البند وفق سياسة الرقابة المالية.'}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{item.categoryAr}</td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800">
                      {isAllowed ? `${item.quarterlyAllocationM.toFixed(1)} م.د.ع` : '— محجوب —'}
                    </td>
                    <td className="px-4 py-2.5 font-mono tabular-nums text-slate-800">
                      {isAllowed ? (
                        <span>
                          {item.actualSpentM.toFixed(1)} م.د.ع{' '}
                          <span className="text-[11px] text-slate-500">({Number(variancePct) >= 0 ? '+' : ''}{variancePct}%)</span>
                        </span>
                      ) : (
                        '— محجوب —'
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                          isAllowed
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {isAllowed ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        <span>{isAllowed ? 'مصرّح بالاطلاع' : 'محجوب بقرار المدير المالي'}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  const currentRoleMeta = CONTROLLED_ROLES.find((r) => r.id === selectedRole)!;
  const totalBudgetPoolM = BUDGET_LINE_ITEMS.reduce((sum, i) => sum + i.quarterlyAllocationM, 0);
  const allowedBudgetPoolM = BUDGET_LINE_ITEMS.filter((i) =>
    draft.allowedBudgetItems.includes(i.id)
  ).reduce((sum, i) => sum + i.quarterlyAllocationM, 0);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-emerald-50 p-2 text-emerald-700">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              الرقابة المالية الصارمة — إدارة بنود الميزانية المسموح بالاطلاع عليها
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              تتيح هذه الأداة للمدير المالي تحديد بنود الميزانية المصرّح لكل من مدير العمليات ومدير المبيعات بالاطلاع عليها، وحجب البنود المالية الحساسة عبر كافة المؤشرات والتقارير وكشف الميزانية.
            </p>
          </div>
        </div>

        <span className="rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
          {budgetPermissionsLoaded ? 'متزامن مع Firestore' : 'الوضع المرجعي'}
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

      {/* Target Director Selector (Operations vs Sales) */}
      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {CONTROLLED_ROLES.map((role) => {
          const policy = budgetPermissions[role.id];
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
                  ? 'border-emerald-700 bg-emerald-50/60 ring-1 ring-emerald-700'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-900">{role.titleAr}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                    policy.strictControlEnabled
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {policy.strictControlEnabled ? 'رقابة صارمة مفعّلة' : 'رقابة قياسية'}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-600">{role.subtitle}</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-[11px] font-semibold text-slate-700">
                <span>
                  البنود المصرّح بها: {policy.allowedBudgetItems.length} / {BUDGET_LINE_ITEMS.length}
                </span>
                <span className="font-mono text-slate-500">كود {role.code}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Director Budget Controls */}
      <div className="mt-6 space-y-5 rounded-lg border border-slate-200 bg-slate-50/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              ضوابط بنود الميزانية: {currentRoleMeta.titleAr}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-600">
              إجمالي المخصصات المكشوفة حالياً:{' '}
              <span className="font-mono font-bold text-slate-900">
                {allowedBudgetPoolM.toFixed(1)} م.د.ع
              </span>{' '}
              من أصل{' '}
              <span className="font-mono text-slate-700">{totalBudgetPoolM.toFixed(1)} م.د.ع</span>
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
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ وتطبيق الرقابة المالية'}</span>
            </button>
          </div>
        </div>

        {/* Strict Financial Governance Master Toggle + Quick Presets */}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-amber-200 bg-amber-50/80 p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={draft.strictControlEnabled}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  strictControlEnabled: e.target.checked,
                }))
              }
              className="mt-0.5 h-4 w-4 accent-amber-700"
            />
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                <ShieldAlert className="h-4 w-4 text-amber-700" />
                <span>تفعيل الرقابة المالية الصارمة عبر المنصة</span>
              </div>
              <p className="mt-0.5 text-[11px] text-amber-900">
                عند التفعيل، تُحجب مؤشرات الأداء، نتائج التقارير، التنبؤات، والتنبيهات المرتبطة بأي بند ميزانية غير مسموح به عن {currentRoleMeta.titleAr}.
              </p>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={applyStrictMinimalPreset}
              className="rounded border border-amber-300 bg-white px-2.5 py-1.5 font-semibold text-amber-900 hover:bg-amber-100"
            >
              الحد الأدنى الصارم
            </button>
            <button
              type="button"
              onClick={applyMaskHighSensitivityPreset}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
            >
              حجب البنود عالية الحساسية
            </button>
            <button
              type="button"
              onClick={applyAllowAllPreset}
              className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100"
            >
              إتاحة الكل
            </button>
          </div>
        </div>

        {/* Budget Line Items Checklist Table */}
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-2.5 font-semibold">السماح</th>
                <th className="px-4 py-2.5 font-semibold">الرمز</th>
                <th className="px-4 py-2.5 font-semibold">بند الميزانية والتفاصيل</th>
                <th className="px-4 py-2.5 font-semibold">الحساسية</th>
                <th className="px-4 py-2.5 font-semibold">المخصص (Q3)</th>
                <th className="px-4 py-2.5 font-semibold">المنفذ الفعلي</th>
                <th className="px-4 py-2.5 font-semibold">حالة الرؤية لـ {currentRoleMeta.titleAr}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BUDGET_LINE_ITEMS.map((item) => {
                const allowed = draft.allowedBudgetItems.includes(item.id);
                const sens = SENSITIVITY_BADGES[item.sensitiveLevel];
                return (
                  <tr
                    key={item.id}
                    onClick={() => toggleBudgetItem(item.id)}
                    className={`cursor-pointer transition-colors ${
                      allowed ? 'bg-white hover:bg-emerald-50/30' : 'bg-slate-50/70 hover:bg-slate-100/70'
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={allowed}
                        onChange={() => toggleBudgetItem(item.id)}
                        aria-label={`السماح ببند ${item.titleAr}`}
                        className="h-4 w-4 accent-emerald-700"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] font-semibold text-slate-600">
                      {item.code}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{item.titleAr}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {item.categoryAr} · {item.description}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${sens.cls}`}>
                        {sens.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-800">
                      {item.quarterlyAllocationM.toFixed(1)} م.د.ع
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-slate-800">
                      {item.actualSpentM.toFixed(1)} م.د.ع
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                          allowed
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {allowed ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                        <span>{allowed ? 'مسموح بالاطلاع' : 'محجوب رقابياً'}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Side-by-Side Comparison Matrix */}
      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-700" />
          <h3 className="text-sm font-bold text-slate-900">
            مقارنة صلاحيات بنود الميزانية المطبّقة حالياً
          </h3>
        </div>
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-700">
              <tr>
                <th className="px-4 py-2.5 font-semibold">بند الميزانية</th>
                <th className="px-4 py-2.5 font-semibold">مدير العمليات</th>
                <th className="px-4 py-2.5 font-semibold">مدير المبيعات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BUDGET_LINE_ITEMS.map((item) => {
                const opsAllowed = budgetPermissions.operations.allowedBudgetItems.includes(item.id);
                const salesAllowed = budgetPermissions.sales.allowedBudgetItems.includes(item.id);
                return (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      <span className="ml-2 font-mono text-[11px] text-slate-500">{item.code}</span>
                      <span>{item.titleAr}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                          opsAllowed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {opsAllowed ? 'مسموح' : 'محجوب'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                          salesAllowed ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {salesAllowed ? 'مسموح' : 'محجوب'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
