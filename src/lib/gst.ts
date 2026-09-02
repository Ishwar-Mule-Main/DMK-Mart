// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — GST ENGINE
// Intra-state: CGST 50% + SGST 50% | Inter-state: IGST 100%
// State code derived from GSTIN prefix (first 2 chars)
// ═══════════════════════════════════════════════════════════════

export const ALLOWED_GST_RATES = [0, 5, 12, 18, 28] as const;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function stateCodeFromGstin(gstin: string): string {
  const prefix = (gstin || "").trim().slice(0, 2);
  return /^\d{2}$/.test(prefix) ? prefix : "";
}

export interface GstSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

/**
 * Calculate GST split for a taxable amount.
 * sellerState === buyerState → intra-state (CGST + SGST, each rate/2)
 * otherwise → inter-state (IGST at full rate)
 */
export function calculateGST(
  taxable: number,
  gstRate: number,
  sellerStateCode: string,
  buyerStateCode: string
): GstSplit {
  const intra = sellerStateCode && buyerStateCode && sellerStateCode === buyerStateCode;
  if (intra) {
    const cgst = round2(taxable * (gstRate / 200));
    const sgst = round2(taxable * (gstRate / 200));
    return { cgst, sgst, igst: 0 };
  }
  const igst = round2(taxable * (gstRate / 100));
  return { cgst: 0, sgst: 0, igst };
}

/** Sum a set of gst splits. */
export function sumGstSplits(splits: GstSplit[]): GstSplit {
  return splits.reduce(
    (acc, s) => ({
      cgst: round2(acc.cgst + s.cgst),
      sgst: round2(acc.sgst + s.sgst),
      igst: round2(acc.igst + s.igst),
    }),
    { cgst: 0, sgst: 0, igst: 0 }
  );
}

/** Round-off to nearest rupee with delta (Rule 545). */
export function roundOffDelta(exactTotal: number): { grand: number; roundOff: number } {
  const grand = Math.round(exactTotal);
  return { grand, roundOff: round2(grand - exactTotal) };
}
