import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmationModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  text: string;
  isOpen: boolean;
  title?: string;
  confirmLabel?: string;
}

/**
 * Destructive-action confirmation built on the Radix `Dialog` primitive so it
 * inherits real dialog semantics (`role="alertdialog"`, `aria-modal`), focus
 * trapping, Escape-to-dismiss, focus restoration, and semantic design tokens
 * (light + dark) instead of hand-rolled hardcoded colors.
 */
export function ConfirmationModal({
  onConfirm,
  onCancel,
  text,
  isOpen,
  title = 'Confirm Delete',
  confirmLabel = 'Delete',
}: ConfirmationModalProps) {
  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md" role="alertdialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-section-title text-foreground">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-destructive" aria-hidden="true" />
            <span>{title}</span>
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
