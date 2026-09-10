// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — DEEP SCANNING ENGINE (SO order ingestion)
// Stage 1 of the staged-order pipeline: turn an external order
// document (PDF / scanned image / WhatsApp order text) into a strict
// JSON extraction:
//     { customer: {businessName, contactPerson, phone, address,
//                  city, gstin},
//       items: [{rawName, quantity, uom, statedPrice, discountPercent}],
//       notes }
// Engine resolution reuses the copilot's client chain (AiSettings →
// env → .z-ai-config). Vision calls run on a vision-capable model;
// PDFs get a server-side text extraction (pdf-parse) first and fall
// back to a vision request on the rendered document when the text
// layer is empty (scanned PDF).
// ═══════════════════════════════════════════════════════════════

import { BusinessError } from "./api";
import { createAiClient, resolveAiModel, translateAiError } from "./aiModel";

/** Vision model used when the owner has not pinned a model. */
const DEFAULT_VISION_MODEL = "glm-5v-turbo";

export interface ExtractedItem {
  rawName: string;
  quantity: number;
  uom: string;
  statedPrice: number;
  discountPercent: number;
}

export interface ExtractedOrder {
  businessName: string;
  contactPerson: string;
  phone: string;
  address: string;
  city: string;
  gstin: string;
  items: ExtractedItem[];
  notes: string;
}

export interface ScanOutcome {
  extraction: ExtractedOrder;
  rawJson: string;
  model: string;
  warnings: string[];
}

// ─── Prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the order-extraction engine of DMK Mart, an Indian household-plastics wholesaler.
You receive an external purchase order (PDF, scan, photo or a WhatsApp order chat) and must return STRICT JSON only — no markdown fences, no commentary.

Return exactly this shape:
{"customer":{"businessName":"","contactPerson":"","phone":"","address":"","city":"","gstin":""},"items":[{"rawName":"","quantity":0,"uom":"","statedPrice":0,"discountPercent":0}],"notes":""}

Extraction rules:
1. businessName = the buyer/shop name (NOT DMK Mart — DMK Mart is the seller). Include location hints only if part of the name.
2. contactPerson = a person name if present, else "".
3. phone = 10-digit Indian mobile if printed, else "".
4. address / city = delivery address and city/town/village (e.g. "Shukrawar Peth, Pune" → address "Shukrawar Peth", city "Pune").
5. gstin = 15-character GSTIN of the buyer if printed, else "".
6. items = EVERY product row in the order table or message, in order:
   - rawName = the description EXACTLY as printed (keep model numbers like "107", "20 Ltr", "5-7-12 Kg").
   - quantity = numeric units ordered. "1 Box (12 pcs)" with unit rate per piece → 12; if the rate is per box keep the box count and uom "Box". Strip commas.
   - uom = Pcs | Set | Box | Carton | Packet | Kg | Ltr (best match).
   - statedPrice = the unit rate printed next to the row (number). If no price is printed use 0.
   - discountPercent = printed discount on the row as a percent (e.g. "5%" → 5), else 0.
