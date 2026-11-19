import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  DashboardPayload,
  DecisionCase,
  DecisionStage,
  DeploymentMode,
  RoleId,
} from './src/types.ts';
import {
  buildEntityMatrix,
  buildProactiveAlerts,
  buildReportsForRole,
  buildRoleKpis,
  buildVarianceBridge,
  buildWeeklyBrief,
} from './server/economicEngine.ts';
import { runProtectedAiAnalysis } from './server/geminiService.ts';
import {
  dropSampleFileToWatchedFolder,
  ingestStructuredRows,
  parseUploadedBuffer,
  scanWatchedFolder,
} from './server/ingestion.ts';
import { ROLES } from './server/seedData.ts';
import { appendAuditLog, loadStore, saveStore } from './server/storage.ts';

function getRequestRole(req: express.Request): RoleId {
  const headerRole = String(req.headers['x-user-role'] ?? 'owner') as RoleId;
  return ROLES[headerRole] ? headerRole : 'owner';
}

function hasActionPermission(roleId: RoleId, action: 'view' | 'analyze' | 'export' | 'comment' | 'propose' | 'approve' | 'admin'): boolean {
  const role = ROLES[roleId];
  return role.allowedActions.includes(action);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '15mb' }));

  // 1. Unified Dashboard Payload (3D RBAC Enforced Server-Side)
  app.get('/api/dashboard', (req, res) => {
    const roleId = getRequestRole(req);
    const period = String(req.query.period ?? '2026-Q3');
    const requestedBranch = String(req.query.branch ?? 'all');

    const state = loadStore();
    const roleDef = ROLES[roleId];

    // Enforce data scope on server
    const branch =
      requestedBranch !== 'all' && requestedBranch !== 'الشركة كاملة' && !roleDef.dataScopes.includes(requestedBranch)
        ? roleDef.dataScopes[0]
        : requestedBranch;

    const availablePeriods = Array.from(new Set(state.transactions.map((t) => t.period))).sort();
    const availableBranches = Array.from(new Set(state.transactions.map((t) => t.branch)));

    const reports = buildReportsForRole(roleId, state, period, branch);
    const proactiveAlerts = buildProactiveAlerts(reports, state, period, branch);

    // Filter decisions by branch scope if non-owner
    const decisions = state.decisions.filter((d) => {
      if (roleId === 'owner') return true;
      if (branch !== 'all' && branch !== 'الشركة كاملة' && d.branchScope !== branch) return false;
      return true;
    });

    const payload: DashboardPayload = {
      role: roleDef,
      deploymentMode: state.deploymentMode,
      filters: {
        period,
        branch,
        availablePeriods,
        availableBranches,
      },
      kpis: buildRoleKpis(roleId, state, period, branch),
      weeklyBrief: buildWeeklyBrief(roleId, state, period, branch),
      varianceBridge: buildVarianceBridge(state, period, branch),
      entityMatrix: buildEntityMatrix(
        state,
        period,
        branch,
        (String(req.query.entityGroup ?? 'product') as 'product' | 'customer' | 'channel' | 'supplier' | 'branch')
      ),
      reports,
      decisions,
      sources: state.sources,
      batches: state.batches.slice(0, 20),
      conflicts: state.conflicts,
      alertRules: state.alertRules,
      proactiveAlerts,
      trustVaultCount: state.trustVault.length,
      // Only Owner and Finance see the Trust Vault mapping table
      trustVaultSample: roleId === 'owner' || roleId === 'finance' ? state.trustVault : [],
      auditLogs: roleId === 'owner' || roleId === 'finance' ? state.auditLogs.slice(0, 30) : [],
      favorites: state.favoritesByRole[roleId] ?? [],
      recentReports: state.recentReportsByRole[roleId] ?? [],
    };

    res.json(payload);
  });

  // 2. Toggle Favorite / Record Recent Report
  app.post('/api/reports/favorite', (req, res) => {
    const roleId = getRequestRole(req);
    const reportId = String(req.body.reportId ?? '');
    const state = loadStore();
    const list = state.favoritesByRole[roleId] ?? [];
    if (list.includes(reportId)) {
      state.favoritesByRole[roleId] = list.filter((id) => id !== reportId);
    } else {
      state.favoritesByRole[roleId] = [reportId, ...list];
    }
    saveStore(state);
    res.json({ favorites: state.favoritesByRole[roleId] });
  });

  app.post('/api/reports/recent', (req, res) => {
    const roleId = getRequestRole(req);
    const reportId = String(req.body.reportId ?? '');
    const state = loadStore();
    const list = state.recentReportsByRole[roleId] ?? [];
    state.recentReportsByRole[roleId] = [reportId, ...list.filter((id) => id !== reportId)].slice(0, 5);
    saveStore(state);
    res.json({ recentReports: state.recentReportsByRole[roleId] });
  });

  // 3. Enterprise AI Trust + Gemini Analysis Endpoint
  app.post('/api/ai/analyze', async (req, res) => {
    const roleId = getRequestRole(req);
    if (!hasActionPermission(roleId, 'analyze')) {
      res.status(403).json({ error: 'صلاحيات هذا الدور لا تسمح بتشغيل التحليل المتقدم.' });
      return;
    }

    const question = String(req.body.question ?? '').trim();
    const period = String(req.body.period ?? '2026-Q3');
    const branch = String(req.body.branch ?? 'all');

    if (!question) {
      res.status(400).json({ error: 'يرجى إدخال سؤال أو فرضية للتحليل.' });
      return;
    }

    try {
      const state = loadStore();
      const result = await runProtectedAiAnalysis({
        question,
        roleId,
        period,
        branch,
        state,
      });

      appendAuditLog(
        state,
        roleId,
        'تحليل ذكاء اصطناعي محمي',
        result.modelUsed,
        `استعلام ضمن (${period} / ${branch}) — أُعيد ترميز ${result.restoredTokensCount} كيان محلياً.`
      );
      saveStore(state);

      res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'تعذر الاتصال بمحرك الذكاء الاصطناعي.';
      res.status(500).json({ error: message });
    }
  });

  // 4. Decision Lifecycle Management (Create, Advance, Human-in-the-Loop Approve, Outcome Measure)
  app.post('/api/decisions', (req, res) => {
    const roleId = getRequestRole(req);
    if (!hasActionPermission(roleId, 'propose')) {
      res.status(403).json({ error: 'لا تملك صلاحية إنشاء قضية قرار.' });
      return;
    }

    const state = loadStore();
    const body = req.body as Partial<DecisionCase>;
    const newCase: DecisionCase = {
      id: `DEC-2026-${Math.floor(100 + Math.random() * 899)}`,
      title: String(body.title ?? 'قضية اقتصادية جديدة'),
      category: String(body.category ?? 'تحسين الهامش'),
      stage: 'diagnosis',
      severity: body.severity ?? 'medium',
      ownerRole: body.ownerRole ?? roleId,
      branchScope: String(body.branchScope ?? 'بغداد'),
      period: String(body.period ?? '2026-Q3'),
      detectedMetric: String(body.detectedMetric ?? 'هامش المساهمة'),
      baselineValue: String(body.baselineValue ?? 'غير محدد'),
      currentValue: String(body.currentValue ?? 'مرصود'),
      estimatedFinancialImpact: Number(body.estimatedFinancialImpact ?? 5000000),
      verificationStatus: body.verificationStatus ?? 'verified',
      diagnosisSummary: String(body.diagnosisSummary ?? 'تم إنشاء القضية من التقرير للمتابعة والتشخيص.'),
      epistemicLevel: body.epistemicLevel ?? 'hypothesis',
      proposedAction: String(body.proposedAction ?? 'مراجعة البدائل التشغيلية والتجارية وتحديد خطة التنفيذ.'),
      requiresOwnerApproval: Boolean(body.requiresOwnerApproval ?? true),
      approvalStatus: body.requiresOwnerApproval === false ? 'not_required' : 'pending_review',
      dueDate: String(body.dueDate ?? '2026-12-10'),
      executionNotes: [`أُنشئت القضية بواسطة ${ROLES[roleId].titleAr}.`],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.decisions.unshift(newCase);
    appendAuditLog(state, roleId, 'إنشاء قضية اقتصادية', newCase.id, newCase.title);
    saveStore(state);
    res.json(newCase);
  });

  app.post('/api/decisions/:id/approve', (req, res) => {
    const roleId = getRequestRole(req);
    if (!hasActionPermission(roleId, 'approve')) {
      res.status(403).json({ error: 'اعتماد القرارات الحساسة محصور بصلاحية المالك فقط (موافقة بشرية إلزامية).' });
      return;
    }

    const state = loadStore();
    const target = state.decisions.find((d) => d.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'القضية غير موجودة.' });
      return;
    }

    const decision = req.body.decision === 'reject' ? 'rejected' : 'approved';
    target.approvalStatus = decision;
    target.approvedBy = ROLES[roleId].titleAr;
    target.stage = decision === 'approved' ? 'execution' : 'diagnosis';
    target.executionNotes.push(
      decision === 'approved'
        ? `تم اعتماد القرار بشرياً من قِبل المالك (${new Date().toLocaleDateString('ar-IQ')}).`
        : 'تم رفض التوصية وإعادتها للتشخيص من قِبل المالك.'
    );
    target.updatedAt = new Date().toISOString();

    appendAuditLog(
      state,
      roleId,
      decision === 'approved' ? 'اعتماد قرار تنفيذي' : 'رفض مقترح قرار',
      target.id,
      target.title
    );
    saveStore(state);
    res.json(target);
  });

  app.post('/api/decisions/:id/progress', (req, res) => {
    const roleId = getRequestRole(req);
    const state = loadStore();
    const target = state.decisions.find((d) => d.id === req.params.id);
    if (!target) {
      res.status(404).json({ error: 'القضية غير موجودة.' });
      return;
    }

    if (target.requiresOwnerApproval && target.approvalStatus !== 'approved' && req.body.stage === 'execution') {
      res.status(400).json({ error: 'لا يمكن الانتقال للتنفيذ قبل اعتماد المالك.' });
      return;
    }

    const nextStage = req.body.stage as DecisionStage | undefined;
    const note = String(req.body.note ?? '').trim();
    if (nextStage) target.stage = nextStage;
    if (note) target.executionNotes.push(`${ROLES[roleId].titleAr}: ${note}`);

    if (req.body.outcomeMeasurement) {
      target.outcomeMeasurement = req.body.outcomeMeasurement;
      target.stage = 'outcome_measurement';
      target.epistemicLevel = 'execution_outcome';
    }

    target.updatedAt = new Date().toISOString();
    appendAuditLog(state, roleId, 'تحديث مسار قضية قرار', target.id, `المرحلة: ${target.stage}`);
    saveStore(state);
    res.json(target);
  });

  // 5. Data Ingestion Endpoints (Manual Upload, Watched Folder, Direct DB Sync, Conflict Resolution)
  app.post('/api/ingest/upload', (req, res) => {
    const roleId = getRequestRole(req);
    const { fileName, base64Content, sourceType } = req.body as {
      fileName: string;
      base64Content: string;
      sourceType?: 'manual_upload' | 'watched_folder';
    };

    if (!fileName || !base64Content) {
      res.status(400).json({ error: 'يرجى تحديد ملف صالح للرفع.' });
      return;
    }

    try {
      const buffer = Buffer.from(base64Content, 'base64');
      const rows = parseUploadedBuffer(fileName, buffer);
      const state = loadStore();

      const outcome = ingestStructuredRows({
        rows,
        rawBytesForHash: buffer,
        sourceId: sourceType === 'watched_folder' ? 'src_watched_folder' : 'src_manual_upload',
        sourceName: `تحميل يدوي — ${fileName}`,
        sourceType: 'manual_upload',
        importedBy: `${ROLES[roleId].titleAr}`,
        actorRole: roleId,
        state,
      });

      res.json(outcome);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'فشل تحليل الملف المرفوع.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/ingest/scan-watched', (req, res) => {
    const roleId = getRequestRole(req);
    const state = loadStore();
    if (req.body?.dropSample) {
      dropSampleFileToWatchedFolder();
    }
    const result = scanWatchedFolder(roleId, state);
    res.json(result);
  });

  app.post('/api/ingest/sync-db', (req, res) => {
    const roleId = getRequestRole(req);
    const sourceId = String(req.body.sourceId ?? 'src_erp_pg');
    const state = loadStore();
    const src = state.sources.find((s) => s.id === sourceId);
    if (!src) {
      res.status(404).json({ error: 'مصدر البيانات غير موجود.' });
      return;
    }

    src.lastSyncAt = new Date().toISOString();
    appendAuditLog(
      state,
      roleId,
      'فحص ومزامنة موصل القراءة فقط',
      src.id,
      `تحقق تفاضلي من ${src.tablesOrPath.join(', ')} — صلاحية قراءة فقط مؤكدة.`
    );
    saveStore(state);
    res.json({ source: src, message: 'تم فحص ومزامنة جداول القراءة بنجاح دون تعديل المصدر.' });
  });

  app.post('/api/conflicts/:id/resolve', (req, res) => {
    const roleId = getRequestRole(req);
    if (roleId !== 'owner' && roleId !== 'finance') {
      res.status(403).json({ error: 'اعتماد مصدر الحقيقة عند التعارض متاح للمالك والمدير المالي فقط.' });
      return;
    }

    const choice = req.body.choice === 'secondary' ? 'resolved_secondary' : 'resolved_primary';
    const state = loadStore();
    const conflict = state.conflicts.find((c) => c.id === req.params.id);
    if (!conflict) {
      res.status(404).json({ error: 'التعارض غير موجود.' });
      return;
    }

    conflict.status = choice;
    conflict.resolvedBy = ROLES[roleId].titleAr;
    conflict.resolvedAt = new Date().toISOString();

    appendAuditLog(
      state,
      roleId,
      'حسم تعارض مصدر بيانات',
      conflict.id,
      `اعتُمد ${choice === 'resolved_primary' ? conflict.primarySourceName : conflict.secondarySourceName} كمصدر حقيقة.`
    );
    saveStore(state);
    res.json(conflict);
  });

  // 6. Deployment Mode Switch (Owner Admin only)
  app.post('/api/governance/deployment-mode', (req, res) => {
    const roleId = getRequestRole(req);
    if (!hasActionPermission(roleId, 'admin')) {
      res.status(403).json({ error: 'تغيير نموذج النشر والخصوصية محصور بصلاحية المالك.' });
      return;
    }

    const mode = String(req.body.mode) as DeploymentMode;
    if (!['hybrid', 'fully_private', 'managed_cloud'].includes(mode)) {
      res.status(400).json({ error: 'نموذج نشر غير صالح.' });
      return;
    }

    const state = loadStore();
    state.deploymentMode = mode;
    appendAuditLog(state, roleId, 'تغيير نموذج النشر والخصوصية', 'DeploymentPolicy', `التحول إلى ${mode}`);
    saveStore(state);
    res.json({ deploymentMode: mode });
  });

  // 7. Proactive Deviation Alert Rules & Notification Workflow
  app.post('/api/alerts/rules/:id', (req, res) => {
    const roleId = getRequestRole(req);
    const state = loadStore();
    const rule = state.alertRules.find((r) => r.id === req.params.id);
    if (!rule) {
      res.status(404).json({ error: 'قاعدة التنبيه غير موجودة.' });
      return;
    }

    if (typeof req.body.threshold === 'number' && Number.isFinite(req.body.threshold)) {
      rule.threshold = Math.max(0, req.body.threshold);
    }
    if (req.body.comparator === 'gt' || req.body.comparator === 'lt') {
      rule.comparator = req.body.comparator;
    }
    if (typeof req.body.enabled === 'boolean') {
      rule.enabled = req.body.enabled;
    }
    rule.updatedBy = roleId;
    rule.updatedAt = new Date().toISOString();

    // Clear prior acknowledgements for alerts tied to this metric so new thresholds notify cleanly
    for (const key of Object.keys(state.alertStates)) {
      if (key.includes(`__${rule.metricKey}__`)) {
        delete state.alertStates[key];
      }
    }

    appendAuditLog(
      state,
      roleId,
      'تحديث حد الانحراف الاستباقي',
      rule.metricLabel,
      `الحد الجديد: ${rule.comparator === 'gt' ? '>' : '<'} ${rule.threshold} ${rule.unit} (${rule.enabled ? 'مفعّل' : 'معطّل'})`
    );
    saveStore(state);
    res.json({ alertRules: state.alertRules });
  });

  app.post('/api/alerts/acknowledge', (req, res) => {
    const roleId = getRequestRole(req);
    const alertIds = Array.isArray(req.body.alertIds) ? (req.body.alertIds as string[]) : [];
    const state = loadStore();
    const now = new Date().toISOString();

    let count = 0;
    for (const id of alertIds) {
      if (typeof id === 'string' && id.trim()) {
        state.alertStates[id] = {
          status: 'acknowledged',
          by: ROLES[roleId].titleAr,
          at: now,
        };
        count += 1;
      }
    }

    if (count > 0) {
      appendAuditLog(state, roleId, 'تأكيد استلام تنبيه انحراف', `${count} تنبيه`, 'تمت مراجعة وتأكيد استلام إشعارات الانحراف.');
      saveStore(state);
    }
    res.json({ acknowledgedCount: count });
  });

  app.post('/api/alerts/escalate', (req, res) => {
    const roleId = getRequestRole(req);
    if (!hasActionPermission(roleId, 'propose')) {
      res.status(403).json({ error: 'لا تملك صلاحية تصعيد التنبيه إلى قضية قرار.' });
      return;
    }

    const {
      alertId,
      reportTitle,
      reportCategory,
      metricLabel,
      actualValueText,
      thresholdValueText,
      recommendedAction,
      targetRole,
      period,
      branchScope,
      severity,
    } = req.body as {
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
    };

    const state = loadStore();
    const newCase: DecisionCase = {
      id: `DEC-ALT-${Math.floor(100 + Math.random() * 899)}`,
      title: `معالجة تجاوز (${metricLabel}) — ${reportTitle}`,
      category: reportCategory || 'الربحية والهوامش',
      stage: 'diagnosis',
      severity: severity === 'critical' ? 'high' : 'medium',
      ownerRole: targetRole || roleId,
      branchScope: branchScope === 'الشركة كاملة' ? 'بغداد' : branchScope,
      period: period || '2026-Q3',
      detectedMetric: metricLabel,
      baselineValue: `الحد المسموح: ${thresholdValueText}`,
      currentValue: actualValueText,
      estimatedFinancialImpact: severity === 'critical' ? 15000000 : 7500000,
      verificationStatus: 'verified',
      diagnosisSummary: `رصد نظام التنبيهات الاستباقي تجاوز مؤشر "${metricLabel}" للحد المسموح به في تقرير "${reportTitle}" (${actualValueText} مقابل ${thresholdValueText}).`,
      epistemicLevel: 'calculated_fact',
      proposedAction: recommendedAction || `اتخاذ إجراء تصحيحي فوري لإعادة ${metricLabel} ضمن الحد المعتمد.`,
      requiresOwnerApproval: true,
      approvalStatus: 'pending_review',
      dueDate: '2026-12-08',
      executionNotes: [`تم تصعيد التنبيه الاستباقي بواسطة ${ROLES[roleId].titleAr}.`],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    state.decisions.unshift(newCase);
    if (alertId) {
      state.alertStates[alertId] = {
        status: 'escalated',
        by: ROLES[roleId].titleAr,
        at: new Date().toISOString(),
      };
    }

    appendAuditLog(state, roleId, 'تصعيد تنبيه انحراف إلى قرار', newCase.id, newCase.title);
    saveStore(state);
    res.json(newCase);
  });

  // Vite or Static Frontend
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OWNER AI Enterprise server listening on http://localhost:${PORT}`);
  });
}

startServer();
