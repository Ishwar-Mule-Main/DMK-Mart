"use client";

// ═══════════════════════════════════════════════════════════════
// INV-UPLOAD — product intake (owner authority).
//  · Single add: full 5-tier pricing + image (URL or file upload —
//    uploads are stored under their canonical file name).
//  · Bulk: CSV paste/file with a dry-run validation report, then
//    commit. Opening stock lands per warehouseCode column.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { invGet, invPost, invUpload, formatMoney } from "@/components/inventory/inv-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { UploadCloud, FileText, CheckCircle2, XCircle, Loader2, Package, ImageIcon, Table2 } from "lucide-react";

const GST_RATES = [0, 5, 12, 18, 28];

interface DryRunReport {
  mode: string;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  invalid: Array<{ rowNumber: number; sku: string; errors: string[] }>;
  validPreview: Array<{ sku: string; name: string; brand: string }>;
}
interface CommitReport {
  mode: string;
  totalRows: number;
  created: number;
  invalidCount: number;
  failedCount: number;
  invalid: DryRunReport["invalid"];
  failed: Array<{ rowNumber: number; sku: string; error: string }>;
}

export function InvUpload() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary">Add / Upload Products</h1>
        <p className="text-[12px] text-dmk-text-muted mt-0.5">
          You hold the authority to grow the shared catalog — one product or a thousand. Every platform updates automatically.
        </p>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <SingleAdd />
        <BulkUpload />
      </div>
    </div>
  );
}

