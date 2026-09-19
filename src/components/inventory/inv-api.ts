"use client";

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL INVENTORY — API CLIENT + TYPES
// Standalone fetch layer (no ERP store coupling). All requests
// relative; the signed httpOnly session cookie rides along
// automatically on same-origin calls.
// ═══════════════════════════════════════════════════════════════

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) {
    throw new ApiError(json.error || `Request failed (${res.status})`, json.code || "ERR_UNKNOWN", res.status);
  }
  return json.data as T;
}

function qs(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
  }
  const s = p.toString();
  return s ? ("" + "?" + s) : "";
}

export async function invGet<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const res = await fetch(path + qs(params), { cache: "no-store" });
  return handle<T>(res);
}

export async function invPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function invPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handle<T>(res);
}

export async function invDelete<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "DELETE" });
  return handle<T>(res);
}

export async function invUpload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  return handle<T>(res);
}

// ─── Shared types ─────────────────────────────────────────────────

export interface InvFirm {
  id: string;
  firmName: string;
  firmCode: string;
  gstin: string;
}

export interface InvSessionInfo {
  username: string;
  expiresAt: string;
  firm: InvFirm;
}

export interface WarehouseRef {
  warehouseId: string;
  code: string;
  name: string;
  type?: string;
  quantity: number;
  reservedQty: number;
  damagedQty: number;
}

export interface InvProduct {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  hsnCode: string;
  gstRate: number;
  purchaseCost: number;
  tier1Distributor: number;
  tier2Wholesale: number;
  tier3SemiWholesale: number;
  tier4Retailer: number;
  tier5Mrp: number;
  stockQuantity: number;
  reservedQty: number;
  damagedStock: number;
  lowStockThreshold: number;
  available?: number;
  barcode: string | null;
  piecesPerBox: number;
  photoUrl: string | null;
  imageFileName: string;
  imageVerified: "PENDING" | "NO_IMAGE" | "MATCHED" | "MISMATCH" | "UNREADABLE";
  imageMatchName: string;
  imageVerifiedAt: string | null;
  sourcePortal: string;
  isActive: boolean;
  updatedAt: string;
  warehouseBreakdown?: WarehouseRef[];
}

export interface InvWarehouse {
  id: string;
  code: string;
  name: string;
  type: string;
  address: string;
  city: string;
  manager: string;
  phone: string;
  isDefault: boolean;
  isActive: boolean;
  skuCount: number;
  totalSellable: number;
  totalDamaged: number;
  totalReserved: number;
}

export interface InvPortal {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  webhookUrl: string;
  contactEmail: string;
  status: string;
  autoSync: boolean;
  apiKeyMasked: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncMessage: string;
}

export interface SyncLogRow {
  id: string;
  portalName: string;
  trigger: string;
  direction: string;
  action: string;
  productsSeen: number;
  created: number;
  updated: number;
  skipped: number;
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface InvOverview {
  firm: InvFirm;
  catalog: { totalSkus: number; activeSkus: number; inactiveSkus: number; brands: number; categories: number };
  stock: { totalSellable: number; totalDamaged: number; totalReserved: number; stockValueAtCost: number; lowStock: number; outOfStock: number };
  imageVerification: { pending: number; noImage: number; matched: number; mismatch: number };
  warehouses: number;
  integrations: {
    total: number;
    active: number;
    portals: Array<{ id: string; name: string; kind: string; status: string; lastSyncAt: string | null; lastSyncStatus: string; autoSync: boolean }>;
  };
  sync: { intervalMin: number; autoSync: boolean; lastRunAt: string | null; nextRunAt: string | null; recentLogs: SyncLogRow[] };
  recentMovements: Array<{
    id: string; at: string; sku: string; name: string; type: string; pool: string;
    direction: string; quantity: number; referenceNo: string; notes: string;
  }>;
}

/** Thumbnail helper — shrink Cloudinary images client-side for fast grids. */
export function thumbUrl(url: string | null, w = 160): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname === "res.cloudinary.com") {
      u.pathname = u.pathname.replace("/upload/", `/upload/c_scale,w_${w}/`);
      u.search = "";
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

export function formatMoney(n: number): string {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}
