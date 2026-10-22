"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { motion } from "motion/react";
import { Activity, BookOpen, FileCode2, GitBranch, Inbox, PanelLeftClose, PanelLeftOpen, Search, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { MosLogo } from "./logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const NAV = [
  { href: "/", label: "My queue", icon: Inbox, exact: true },
  { href: "/procedures", label: "Procedures", icon: FileCode2 },
  { href: "/snapshots", label: "Snapshots", icon: GitBranch },
  { href: "/catalog", label: "TM/TC catalog", icon: BookOpen },
  { href: "/audit", label: "Audit log", icon: Activity },
  { href: "/admin", label: "Admin", icon: Shield },
];

export function AppSidebar({ userSlot }: { userSlot: React.ReactNode }) {
  const pathname = usePathname();
  const inIde = pathname.endsWith("/edit");
  const [collapsed, setCollapsed] = useState(inIde);
  // Auto-collapse when entering the editor and expand when leaving it (state adjusted during render).
  const [wasInIde, setWasInIde] = useState(inIde);
  if (wasInIde !== inIde) {
    setWasInIde(inIde);
    setCollapsed(inIde);
  }

  return (
    <motion.aside
      animate={{ width: collapsed ? 60 : 236 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="relative z-20 flex h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground"
    >
      <div className={cn("flex h-14 items-center px-3", collapsed ? "justify-center" : "justify-between")}>
        <Link href="/" className="overflow-hidden">
          {collapsed ? <MosLogo className="[&>span:last-child]:hidden" /> : <MosLogo />}
        </Link>
        {!collapsed && (
          <button onClick={() => setCollapsed(true)} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Collapse sidebar">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>

      <div className="px-2.5 pb-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("mos:open-palette"))}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg border bg-background/40 px-2 text-sm text-muted-foreground transition hover:border-primary/30 hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <Search className="size-3.5" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5">
        {NAV.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          const link = (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors",
                active ? "text-sidebar-accent-foreground" : "text-muted-foreground hover:text-foreground",
                collapsed && "justify-center px-0",
              )}
            >
              {active && (
                <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-sidebar-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
              )}
              <item.icon className="relative size-4 shrink-0" />
              {!collapsed && <span className="relative truncate">{item.label}</span>}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className={cn("border-t p-2.5", collapsed && "flex flex-col items-center gap-2")}>
        {collapsed && (
          <button onClick={() => setCollapsed(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground" aria-label="Expand sidebar">
            <PanelLeftOpen className="size-4" />
          </button>
        )}
        <div data-collapsed={collapsed} className="group/user">{userSlot}</div>
      </div>
    </motion.aside>
  );
}
