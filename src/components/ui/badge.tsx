import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium leading-5",
  {
    variants: {
      variant: {
        neutral: "border-navy-600 bg-navy-800/70 text-ink-dim",
        cyan: "border-cyan/40 bg-cyan/10 text-cyan-soft",
        gold: "border-gold/40 bg-gold/10 text-gold",
        ok: "border-ok/40 bg-ok/10 text-ok",
        bad: "border-bad/40 bg-bad/10 text-bad",
        pending: "border-pending/40 bg-pending/10 text-pending",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
