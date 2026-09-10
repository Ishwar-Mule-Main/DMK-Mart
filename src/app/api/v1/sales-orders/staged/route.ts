// ═══════════════════════════════════════════════════════════════
// /api/v1/sales-orders/staged — deep-scan order ingestion
// GET  ?firmId=&status=&search= → staging queue (files excluded)
// POST → ingest a new order document and run the deep-scan engine:
//        • multipart/form-data: file=<pdf|png|jpg|webp> (+firmId)
//        • application/json:    {firmId, text} (WhatsApp/typed order)
//        → AI extraction → dual matching → StagedOrderUpload rows in
//          NEEDS_REVIEW awaiting the staging terminal.
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import {
  BusinessError,
  getStr,
  handleApiError,
  ok,
  resolveFirm,
} from "@/app/api/v1/_lib/api";
import { scanOrderImage, scanOrderPdf, scanOrderText } from "@/app/api/v1/_lib/orderScan";
import { matchAndLinkCustomer, matchExtractedItems, shapeStagedOrder } from "@/app/api/v1/_lib/stagedOrders";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB — enough for any phone scan
const ALLOWED_IMAGE = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const firm = await resolveFirm(getStr(sp.get("firmId")));
    const status = getStr(sp.get("status"));
    const search = getStr(sp.get("search"));

    const orders = await db.stagedOrderUpload.findMany({
      where: {
        firmId: firm.id,
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        source: true,
        status: true,
        originalFileName: true,
        originalFileType: true,
        scanModel: true,
        scanNote: true,
        extractedBusinessName: true,
        extractedPhone: true,
        extractedCity: true,
        customerMatchMethod: true,
        customerMatchScore: true,
        confirmedSalesOrderId: true,
        confirmedAt: true,
        createdAt: true,
        customer: { select: { id: true, partyName: true, city: true, assignedTier: true } },
        items: { select: { quantity: true, statedPrice: true, appliedPrice: true, isUnlisted: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const q = search.trim().toLowerCase();
    const filtered = q
      ? orders.filter((o) =>
          [o.extractedBusinessName, o.extractedPhone, o.extractedCity, o.customer?.partyName ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q)
        )
      : orders;

    const shaped = filtered.map((o) => {
      const subtotal = o.items.reduce(
        (s, i) => s + i.quantity * (i.appliedPrice > 0 ? i.appliedPrice : i.statedPrice),
        0
      );
      return {
        id: o.id,
        source: o.source,
        status: o.status,
        originalFileName: o.originalFileName,
        originalFileType: o.originalFileType,
        scanModel: o.scanModel,
        scanNote: o.scanNote,
        extracted: {
          businessName: o.extractedBusinessName,
          phone: o.extractedPhone,
          city: o.extractedCity,
        },
        customer: o.customer,
        customerMatchMethod: o.customerMatchMethod,
        customerMatchScore: o.customerMatchScore,
        confirmedSalesOrderId: o.confirmedSalesOrderId,
        confirmedAt: o.confirmedAt,
        createdAt: o.createdAt,
        itemCount: o._count.items,
        unlistedCount: o.items.filter((i) => i.isUnlisted).length,
        subtotal: Math.round(subtotal * 100) / 100,
      };
    });

    const totals = {
      needsReview: shaped.filter((o) => o.status === "NEEDS_REVIEW").length,
      booked: shaped.filter((o) => o.status === "BOOKED").length,
      unlistedLines: shaped.filter((o) => o.status === "NEEDS_REVIEW").reduce((s, o) => s + o.unlistedCount, 0),
    };

    return ok({ orders: shaped, totals });
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let firmId = "";
    let source = "";
    let originalFileName = "";
    let originalFileType = "";
    let fileDataUrl = "";
    let pdfBase64 = "";
    let orderText = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      firmId = getStr(form.get("firmId"));
      const file = form.get("file");
      if (!(file instanceof File)) {
        throw new BusinessError("ERR_VALIDATION", "Attach an order file (PDF or photo)", 400);
      }
      if (file.size > MAX_FILE_BYTES) {
        throw new BusinessError("ERR_VALIDATION", "File is larger than 8 MB — upload a smaller scan", 413);
      }
      const type = file.type || "application/octet-stream";
      const isPdf = type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf && !ALLOWED_IMAGE.includes(type)) {
        throw new BusinessError("ERR_VALIDATION", "Only PDF, PNG, JPG or WebP order files are supported", 415);
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const b64 = buf.toString("base64");
      originalFileName = file.name.slice(0, 120);
      originalFileType = isPdf ? "application/pdf" : type;
      if (isPdf) {
        pdfBase64 = b64;
        source = "PDF_UPLOAD";
      } else {
        fileDataUrl = `data:${type};base64,${b64}`;
        source = "IMAGE_UPLOAD";
      }
    } else {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
      firmId = getStr(body.firmId);
      orderText = getStr(body.text);
      if (!orderText) {
        throw new BusinessError("ERR_VALIDATION", "Paste the order text (or upload a file) to scan", 400);
      }
      if (orderText.length > 12000) orderText = orderText.slice(0, 12000);
      source = "WHATSAPP_TEXT";
      originalFileName = "WhatsApp order (pasted text)";
      originalFileType = "text/plain";
      // Stored as a data URL so the staging terminal can preview the
      // pasted message through the same /file endpoint as uploads.
      fileDataUrl = `data:text/plain;base64,${Buffer.from(orderText, "utf-8").toString("base64")}`;
    }

    const firm = await resolveFirm(firmId);

    // ── Stage 1: deep scan ────────────────────────────────────────
    const outcome =
      source === "PDF_UPLOAD"
        ? await scanOrderPdf(pdfBase64)
        : source === "IMAGE_UPLOAD"
          ? await scanOrderImage(fileDataUrl)
          : await scanOrderText(orderText);

    const extraction = outcome.extraction;
    if (extraction.items.length === 0) {
      throw new BusinessError(
        "ERR_SCAN_NO_ITEMS",
        "No line items were found in this document — check the scan and retry, or book the order manually.",
        422
      );
    }

    // ── Stage 2: dual matching ────────────────────────────────────
    const customerMatch = await matchAndLinkCustomer(firm.id, extraction);
    const matchedItems = await matchExtractedItems(firm.id, extraction);

    // Lock the applied price per line: matched product → customer tier
    // price (staging can still override); unmatched → stated price.
    const TIER_KEYS = ["tier1Distributor", "tier2Wholesale", "tier3SemiWholesale", "tier4Retailer", "tier5Mrp"];
    const tier =
      customerMatch.matchedCustomer && TIER_KEYS.includes(customerMatch.matchedCustomer.assignedTier)
        ? customerMatch.matchedCustomer.assignedTier
        : "tier4Retailer";
    const productRows = await db.product.findMany({
      where: { id: { in: matchedItems.map((m) => m.matchedSkuId).filter((x): x is string => Boolean(x)) } },
      select: {
        id: true,
        tier1Distributor: true,
        tier2Wholesale: true,
        tier3SemiWholesale: true,
        tier4Retailer: true,
        tier5Mrp: true,
      },
    });
    const productById = new Map(productRows.map((p) => [p.id, p]));

    const staged = await db.stagedOrderUpload.create({
      data: {
        firmId: firm.id,
        source,
        originalFileName,
        originalFileType,
        originalFileData: fileDataUrl,
        rawExtractedJson: outcome.rawJson.slice(0, 60000),
        scanModel: outcome.model,
        scanNote: outcome.warnings.join(" "),
        extractedBusinessName: extraction.businessName,
        extractedContactPerson: extraction.contactPerson,
        extractedPhone: extraction.phone,
        extractedAddress: extraction.address,
        extractedCity: extraction.city,
        extractedGstin: extraction.gstin,
        matchedCustomerId: customerMatch.matchedCustomerId,
        customerMatchMethod: customerMatch.method,
        customerMatchScore: customerMatch.score,
        status: "NEEDS_REVIEW",
        items: {
          create: matchedItems.map((m) => {
            const product = m.matchedSkuId ? productById.get(m.matchedSkuId) : null;
            const tierPrice = product
              ? ((product[tier as keyof typeof product] as number) || 0)
              : 0;
            return {
              ...m,
              appliedPrice: tierPrice > 0 ? tierPrice : m.statedPrice,
            };
          }),
        },
      },
    });

    const detail = await shapeStagedOrder(staged.id);
    return ok({ staged: detail }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
