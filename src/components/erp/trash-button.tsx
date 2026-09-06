"use client";

// ═══════════════════════════════════════════════════════════════
// SHARED — TRASH BUTTON (move a record to the Deleted Data bin)
// Ghost icon button + confirm dialog. The onConfirm callback performs
// the DELETE; the bin snapshot is captured by the API before the row
// is deactivated, so the action is always reversible from the
// Deleted Data view.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function TrashButton({
  recordLabel,
  recordHint,
  onConfirm,
  className,
  confirmLabel = "Move to Deleted Data",
}: {
  recordLabel: string;
  /** One-line explanation shown under the title in the dialog. */
  recordHint?: string;
  onConfirm: () => Promise<void>;
  className?: string;
  confirmLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) setOpen(v);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={
            className ??
            "h-8 w-8 p-0 text-dmk-danger/80 hover:text-dmk-danger hover:bg-dmk-hover"
          }
          aria-label={`Move ${recordLabel} to Deleted Data`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="dmk-card border-dmk-border-medium">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-dmk-text-primary">
            Move “{recordLabel}” to Deleted Data?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-dmk-text-secondary">
            {recordHint ??
              "The record is snapshotted into the Deleted Data folder first, so you can restore it anytime from Deleted Data (Intelligence). Historical documents are never touched."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-9 bg-dmk-input-well border-dmk-border-subtle text-dmk-text-secondary hover:bg-dmk-hover">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-9 bg-dmk-danger text-white hover:bg-dmk-danger/90"
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
