// GET /api/universal/v1/health — connection test for the Setup
// Guide "Test connection" button and platform health checks.
// Requires a valid X-API-Key (so a green light means auth works too).

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handleApiError, ok } from "@/app/api/v1/_lib/api";
import { UNIVERSAL_API_VERSION, requirePortal } from "@/app/api/universal/v1/_lib/portal";

export async function GET(req: NextRequest) {
  try {
    const { portal, firm } = await requirePortal(req);
    const [skus, totalStock] = await Promise.all([
      db.product.count({ where: { firmId: firm.id, isActive: true } }),
      db.product.aggregate({ where: { firmId: firm.id, isActive: true }, _sum: { stockQuantity: true } }),
    ]);
    return ok({
      status: "UP",
      version: UNIVERSAL_API_VERSION,
      portal: { name: portal.name, kind: portal.kind, status: portal.status },
      firm: { firmName: firm.firmName, firmCode: firm.firmCode },
      catalog: { activeSkus: skus, totalSellableStock: totalStock._sum.stockQuantity ?? 0 },
      serverTime: new Date().toISOString(),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