7. Ignore DMK Mart's own header/footer, bank details, GST summary rows and totals — only buyer + line items.
8. If the document is a WhatsApp chat, extract the ordered items from the message text the same way.
9. notes = one short line with anything unusual (missing prices, unclear rows, delivery date requested), else "".
10. If you truly cannot find any line items, return an empty items array.`;

function userTextPrompt(docHint: string): string {
  return `${docHint}\nExtract the buyer and every line item. STRICT JSON only.`;
}

// ─── JSON parsing / normalization ────────────────────────────────

function stripFences(raw: string): string {
  let s = (raw ?? "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // tolerate leading prose before the first {
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s;
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[₹,\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function normalizeExtraction(parsed: Record<string, unknown>): ExtractedOrder {
  // Vision models drift between schema variants — accept the common
  // aliases (customer/buyer, items/line_items, phone/mobile…).
  const customer = (parsed.customer ?? parsed.buyer ?? parsed.party ?? {}) as Record<string, unknown>;
  const pick = (obj: Record<string, unknown>, ...keys: string[]): unknown => {
    for (const k of keys) {
      const hit = Object.entries(obj).find(([kk]) => kk.toLowerCase() === k.toLowerCase());
      if (hit && hit[1] !== undefined && hit[1] !== null && hit[1] !== "") return hit[1];
    }
    return undefined;
  };
  const rawItems =
    (pick(parsed, "items", "line_items", "lineitems", "lines") as unknown[] | undefined) ??
    (Array.isArray(parsed.items) ? parsed.items : []);

  const items: ExtractedItem[] = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const rawName = asText(pick(r, "rawName", "name", "product", "description", "item"));
    if (!rawName) continue;
    items.push({
      rawName: rawName.slice(0, 160),
      quantity: Math.max(0, asNum(pick(r, "quantity", "qty", "orderedQty"), 0)),
      uom: (asText(pick(r, "uom", "unit")) || "Pcs").slice(0, 16),
      statedPrice: Math.max(0, asNum(pick(r, "statedPrice", "price", "rate", "unitPrice", "unit_rate"), 0)),
      discountPercent: Math.min(100, Math.max(0, asNum(pick(r, "discountPercent", "discount"), 0))),
    });
  }

  return {
    businessName: asText(pick(customer, "businessName", "name", "partyName", "shop", "firm")).slice(0, 120),
    contactPerson: asText(pick(customer, "contactPerson", "contact", "person")).slice(0, 80),
    phone: asText(pick(customer, "phone", "mobile", "phoneNumber", "mobileNumber")).slice(0, 20),
    address: asText(pick(customer, "address", "deliveryAddress")).slice(0, 200),
    city: asText(pick(customer, "city", "town")).slice(0, 60),
    gstin: asText(pick(customer, "gstin", "gstNo", "gstNumber", "gst")).toUpperCase().slice(0, 15),
    items,
    notes: asText(pick(parsed, "notes", "note")).slice(0, 300),
  };
}

export function parseExtraction(rawText: string): ExtractedOrder {
  const cleaned = stripFences(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new BusinessError(
      "ERR_SCAN_PARSE",
      "The scan engine returned an unreadable response — please retry the upload.",
      502
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new BusinessError("ERR_SCAN_PARSE", "The scan engine returned no order data", 502);
  }
  return normalizeExtraction(parsed as Record<string, unknown>);
}

// ─── Engine plumbing ─────────────────────────────────────────────

async function requireClient() {
  const { client, error } = await createAiClient();
  if (!client) {
    throw new BusinessError(
      "ERR_AI_NOT_CONFIGURED",
      error?.includes("No AI configuration")
        ? "The deep-scan engine needs AI — open Settings → DMK AI Copilot and save an API key (no redeploy needed)."
        : error || "AI engine is not configured",
      503
    );
  }
  return client;
}

async function visionScan(content: unknown[], modelHint?: string): Promise<{ text: string; model: string }> {
  const client = await requireClient();
  const resolved = (await resolveAiModel()) || modelHint || DEFAULT_VISION_MODEL;
  try {
    const completion = (await (client as never as {
      chat: { completions: { createVision: (body: unknown) => Promise<never> } };
    }).chat.completions.createVision({
      model: resolved,
      messages: [{ role: "user", content }],
      thinking: { type: "disabled" },
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const text = completion?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new BusinessError("ERR_SCAN_EMPTY", "The scan engine could not read this document", 502);
    }
    return { text, model: resolved };
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError("ERR_SCAN_ENGINE", translateAiError(e), 502);
  }
}

async function textScan(prompt: string): Promise<{ text: string; model: string }> {
  const client = await requireClient();
  const resolved = await resolveAiModel();
  try {
    const completion = (await (client as never as {
      chat: { completions: { create: (body: unknown) => Promise<never> } };
    }).chat.completions.create({
      ...(resolved ? { model: resolved } : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
      temperature: 0.1,
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const text = completion?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new BusinessError("ERR_SCAN_EMPTY", "The scan engine returned nothing", 502);
    }
    return { text, model: resolved || "default" };
  } catch (e) {
    if (e instanceof BusinessError) throw e;
    throw new BusinessError("ERR_SCAN_ENGINE", translateAiError(e), 502);
  }
}

// ─── Public entry points ─────────────────────────────────────────

/** Scanned image / photo / screenshot of an order. */
export async function scanOrderImage(dataUrl: string): Promise<ScanOutcome> {
  const { text, model } = await visionScan(
    [
      { type: "text", text: `${SYSTEM_PROMPT}\n\n${userTextPrompt("The image is an external purchase order (or a WhatsApp order screenshot).")}` },
      { type: "image_url", image_url: { url: dataUrl } },
    ],
    DEFAULT_VISION_MODEL
  );
  return {
    extraction: parseExtraction(text),
    rawJson: text,
    model,
    warnings: [],
  };
}

/** PDF order: server-side text layer first, vision fallback. */
export async function scanOrderPdf(pdfBase64: string): Promise<ScanOutcome> {
  let textLayer = "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(Buffer.from(pdfBase64, "base64")) });
    const result = await parser.getText();
    textLayer = (result?.text ?? "").trim();
    await parser.destroy();
  } catch {
    textLayer = "";
  }

  if (textLayer.length >= 40) {
    const { text, model } = await textScan(
      userTextPrompt(`Below is the extracted text of a purchase-order PDF. Reconstruct the buyer and the line-item table.\n\n--- PDF TEXT ---\n${textLayer.slice(0, 12000)}\n--- END ---`)
    );
    const warnings =
      textLayer.length < 300
        ? ["The PDF text layer was small — verify every parsed row against the original."]
        : [];
    return { extraction: parseExtraction(text), rawJson: text, model, warnings };
  }

  // Scanned PDF (no text layer) → hand the document itself to the vision engine.
  try {
    const { text, model } = await visionScan(
      [
        { type: "text", text: `${SYSTEM_PROMPT}\n\n${userTextPrompt("The attached PDF is a scanned purchase order.")}` },
        { type: "file_url", file_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
      ],
      DEFAULT_VISION_MODEL
    );
    return {
      extraction: parseExtraction(text),
      rawJson: text,
      model,
      warnings: ["Scanned PDF read by the vision engine — verify every parsed row."],
    };
  } catch {
    throw new BusinessError(
      "ERR_SCAN_SCANNED_PDF",
      "This PDF has no text layer and the vision engine could not read it directly — please upload a photo or screenshot of the order instead.",
      422
    );
  }
}

/** WhatsApp / pasted order text. */
export async function scanOrderText(orderText: string): Promise<ScanOutcome> {
  const clipped = orderText.trim().slice(0, 12000);
  const { text, model } = await textScan(
    userTextPrompt("The following is a WhatsApp order message (or typed order). Extract buyer and line items.\n\n--- ORDER TEXT ---\n" + clipped + "\n--- END ---")
  );
  return { extraction: parseExtraction(text), rawJson: text, model, warnings: [] };
}
