// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — SALES RETURN CORE (R4: returns → DAMAGED pool)
// Shared by /sales-returns route and the seed route.
// ═══════════════════════════════════════════════════════════════

import { db } from "@/lib/db";
import { ACC, fyLabelForDate, nextDocNumber, postJournal } from "@/lib/journal";
import { calculateGST, round2, sumGstSplits } from "@/lib/gst";
import { BusinessError } from "./api";
import { addCustomerLedger, recordMovement, updateCustomerBalance } from "./party";

export interface SalesReturnLineInput {
  productId: string;
  damagedQty: number;
  unitPrice?: number;
  defectType?: string;
}

export interface CreateSalesReturnInput {
  customerId?: string | null;
  invoiceId?: string | null;
  invoiceRef?: string;
  returnDate: Date;
  notes?: string;
  items: SalesReturnLineInput[];
  /** How the return value is settled with the customer:
   *  CREDIT (default) — amount stays as customer credit (receivable ↓)
   *  UPI_NEFT | CASH  — amount paid out immediately (bank/cash ↓, customer balance net-unchanged) */
  refundMode?: "CREDIT" | "UPI_NEFT" | "CASH";
}

type FirmRow = { id: string; stateCode: string; invoicePrefix: string; financialYear: string };

export async function createSalesReturn(firm: FirmRow, input: CreateSalesReturnInput) {
  const rawItems = input.items;
  if (rawItems.length === 0) {
    throw new BusinessError("ERR_EMPTY_ITEMS", "Sales return requires at least one item", 400);
  }

  const customerId = input.customerId || null;
  const customer = customerId
    ? await db.customer.findFirst({ where: { id: customerId, firmId: firm.id } })
    : null;
  if (customerId && !customer) {
    throw new BusinessError("ERR_CUSTOMER_NOT_FOUND", "Customer not found for this firm", 404);
  }

  const sourceInvoice = input.invoiceId
    ? await db.invoice.findFirst({
        where: { id: input.invoiceId, firmId: firm.id },
        include: { lineItems: true },
      })
    : null;

  const refundMode = input.refundMode === "UPI_NEFT" || input.refundMode === "CASH" ? input.refundMode : "CREDIT";

  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  const products = await db.product.findMany({
    where: { firmId: firm.id, id: { in: productIds } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  // GST: seller = firm, buyer = customer state (counter fallback firm)
  const buyerState = customer?.stateCode ?? firm.stateCode;

  interface ComputedReturnItem {
    productId: string;
    damagedQty: number;
    unitPrice: number;
    gstRate: number;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
    defectType: string;
  }
  const items: ComputedReturnItem[] = [];

  for (const raw of rawItems) {
    const product = productMap.get(raw.productId);
    if (!product) {
      throw new BusinessError("ERR_PRODUCT_NOT_FOUND", `Product ${raw.productId} not found`, 404);
    }
    const damagedQty = round2(raw.damagedQty);
    if (damagedQty <= 0) {
      throw new BusinessError("ERR_VALIDATION", `Return quantity must be positive for ${product.sku}`, 400);
    }

    // Prefer the price the customer actually paid (invoice line),
    // fall back to supplied unitPrice, else retailer tier.
    let unitPrice: number | null = null;
    let invoicedQty: number | null = null;
    if (sourceInvoice) {
      const line = sourceInvoice.lineItems.find((l) => l.productId === product.id);
      if (line) {
        unitPrice = line.unitPrice;
        invoicedQty = line.quantity;
      }
    }
    if (unitPrice === null && raw.unitPrice !== undefined) {
      unitPrice = round2(raw.unitPrice);
    }
    if (unitPrice === null) unitPrice = round2(product.tier4Retailer);

    // Never return more than was invoiced for that product
    if (invoicedQty !== null && damagedQty > round2(invoicedQty) + 0.001) {
      throw new BusinessError(
        "ERR_RETURN_EXCEEDS_INVOICE",
        `Return qty for "${product.sku}" (${damagedQty}) exceeds the invoiced quantity (${invoicedQty})`,
        422,
      );
    }

    const taxable = round2(damagedQty * unitPrice);
    const gst = calculateGST(taxable, product.gstRate, firm.stateCode, buyerState);
    items.push({
      productId: product.id,
      damagedQty,
      unitPrice,
      gstRate: product.gstRate,
      taxableAmount: taxable,
      cgstAmount: gst.cgst,
      sgstAmount: gst.sgst,
      igstAmount: gst.igst,
      totalAmount: round2(taxable + gst.cgst + gst.sgst + gst.igst),
      defectType: raw.defectType || "Damaged",
    });
  }

  const subtotal = round2(items.reduce((s, i) => s + i.taxableAmount, 0));
  const tax = sumGstSplits(items.map((i) => ({ cgst: i.cgstAmount, sgst: i.sgstAmount, igst: i.igstAmount })));
  const totalTax = round2(tax.cgst + tax.sgst + tax.igst);
  const grandTotal = round2(subtotal + totalTax);

  // Credit-note number carries the FY of the return date.
  const creditNoteNo = await nextDocNumber("CN", firm.id, firm.invoicePrefix, fyLabelForDate(input.returnDate));

  const returnId = await db.$transaction(async (tx) => {
    const created = await tx.salesReturn.create({
      data: {
        firmId: firm.id,
        creditNoteNo,
        invoiceRef: sourceInvoice?.invoiceNumber ?? input.invoiceRef ?? "",
        invoiceId: sourceInvoice?.id ?? null,
        customerId: customer?.id ?? null,
        returnDate: input.returnDate,
        subtotal,
        totalTax,
        grandTotal,
        notes: input.notes ?? "",
        refundMode,
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            damagedQty: i.damagedQty,
            unitPrice: i.unitPrice,
            gstRate: i.gstRate,
            totalAmount: i.totalAmount,
            defectType: i.defectType,
          })),
        },
      },
      select: { id: true },
    });

    for (const item of items) {
      // R4: returned goods NEVER re-enter the sellable pool
      await tx.product.update({
        where: { id: item.productId },
        data: { damagedStock: { increment: item.damagedQty } },
      });
      await recordMovement(tx, {
        firmId: firm.id,
        productId: item.productId,
        movementType: "SALES_RETURN_DAMAGE",
        quantity: item.damagedQty,
        targetPool: "DAMAGED",
        direction: "IN",
        referenceDocId: created.id,
        referenceNo: creditNoteNo,
        notes: `Customer return (${item.defectType}) — ${creditNoteNo}`,
      });
    }

    if (customer) {
      // Dr-positive receivable decreases with a credit note
      await updateCustomerBalance(tx, customer.id, -grandTotal);
      await addCustomerLedger(tx, customer.id, {
        entryDate: input.returnDate,
        voucherType: "CREDIT_NOTE",
        voucherNo: creditNoteNo,
        particulars: `Sales return — credit note ${creditNoteNo}`,
        debit: 0,
        credit: grandTotal,
      });

      // Refund settled instantly (UPI/NEFT or Cash): the credit is
      // immediately consumed by an outgoing payment → net balance change 0.
      if (refundMode !== "CREDIT") {
        await updateCustomerBalance(tx, customer.id, +grandTotal);
        await addCustomerLedger(tx, customer.id, {
          entryDate: input.returnDate,
          voucherType: "REFUND",
          voucherNo: creditNoteNo,
          particulars: `Refund paid via ${refundMode === "UPI_NEFT" ? "UPI/NEFT" : "Cash"} — credit note ${creditNoteNo}`,
          debit: grandTotal,
          credit: 0,
        });
      }
    }

    return created.id;
  });

  const journal = await postJournal({
    firmId: firm.id,
    voucherType: "CREDIT_NOTE",
    postingDate: input.returnDate,
    narration: `Credit note ${creditNoteNo} — sales return${customer ? ` from ${customer.partyName}` : ""}`,
    referenceDocId: returnId,
    lines: [
      { accountCode: ACC.SALES_RETURNS, entrySide: "DEBIT", amount: subtotal },
      ...(tax.cgst > 0 ? [{ accountCode: ACC.GST_CGST, entrySide: "DEBIT" as const, amount: tax.cgst }] : []),
      ...(tax.sgst > 0 ? [{ accountCode: ACC.GST_SGST, entrySide: "DEBIT" as const, amount: tax.sgst }] : []),
      ...(tax.igst > 0 ? [{ accountCode: ACC.GST_IGST, entrySide: "DEBIT" as const, amount: tax.igst }] : []),
      { accountCode: ACC.AR, entrySide: "CREDIT", amount: grandTotal },
    ],
  });

  // Settlement journal when the customer is paid instantly (money out)
  let refundJournal: Awaited<ReturnType<typeof postJournal>> | null = null;
  if (refundMode !== "CREDIT" && customer) {
    refundJournal = await postJournal({
      firmId: firm.id,
      voucherType: "PAYMENT",
      postingDate: input.returnDate,
      narration: `Customer refund — ${customer.partyName} — credit note ${creditNoteNo} via ${refundMode === "UPI_NEFT" ? "UPI/NEFT" : "Cash"}`,
      referenceDocId: returnId,
      lines: [
        { accountCode: ACC.AR, entrySide: "DEBIT", amount: grandTotal },
        { accountCode: refundMode === "UPI_NEFT" ? ACC.BANK : ACC.CASH, entrySide: "CREDIT", amount: grandTotal },
      ],
    });
  }

  const created = await db.salesReturn.findUnique({
    where: { id: returnId },
    include: {
      items: true,
      customer: { select: { id: true, partyName: true, closingBalance: true } },
    },
  });

  return { salesReturn: created, journal, refundJournal, refundMode };
}
