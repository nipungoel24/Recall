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
          // Collapsed: a square icon button for the rail.
          // Expanded: a compact utility row that sits beside Settings in the
          // footer, matching its height so the pair reads as one control group.
          className={
            isCollapsed
              ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              : "flex min-w-0 flex-1 items-center gap-2 h-8 rounded-md px-2.5 text-sm text-foreground transition-colors duration-100 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          }
          aria-label="About Recall"
          title="About Recall"
        >
          <InfoIcon className={isCollapsed ? "h-4 w-4" : "h-4 w-4 shrink-0"} aria-hidden="true" />
          {!isCollapsed && <span className="truncate">About</span>}
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