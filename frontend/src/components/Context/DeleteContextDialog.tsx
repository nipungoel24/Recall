'use client';

import { useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface DeleteContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  meetingCount: number;
  onConfirm: () => Promise<boolean>;
}

export function DeleteContextDialog({
  open,
  onOpenChange,
  contextName,
  meetingCount,
  onConfirm,
}: DeleteContextDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      const ok = await onConfirm();
      if (ok) {
            onOpenChange(false);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle>Delete Context</DialogTitle>
          <DialogDescription className="text-gray-500">
            Delete &quot;{contextName}&quot;?
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-gray-600">
          This removes the Context and its saved knowledge
          {meetingCount > 0
            ? `, and unlinks ${meetingCount} meeting${meetingCount === 1 ? '' : 's'}`
            : ''}
          . Your meetings and transcripts are never deleted.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete Context
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
