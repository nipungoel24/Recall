'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface RenameContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextId: string;
  initialName: string;
  initialDescription?: string;
  onSubmit: (name: string, description?: string) => Promise<boolean>;
}

export function RenameContextDialog({
  open,
  onOpenChange,
  contextId,
  initialName,
  initialDescription = '',
  onSubmit,
}: RenameContextDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setDescription(initialDescription);
    }
  }, [open, initialName, initialDescription]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Context name must not be empty');
      return;
    }

    setIsSubmitting(true);
    try {
      const ok = await onSubmit(trimmedName, description.trim() || undefined);
      if (ok) {
            toast.success(`Context renamed to "${trimmedName}"`);
        onOpenChange(false);
      }
    } catch (err) {
      console.error('Failed to rename context:', err);
      toast.error('Failed to rename context', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle>Rename Context</DialogTitle>
          <DialogDescription className="text-gray-500">
            Update the name or description for {contextId ? 'this Context' : ''}. Meetings stay put.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="rename-context-name">Name</Label>
            <Input
              id="rename-context-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rename-context-description">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </Label>
            <Textarea
              id="rename-context-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="blue" onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <Pencil />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
