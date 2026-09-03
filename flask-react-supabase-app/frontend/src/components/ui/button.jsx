import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-medium transition-all duration-300 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "bg-[color:var(--ex-shell-surface-strong)] text-white shadow-sm shadow-black/20 hover:bg-[color:var(--ex-shell-surface)] hover:scale-[1.02] active:scale-[0.98]",
      destructive: "bg-destructive text-destructive-foreground shadow-sm shadow-black/5 hover:bg-destructive/90",
      outline: "border border-input bg-background shadow-sm shadow-black/5 hover:bg-accent hover:text-accent-foreground",
      secondary: "bg-[color:var(--ex-shell-surface)] text-white border border-white/10 shadow-sm shadow-black/20 hover:bg-[color:var(--ex-shell-surface-strong)] hover:border-white/20",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      link: "text-primary underline-offset-4 hover:underline",
    },
    size: {
      default: "h-11 px-6 py-2",
      sm: "h-8 rounded-lg px-3 text-xs",
      lg: "h-12 rounded-full px-8 text-base",
      icon: "h-9 w-9",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };