// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — WORD-WISE SEARCH RANKING (shared client+server)
// ═══════════════════════════════════════════════════════════════
// Every search bar in the product pipes results through this module so
// "text-wise / word-wise" matches always surface on top:
//
//   1. Every query word must match somewhere across the searchable
//      fields (AND across words, OR across fields) — e.g. "taparia
//      hammer" matches brand "Taparia" + name "Claw Hammer".
//      A word matched by NO field (even with typo tolerance) drops the row.
//   2. Ranking (best first):
//        • exact full-phrase equality on a field
//        • field starts with the whole phrase
//        • whole phrase contained in a field
//        • every word at a WORD START (word-wise hit)  ← ranked above
//        • words contained mid-string (text-wise hit)
//        • typo-tolerant hits (edit distance 1)         ← ranked lowest
//      Primary (first) fields weigh more; hits at the start of a
//      field weigh more than hits buried mid-string.
//
// Pure TypeScript — safe to import from API routes AND client views.
// ═══════════════════════════════════════════════════════════════

/** Lowercase, strip Latin diacritics, collapse whitespace. Devanagari is preserved. */
export function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalizeText(s);
  return n ? n.split(" ").filter(Boolean) : [];
}

/**
 * Case variants for SQL `contains` prefilters. Postgres `contains` is
 * case-sensitive (SQLite is not) and `mode: "insensitive"` is unsupported
 * on the SQLite connector — offering as-typed / lower / UPPER / Capitalized
 * variants keeps the prefilter a generous superset on BOTH connectors while
 * the case-insensitive JS ranker below does the exact word-wise matching.
 */
export function containsVariants(word: string): string[] {
  const lower = word.toLowerCase();
  const upper = lower.toUpperCase();
  const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([word, lower, upper, cap])];
}

/**
 * Full SQL prefilter arms for ONE query word: case-variant `contains` on
 * every searchable column, plus — for words of 4+ chars — a 3-char prefix
 * relaxation so edit-distance-1 typos can reach the JS ranker (which makes
 * the final match decision). `col` maps one case variant to the OR arms of
 * a single column, e.g. (v) => [{ sku: { contains: v } }, …].
 */
export function containsArms<T>(word: string, col: (v: string) => T[]): T[] {
  const arms = containsVariants(word).flatMap(col);
  if (word.length < 4) return arms;
  return arms.concat(containsVariants(word.slice(0, 3)).flatMap(col));
}


/** Bounded Levenshtein with early exit (typo tolerance only). */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return false;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max;
}

const LETTER_RE = /[a-z0-9\u0900-\u097F]/;

/** Word-start hit = begins a token or follows a separator (/, -, #, @, ., _, + …). */
function isWordStartHit(field: string, word: string): boolean {
  let idx = field.indexOf(word);
  while (idx !== -1) {
    if (idx === 0) return true;
    if (!LETTER_RE.test(field[idx - 1])) return true;
    idx = field.indexOf(word, idx + 1);
  }
  return false;
}

// Tier scores
const PHRASE_EXACT = 400;
const PHRASE_PREFIX = 300;
const PHRASE_CONTAINS = 200;
const WORD_START = 60;
const WORD_START_HEAD = 72; // field starts with the word
const CONTAINS = 30;
const TYPO = 18;

interface FieldMatch {
  score: number;
  matched: number; // bitmask of matched word indices
}

/**
 * Score ONE field against the query. Words unmatched by this field are
 * simply not credited here — the record-level union decides the AND.
 */
function scoreField(field: string, words: string[], phrase: string, allowTypo: boolean): FieldMatch {
  const result: FieldMatch = { score: 0, matched: 0 };
  if (!field) return result;

  // Whole-phrase tiers
  if (field === phrase) result.score += PHRASE_EXACT;
  else if (field.startsWith(phrase)) result.score += PHRASE_PREFIX;
  else if (phrase.length >= 3 && field.includes(phrase)) result.score += PHRASE_CONTAINS;

  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    // Earlier query words weigh slightly more (users lead with the key term)
    const wordWeight = words.length > 1 ? 1 + (words.length - w) * 0.12 : 1;
    const bit = 1 << w;
    if (result.matched & bit) continue;

    if (isWordStartHit(field, word)) {
      result.score += (field.startsWith(word) ? WORD_START_HEAD : WORD_START) * wordWeight;
      result.matched |= bit;
      continue;
    }
    if (field.includes(word)) {
      result.score += CONTAINS * wordWeight;
      result.matched |= bit;
      continue;
    }
    if (allowTypo && word.length >= 4) {
      const tokens = field.split(/[^a-z0-9\u0900-\u097F]+/).filter(Boolean);
      let typoHit = false;
      for (const tok of tokens) {
        if (Math.abs(tok.length - word.length) <= 1 && editDistanceWithin(tok, word, 1)) {
          typoHit = true;
          break;
        }
        if (tok.length >= word.length && tok.startsWith(word.slice(0, 3)) && editDistanceWithin(tok.slice(0, word.length + 1), word, 1)) {
          typoHit = true;
          break;
        }
      }
      if (typoHit) {
        result.score += TYPO * wordWeight;
        result.matched |= bit;
      }
    }
  }
  return result;
}

/**
 * Rank records against a query using ordered searchable fields.
 * - Empty query → items pass through unchanged.
 * - Non-matching records are dropped; matches sorted best-first.
 * - `opts.limit` truncates; `opts.chronological` keeps date order but only
 *   filters (used by registers where newest-first beats relevance).
 */
export function rankSearch<T>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => Array<string | number | null | undefined>,
  opts?: { limit?: number; chronological?: boolean }
): T[] {
  const q = normalizeText(query);
  if (!q) return [...items];
  const words = tokenize(q);
  const allMask = words.length >= 31 ? -1 : (1 << words.length) - 1;

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const fields = getFields(item).map((f) => normalizeText(String(f ?? "")));
    let total = 0;
    let union = 0;
    for (let f = 0; f < fields.length; f++) {
      const m = scoreField(fields[f], words, q, f === 0);
      if (m.score === 0) continue;
      // Primary field counts double; later fields taper off.
      total += m.score * (f === 0 ? 2 : 1 / (1 + f * 0.5));
      union |= m.matched;
    }
    const covered = words.length >= 31 ? union === -1 : (union & allMask) === allMask;
    if (!covered) continue; // hard AND across words (with typo rescue)
    scored.push({ item, score: total });
  }

  // Chronological registers: filter only, keep incoming (newest-first) order.
  if (opts?.chronological) {
    const keep = new Set(scored.map((s) => s.item));
    return items.filter((i) => keep.has(i)).slice(0, opts.limit ?? Infinity);
  }
  scored.sort((a, b) => b.score - a.score);
  const out = scored.map((s) => s.item);
  return opts?.limit ? out.slice(0, opts.limit) : out;
}

/** Filter without reordering (complement: drops non-matches only). */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  getFields: (item: T) => Array<string | number | null | undefined>
): T[] {
  return rankSearch(items, query, getFields, { chronological: true });
}
