import {
  AiAnalysisResponse,
  DashboardPayload,
  DecisionCase,
  DecisionStage,
  DeploymentMode,
  RoleId,
} from '../types.ts';

async function requestJson<T>(url: string, role: RoleId, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': role,
      ...(options?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? 'حدث خطأ أثناء تنفيذ الطلب.');
  }
  return data as T;
}

export function fetchDashboard(
  role: RoleId,
  period: string,
  branch: string,
  entityGroup: string = 'product'
): Promise<DashboardPayload> {
  const params = new URLSearchParams({ period, branch, entityGroup });
  return requestJson<DashboardPayload>(`/api/dashboard?${params.toString()}`, role);
}

export function toggleFavoriteReport(role: RoleId, reportId: string): Promise<{ favorites: string[] }> {
  return requestJson('/api/reports/favorite', role, {
    method: 'POST',
    body: JSON.stringify({ reportId }),
  });
}

export function recordRecentReport(role: RoleId, reportId: string): Promise<{ recentReports: string[] }> {
  return requestJson('/api/reports/recent', role, {
    method: 'POST',
    body: JSON.stringify({ reportId }),
  });
}

export function runAiAnalysis(
  role: RoleId,
  payload: { question: string; period: string; branch: string }
): Promise<AiAnalysisResponse> {
  return requestJson<AiAnalysisResponse>('/api/ai/analyze', role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createDecisionCase(role: RoleId, payload: Partial<DecisionCase>): Promise<DecisionCase> {
  return requestJson<DecisionCase>('/api/decisions', role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function approveDecisionCase(
  role: RoleId,
  id: string,
  decision: 'approve' | 'reject'
): Promise<DecisionCase> {
  return requestJson<DecisionCase>(`/api/decisions/${id}/approve`, role, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function progressDecisionCase(
  role: RoleId,
  id: string,
  payload: {
    stage?: DecisionStage;
    note?: string;
    outcomeMeasurement?: DecisionCase['outcomeMeasurement'];
  }
): Promise<DecisionCase> {
  return requestJson<DecisionCase>(`/api/decisions/${id}/progress`, role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function uploadManualFile(
  role: RoleId,
  payload: { fileName: string; base64Content: string }
): Promise<{ batch: unknown; conflictsAdded: unknown[]; acceptedCount: number; duplicateSkipped: boolean }> {
  return requestJson('/api/ingest/upload', role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function scanWatchedFolderApi(
  role: RoleId,
  dropSample = false
): Promise<{ filesScanned: string[]; newBatches: unknown[]; skippedDuplicates: number }> {
  return requestJson('/api/ingest/scan-watched', role, {
    method: 'POST',
    body: JSON.stringify({ dropSample }),
  });
}

export function syncDatabaseSource(
  role: RoleId,
  sourceId: string
): Promise<{ source: unknown; message: string }> {
  return requestJson('/api/ingest/sync-db', role, {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });
}

export function resolveSourceConflict(
  role: RoleId,
  conflictId: string,
  choice: 'primary' | 'secondary'
): Promise<unknown> {
  return requestJson(`/api/conflicts/${conflictId}/resolve`, role, {
    method: 'POST',
    body: JSON.stringify({ choice }),
  });
}

export function updateDeploymentMode(role: RoleId, mode: DeploymentMode): Promise<{ deploymentMode: DeploymentMode }> {
  return requestJson('/api/governance/deployment-mode', role, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function updateAlertRuleApi(
  role: RoleId,
  ruleId: string,
  payload: { threshold?: number; comparator?: 'gt' | 'lt'; enabled?: boolean }
): Promise<{ alertRules: import('../types.ts').AlertThresholdRule[] }> {
  return requestJson(`/api/alerts/rules/${ruleId}`, role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function acknowledgeAlertsApi(
  role: RoleId,
  alertIds: string[]
): Promise<{ acknowledgedCount: number }> {
  return requestJson('/api/alerts/acknowledge', role, {
    method: 'POST',
    body: JSON.stringify({ alertIds }),
  });
}

export function escalateAlertApi(
  role: RoleId,
  payload: {
    alertId: string;
    reportTitle: string;
    reportCategory: string;
    metricLabel: string;
    actualValueText: string;
    thresholdValueText: string;
    recommendedAction: string;
    targetRole: RoleId;
    period: string;
    branchScope: string;
    severity: 'critical' | 'warning';
  }
): Promise<DecisionCase> {
  return requestJson<DecisionCase>('/api/alerts/escalate', role, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
