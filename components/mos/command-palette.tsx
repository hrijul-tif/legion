"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Activity, BookOpen, FileCode2, GitBranch, Inbox, Moon, Search, Shield, Sun } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { createClient } from "@/lib/supabase/client";
import { StateBadge } from "./state-badge";
import type { SnapshotState } from "@/lib/lifecycle";

interface ProcHit {
  id: string;
  name: string;
  folder: string;
  active_number: number | null;
}
interface SnapHit {
  id: string;
  procedure_name: string;
  number: number;
  state: SnapshotState;
  code_sha256: string | null;
}

const PAGES = [
  { href: "/", label: "My queue", icon: Inbox },
  { href: "/procedures", label: "Procedures", icon: FileCode2 },
  { href: "/snapshots", label: "Snapshots", icon: GitBranch },
  { href: "/catalog", label: "TM/TC catalog", icon: BookOpen },
  { href: "/audit", label: "Audit log", icon: Activity },
  { href: "/admin", label: "Admin", icon: Shield },
];

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [procs, setProcs] = useState<ProcHit[]>([]);
  const [snaps, setSnaps] = useState<SnapHit[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mos:open-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mos:open-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = ++seq.current;
    const term = query.trim();
    const t = setTimeout(async () => {
      const supabase = createClient();
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const procQ = supabase.from("procedure_overview").select("id, name, folder, active_number").order("last_activity_at", { ascending: false }).limit(8);
      const hashLike = /^[0-9a-f]{4,64}$/i.test(term);
      const numMatch = term.match(/#(\d+)/);
      let snapQ = supabase.from("snapshot_list").select("id, procedure_name, number, state, code_sha256").order("state_changed_at", { ascending: false }).limit(8);
      if (hashLike) snapQ = snapQ.ilike("code_sha256", `${term.toLowerCase()}%`);
      else if (term) snapQ = snapQ.ilike("procedure_name", `%${term.replace(/#\d+/, "").trim().replace(/[%_]/g, "")}%`);
      if (numMatch) snapQ = snapQ.eq("number", Number(numMatch[1]));
      const [p, s] = await Promise.all([term ? procQ.or(`name.ilike.${like},folder.ilike.${like}`) : procQ, snapQ]);
      if (id !== seq.current) return;
      setProcs((p.data as ProcHit[]) ?? []);
      setSnaps((s.data as SnapHit[]) ?? []);
    }, 120);
    return () => clearTimeout(t);
  }, [query, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search MOS" className="sm:max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Procedures, snapshots (#7, hash), pages…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[420px]">
          <CommandEmpty>No matches.</CommandEmpty>
          {procs.length > 0 && (
            <CommandGroup heading="Procedures">
              {procs.map((p) => (
                <CommandItem key={p.id} value={`proc-${p.id}`} onSelect={() => go(`/procedures/${p.id}`)}>
                  <FileCode2 />
                  <span className="truncate font-mono text-xs">{p.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {p.active_number ? `PROD #${p.active_number}` : "not in PROD"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {snaps.length > 0 && (
            <CommandGroup heading="Snapshots">
              {snaps.map((s) => (
                <CommandItem key={s.id} value={`snap-${s.id}`} onSelect={() => go(`/snapshots/${s.id}`)}>
                  <GitBranch />
                  <span className="font-mono text-xs font-semibold">#{s.number}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{s.procedure_name}</span>
                  <StateBadge state={s.state} size="xs" short showCode={false} className="ml-auto" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {PAGES.filter((p) => !query || p.label.toLowerCase().includes(query.toLowerCase())).map((p) => (
              <CommandItem key={p.href} value={`page-${p.href}`} onSelect={() => go(p.href)}>
                <p.icon /> {p.label}
              </CommandItem>
            ))}
            {query.trim().length > 1 && (
              <CommandItem value="catalog-search" onSelect={() => go(`/catalog?q=${encodeURIComponent(query.trim())}`)}>
                <Search /> Search the TM/TC catalog for “{query.trim()}”
              </CommandItem>
            )}
            <CommandItem
              value="toggle-theme"
              onSelect={() => {
                setTheme(resolvedTheme === "dark" ? "light" : "dark");
                setOpen(false);
              }}
            >
              {resolvedTheme === "dark" ? <Sun /> : <Moon />} Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
