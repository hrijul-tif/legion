"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label,
  children,
  variant = "ghost",
  size = "icon-xs",
  className,
}: {
  text: string;
  label: string;
  children?: React.ReactNode;
  variant?: "ghost" | "outline" | "secondary" | "default";
  size?: "icon-xs" | "icon-sm" | "sm" | "xs";
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error("Could not copy to the clipboard.");
    }
  };
  return (
    <Button type="button" variant={variant} size={size} aria-label={label} title={label} onClick={copy} className={cn(className)}>
      {done ? <Check className="text-tone-success" /> : <Copy />}
      {children}
    </Button>
  );
}
