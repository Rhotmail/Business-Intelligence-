import { GoogleGenAI, Type } from '@google/genai';
import { AiAnalysisResponse, EpistemicLevel, RoleId } from '../src/types.ts';
import {
  detokenizeTextLocally,
  tokenizeTextLocally,
  verifyClaimAgainstEngineNumbers,
} from './aiTrust.ts';
import { aggregateMetrics, buildEntityMatrix, filterTransactions, formatIQD } from './economicEngine.ts';
import { EnterpriseStoreState } from './storage.ts';

const aiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

export async function runProtectedAiAnalysis(params: {
  question: string;
  roleId: RoleId;
  period: string;
  branch: string;
  state: EnterpriseStoreState;
}): Promise<AiAnalysisResponse> {
  const { question, roleId, period, branch, state } = params;
  const rows = filterTransactions(state.transactions, period, branch);
  const agg = aggregateMetrics(rows);
  const products = buildEntityMatrix(state, period, branch, 'product');
  const customers = buildEntityMatrix(state, period, branch, 'customer');

  // Build deterministic factual context
  const rawContextLines = [
    `الشركة: شركة الرافدين للتجارة`,
    `الدور الطالب للتحليل: ${roleId} | الفترة: ${period} | النطاق: ${branch}`,
    `صافي الإيرادات: ${Math.round(agg.netRevenue)} د.ع (${formatIQD(agg.netRevenue)})`,
    `نسبة الخصم التجاري: ${agg.discountRatePct.toFixed(1)}% (إجمالي الخصم: ${Math.round(agg.discountAmount)} د.ع)`,
    `كلفة البضاعة المباعة (COGS): ${Math.round(agg.cogs)} د.ع`,
    `هامش المساهمة: ${agg.contributionMarginPct !== null ? agg.contributionMarginPct.toFixed(1) + '%' : 'غير مكتمل'} (${agg.contributionCoverageNote})`,
    `صافي الربح: ${agg.netProfit !== null ? Math.round(agg.netProfit) + ' د.ع' : 'معلّق بسبب نقص OpEx'}`,
    `السيولة المحتجزة في المخزون والذمم: ${Math.round(agg.trappedCapital)} د.ع`,
    `متوسط أيام المخزون: ${Math.round(agg.avgInventoryDays)} يوم | متوسط أيام التحصيل: ${Math.round(agg.avgArDays)} يوم`,
    `تفاصيل المنتجات: ${products
      .map(
        (p) =>
          `${p.entityName} (إيراد: ${Math.round(p.netRevenue)}, خصم: ${p.discountRatePct}%, مساهمة: ${p.contributionMarginPct ?? 'غير متاح'}%)`
      )
      .join(' ؛ ')}`,
    `تفاصيل العملاء: ${customers
      .map(
        (c) =>
          `${c.entityName} (إيراد: ${Math.round(c.netRevenue)}, خصم: ${c.discountRatePct}%, رأس مال محتجز: ${Math.round(c.trappedCapital)})`
      )
      .join(' ؛ ')}`,
  ].join('\n');

  // Known deterministic numbers for return-path verification
  const knownNumbers: number[] = [
    agg.netRevenue,
    agg.discountAmount,
    agg.discountRatePct,
    agg.cogs,
    agg.grossProfit,
    agg.grossMarginPct,
    agg.trappedCapital,
    agg.avgInventoryDays,
    agg.avgArDays,
    agg.wasteCost,
    ...(agg.contributionMarginPct !== null ? [agg.contributionMarginPct] : []),
    ...(agg.contributionProfit !== null ? [agg.contributionProfit] : []),
    ...(agg.netProfit !== null ? [agg.netProfit] : []),
    ...products.flatMap((p) => [p.netRevenue, p.discountRatePct, p.contributionMarginPct ?? 0]),
    ...customers.flatMap((c) => [c.netRevenue, c.discountRatePct, c.trappedCapital]),
  ];

  // Step 1: Tokenize locally via Enterprise AI Trust (never leaves server unmasked)
  const { tokenizedText: tokenizedContext } = tokenizeTextLocally(rawContextLines, state);
  const { tokenizedText: tokenizedQuestion } = tokenizeTextLocally(question, state);

  const fullTokenizedPrompt = `أنت محلل اقتصادي تنفيذي لمنصة OWNER AI Enterprise.
تعتمد على البيانات الرقمية المحسوبة محلياً والمرفقة أدناه فقط. استخدم نفس رموز الكيانات (مثل PRODUCT_008, CUSTOMER_027, BRANCH_001) دون محاولة تخمين أسمائها الحقيقية.
قدّم تشخيصاً اقتصادياً دقيقاً بالعربية يميز بصراحة بين الحقائق المحسوبة والفرضيات والتوصيات، ولا تفترض أرقاماً غير موجودة.

السياق المرمّز المعتمد:
${tokenizedContext}

سؤال المستخدم المرمّز:
${tokenizedQuestion}`;

  // Step 2: Check Deployment Mode — Fully Private blocks any external AI transmission!
  if (state.deploymentMode === 'fully_private') {
    const localNarrative = `تم تشغيل التحليل في وضع الخصوصية الكاملة (Fully Private Mode) داخل خادم الشركة دون إرسال أي بيانات إلى نموذج خارجي.
وفق المحرك الاقتصادي المحلي لنطاق (${branch}) خلال (${period}): بلغ صافي الإيرادات ${formatIQD(agg.netRevenue)} بمعدل خصم ${agg.discountRatePct.toFixed(1)}%، وبلغت السيولة المحتجزة ${formatIQD(agg.trappedCapital)}.`;

    return {
      epistemicSummary: [
        {
          statement: `تم احتساب صافي الإيرادات ${formatIQD(agg.netRevenue)} ومعدل الخصم ${agg.discountRatePct.toFixed(1)}% محلياً بنسبة موثوقية عالية.`,
          level: 'calculated_fact',
          verifiedAgainstEngine: true,
          verificationNote: 'حساب محلي حتمي (Fully Private)',
        },
        {
          statement: 'يُوصى بضبط سقف الخصومات ومراجعة المخزون البطيء قبل التوسع الائتماني.',
          level: 'recommendation',
          verifiedAgainstEngine: true,
          verificationNote: 'توصية محلية دون اتصال خارجي',
        },
      ],
      executiveNarrative: localNarrative,
      tokenizedPromptPreview: fullTokenizedPrompt,
      rawModelResponsePreview: '[محجوب بموجب سياسة Fully Private Mode — لم تغادر أي بيانات البيئة المحلية]',
      restoredTokensCount: 0,
      deploymentMode: state.deploymentMode,
      modelUsed: 'Local Deterministic Engine Only (Fully Private)',
    };
  }

  if (!aiClient) {
    throw new Error('مفتاح Gemini API غير مهيأ على الخادم (GEMINI_API_KEY).');
  }

  // Step 3: Call Gemini API (`gemini-4-hydrogen`) with structured schema
  const response = await aiClient.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: fullTokenizedPrompt,
    config: {
      systemInstruction:
        'أنت محرك تفسير اقتصادي مؤسسي. التزم برموز الكيانات كما وردت (مثل PRODUCT_008 و CUSTOMER_027) ولا تخترع أرقاماً غير واردة في السياق. صنّف كل نقطة إلى مستوى معرفي دقيق.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          executiveNarrative: {
            type: Type.STRING,
            description: 'ملخص تحليلي تنفيذي واضح ومباشر باللغة العربية باستخدام رموز الكيانات كما وردت.',
          },
          insights: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                statement: { type: Type.STRING, description: 'الجملة التحليلية باستخدام رموز الكيانات.' },
                level: {
                  type: Type.STRING,
                  description:
                    'واحدة من: calculated_fact, analytical_conclusion, hypothesis, recommendation, execution_outcome',
                },
              },
              required: ['statement', 'level'],
            },
          },
        },
        required: ['executiveNarrative', 'insights'],
      },
    },
  });

  const rawJsonStr = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawJsonStr) as {
    executiveNarrative?: string;
    insights?: Array<{ statement: string; level: string }>;
  };

  const rawNarrative = parsed.executiveNarrative ?? '';
  const rawInsights = Array.isArray(parsed.insights) ? parsed.insights : [];

  // Step 4: Local De-Tokenization + Return-Path Numeric Verification
  const { restoredText: restoredNarrative, restoredCount: count1 } = detokenizeTextLocally(rawNarrative, state);
  let totalRestored = count1;

  const allowedLevels: EpistemicLevel[] = [
    'calculated_fact',
    'analytical_conclusion',
    'hypothesis',
    'recommendation',
    'execution_outcome',
  ];

  const epistemicSummary = rawInsights.map((item) => {
    const { restoredText, restoredCount } = detokenizeTextLocally(item.statement, state);
    totalRestored += restoredCount;
    const validLevel: EpistemicLevel = allowedLevels.includes(item.level as EpistemicLevel)
      ? (item.level as EpistemicLevel)
      : 'analytical_conclusion';

    const check = verifyClaimAgainstEngineNumbers(restoredText, knownNumbers);
    return {
      statement: restoredText,
      level: !check.verified && validLevel === 'calculated_fact' ? 'hypothesis' : validLevel,
      verifiedAgainstEngine: check.verified,
      verificationNote: check.note,
    };
  });

  return {
    epistemicSummary,
    executiveNarrative: restoredNarrative,
    tokenizedPromptPreview: fullTokenizedPrompt,
    rawModelResponsePreview: rawJsonStr,
    restoredTokensCount: totalRestored,
    deploymentMode: state.deploymentMode,
    modelUsed: 'gemini-4-hydrogen (Protected via Enterprise AI Trust)',
  };
}
