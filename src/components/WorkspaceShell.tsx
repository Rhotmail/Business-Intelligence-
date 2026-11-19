import React, { useState } from 'react';
import {
  BarChart3,
  CheckSquare,
  Database,
  FileText,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useFirebase } from '../context/FirebaseContext.tsx';
import { DashboardPayload, WorkspaceSection } from '../types.ts';
import { DEPLOYMENT_MODE_LABELS } from '../utils/formatters.ts';

interface WorkspaceShellProps {
  data: DashboardPayload;
  activeSection: WorkspaceSection;
  onChangeSection: (section: WorkspaceSection) => void;
  period: string;
  onChangePeriod: (period: string) => void;
  branch: string;
  onChangeBranch: (branch: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ id: WorkspaceSection; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'home', label: 'الرئيسية', icon: LayoutDashboard },
  { id: 'reports', label: 'مكتبة التقارير', icon: FileText },
  { id: 'analysis', label: 'التحليل والتوأم الاقتصادي', icon: BarChart3 },
  { id: 'decisions', label: 'القرارات والمتابعة', icon: CheckSquare },
  { id: 'data', label: 'مصادر البيانات والتحقق', icon: Database },
  { id: 'trust', label: 'طبقة الحماية والحوكمة', icon: ShieldCheck },
];

const SECTION_TITLES: Record<WorkspaceSection, string> = {
  home: 'الرئيسية التنفيذية',
  reports: 'مكتبة التقارير المعتمدة',
  analysis: 'التحليل الاقتصادي والذكاء المحمي',
  decisions: 'دورة القضايا والقرارات والمتابعة',
  data: 'منظومة استقبال البيانات والتحقق',
  trust: 'طبقة Enterprise AI Trust والحوكمة',
};

export const WorkspaceShell: React.FC<WorkspaceShellProps> = ({
  data,
  activeSection,
  onChangeSection,
  period,
  onChangePeriod,
  branch,
  onChangeBranch,
  onRefresh,
  isRefreshing,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, activeAccount, signOutUser, firestoreSynced } = useFirebase();

  const pendingApprovals = data.decisions.filter(
    (d) => d.requiresOwnerApproval && d.approvalStatus === 'pending_review'
  ).length;
  const pendingConflicts = data.conflicts.filter((c) => c.status === 'pending').length;

  const sidebarContent = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-100">
      <div className="border-b border-slate-800 px-5 py-5">
        <div className="text-lg font-bold tracking-tight text-white">OWNER AI Enterprise</div>
        <div className="mt-1 text-xs text-slate-400">الاستخبارات الاقتصادية والتحكم الإداري</div>
      </div>

      {/* Role-Bound Authenticated Account Card */}
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-400">
          <span>الحساب المعتمد (صلاحية مقيّدة)</span>
          <Lock className="h-3.5 w-3.5 text-slate-500" />
        </div>
        <div className="rounded-md border border-blue-800/60 bg-blue-950/50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-bold text-white">
              {activeAccount?.titleAr ?? data.role.titleAr}
            </span>
            <span className="rounded bg-blue-700 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white">
              {activeAccount?.code ?? data.role.code}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-300" dir="ltr">
            {user?.email ?? activeAccount?.email}
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
            {activeAccount?.description ?? data.role.description}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            void signOutUser();
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span>تبديل الحساب / تسجيل الخروج</span>
        </button>
      </div>

      {/* Unified Workspace Navigation (Filtered by Admin RBAC Policy) */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-4" aria-label="أقسام مساحة العمل">
        <div className="mb-2 text-xs font-medium text-slate-400">مساحة العمل</div>
        {NAV_ITEMS.filter(
          (item) => !data.activePolicy || data.activePolicy.allowedSections.includes(item.id)
        ).map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          let badgeCount = 0;
          if (item.id === 'decisions') badgeCount = pendingApprovals;
          if (item.id === 'data') badgeCount = pendingConflicts;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onChangeSection(item.id);
                setMobileMenuOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-right text-sm transition-colors ${
                isActive
                  ? 'bg-slate-800 font-semibold text-white'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{item.label}</span>
              </span>
              {badgeCount > 0 && (
                <span className="font-mono text-xs tabular-nums text-amber-300">{badgeCount}</span>
              )}
            </button>
          );
        })}
        {data.activePolicy && data.activePolicy.allowedSections.length === 0 && (
          <div className="rounded-md border border-slate-700 bg-slate-800/60 p-3 text-[11px] text-slate-300">
            تم حجب جميع الأقسام لهذا الحساب مؤقتاً من قِبل الإدارة.
          </div>
        )}
      </nav>

      {/* Active Role RBAC Scope Footer */}
      <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-400">
        <div className="font-medium text-slate-200">{data.role.workspaceName}</div>
        <div className="mt-1">النطاق: {data.role.dataScopes.join(' · ')}</div>
        <div className="mt-1 text-slate-500">
          الوضع: {DEPLOYMENT_MODE_LABELS[data.deploymentMode].title.split('—')[0].trim()}
          {firestoreSynced ? ' · متزامن مع Firestore' : ''}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 border-l border-slate-200 lg:block">{sidebarContent}</aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-72 max-w-[85vw] shrink-0">{sidebarContent}</div>
          <div
            className="flex-1 bg-slate-950/50"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        </div>
      )}

      {/* Main Column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Clean 3-Zone Top Bar */}
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="فتح القائمة"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="whitespace-nowrap font-semibold text-slate-900">{data.role.workspaceName}</span>
              <span className="text-slate-300" aria-hidden="true">
                /
              </span>
              <span className="truncate text-slate-600">{SECTION_TITLES[activeSection]}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>تحديث المؤشرات</span>
            </button>
          </div>
        </header>

        {/* Persistent Filter Toolbar (Below Top Bar) */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <span className="font-medium text-slate-600">الفترة:</span>
              <select
                value={period}
                onChange={(e) => onChangePeriod(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                {data.filters.availablePeriods.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="all">جميع الفترات</option>
              </select>
            </label>

            <label className="flex items-center gap-2">
              <span className="font-medium text-slate-600">نطاق البيانات:</span>
              <select
                value={branch}
                onChange={(e) => onChangeBranch(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                {data.role.dataScopes.includes('الشركة كاملة') && (
                  <option value="all">الشركة كاملة</option>
                )}
                {data.filters.availableBranches
                  .filter((b) => data.role.dataScopes.includes('الشركة كاملة') || data.role.dataScopes.includes(b))
                  .map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2 text-slate-500">
            <span>الحماية المحلية: {data.trustVaultCount} كيان مرمّز</span>
            <span aria-hidden="true">·</span>
            <span>مصدر الحقيقة: ERP &amp; DWH</span>
          </div>
        </div>

        {/* Main Viewport */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
          {data.activePolicy && !data.activePolicy.allowedSections.includes(activeSection) ? (
            <div className="rounded-lg border border-amber-200 bg-white p-8 text-center">
              <Lock className="mx-auto h-7 w-7 text-amber-700" />
              <h2 className="mt-3 text-base font-bold text-slate-900">
                الوصول إلى هذا القسم محجوب حسب صلاحيات الإدارة
              </h2>
              <p className="mt-1.5 text-xs text-slate-600">
                قام المالك (Admin) بتقييد الوصول إلى قسم "{SECTION_TITLES[activeSection]}" لحساب {data.role.titleAr}.
              </p>
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
};
