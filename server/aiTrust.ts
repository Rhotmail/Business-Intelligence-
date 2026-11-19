import { TrustVaultEntry } from '../src/types.ts';
import { EnterpriseStoreState, saveStore } from './storage.ts';

/**
 * Enterprise AI Trust — Local Entity Tokenization & Return-Path Verification
 * Zero external API calls are ever made to tokenize or de-tokenize entity names.
 */

export function ensureTokenForEntity(
  state: EnterpriseStoreState,
  entityType: TrustVaultEntry['entityType'],
  realName: string
): string {
  const normalized = realName.trim();
  if (!normalized) return realName;

  const existing = state.trustVault.find(
    (entry) => entry.entityType === entityType && entry.realName === normalized
  );
  if (existing) return existing.token;

  const countOfType = state.trustVault.filter((e) => e.entityType === entityType).length + 1;
  const padded = String(countOfType + 20).padStart(3, '0');
  const token = `${entityType}_${padded}`;

  state.trustVault.push({
    token,
    entityType,
    realName: normalized,
    createdAt: new Date().toISOString(),
  });
  saveStore(state);
  return token;
}

export function tokenizeTextLocally(
  text: string,
  state: EnterpriseStoreState
): { tokenizedText: string; replacementsCount: number } {
  let result = text;
  let count = 0;

  // Sort longest realName first to avoid partial substring collisions
  const sorted = [...state.trustVault].sort((a, b) => b.realName.length - a.realName.length);

  for (const entry of sorted) {
    if (entry.realName && result.includes(entry.realName)) {
      const escaped = entry.realName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const matches = result.match(regex);
      if (matches) {
        count += matches.length;
        result = result.replace(regex, entry.token);
      }
    }
  }

  return { tokenizedText: result, replacementsCount: count };
}

export function detokenizeTextLocally(
  tokenizedText: string,
  state: EnterpriseStoreState
): { restoredText: string; restoredCount: number } {
  let result = tokenizedText;
  let count = 0;

  const sorted = [...state.trustVault].sort((a, b) => b.token.length - a.token.length);
  for (const entry of sorted) {
    if (result.includes(entry.token)) {
      const escaped = entry.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      const matches = result.match(regex);
      if (matches) {
        count += matches.length;
        result = result.replace(regex, entry.realName);
      }
    }
  }

  return { restoredText: result, restoredCount: count };
}

/**
 * Return-Path Numeric Verification:
 * Checks whether numbers quoted by AI match verified deterministic numbers in context,
 * preventing unverified estimates from being presented as verified facts.
 */
export function verifyClaimAgainstEngineNumbers(
  statement: string,
  knownNumbers: number[]
): { verified: boolean; note: string } {
  const numberMatches = statement.match(/\d+(?:[.,]\d+)?/g);
  if (!numberMatches || numberMatches.length === 0) {
    return { verified: true, note: 'تحليل نوعي مستند إلى السياق المعتمد' };
  }

  const parsedNums = numberMatches.map((m) => Number(m.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
  const matchedAny = parsedNums.some((n) =>
    knownNumbers.some((kn) => {
      if (kn === 0) return n === 0;
      const relDiff = Math.abs(kn - n) / Math.abs(kn);
      const scaledDiff = Math.abs(kn / 1_000_000 - n) / Math.max(0.01, Math.abs(kn / 1_000_000));
      return relDiff <= 0.03 || scaledDiff <= 0.05;
    })
  );

  if (matchedAny) {
    return { verified: true, note: 'مطابق حسابياً مع نتائج المحرك الاقتصادي المحلي' };
  }

  return {
    verified: false,
    note: 'يحتوي على رقم/نسبة تقديرية لم تُطابق رقمياً بالمعادلة المحلية — يُعامل كتقدير تحليلي',
  };
}
