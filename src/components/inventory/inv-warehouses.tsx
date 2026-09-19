"use client";

// ═══════════════════════════════════════════════════════════════
// INV-WAREHOUSES — warehouse stocking (portal-private placement).
// Create/edit warehouses, inspect per-warehouse stock, transfer
// units between warehouses (totals never change → other platforms
// are unaffected by internal placement).
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  invGet, invPost, invPatch, invDelete, thumbUrl, type InvWarehouse,
} from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Warehouse, Plus, ArrowRightLeft, Boxes, MapPin, Phone, User, Star, Loader2, ImageIcon, Search, X,
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  MAIN: "Main hub",
  SATELLITE: "Satellite",
  TRANSIT: "Transit",
  QC_DAMAGED: "QC / Damaged",
  FRANCHISE: "Franchise",
};

interface StockRow {
  productId: string;
  sku: string;
  name: string;
  brand: string;
  unit: string;
  photoUrl: string | null;
  imageFileName: string;
  quantity: number;
  reservedQty: number;
  damagedQty: number;
}

export function InvWarehouses() {
  const { toast } = useToast();
  const [warehouses, setWarehouses] = React.useState<InvWarehouse[] | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [stockWh, setStockWh] = React.useState<InvWarehouse | null>(null);
  const [transferWh, setTransferWh] = React.useState<InvWarehouse | null>(null);

  const load = React.useCallback(async () => {
    try {
      const d = await invGet<{ warehouses: InvWarehouse[] }>("/api/v1/inventory/warehouses");
      setWarehouses(d.warehouses);
    } catch (e) {
      toast({ title: "Load failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      setWarehouses([]);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Warehouses</h1>
          <p className="text-[12px] text-dmk-text-muted mt-0.5">
            Placement lives only here — every other platform reads just the total stock.
          </p>
        </div>
        <Button size="sm" className="h-9 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New warehouse
        </Button>
      </div>

      {warehouses === null ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[180px] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {warehouses.map((w) => (
            <div key={w.id} className={cn("dmk-card p-4", !w.isActive && "opacity-60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Warehouse className="h-4 w-4 text-dmk-yellow shrink-0" strokeWidth={1.75} />
                    <p className="text-[14px] font-bold text-dmk-text-primary truncate">{w.name}</p>
                    {w.isDefault && (
                      <span className="dmk-badge h-5 px-1.5 gap-1 text-[9px] bg-dmk-yellow/15 text-dmk-yellow shrink-0">
                        <Star className="h-2.5 w-2.5" /> DEFAULT
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-dmk-text-muted">
                    <span className="font-mono">{w.code}</span> · {TYPE_LABELS[w.type] ?? w.type}
                  </p>
                </div>
                <span className={cn("dmk-badge h-5.5 px-1.5 text-[9.5px] shrink-0", w.isActive ? "dmk-badge-success" : "bg-dmk-hover text-dmk-text-muted")}>
                  {w.isActive ? "ACTIVE" : "OFF"}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
                <div className="dmk-well rounded-lg py-2">
                  <p className="text-[9px] uppercase tracking-wider text-dmk-text-muted">Sellable</p>
                  <p className="text-[14px] font-black text-dmk-text-primary font-money mt-0.5">{w.totalSellable.toLocaleString("en-IN")}</p>
                </div>
                <div className="dmk-well rounded-lg py-2">
                  <p className="text-[9px] uppercase tracking-wider text-dmk-text-muted">Reserved</p>
                  <p className="text-[14px] font-black text-amber-400 font-money mt-0.5">{w.totalReserved.toLocaleString("en-IN")}</p>
                </div>
                <div className="dmk-well rounded-lg py-2">
                  <p className="text-[9px] uppercase tracking-wider text-dmk-text-muted">Damaged</p>
                  <p className="text-[14px] font-black text-red-400 font-money mt-0.5">{w.totalDamaged.toLocaleString("en-IN")}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-[10.5px] text-dmk-text-muted truncate">{w.skuCount} SKUs stored</p>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setStockWh(w)}>View stock</Button>
                  <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={() => setTransferWh(w)}>
                    <ArrowRightLeft className="h-3 w-3" /> Transfer
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <WarehouseCreate open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void load()} />
      {stockWh && <WarehouseStockDialog wh={stockWh} onClose={() => setStockWh(null)} />}
      {transferWh && <TransferDialog from={transferWh} onClose={() => setTransferWh(null)} onDone={() => void load()} />}
    </div>
  );
}

function WarehouseCreate({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ code: "", name: "", type: "SATELLITE", city: "", address: "", manager: "", phone: "", isDefault: false });

  async function create() {
    setBusy(true);
    try {
      await invPost("/api/v1/inventory/warehouses", { ...form, code: form.code.toUpperCase() });
      toast({ title: "Warehouse created", description: `${form.code.toUpperCase()} is ready to receive stock.` });
      onOpenChange(false);
      setForm({ code: "", name: "", type: "SATELLITE", city: "", address: "", manager: "", phone: "", isDefault: false });
      onCreated();
    } catch (e) {
      toast({ title: "Create failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[15px]">New warehouse</DialogTitle>
          <DialogDescription className="text-[11.5px]">Codes are firm-unique (e.g. WH-NORTH). The default warehouse absorbs every external/universal stock delta.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-dmk-text-muted">Code *</Label>
              <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="WH-NORTH" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-mono" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-dmk-text-muted">Type</Label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Warehouse type">
                {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="North Satellite Warehouse" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label className="text-[11px] text-dmk-text-muted flex items-center gap-1"><MapPin className="h-3 w-3" /> City</Label>
              <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-dmk-text-muted flex items-center gap-1"><User className="h-3 w-3" /> Manager</Label>
              <Input value={form.manager} onChange={(e) => setForm((f) => ({ ...f, manager: e.target.value }))} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Address</Label>
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-dmk-text-secondary">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} className="accent-[var(--accent-yellow)]" />
            Make this the default receiving warehouse
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" className="h-8 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={create} disabled={busy || !form.code.trim() || !form.name.trim()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WarehouseStockDialog({ wh, onClose }: { wh: InvWarehouse; onClose: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<StockRow[] | null>(null);
  const [search, setSearch] = React.useState("");
  const [searchDeb, setSearchDeb] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setSearchDeb(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    let alive = true;
    invGet<{ rows: StockRow[] }>(`/api/v1/inventory/warehouses/${wh.id}/stock`, { search: searchDeb, pageSize: 100 })
      .then((d) => { if (alive) setRows(d.rows); })
      .catch((e) => {
        toast({ title: "Load failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
        if (alive) setRows([]);
      });
    return () => { alive = false; };
  }, [searchDeb, wh.id, toast]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[720px] max-h-[85vh] overflow-y-auto dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[15px] flex items-center gap-2">
            <Boxes className="h-4 w-4 text-dmk-yellow" /> {wh.name} — stored stock
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">Per-SKU placement rows for {wh.code}. Totals across warehouses always equal the catalog total.</DialogDescription>
        </DialogHeader>
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-dmk-text-muted" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by SKU / name / brand…" className="pl-8 h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" aria-label="Filter warehouse stock" />
          {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-dmk-text-muted" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {rows === null ? (
          <div className="space-y-2 pt-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
        ) : rows.length === 0 ? (
          <p className="dmk-well rounded-lg p-6 text-center text-[12px] text-dmk-text-muted">Nothing stored here yet — add stock or transfer units in.</p>
        ) : (
          <div className="rounded-lg border border-dmk-border-subtle overflow-x-auto">
            <table className="w-full text-[11.5px] min-w-[520px]">
              <thead>
                <tr className="bg-dmk-hover text-left text-[9.5px] uppercase tracking-wider text-dmk-text-muted">
                  <th className="py-2 px-2 font-bold">Product</th>
                  <th className="py-2 px-2 font-bold text-right">Sellable</th>
                  <th className="py-2 px-2 font-bold text-right">Reserved</th>
                  <th className="py-2 px-2 font-bold text-right">Damaged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId} className="border-t border-dmk-border-subtle/60">
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="h-8 w-8 rounded-md overflow-hidden bg-[#111827] shrink-0 border border-dmk-border-subtle">
                          {r.photoUrl ? (
                            <img src={thumbUrl(r.photoUrl, 64) ?? r.photoUrl} alt={`${r.brand} ${r.name}`} width={32} height={32} loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <span className="h-full w-full flex items-center justify-center"><ImageIcon className="h-3 w-3 text-dmk-text-muted" /></span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-dmk-text-primary max-w-[260px]">{r.name}</span>
                          <span className="block font-mono text-[9.5px] text-dmk-text-muted">{r.sku} · {r.imageFileName}</span>
                        </span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-money font-bold text-dmk-text-primary">{r.quantity.toLocaleString("en-IN")}</td>
                    <td className="py-1.5 px-2 text-right font-money text-amber-400">{r.reservedQty.toLocaleString("en-IN")}</td>
                    <td className="py-1.5 px-2 text-right font-money text-red-400">{r.damagedQty.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({ from, onClose, onDone }: { from: InvWarehouse; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [warehouses, setWarehouses] = React.useState<InvWarehouse[]>([]);
  const [toId, setToId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [matches, setMatches] = React.useState<Array<{ productId: string; sku: string; name: string; quantity: number; unit: string }>>([]);
  const [picked, setPicked] = React.useState<{ productId: string; sku: string; name: string; max: number; unit: string } | null>(null);
  const [qty, setQty] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    invGet<{ warehouses: InvWarehouse[] }>("/api/v1/inventory/warehouses")
      .then((d) => {
        const others = d.warehouses.filter((w) => w.id !== from.id && w.isActive);
        setWarehouses(others);
        setToId(others[0]?.id ?? "");
      })
      .catch(() => undefined);
  }, [from.id]);

  React.useEffect(() => {
    if (!search.trim()) { setMatches([]); return; }
    const t = setTimeout(() => {
      invGet<{ rows: StockRow[] }>(`/api/v1/inventory/warehouses/${from.id}/stock`, { search: search.trim(), pageSize: 8 })
        .then((d) => setMatches(d.rows.map((r) => ({ productId: r.productId, sku: r.sku, name: r.name, quantity: r.quantity, unit: r.unit }))))
        .catch(() => setMatches([]));
    }, 300);
    return () => clearTimeout(t);
  }, [search, from.id]);

  async function transfer() {
    if (!picked || !toId) return;
    setBusy(true);
    try {
      await invPost("/api/v1/inventory/warehouses/transfer", { productId: picked.productId, fromWarehouseId: from.id, toWarehouseId: toId, quantity: Number(qty) });
      toast({ title: "Stock transferred", description: `${qty} × ${picked.sku} → ${warehouses.find((w) => w.id === toId)?.code}. Total unchanged.` });
      onClose();
      onDone();
    } catch (e) {
      toast({ title: "Transfer failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[460px] dmk-card border-dmk-border-subtle" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-[15px] flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-dmk-yellow" /> Transfer from {from.code}
          </DialogTitle>
          <DialogDescription className="text-[11.5px]">Moving units between warehouses never changes the catalog total — other platforms see no difference.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Destination warehouse</Label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Destination warehouse">
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">Product (searches {from.code} stock)</Label>
            {picked ? (
              <div className="dmk-well rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] text-dmk-text-primary truncate">{picked.name}</p>
                  <p className="font-mono text-[10px] text-dmk-text-muted">{picked.sku} · {picked.max.toLocaleString("en-IN")} {picked.unit} available here</p>
                </div>
                <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setPicked(null); setQty(""); }}>Change</Button>
              </div>
            ) : (
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU or name…" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
                {matches.length > 0 && (
                  <div className="rounded-lg border border-dmk-border-subtle divide-y divide-dmk-border-subtle/60 max-h-44 overflow-y-auto">
                    {matches.map((m) => (
                      <button key={m.productId} onClick={() => { setPicked({ ...m, max: m.quantity }); setSearch(""); }} className="w-full text-left px-3 py-2 hover:bg-dmk-hover transition-colors">
                        <span className="block text-[12px] text-dmk-text-primary truncate">{m.name}</span>
                        <span className="block font-mono text-[10px] text-dmk-text-muted">{m.sku} · {m.quantity.toLocaleString("en-IN")} {m.unit}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {picked && (
            <div className="space-y-1">
              <Label className="text-[11px] text-dmk-text-muted">Quantity ({picked.unit})</Label>
              <Input type="number" min={1} max={picked.max} value={qty} onChange={(e) => setQty(e.target.value)} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
              <p className="text-[10px] text-dmk-text-muted">Max {picked.max.toLocaleString("en-IN")} {picked.unit} in {from.code}.</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" onClick={onClose}>Cancel</Button>
            <Button size="sm" className="h-8 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={transfer} disabled={busy || !picked || !toId || !qty || Number(qty) <= 0}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />} Transfer
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
