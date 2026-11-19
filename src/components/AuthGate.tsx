import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, UserCheck } from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  EXECUTIVE_ACCOUNTS,
  ExecutiveAccount,
  useFirebase,
} from '../context/FirebaseContext.tsx';

export const AuthGate: React.FC = () => {
  const {
    signInWithAccount,
    signingIn,
    authError,
    connectionOk,
    needsEmailProviderSetup,
  } = useFirebase();

  const [selectedAccount, setSelectedAccount] = useState<ExecutiveAccount>(EXECUTIVE_ACCOUNTS[0]);
  const [identifier, setIdentifier] = useState<string>(EXECUTIVE_ACCOUNTS[0].email);
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  const handleSelectAccount = (acc: ExecutiveAccount) => {
    setSelectedAccount(acc);
    setIdentifier(acc.email);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await signInWithAccount(identifier, password);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10" dir="rtl">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="border-b border-slate-100 pb-5">
          <div className="flex items-center gap-2 text-blue-800">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <span className="text-xs font-semibold">بوابة الدخول المؤسسي المقيّد — RBAC</span>
          </div>
          <h1 className="mt-2.5 text-2xl font-bold tracking-tight text-slate-900">
            OWNER AI Enterprise
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            الدخول مقتصر حصرياً على الحسابات الإدارية المعتمدة (المالك، مدير العمليات، المدير المالي، مدير المبيعات) عبر التحقق بالبريد المؤسسي وكلمة المرور دون استخدام حسابات Google.
          </p>
        </div>

        {!connectionOk && (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
            تعذّر التحقق من الاتصال المباشر بخدمة Firestore؛ يرجى التحقق من اتصال الشبكة وإعدادات المشروع.
          </div>
        )}

        {authError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
            <div className="font-semibold">{authError}</div>
            {needsEmailProviderSetup && (
              <div className="mt-2.5 space-y-1.5 border-t border-red-200 pt-2.5 text-[11px] leading-relaxed text-red-800">
                <div className="font-semibold">خطوات تفعيل مزوّد البريد وكلمة المرور في Firebase Console:</div>
                <div>
                  1. افتح{' '}
                  <a
                    href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold underline hover:text-red-950"
                  >
                    إعدادات Authentication في Firebase Console
                  </a>
                  .
                </div>
                <div>2. اختر Sign-in method ثم أضف/فعّل خيار <strong>Email/Password</strong> واضغط <strong>Save</strong>.</div>
                <div>3. ارجع إلى هنا واضغط تسجيل الدخول ليتم تفعيل الحساب في Firebase تلقائياً.</div>
              </div>
            )}
          </div>
        )}

        {/* 4 Designated Executive Accounts Selector */}
        <div className="mt-6">
          <div className="mb-2.5 text-xs font-semibold text-slate-700">
            1. اختر الحساب الإداري المعتمد:
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {EXECUTIVE_ACCOUNTS.map((acc) => {
              const isSelected = selectedAccount.roleId === acc.roleId;
              return (
                <button
                  key={acc.roleId}
                  type="button"
                  onClick={() => handleSelectAccount(acc)}
                  className={`rounded-md border p-3.5 text-right transition-colors ${
                    isSelected
                      ? 'border-blue-700 bg-blue-50/70 ring-1 ring-blue-700'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <UserCheck
                        className={`h-4 w-4 shrink-0 ${
                          isSelected ? 'text-blue-700' : 'text-slate-400'
                        }`}
                      />
                      <span>{acc.titleAr}</span>
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                      {acc.code}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-slate-500" dir="ltr">
                    {acc.email}
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-600">{acc.scopeLabel}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4 border-t border-slate-100 pt-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                معرّف الحساب / البريد المؤسسي
              </span>
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                dir="ltr"
                required
                placeholder="owner@owner-ai.iq"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                كلمة المرور
              </span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  required
                  placeholder="••••••••••••"
                  className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 font-mono text-xs text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="absolute inset-y-0 left-2 flex items-center text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setIdentifier(selectedAccount.email);
                setPassword(selectedAccount.defaultPassword);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>تعبئة كلمة المرور الافتراضية لحساب ({selectedAccount.titleAr})</span>
            </button>

            <button
              type="submit"
              disabled={signingIn}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              <Lock className="h-4 w-4 shrink-0" />
              <span>{signingIn ? 'جارٍ التحقق من الحساب...' : `تسجيل الدخول (${selectedAccount.titleAr})`}</span>
            </button>
          </div>
        </form>

        {/* Reference table of the 4 designated corporate accounts */}
        <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3.5 text-[11px] text-slate-600">
          <div className="mb-2 font-semibold text-slate-800">
            دليل بيانات الدخول الأولية للحسابات الإدارية المحددة:
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {EXECUTIVE_ACCOUNTS.map((acc) => (
              <div
                key={acc.roleId}
                className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5"
              >
                <span className="font-semibold text-slate-800">{acc.titleAr}</span>
                <span className="font-mono text-[10px] text-slate-600" dir="ltr">
                  {acc.email} / {acc.defaultPassword}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
