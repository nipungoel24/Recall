'use client';

import { motion } from 'framer-motion';
import { FileQuestion, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
  hasTranscripts?: boolean;
}

export function EmptyStateSummary({
  onGenerate,
  hasModel,
  isGenerating = false,
  hasTranscripts = true,
}: EmptyStateSummaryProps) {
  const isGenerateDisabled = !hasModel || !hasTranscripts || isGenerating;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full p-8 text-center text-foreground"
    >
      <div className="rounded-full bg-muted/60 p-4 mb-4">
        <FileQuestion className="w-10 h-10 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1.5">
        No Summary Generated Yet
      </h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-md">
        Generate an AI-powered summary of your meeting transcript to capture key discussion points, decisions, and action items.
      </p>

      {!hasTranscripts && (
        <div className="rounded-md border border-border bg-muted/30 px-3.5 py-2 mb-5 max-w-md">
          <p className="text-xs text-muted-foreground">
            No transcript is available for this meeting yet. Record audio or wait for live transcription before generating a summary.
          </p>
        </div>
      )}

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <Button
                onClick={onGenerate}
                disabled={isGenerateDisabled}
                className="gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {isGenerating ? 'Generating...' : 'Generate Summary'}
              </Button>
            </div>
          </TooltipTrigger>
          {!hasModel ? (
            <TooltipContent>
              <p>Please select a model in Settings first</p>
            </TooltipContent>
          ) : !hasTranscripts ? (
            <TooltipContent>
              <p>Cannot generate summary without a transcript</p>
            </TooltipContent>
          ) : null}
        </Tooltip>
      </TooltipProvider>

      {!hasModel && (
        <p className="text-xs text-destructive mt-3">
          Please select a model in Settings first
        </p>
      )}
    </motion.div>
  );
}
