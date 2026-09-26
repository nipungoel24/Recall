import React from "react";
import { Info as InfoIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { VisuallyHidden } from "./ui/visually-hidden";
import { About } from "./About";

interface InfoProps {
    isCollapsed: boolean;
}

const Info = React.forwardRef<HTMLButtonElement, InfoProps>(({ isCollapsed }, ref) => {
  return (
    <Dialog aria-describedby={undefined}>
      <DialogTrigger asChild>
        <button
          ref={ref}
          type="button"
          className={`flex items-center justify-center mb-2 cursor-pointer border-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isCollapsed
              ? "bg-transparent p-2 text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground rounded-lg"
              : "w-full px-3 py-1.5 mt-1 text-sm font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg shadow-sm"
          }`}
          aria-label="About Recall"
          title="About Recall"
        >
          <InfoIcon className={`${isCollapsed ? "w-5 h-5" : "w-4 h-4"}`} aria-hidden="true" />
          {!isCollapsed && <span className="ml-2 text-sm">About</span>}
        </button>
      </DialogTrigger>
      <DialogContent>
        <VisuallyHidden>
          <DialogTitle>About Recall</DialogTitle>
        </VisuallyHidden>
        <About />
      </DialogContent>
    </Dialog>
  );
});

Info.displayName = "About";

export default Info; 