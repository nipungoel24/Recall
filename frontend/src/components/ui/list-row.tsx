'use client';

import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * ListRow — the shared row primitive for navigation and list-oriented UI.
 *
 * Intended consumers: sidebar navigation, the Meetings library, meeting rows,
 * templates, contexts. A1 introduces it; migrating existing screens is
 * deliberately deferred so no behaviour changes alongside the primitive.
 *
 * State model:
 *   rest     transparent
 *   hover    `bg-muted` — a neutral surface, never a saturated hue
 *   active   `bg-muted` + a 2px `bg-primary` indicator, absolutely positioned
 *            so selecting a row can never shift layout
 *   focus    `ring-ring` with `ring-offset-background`, so the ring is correct
 *            in both light and dark themes
 *
 * Accessibility: renders the correct semantic element per usage, exposes
 * `aria-current` when active, `aria-disabled` when disabled, and supplies an
 * accessible name plus a tooltip whenever it renders icon-only.
 */

const ROW_BASE =
  'group/row relative flex w-full items-center rounded-md text-sm ' +
  'transition-colors duration-100 motion-reduce:transition-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 ring-offset-background ' +
  'disabled:pointer-events-none disabled:opacity-50 aria-disabled:opacity-50';

const ROW_IDLE = 'text-foreground hover:bg-muted';
const ROW_ACTIVE = 'bg-muted text-foreground font-medium';

/** 2px marker: makes the current row unmistakable without a layout shift. */
const ROW_INDICATOR =
  'pointer-events-none absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-primary';

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /**
   * Which semantic element to render. `a` for navigation, `button` for
   * actions. The primitive does not assume every row is a link.
   */
  as?: 'button' | 'a';
  /** Required when `as="a"`. Dropped when the row is disabled. */
  href?: string;
  /** Forwarded only when `as="button"`; defaults to `type="button"`. */
  type?: 'button' | 'submit' | 'reset';
  name?: string;
  /** Marks the row as the current location. Sets `aria-current="page"`. */
  active?: boolean;
  disabled?: boolean;
  /** Icon-only presentation. Hides the label and adds a tooltip. */
  collapsed?: boolean;
  icon?: LucideIcon;
  /** Visible label, and the accessible name when collapsed. */
  label: string;
  /** Small count/status affordance shown before any trailing content. */
  badge?: React.ReactNode;
  /** Trailing content, e.g. row hover actions. */
  trailing?: React.ReactNode;
  /** Overrides children entirely; for rows that need custom inner content. */
  children?: React.ReactNode;
  /** Native tooltip text. Defaults to `label`. */
  tooltip?: string;
  tooltipSide?: React.ComponentProps<typeof TooltipContent>['side'];
}

const ListRow = React.forwardRef<HTMLElement, ListRowProps>(function ListRow(
  {
    as = 'button',
    href,
    active = false,
    disabled = false,
    collapsed = false,
    icon: Icon,
    label,
    badge,
    trailing,
    children,
    tooltip,
    tooltipSide = 'right',
    className,
    type,
    name,
    ...rest
  },
  ref,
) {
  const tone = active ? ROW_ACTIVE : ROW_IDLE;
  const sizing = collapsed
    ? 'h-9 w-9 shrink-0 justify-center'
    : 'h-9 min-w-0 gap-2.5 px-3';

  const content = (
    <>
      {active ? <span aria-hidden="true" className={ROW_INDICATOR} data-slot="list-row-indicator" /> : null}

      {Icon ? (
        <Icon
          className={cn('h-4 w-4 shrink-0', collapsed ? 'text-current' : 'text-muted-foreground')}
          aria-hidden="true"
        />
      ) : null}

      {collapsed ? null : (
        <>
          <span className={cn('min-w-0 flex-1 truncate', !children && 'text-left')}>{label}</span>
          {badge ? <span className="shrink-0">{badge}</span> : null}
          {trailing ? <span className="shrink-0">{trailing}</span> : null}
        </>
      )}

      {children}
    </>
  );

  const shared = {
    'data-slot': 'list-row',
    'data-active': active ? 'true' : undefined,
    'data-collapsed': collapsed ? 'true' : undefined,
    className: cn(ROW_BASE, sizing, tone, className),
    'aria-current': active ? ('page' as const) : undefined,
    'aria-disabled': disabled || undefined,
    'aria-label': collapsed ? label : undefined,
  };

  const element =
    as === 'a' ? (
      <a
        {...shared}
        {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={disabled ? undefined : href}
        aria-disabled={disabled || undefined}
        onClick={
          disabled
            ? (event) => event.preventDefault()
            : (rest.onClick as React.MouseEventHandler<HTMLAnchorElement> | undefined)
        }
      >
        {content}
      </a>
    ) : (
      <button
        {...shared}
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type ?? 'button'}
        name={name}
        disabled={disabled}
      >
        {content}
      </button>
    );

  // Collapsed rows render icon-only, so the tooltip carries the label. The
  // accessible name is already set via aria-label, so this is an enhancement
  // for pointer users rather than the only source of the name.
  if (!collapsed) return element;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{element}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
});

ListRow.displayName = 'ListRow';

export { ListRow };
