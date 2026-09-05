// ═══════════════════════════════════════════════════════════════
// POST /api/v1/deleted-data/[id]/restore — put one deleted record back.
// Soft-deleted masters are reactivated in place; hard-deleted records
// (recurring templates) are recreated from their snapshot. Conflicts
// (SKU/username taken, parent customer gone) fail with clear codes.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { restoreFromTrash } from "@/app/api/v1/_lib/trash";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await restoreFromTrash(id);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
