// ═══════════════════════════════════════════════════════════════
// /api/v1/logistics/trips/[id]/stops/[stopId]/verify-otp
// Driver/owner confirms a delivery with the OTP printed on the bill.
// POST {firmId? | staffId?, otp, collectedMode, collectedAmount, staffId?}
//  • 5 wrong attempts → locked (signature fallback or call the office)
//  • mismatch → attempts incremented PERSISTED before the 422 responds
//  • match → stop DELIVERED (proof=OTP), trip advances automatically
// ═══════════════════════════════════════════════════════════════

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { BusinessError, asRecord, getNum, getStr, handleApiError, ok } from "@/app/api/v1/_lib/api";
import { loadStopForDelivery, markStopDelivered } from "@/app/api/v1/_lib/logistics";
import { round2 } from "@/lib/gst";

const MAX_OTP_ATTEMPTS = 5;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const { id, stopId } = await params;
    const body = asRecord(await request.json().catch(() => ({})));
    const firmId = getStr(body.firmId);
    const staffId = getStr(body.staffId);

    const { trip, stop } = await loadStopForDelivery({ tripId: id, stopId, firmId, staffId });

    const collectedMode = getStr(body.collectedMode).toUpperCase();
    if (collectedMode !== "CASH" && collectedMode !== "UPI") {
      throw new BusinessError("ERR_VALIDATION", "collectedMode must be CASH or UPI", 400);
    }
    const collectedAmount = getNum(body.collectedAmount);
    if (collectedAmount < 0) {
      throw new BusinessError("ERR_VALIDATION", "collectedAmount cannot be negative", 400);
    }

    // Lockout check FIRST — a locked stop never consumes another attempt.
    if (stop.otpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new BusinessError(
        "ERR_OTP_LOCKED",
        "Too many wrong attempts — use the signature fallback or call the office",
        422
      );
    }

    // Digits-only comparison on both sides ("12 34" still matches "1234").
    const otp = getStr(body.otp).replace(/\D/g, "");
    const expected = (await db.invoice.findUnique({
      where: { id: stop.invoiceId },
      select: { deliveryOtp: true },
    }))?.deliveryOtp ?? "";

    if (otp === "" || otp !== expected.replace(/\D/g, "")) {
      // Persist the attempt BEFORE responding so retries across
      // requests/reconnects count against the same stop.
      await db.tripStop.update({
        where: { id: stop.id },
        data: { otpAttempts: { increment: 1 } },
      });
      const attemptsLeft = MAX_OTP_ATTEMPTS - (stop.otpAttempts + 1);
      throw new BusinessError(
        "ERR_OTP_MISMATCH",
        attemptsLeft > 0
          ? `Incorrect OTP — ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left`
          : "Incorrect OTP — no attempts left, use the signature fallback or call the office",
        422,
        { attemptsLeft }
      );
    }

    const result = await markStopDelivered({
      trip,
      stopId: stop.id,
      proof: "OTP",
      collectedMode,
      collectedAmount: round2(collectedAmount),
      deliveredBy: staffId,
    });
    return ok(result);
  } catch (e) {
    return handleApiError(e);
  }
}
