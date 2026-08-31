import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const wellClassName = cn(
  "group/empty-well flex w-full cursor-pointer flex-col items-center justify-center border-2 border-dashed text-center transition-colors",
  "relative min-h-[7.5rem] overflow-hidden rounded-2xl border-foreground/15 bg-foreground/[0.03] px-5 py-6",
  "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "dark:border-foreground/20 dark:bg-foreground/[0.035] dark:hover:border-primary/40",
  "sm:min-h-[8rem] sm:py-7",
  "disabled:cursor-not-allowed disabled:opacity-50"
);

type SharedProps = {
  icon: ReactNode;
  /** Short action label, e.g. "Add files". */
  title: string;
  /** One concise line under the title. */
  description: string;
  className?: string;
};

type ButtonProps = SharedProps &
  Omit<ComponentProps<"button">, "children" | "title"> & {
    href?: undefined;
  };

type LinkProps = SharedProps & {
  href: string;
};

function WellBody({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <>
      <span className="relative z-[2] flex items-center gap-2.5">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border/60 bg-card/35 text-foreground shadow-sm backdrop-blur-sm transition-[background-color,box-shadow] group-hover/empty-well:bg-card/55"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          {title}
        </span>
      </span>
      <p className="relative z-[2] mt-2 max-w-sm text-xs text-muted-foreground">
        {description}
      </p>
    </>
  );
}

/**
 * Wide, short empty-state well for project content tabs. Echoes the
 * authed-home featured file dropzone chrome (`rounded-2xl`, dashed
 * border, ~8rem tall) with a preceding icon + tagline + one-line
 * description instead of the WebGL backdrop.
 */
export function ProjectTabEmptyWell(props: ButtonProps | LinkProps) {
  const { icon, title, description, className } = props;
  const body = (
    <WellBody icon={icon} title={title} description={description} />
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <Link href={props.href} className={cn(wellClassName, className)}>
        {body}
      </Link>
    );
  }

  const {
    icon: _icon,
    title: _title,
    description: _description,
    className: _className,
    href: _href,
    type = "button",
    ...domProps
  } = props as ButtonProps;

  return (
    <button type={type} className={cn(wellClassName, className)} {...domProps}>
      {body}
    </button>
  );
}