function SingleAdd() {
  const { toast } = useToast();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    sku: "", name: "", brand: "", category: "", unit: "Pcs", hsnCode: "3924", gstRate: "18",
    purchaseCost: "", tier1Distributor: "", tier2Wholesale: "", tier3SemiWholesale: "", tier4Retailer: "", tier5Mrp: "",
    openingStock: "", lowStockThreshold: "", barcode: "", photoUrl: "", warehouseId: "",
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<string | null>(null);
  const [warehouses, setWarehouses] = React.useState<Array<{ id: string; code: string; name: string }>>([]);

  React.useEffect(() => {
    invGet<{ warehouses: Array<{ id: string; code: string; name: string }> }>("/api/v1/inventory/warehouses")
      .then((d) => setWarehouses(d.warehouses))
      .catch(() => undefined);
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const canonicalPreview = [form.brand, form.name].filter(Boolean).join(" ").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand-product-name";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      let photoUrl = form.photoUrl.trim();
      if (file) {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("canonicalName", canonicalPreview);
        const up = await invUpload<{ url: string; fileName: string }>("/api/v1/inventory/uploads", fd);
        photoUrl = up.url;
      }
      const num = (s: string) => (s.trim() === "" ? 0 : Number(s));
      const res = await invPost<{ message: string }>("/api/v1/inventory/products", {
        sku: form.sku.trim(), name: form.name.trim(), brand: form.brand.trim(), category: form.category.trim(),
        unit: form.unit, hsnCode: form.hsnCode.trim(), gstRate: num(form.gstRate),
        purchaseCost: num(form.purchaseCost), tier1Distributor: num(form.tier1Distributor), tier2Wholesale: num(form.tier2Wholesale),
        tier3SemiWholesale: num(form.tier3SemiWholesale), tier4Retailer: num(form.tier4Retailer), tier5Mrp: num(form.tier5Mrp),
        openingStock: num(form.openingStock), lowStockThreshold: num(form.lowStockThreshold),
        barcode: form.barcode.trim(), photoUrl, warehouseId: form.warehouseId,
      });
      toast({ title: "Product added to the universal catalog", description: res.message });
      setForm((f) => ({ ...f, sku: "", name: "", barcode: "", openingStock: "", photoUrl: "" }));
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast({ title: "Add failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="dmk-card p-4 space-y-3.5" aria-label="Add single product">
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
        <p className="text-[13.5px] font-bold text-dmk-text-primary">Single product</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">SKU *</Label>
          <Input required value={form.sku} onChange={set("sku")} placeholder="DMK-PL-9001" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px] font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">Brand</Label>
          <Input value={form.brand} onChange={set("brand")} placeholder="DMK Polymers" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[11px] text-dmk-text-muted">Product name *</Label>
        <Input required value={form.name} onChange={set("name")} placeholder="Palace Planter 12 inch" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
      </div>
      <p className="text-[10.5px] text-dmk-text-muted -mt-1.5">
        Canonical image file name: <span className="font-mono text-dmk-yellow">{canonicalPreview}.webp</span>
      </p>

      <div className="grid grid-cols-3 gap-2.5">
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">Category</Label>
          <Input value={form.category} onChange={set("category")} placeholder="Planters" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">Unit</Label>
          <select value={form.unit} onChange={set("unit")} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Unit">
            {["Pcs", "Set", "Packet", "Box", "Crate", "Kgs", "Ltr"].map((u) => <option key={u}>{u}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">GST %</Label>
          <select value={form.gstRate} onChange={set("gstRate")} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="GST rate">
            {GST_RATES.map((r) => <option key={r} value={String(r)}>{r}%</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">Purchase cost ₹</Label>
          <Input type="number" min={0} step="0.01" value={form.purchaseCost} onChange={set("purchaseCost")} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-dmk-text-muted">HSN code</Label>
          <Input value={form.hsnCode} onChange={set("hsnCode")} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {([["tier1Distributor", "T1 Distributor ₹"], ["tier2Wholesale", "T2 Wholesale ₹"], ["tier3SemiWholesale", "T3 Semi-wholesale ₹"], ["tier4Retailer", "T4 Retailer ₹"], ["tier5Mrp", "MRP ₹"], ["openingStock", "Opening stock"], ["lowStockThreshold", "Low-stock alert at"], ["barcode", "Barcode"]] as const).map(([k, label]) => (
          <div key={k} className="space-y-1">
            <Label className="text-[11px] text-dmk-text-muted">{label}</Label>
            <Input type={k === "barcode" ? "text" : "number"} min={0} step="0.01" value={form[k]} onChange={set(k)} className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[12.5px]" />
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-dmk-text-muted">Opening stock warehouse</Label>
        <select value={form.warehouseId} onChange={set("warehouseId")} className="h-9 w-full rounded-md border border-dmk-border-subtle bg-dmk-input-well px-2 text-[12.5px] text-dmk-text-primary" aria-label="Opening stock warehouse">
          <option value="">Default warehouse</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] text-dmk-text-muted">Product image</Label>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="space-y-1">
            <Input value={form.photoUrl} onChange={set("photoUrl")} placeholder="https://… (image URL)" className="h-9 bg-dmk-input-well border-dmk-border-subtle text-[11.5px]" />
            {preview && (
              <div className="h-20 w-20 rounded-lg overflow-hidden border border-dmk-border-subtle bg-[#111827]">
                <img src={preview} alt="Selected image preview" className="h-full w-full object-cover" />
              </div>
            )}
          </div>
          <label className="dmk-well rounded-lg border border-dashed border-dmk-border-subtle h-[76px] flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-dmk-hover transition-colors">
            <ImageIcon className="h-4 w-4 text-dmk-text-muted" />
            <span className="text-[10.5px] text-dmk-text-muted">or upload file (≤ 5 MB)</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/webp,image/png,image/jpeg,image/gif,image/avif"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                setPreview(f ? URL.createObjectURL(f) : null);
              }}
            />
          </label>
        </div>
      </div>

      <Button type="submit" disabled={busy || !form.sku.trim() || !form.name.trim()} className="w-full h-10 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90 disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
        {busy ? "Adding…" : "Add to universal catalog"}
      </Button>
    </form>
  );
}

function BulkUpload() {
  const { toast } = useToast();
  const [csv, setCsv] = React.useState("");
  const [report, setReport] = React.useState<DryRunReport | CommitReport | null>(null);
  const [busy, setBusy] = React.useState<"dry" | "commit" | null>(null);

  const sample = `sku,name,brand,category,unit,hsnCode,gstRate,purchaseCost,tier1Distributor,tier2Wholesale,tier3SemiWholesale,tier4Retailer,tier5Mrp,openingStock,openingDamagedStock,lowStockThreshold,piecesPerBox,barcode,photoUrl,warehouseCode
DMK-PL-9001,DMK Polymers Palace Planter 12 inch,DMK Polymers,Planters,Pcs,3924,18,180,260,220,200,240,320,120,0,20,6,,https://example.com/palace.webp,WH-MAIN
DMK-BK-105,Deep Household Bucket 20L Round,Deep Household,Buckets,Pcs,3924,18,95,140,120,110,125,160,300,2,40,12,,https://example.com/bucket.webp,`;

  async function validate() {
    setBusy("dry");
    try {
      const r = await invPost<DryRunReport>("/api/v1/inventory/products/bulk", { csv, commit: false });
      setReport(r);
      toast({ title: "Dry run complete", description: `${r.validCount} valid · ${r.invalidCount} invalid of ${r.totalRows} rows` });
    } catch (e) {
      toast({ title: "Validation failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    setBusy("commit");
    try {
      const r = await invPost<CommitReport>("/api/v1/inventory/products/bulk", { csv, commit: true });
      setReport(r);
      toast({ title: "Bulk import committed", description: `${r.created} products created across every platform` });
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function downloadTemplate() {
    try {
      const d = await invGet<{ csv: string }>("/api/v1/inventory/products/import-template");
      setCsv(d.csv);
      toast({ title: "Template loaded", description: "Edit the example rows and run Validate." });
    } catch (e) {
      toast({ title: "Template failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  const isDry = report?.mode === "DRY_RUN";
  const invalid = report?.invalid ?? [];

  return (
    <div className="dmk-card p-4 space-y-3.5" aria-label="Bulk upload products">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4 text-dmk-yellow" strokeWidth={1.75} />
          <p className="text-[13.5px] font-bold text-dmk-text-primary">Bulk upload (CSV)</p>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={downloadTemplate}>
          <FileText className="h-3 w-3" /> Load template
        </Button>
      </div>
      <p className="text-[11.5px] text-dmk-text-muted leading-relaxed">
        Paste CSV or a template. Columns: <span className="font-mono text-[10.5px]">sku, name, brand, category, unit, hsnCode, gstRate, purchaseCost, tier1…tier5, openingStock, openingDamagedStock, lowStockThreshold, piecesPerBox, barcode, photoUrl, warehouseCode</span>.
        Opening stock lands on the named warehouse (or the default).
      </p>
      <textarea
        value={csv}
        onChange={(e) => { setCsv(e.target.value); setReport(null); }}
        placeholder={sample}
        rows={10}
        className="w-full rounded-lg border border-dmk-border-subtle bg-dmk-input-well p-3 font-mono text-[11px] text-dmk-text-primary focus:outline-none focus:ring-2 focus:ring-dmk-yellow/40"
        aria-label="CSV data"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={validate} disabled={busy !== null || !csv.trim()}>
          {busy === "dry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Validate (dry run)
        </Button>
        <Button size="sm" className="h-9 gap-1.5 bg-dmk-yellow text-black font-bold hover:bg-dmk-yellow/90" onClick={commit} disabled={busy !== null || !csv.trim() || (report !== null && isDry && (report as DryRunReport).validCount === 0)}>
          {busy === "commit" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />} Commit import
        </Button>
      </div>

      {report && (
        <div className="dmk-well rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className={cn("dmk-badge h-6 px-2 text-[10px]", report.mode === "COMMIT" ? "dmk-badge-success" : "bg-dmk-blue/10 text-dmk-blue")}>
              {report.mode === "COMMIT" ? "COMMITTED" : "DRY RUN"}
            </span>
            <span className="text-dmk-text-muted">
              {report.mode === "COMMIT"
                ? `${(report as CommitReport).created} created · ${(report as CommitReport).invalidCount} invalid · ${(report as CommitReport).failedCount} failed`
                : `${(report as DryRunReport).validCount} valid · ${(report as DryRunReport).invalidCount} invalid of ${report.totalRows}`}
            </span>
          </div>
          {invalid.length > 0 && (
            <div className="max-h-44 overflow-y-auto space-y-1.5">
              {invalid.slice(0, 30).map((r) => (
                <div key={r.rowNumber} className="flex items-start gap-2 text-[11px]">
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span className="font-mono text-[10px] text-dmk-text-muted shrink-0">row {r.rowNumber}</span>
                  <span className="font-mono text-[10px] text-dmk-text-muted shrink-0">{r.sku}</span>
                  <span className="text-red-400/90">{r.errors.join(" · ")}</span>
                </div>
              ))}
            </div>
          )}
          {report.mode === "COMMIT" && (report as CommitReport).failed.length > 0 && (
            <div className="max-h-32 overflow-y-auto space-y-1.5">
              {(report as CommitReport).failed.slice(0, 15).map((r) => (
                <div key={r.rowNumber} className="flex items-start gap-2 text-[11px]">
                  <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                  <span className="font-mono text-[10px] text-dmk-text-muted shrink-0">{r.sku}</span>
                  <span className="text-red-400/90">{r.error}</span>
                </div>
              ))}
            </div>
          )}
          {isDry && (report as DryRunReport).validCount > 0 && (
            <div className="flex items-center gap-2 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Ready — commit to publish {(report as DryRunReport).validCount} new SKUs to every platform.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
