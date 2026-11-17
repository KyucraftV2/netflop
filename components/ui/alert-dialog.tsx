"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  title,
  description,
  children,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content> & {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-tile bg-surface p-6 shadow-pop",
          className,
        )}
        {...props}
      >
        <AlertDialogPrimitive.Title className="text-lg font-bold">
          {title}
        </AlertDialogPrimitive.Title>
        {description ? (
          <AlertDialogPrimitive.Description className="mt-2 text-sm text-muted">
            {description}
          </AlertDialogPrimitive.Description>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-end gap-3">{children}</div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "secondary" }), className)}
      {...props}
    />
  );
}

export function AlertDialogAction({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant: "primary" }), className)}
      {...props}
    />
  );
}
