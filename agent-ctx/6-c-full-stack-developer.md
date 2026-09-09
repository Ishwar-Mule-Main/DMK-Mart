# Task 6-c — Driver Trip View in the /team portal

Agent: full-stack-developer · Date: 2026 session (parallel with Task 4-a logistics backend)

## Files

| File | Change |
|---|---|
| `src/components/verify/driver-trip-view.tsx` | NEW — the driver's mobile-first trip screen |
| `src/components/verify/verification-portal.tsx` | EDIT — VerificationPortal is now a router: DRIVER → DriverTripView, others → `VerifierWorkspace` (former body, unchanged) |
| `src/store/erp-store.ts` | EDIT — `ErpSession.staffRole?: string` added (parallel agent's logistics ViewIds also live here; both edits coexist) |
| `src/components/auth/login-gate.tsx` | EDIT — TeamDoor saves `staffRole: res.staff.role` on login (shared login box untouched) |
| `src/components/erp/views/verification.tsx` | EDIT — owner staff dialog role picker now offers `Driver (delivery trips)` (STAFF_ROLE_OPTIONS + flex-wrap) |

## Where the role check sits

Inside `VerificationPortal` (NOT app-shell — instructed not to touch it):

```tsx
if (session?.role === "TEAM" && session.staffRole === "DRIVER") return <DriverTripView staff={...} firm={...} onLogout={...}/>;
return <VerifierWorkspace />;
```

`VerificationPortal` only calls 2 hooks (session, logout) before the branch → stable hook order. `staffRole` is fixed for a session's lifetime; persisted sessions from before this change have `staffRole === undefined` → fall through to the verifier view.

## Driver screen behaviour

- Poll `GET /api/v1/logistics/driver/active-trip?staffId=` every 15s (interval cleared on unmount; refetch after every action; fetch failure → amber offline banner + header chip, polling continues, last trip stays visible).
- No trip → EmptyState "No active trip yet — your trip appears here the moment the office dispatches it." + Refresh + Sign out.
- Trip header: trip number, route, vehicle chip, "X of Y delivered", thin green progress bar, refresh icon button.
- Pending stops: sequence circle, big shop name, tel: call button, box/loose/kg chips, items with "2 boxes + 3 loose" breakdown, 26px "Collect on delivery" amount + CASH/UPI chip, full-width `Enter Bill OTP & Deliver`.
- OTP dialog: shadcn InputOTP (4 slots, h-14), CASH|UPI segmented toggle, amount (defaults to stop.amount), Confirm gated on 4 digits + valid amount.
  - `ERR_OTP_MISMATCH` → red "Wrong code — N attempts left", digits kept, CSS shake (scoped keyframes) + `navigator.vibrate(180)`.
  - `ERR_OTP_LOCKED` → locked mode → "Bill misplaced? Confirm with paper signature".
  - "Customer lost the bill? Use paper signature" text button → signature-confirm mode → POST signature endpoint.
  - verify-otp/signature are called with a local raw-fetch helper so `attemptsLeft` survives (ApiError would drop it); fallback parses "N attempts" from the message.
- Delivered stops: emerald-900/20 card, "Delivered at HH:MM", proof chip (OTP verified / Paper signature), collected amount + mode.
- All delivered → "All deliveries done! Return to the warehouse for cash settlement." banner, header 100%.

## Owner staff role select location

`src/components/erp/views/verification.tsx` → `StaffDialog` role row (previously `["VERIFIER","SUPERVISOR"]` Switch map) → now `STAFF_ROLE_OPTIONS` including `DRIVER` / "Driver (delivery trips)". `POST`/`PATCH /api/v1/verification/staff` already pass `role` through; `VerificationStaff.role` is a plain String column, so no schema change.

## QA

- `npx tsc --noEmit`: **0 errors in all 5 touched files.** Project-wide tsc currently has 3 errors that belong to parallel agents' in-flight work: `src/app/api/v1/_lib/logistics.ts`, `src/app/api/v1/logistics/routes/route.ts` (Task 4-a — Prisma client not yet regenerated for the new models) and `src/components/erp/app-shell.tsx` (VIEW_MAP missing the 3 logistics ViewIds someone added to the store).
- `npx eslint` on the 5 touched files: **0 problems**.
- Dev server hot-compiled clean (✓) after all files landed; no dev server started, no build run. i18n dictionaries untouched.

## Contract the API agent (4-a) must honor

1. `active-trip` response: `{trip: null | {...}}`, stops include `phone`, `expectedMode` ∈ {CASH, UPI}, `status` ∈ {PENDING, DELIVERED}, `deliveryProof` ∈ {"", "OTP", "SIGNATURE"}, `deliveredAt` ISO or null, `items[]` with sku/productName/quantity/boxes/loosePieces/weightKg — **no OTP values ever**. Stops pre-sorted by `sequence` (client re-sorts defensively anyway).
2. `POST /trips/[tripId]/stops/[stopId]/verify-otp` body `{otp, collectedMode, collectedAmount, staffId}`; `POST .../signature` body `{collectedMode, collectedAmount, staffId}`; both → `200 {stop, trip:{status,totalStops,deliveredStops}}`.
3. **422 `ERR_OTP_MISMATCH` must include `attemptsLeft: number` as a top-level field on the `{ok:false,error,code}` envelope** (client fallback: regex-parses "N attempts" from `error`).
4. 422 `ERR_OTP_LOCKED` after 5 wrong attempts; 409 `ERR_INVALID_STATE` (e.g. stop not PENDING / trip not active) is surfaced as a generic inline error message.
