import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'حدث خطأ غير متوقع في التطبيق.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; path?: string; operationType?: string };
      if (parsed && typeof parsed === 'object' && parsed.error) {
        if (parsed.error.includes('Quota exceeded')) {
          readable =
            'تم بلوغ الحد اليومي المجاني لقراءات/كتابات Firestore. يُعاد ضبط الحصة تلقائياً في اليوم التالي.';
        } else if (parsed.error.includes('Missing or insufficient permissions')) {
          readable = `تعذّر الوصول إلى قاعدة البيانات (${parsed.operationType ?? 'read'} على ${parsed.path ?? 'المسار'}) بسبب صلاحيات الأمان.`;
        } else {
          readable = parsed.error;
        }
      }
    } catch {
      // keep raw message
    }
    return { hasError: true, message: readable };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6" dir="rtl">
          <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6 text-right shadow-sm">
            <div className="flex items-center gap-2.5 text-red-800">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h1 className="text-base font-bold">تعذر استكمال العملية</h1>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-700">{this.state.message}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>إعادة تحميل المنصة</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
