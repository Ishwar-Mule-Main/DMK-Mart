// ═══════════════════════════════════════════════════════════════
// /api/v1/recurring/runs — subscription ledger for one template
// GET ?firmId=&templateId= → every invoice auto-posted by the
// template (stamped templateId), newest first, with totals.
// Invoices keep their templateId while the template lives; after
// template deletion the FK is SetNull and the rows remain in the
// invoice register (this endpoint then reports 404 — correct).
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  getStr,
  handleApiError,
  ok,
  resolveFirm,
  BusinessError,
} from "@/app/api/v1/_lib/api";
import { round2 } from "@/lib/gst";

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firmId = getStr(sp.get("firmId"));
    const firm = await resolveFirm(firmId);
    const templateId = getStr(sp.get("templateId"));
    if (!templateId) {
      throw new BusinessError("ERR_VALIDATION", "templateId is required", 400);
    }

    const template = await db.recurringTemplate.findFirst({
      where: { id: templateId, firmId: firm.id },
      select: { id: true, name: true, frequency: true, paymentMode: true, isActive: true, nextRunDate: true },
    });
    if (!template) {
      throw new BusinessError("ERR_TEMPLATE_NOT_FOUND", "Recurring template not found", 404);
    }

    const runs = await db.invoice.findMany({
      where: { firmId: firm.id, templateId },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        grandTotal: true,
        subtotal: true,
        totalCgst: true,
        totalSgst: true,
        totalIgst: true,
        paymentMode: true,
        status: true,
        customer: { select: { partyName: true } },
      },
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
    });

    const posted = runs.filter((r) => r.status === "POSTED");
    const totals = {
      runs: posted.length,
      billed: round2(posted.reduce((s, r) => s + r.grandTotal, 0)),
      avgInvoice: posted.length > 0 ? round2(posted.reduce((s, r) => s + r.grandTotal, 0) / posted.length) : 0,
      lastRunDate: posted[0]?.invoiceDate.toISOString() ?? null,
      lastInvoiceNo: posted[0]?.invoiceNumber ?? null,
    };

    return ok({
      template,
      totals,
      rows: runs.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        invoiceDate: r.invoiceDate.toISOString(),
        grandTotal: r.grandTotal,
        tax: round2(r.totalCgst + r.totalSgst + r.totalIgst),
        paymentMode: r.paymentMode,
        status: r.status,
        customerName: r.customer?.partyName ?? "Counter sale",
      })),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
