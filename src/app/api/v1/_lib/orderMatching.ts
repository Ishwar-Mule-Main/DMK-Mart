// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — DUAL INTELLIGENT MATCHING ENGINE (deep-scan orders)
// Links every entity extracted from an external order document to the
// existing masters:
//   Customer → exact Phone → exact GSTIN → fuzzy Business Name
//   Product  → exact SKU  → fuzzy Name (number-aware: model codes
//              like "107", "20 Ltr", "5-7-12" are discriminative)
// Everything is deterministic (no AI in this layer) so results are
// reproducible and auditable. Confidence 0..1; AUTO threshold decides
// auto-link vs "unmatched → quick-add".
// ═══════════════════════════════════════════════════════════════

// Words that carry no identity in Indian trade names.
const STOP_WORDS = new Set([
  "pvt", "private", "ltd", "limited", "llp", "lp", "opc",
  "trading", "traders", "trader", "company", "co", "corp",
  "enterprises", "enterprise", "agency", "agency", "the", "and",
  "sales", "service", "supplier", "suppliers", "general", "stores", "store",
]);

/** Normalize free text: lowercase, punctuation → spaces, collapse. */
function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Identity tokens of a business/product name (stop-words dropped). */
function tokens(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Numeric model codes ("107", "20", "5", "7", "12", "24") — highly discriminative. */
function numberTokens(s: string): string[] {
  return normalizeText(s).split(" ").filter((t) => /\d/.test(t) && t.length >= 1);
}

/** Jaccard similarity over token sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Last 10 digits of a phone-ish string (Indian mobile normalization). */
export function normalizePhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// ─── Customer matching ───────────────────────────────────────────

export interface CustomerMatchCandidate {
  id: string;
  partyName: string;
  firmName: string;
  phone: string;
  gstin: string;
  city: string;
  assignedTier: string;
  creditLimit: number;
  closingBalance: number;
  customerType: string;
}

export interface CustomerMatchResult {
  customer: CustomerMatchCandidate | null;
  confidence: number;
  method: "PHONE" | "GSTIN" | "NAME" | "";
}

/**
 * Scenario A of the spec: exact phone → exact GSTIN → fuzzy name.
 * Name matching blends Jaccard over identity tokens with a substring
 * containment bonus (e.g. "Parihar Trading" inside
 * "Parihar Trading Company, Pune") — the two signals overlap heavily,
 * so take the max.
 */
export function matchCustomer(
  extracted: { businessName?: string; phone?: string; gstin?: string },
  candidates: CustomerMatchCandidate[]
): CustomerMatchResult {
  const phone = normalizePhone(extracted.phone ?? "");
  const gstin = (extracted.gstin ?? "").trim().toUpperCase();
  const name = (extracted.businessName ?? "").trim();

  // 1 — exact phone
  if (phone.length >= 10) {
    const hit = candidates.find((c) => normalizePhone(c.phone) === phone);
    if (hit) return { customer: hit, confidence: 0.98, method: "PHONE" };
  }

  // 2 — exact GSTIN
  if (gstin.length >= 10) {
    const hit = candidates.find((c) => (c.gstin ?? "").trim().toUpperCase() === gstin);
    if (hit) return { customer: hit, confidence: 0.97, method: "GSTIN" };
  }

  // 3 — fuzzy business name
  if (name.length >= 4) {
    const nameTokens = new Set(tokens(name));
    const nameNumbers = new Set(numberTokens(name));
    let best: CustomerMatchResult = { customer: null, confidence: 0, method: "" };
    for (const c of candidates) {
      const cName = `${c.partyName} ${c.firmName ?? ""}`;
      const cTokens = new Set(tokens(cName));
      let score = jaccard(nameTokens, cTokens);
      // containment bonus — one name is a substring of the other
      const a = normalizeText(name);
      const b = normalizeText(cName);
      if (a.length >= 5 && (b.includes(a) || a.includes(b))) {
        score = Math.max(score, 0.82);
      }
      // model numbers agreeing is a strong signal
      if (nameNumbers.size > 0) {
        const cNumbers = new Set(numberTokens(cName));
        let numHit = 0;
        for (const n of nameNumbers) if (cNumbers.has(n)) numHit += 1;
        score += 0.08 * numHit;
      }
      if (score > best.confidence) {
        best = { customer: c, confidence: Math.min(0.95, score), method: "NAME" };
      }
    }
    if (best.confidence >= 0.62) return best;
  }

  return { customer: null, confidence: 0, method: "" };
}

/** Below this confidence the customer row shows "NEW CUSTOMER DETECTED". */
export const CUSTOMER_AUTO_THRESHOLD = 0.62;

// ─── Product matching ────────────────────────────────────────────

export interface ProductMatchCandidate {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  isActive: boolean;
}

export interface ProductMatchResult {
  product: ProductMatchCandidate | null;
  confidence: number;
  method: "SKU" | "NAME" | "";
}

/**
 * Scenario B of the spec: fuzzy-match a raw PDF line against the
 * catalog. Exact SKU (normalized) wins outright; otherwise token
 * similarity with a strong boost when the numeric model codes agree
 * ("balaji dustbin padel 107" ↔ "Balaji Dustbin Padel 107").
 */
export function matchProduct(
  rawName: string,
  candidates: ProductMatchCandidate[]
): ProductMatchResult {
  const raw = (rawName ?? "").trim();
  if (!raw) return { product: null, confidence: 0, method: "" };

  const rawNorm = normalizeText(raw);
  const rawNoSpace = rawNorm.replace(/ /g, "");

  // 0 — exact SKU (with or without separators)
  for (const c of candidates) {
    if (!c.sku) continue;
    const skuNorm = normalizeText(c.sku).replace(/ /g, "");
    if (skuNorm && skuNorm === rawNoSpace) {
      return { product: c, confidence: 0.99, method: "SKU" };
    }
  }

  const rawTokens = new Set(tokens(raw));
  const rawNumbers = new Set(numberTokens(raw));

  let best: ProductMatchResult = { product: null, confidence: 0, method: "" };
  for (const c of candidates) {
    if (!c.isActive) continue;
    const cName = `${c.name} ${c.category === "General" ? "" : c.category}`;
    const cTokens = new Set(tokens(cName));
    let score = jaccard(rawTokens, cTokens);

    // containment: "ap container" inside "ap container 5-7-12 kg"
    const cNorm = normalizeText(c.name);
    if (rawNorm.length >= 4 && (cNorm.includes(rawNorm) || rawNorm.includes(cNorm))) {
      const shorter = Math.min(rawNorm.length, cNorm.length);
      const longer = Math.max(rawNorm.length, cNorm.length);
      score = Math.max(score, 0.6 + 0.3 * (shorter / longer));
    }

    // numeric model codes agreement — each shared number is a strong vote
    if (rawNumbers.size > 0) {
      const cNumbers = new Set(numberTokens(cName));
      let numHit = 0;
      for (const n of rawNumbers) if (cNumbers.has(n)) numHit += 1;
      score += 0.15 * numHit;
    }

    // sku tokens appearing inside the raw text ("ap-cnt-012" → "ap cnt 012")
    if (c.sku) {
      const skuTokens = tokens(c.sku.replace(/-/g, " "));
      if (skuTokens.length > 0 && skuTokens.every((t) => rawTokens.has(t))) {
        score = Math.max(score, 0.85);
      }
    }

    if (score > best.confidence) {
      best = { product: c, confidence: Math.min(0.97, score), method: "NAME" };
    }
  }

  if (best.confidence >= PRODUCT_AUTO_THRESHOLD) return best;
  return { product: null, confidence: best.confidence, method: "" };
}

/** Below this confidence the line is flagged Unmatched (quick-add). */
export const PRODUCT_AUTO_THRESHOLD = 0.62;
