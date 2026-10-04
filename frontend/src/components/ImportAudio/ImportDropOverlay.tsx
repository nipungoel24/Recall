import React from 'react';
import { Upload } from 'lucide-react';
import { getAudioFormatsDisplayList } from '@/constants/audioFormats';

interface ImportDropOverlayProps {
  visible: boolean;
}

export function ImportDropOverlay({ visible }: ImportDropOverlayProps) {
  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-scrim/60 backdrop-blur-sm
                 flex items-center justify-center pointer-events-none"
    >
      <div className="border-2 border-dashed border-primary/50 rounded-lg
                      p-12 text-center bg-popover shadow-lg">
        <Upload className="h-16 w-16 text-primary mx-auto mb-4" />
        <p className="text-xl font-medium text-popover-foreground">Drop audio file to import</p>
        <p className="text-sm text-muted-foreground mt-2">{getAudioFormatsDisplayList()}</p>
      </div>
    </div>
  );
}
