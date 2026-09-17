"use client";

// ═══════════════════════════════════════════════════════════════
// SHARED — RECEIPT VIEWER POPUP
// Full-size receipt/bill photo inside a dialog box. Used by
// Record Expense (attach preview + recent register) and
// Expense Reports (voucher table receipt column).
// Expects a dataURL (or any <img src>) + optional metadata rows.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface ReceiptViewerMeta {
  /** Already-translated label, e.g. t("cmn.amount"). */
  label: string;
  /** Already-formatted value, e.g. formatINR(1500). */
  value: string;
  /** Optional extra class for the value (e.g. font-money). */
  valueCls?: string;
}

export interface ReceiptViewerData {
  /** Image source — dataURL for freshly picked files, or a stored URL. */
  url: string;
  /** Popup title — voucher number for saved rows, file name while drafting. */
  title: string;
  /** Suggested file name for the download button. */
  fileName: string;
  /** Optional metadata grid under the image. */
  meta?: ReceiptViewerMeta[];
}

export function ReceiptViewerDialog({
  data,
  onClose,
}: {
  data: ReceiptViewerData | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [loaded, setLoaded] = React.useState(false);

  // New receipt opened → reset the loading flag.
  React.useEffect(() => {
    setLoaded(false);
  }, [data?.url]);

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-[calc(100%-1.5rem)] gap-0 overflow-hidden border-dmk-border-medium bg-dmk-bg-secondary p-0 sm:max-w-xl"
      >
        {data && (
          <div className="flex max-h-[86vh] flex-col">
            <DialogHeader className="border-b border-dmk-border-subtle px-5 py-3.5 pr-12">
              <DialogTitle className="flex min-w-0 items-center gap-2 font-mono text-[13.5px] text-dmk-text-primary">
                <span className="truncate" title={data.title}>
                  {data.title}
                </span>
              </DialogTitle>
              <DialogDescription className="sr-only">{t("exp.receiptTitle")}</DialogDescription>
            </DialogHeader>

            {/* Full-size image — object-contain on a dark well, scroll-safe */}
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div
                className="dmk-well relative flex min-h-[160px] items-center justify-center rounded-lg p-2"
                role="img"
                aria-label={t("exp.receiptTitle")}
              >
                {!loaded && (
                  <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                    <Loader2 className="h-6 w-6 animate-spin text-dmk-text-muted" />
                  </div>
                )}
                <img
                  src={data.url}
                  alt={t("exp.receiptTitle")}
                  onLoad={() => setLoaded(true)}
                  className={cn(
                    "max-h-[38vh] w-auto max-w-full rounded-md object-contain transition-opacity duration-200 sm:max-h-[48vh]",
                    loaded ? "opacity-100" : "opacity-0"
                  )}
                />
              </div>

              {/* Metadata grid */}
              {data.meta && data.meta.length > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                  {data.meta.map((m) => (
                    <div key={m.label} className="min-w-0">
                      <dt className="text-[10px] font-semibold uppercase tracking-wider text-dmk-text-muted">
                        {m.label}
                      </dt>
                      <dd
                        className={cn(
                          "mt-0.5 truncate text-[12.5px] text-dmk-text-primary",
                          m.valueCls
                        )}
                        title={m.value}
                      >
                        {m.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <DialogFooter className="border-t border-dmk-border-subtle px-5 py-3.5">
              <a href={data.url} download={data.fileName} className="sm:mr-auto">
                <Button
                  variant="outline"
                  className="h-10 gap-2 border-dmk-border-subtle bg-dmk-input-well px-4 text-[12.5px] text-dmk-text-secondary hover:bg-dmk-hover hover:text-dmk-text-primary"
                  aria-label={t("exp.downloadReceipt")}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {t("exp.downloadReceipt")}
                </Button>
              </a>
              <Button
                onClick={onClose}
                className="h-10 bg-dmk-yellow px-5 text-[12.5px] font-semibold text-dmk-bg-primary hover:brightness-110"
                aria-label={t("cmn.close")}
              >
                {t("cmn.close")}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
