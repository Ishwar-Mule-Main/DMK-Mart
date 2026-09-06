"use client";

// ═══════════════════════════════════════════════════════════════
// SHARED: StockAdjustDialog — per-product dual-stock adjustment
// Five correction types, each with audit trail + correct journals:
//   ADD_SELLABLE     sellable ↑        (surplus journal)
//   REMOVE_SELLABLE  sellable ↓        (shortage journal)
//   TRANSFER_DAMAGED sellable → damaged (value-neutral)
//   REQUEUE_SELLABLE damaged → sellable (value-neutral)
//   WRITE_OFF        damaged destroyed  (damage-loss journal)
// Used by: Products view (row action) + Stock Levels view (Adjust)
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  PackageMinus,
  PackagePlus,
  RotateCcw,
  Trash2,
} from "lucide-react";

import { ErrorText, Field, inputCls } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiPost, ApiError } from "@/lib/api-client";
import { toast } from "@/hooks/use-toast";
import { useErpStore } from "@/store/erp-store";
import type { Product } from "@/types/erp";
import { toISODate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type AdjustType =
  | "ADD_SELLABLE"
  | "REMOVE_SELLABLE"
  | "TRANSFER_DAMAGED"
  | "REQUEUE_SELLABLE"
  | "WRITE_OFF";

const TYPES: Array<{
  value: AdjustType;
  label: string;
  hint: string;
  icon: React.ElementType;
  pool: "SELLABLE" | "DAMAGED";
  direction: "IN" | "OUT";
  toastTitle: string;
}> = [
  {
    value: "ADD_SELLABLE",
    label: "Add Stock (+)",
    hint: "Unrecorded inward / found stock → sellable pool",
    icon: PackagePlus,
    pool: "SELLABLE",
    direction: "IN",
    toastTitle: "Stock added",
  },
  {
    value: "REMOVE_SELLABLE",
    label: "Remove Stock (−)",
    hint: "Count shortage / shrinkage → out of sellable",
    icon: PackageMinus,
    pool: "SELLABLE",
    direction: "OUT",
    toastTitle: "Stock removed",
  },
  {
    value: "TRANSFER_DAMAGED",
    label: "Transfer to Damaged",
    hint: "Move sellable units into damaged quarantine",
    icon: ArrowDownToLine,
    pool: "SELLABLE",
    direction: "OUT",
    toastTitle: "Transferred to damaged pool",
  },
  {
    value: "REQUEUE_SELLABLE",
    label: "Requeue to Sellable",
    hint: "Repaired / reclassified units back to sellable",
    icon: RotateCcw,
    pool: "DAMAGED",
    direction: "IN",
    toastTitle: "Requeued to sellable",
  },
  {
    value: "WRITE_OFF",
    label: "Write Off Damaged",
    hint: "Destroy damaged units → damage-loss journal",
    icon: Trash2,
    pool: "DAMAGED",
    direction: "OUT",
    toastTitle: "Stock written off",
  },
];

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function maxFor(type: AdjustType, p: Product): number | null {
  switch (type) {
    case "REMOVE_SELLABLE":
    case "TRANSFER_DAMAGED":
      return p.stockQuantity;
    case "REQUEUE_SELLABLE":
    case "WRITE_OFF":
      return p.damagedStock;
    case "ADD_SELLABLE":
      return null; // unbounded inward
  }
}

function previewFor(type: AdjustType, p: Product, q: number): { sellable: number; damaged: number } {
  const s = p.stockQuantity;
  const d = p.damagedStock;
  switch (type) {
    case "ADD_SELLABLE":
      return { sellable: s + q, damaged: d };
    case "REMOVE_SELLABLE":
      return { sellable: s - q, damaged: d };
    case "TRANSFER_DAMAGED":
      return { sellable: s - q, damaged: d + q };
    case "REQUEUE_SELLABLE":
      return { sellable: s + q, damaged: d - q };
    case "WRITE_OFF":
      return { sellable: s, damaged: d - q };
  }
}

interface StockAdjustDialogProps {
  product: Product | null;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful adjustment (e.g. reload the list). */
  onAdjusted?: () => void;
}

export function StockAdjustDialog({ product, onOpenChange, onAdjusted }: StockAdjustDialogProps) {
  const activeFirmId = useErpStore((s) => s.activeFirmId);

  const [type, setType] = React.useState<AdjustType>("ADD_SELLABLE");
  const [qty, setQty] = React.useState("1");
  const [reason, setReason] = React.useState("");
  const [adjustDate, setAdjustDate] = React.useState(toISODate(new Date()));
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form each time a (new) product is opened.
  React.useEffect(() => {
    if (product) {
      setType("ADD_SELLABLE");
      setQty("1");
      setReason("");
      setAdjustDate(toISODate(new Date()));
      setError(null);
      setSubmitting(false);
    }
  }, [product]);

  const q = Number(qty);
  const qValid = Number.isFinite(q) && q > 0;
  const max = product ? maxFor(type, product) : null;
  const overMax = max !== null && qValid && q > max;
  const preview = product && qValid ? previewFor(type, product, q) : null;
  const meta = TYPES.find((t) => t.value === type)!;

  const submit = async () => {
    if (!activeFirmId || !product) return;
    if (!qValid) {
      setError("Quantity must be a positive number.");
      return;
    }
    if (overMax) {
      setError(`Cannot adjust more than ${fmtQty(max!)} ${maxFor(type, product) === product.stockQuantity ? "sellable" : "damaged"} units.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/v1/stock/adjustment", {
        firmId: activeFirmId,
        productId: product.id,
        adjustType: type,
        quantity: q,
        reason: reason.trim(),
        adjustDate,
      });
      toast({
        title: meta.toastTitle,
        description: `${product.sku} × ${fmtQty(q)} — movement recorded in the audit trail.`,
      });
      onOpenChange(false);
      onAdjusted?.();
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? `${e.message} (${e.code})`
          : e instanceof Error
            ? e.message
            : "Adjustment failed";
      setError(msg);
      toast({ title: "Adjustment failed", description: msg, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent className="dmk-card border-dmk-border-medium max-h-[92vh] overflow-y-auto sm:w-[560px] [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="text-dmk-text-primary text-[16px]">Adjust Stock</DialogTitle>
          <DialogDescription className="text-dmk-text-muted text-[12px]">
            {product ? `${product.sku} — ${product.name}` : ""}
          </DialogDescription>
        </DialogHeader>

        {product && (
          <>
            {/* Current pools */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary px-3 py-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">Sellable</p>
                <p className="font-money text-[15px] font-semibold text-dmk-success">{fmtQty(product.stockQuantity)}</p>
              </div>
              <div className="rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary px-3 py-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-dmk-text-muted">Damaged</p>
                <p className={cn("font-money text-[15px] font-semibold", product.damagedStock > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
                  {fmtQty(product.damagedStock)}
                </p>
              </div>
            </div>

            {/* Adjustment type picker */}
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as AdjustType)}
              className="grid grid-cols-1 gap-1.5"
            >
              {TYPES.map((t) => {
                const Icon = t.icon;
                const active = t.value === type;
                return (
                  <Label
                    key={t.value}
                    htmlFor={`adj-${t.value}`}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors",
                      active
                        ? "border-dmk-border-medium bg-dmk-bg-tertiary"
                        : "border-dmk-border-subtle hover:bg-dmk-hover"
                    )}
                  >
                    <RadioGroupItem id={`adj-${t.value}`} value={t.value} className="mt-0.5" />
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-dmk-gold" : "text-dmk-text-muted")} />
                    <span className="min-w-0">
                      <span className={cn("block text-[12.5px] font-semibold", active ? "text-dmk-text-primary" : "text-dmk-text-secondary")}>
                        {t.label}
                      </span>
                      <span className="block text-[11px] leading-snug text-dmk-text-muted">{t.hint}</span>
                    </span>
                  </Label>
                );
              })}
            </RadioGroup>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Quantity *"
                hint={max !== null ? `Max ${fmtQty(max)} (pool limit)` : "Unlimited for inward"}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  className={cn(inputCls, overMax && "border-dmk-danger/60")}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </Field>
              <Field label="Adjustment Date">
                <Input
                  type="date"
                  className={inputCls}
                  value={adjustDate}
                  onChange={(e) => setAdjustDate(e.target.value)}
                />
              </Field>
            </div>

            <Field label="Reason" hint="Recorded on the audit movement (recommended)">
              <Textarea
                rows={2}
                className={cn(inputCls, "resize-none")}
                placeholder="e.g. Physical count correction / damaged in transit / repair passed QC"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>

            {/* Live balance preview */}
            {preview && qValid && !overMax && (
              <div className="flex items-center gap-2 rounded-md border border-dmk-border-subtle bg-dmk-bg-tertiary px-3 py-2 text-[11.5px] text-dmk-text-secondary">
                <ArrowUpFromLine className="h-3.5 w-3.5 shrink-0 text-dmk-text-muted" />
                <span>
                  After posting — Sellable{" "}
                  <span className="font-money font-semibold text-dmk-success">{fmtQty(preview.sellable)}</span>
                  {"  ·  "}Damaged{" "}
                  <span className={cn("font-money font-semibold", preview.damaged > 0 ? "text-dmk-danger" : "text-dmk-text-muted")}>
                    {fmtQty(preview.damaged)}
                  </span>
                </span>
              </div>
            )}

            {(overMax || (!qValid && qty.trim() !== "")) && (
              <ErrorText>
                {overMax
                  ? `Cannot adjust more than ${fmtQty(max!)} ${meta.pool === "SELLABLE" ? "sellable" : "damaged"} units.`
                  : "Quantity must be a positive number."}
              </ErrorText>
            )}
            {error && !overMax && <ErrorText>{error}</ErrorText>}

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="h-9 border-dmk-border-subtle bg-dmk-input-well text-dmk-text-secondary hover:bg-dmk-hover"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={submitting || !qValid || overMax}
                className="h-9"
              >
                {submitting ? "Posting…" : "Post Adjustment"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
