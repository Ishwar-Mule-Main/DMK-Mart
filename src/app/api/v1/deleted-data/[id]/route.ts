// ═══════════════════════════════════════════════════════════════
// DELETE /api/v1/deleted-data/[id] — purge one item from the bin,
// forever. When the underlying row carries no transaction history it
// is hard-deleted too; otherwise it only leaves the bin (the inactive
// row stays for ledger integrity) and the response says which happened.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { purgeFromTrash } from "@/app/api/v1/_lib/trash";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await purgeFromTrash(id);
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
