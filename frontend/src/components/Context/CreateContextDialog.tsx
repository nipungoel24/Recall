'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
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
import { ContextThreadDetail } from '@/types/context';
import { contextService } from '@/services/contextService';

interface CreateContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (context: ContextThreadDetail) => void;
}

export function CreateContextDialog({ open, onOpenChange, onCreated }: CreateContextDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Context name must not be empty');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await contextService.createContextThread(
        trimmedName,
        description.trim() || undefined,
      );
        toast.success(`Context "${created.name}" created`);
      reset();
      onOpenChange(false);
      onCreated?.(created);
    } catch (err) {
      console.error('Failed to create context:', err);
      toast.error('Failed to create context', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle>New Context</DialogTitle>
          <DialogDescription className="text-gray-500">
            Group related meetings so their decisions and next steps carry over.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="context-name">Name</Label>
            <Input
              id="context-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Project Phoenix"
              autoFocus
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="context-description">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </Label>
            <Textarea
              id="context-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this Context is about"
              rows={3}
              maxLength={2000}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="default" onClick={handleSubmit} disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? <Loader2 className="animate-spin" /> : <Plus />}
            Create Context
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
