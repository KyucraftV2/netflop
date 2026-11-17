import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-card px-4 text-sm font-semibold whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white hover:bg-accent-hover",
        light: "bg-white text-black hover:bg-white/85",
        secondary: "bg-surface-2 text-fg hover:bg-surface-3",
        ghost: "text-fg hover:bg-white/10",
        outline: "border border-white/25 text-fg hover:bg-white/10",
        danger: "bg-danger/15 text-danger hover:bg-danger/25",
      },
      size: {
        sm: "min-h-9 px-3 text-xs",
        md: "",
        lg: "min-h-12 px-6 text-base",
        icon: "size-11 min-h-11 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
