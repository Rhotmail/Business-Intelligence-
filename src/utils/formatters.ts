import { DecisionStage, DeploymentMode, EpistemicLevel, RoleId, VerificationStatus } from '../types.ts';

export function formatMillionsIQD(amount: number): string {
  const millions = amount / 1_000_000;
  if (Math.abs(millions) >= 1) {
    return `${millions.toFixed(1)} م.د.ع`;
  }
  return `${Math.round(amount).toLocaleString('en-US')} د.ع`;
}

export function getVerificationMeta(status: VerificationStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'verified':
      return {
        label: 'بيانات معتمدة',
        className: 'text-emerald-800 bg-emerald-50 border-emerald-200',
      };
    case 'partial':
      return {
        label: 'بيانات جزئية',
        className: 'text-amber-800 bg-amber-50 border-amber-200',
      };
    case 'rejected':
      return {
        label: 'بيانات مرفوضة',
        className: 'text-red-800 bg-red-50 border-red-200',
      };
  }
}

export function getEpistemicLabel(level: EpistemicLevel): {
  label: string;
  toneClass: string;
} {
  switch (level) {
    case 'calculated_fact':
      return { label: 'حقيقة محسوبة', toneClass: 'text-emerald-800 bg-emerald-50 border-emerald-200' };
    case 'analytical_conclusion':
      return { label: 'استنتاج تحليلي', toneClass: 'text-blue-800 bg-blue-50 border-blue-200' };
    case 'hypothesis':
      return { label: 'فرضية تحتاج تحققاً', toneClass: 'text-amber-800 bg-amber-50 border-amber-200' };
    case 'recommendation':
      return { label: 'توصية مقترحة', toneClass: 'text-slate-800 bg-slate-100 border-slate-300' };
    case 'execution_outcome':
      return { label: 'نتيجة تنفيذ مرصودة', toneClass: 'text-emerald-900 bg-emerald-100 border-emerald-300' };
  }
}

export const STAGE_LABELS: Record<DecisionStage, string> = {
  detection: '1. الاكتشاف',
  verification: '2. التحقق',
  diagnosis: '3. التشخيص',
  decision_design: '4. تصميم القرار',
  assignment_approval: '5. المسؤولية والاعتماد',
  execution: '6. التنفيذ',
  outcome_measurement: '7. قياس النتيجة',
};

export const ROLE_TITLES: Record<RoleId, string> = {
  owner: 'المالك',
  finance: 'المدير المالي',
  operations: 'مدير العمليات',
  commercial: 'المدير التجاري',
  sales: 'مدير المبيعات',
};

export const DEPLOYMENT_MODE_LABELS: Record<DeploymentMode, { title: string; subtitle: string }> = {
  hybrid: {
    title: 'الهجين (Hybrid) — الموصى به',
    subtitle: 'البيانات وقاموس الرموز محلياً، ويُرسل النص المرمّز فقط للتحليل.',
  },
  fully_private: {
    title: 'الخصوصية الكاملة (Fully Private)',
    subtitle: 'المعالجة كاملة محلياً دون أي اتصال بنماذج خارجية.',
  },
  managed_cloud: {
    title: 'السحابة المدارة (Managed Cloud)',
    subtitle: 'استضافة معزولة باتفاقية حماية وترميز محلي للكيانات.',
  },
};
