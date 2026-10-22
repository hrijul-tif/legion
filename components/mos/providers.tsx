"use client";

import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
      <NuqsAdapter>
        <TooltipProvider delayDuration={250}>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </NuqsAdapter>
    </ThemeProvider>
  );
}
