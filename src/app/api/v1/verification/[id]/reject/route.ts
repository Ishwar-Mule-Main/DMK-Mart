// ═══════════════════════════════════════════════════════════════
// POST /api/v1/verification/[id]/reject — owner sends a team
// submission back for re-verification with a reason.
// Body: { reason }
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { asRecord, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { rejectVerification } from "@/app/api/v1/_lib/verification";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const reason = getStr(body.reason);
    if (!reason) return handleApiError(new Error("A reason is required to send back"));
    const result = await rejectVerification(id, reason);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
