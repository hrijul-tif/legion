"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Radio, SearchX, Terminal } from "lucide-react";
import { parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { PageHeader } from "@/components/mos/page-header";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadCatalog, searchCatalog } from "@/lib/catalog/load";
import type { Catalog } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { CatalogDetail } from "./catalog-detail";

const TABS = ["commands", "parameters", "enums"] as const;
type Tab = (typeof TABS)[number];
type Mission = Catalog["mission"];

const parsers = {
  mission: parseAsStringLiteral(["FF", "JTYU"] as const).withDefault("FF"),
  tab: parseAsStringLiteral(TABS).withDefault("commands"),
  item: parseAsString,
  q: parseAsString.withDefault(""),
  sys: parseAsString,
};

const PAGE = 200;

type LoadState = { mission: Mission } & ({ status: "ready"; catalog: Catalog } | { status: "missing" } | { status: "error"; message: string });

function useCatalog(mission: Mission): LoadState | null {
  const [state, setState] = useState<LoadState | null>(null);
  useEffect(() => {
    let live = true;
    loadCatalog(mission).then(
      (catalog) => live && setState({ mission, status: "ready", catalog }),
      (err: unknown) => {
        if (!live) return;
        const message = err instanceof Error ? err.message : String(err);
        setState(message.includes("HTTP 404") ? { mission, status: "missing" } : { mission, status: "error", message });
      },
    );
    return () => {
      live = false;
    };
  }, [mission]);
  return state && state.mission === mission ? state : null;
}

function useMissionAvailable(mission: Mission): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/catalog/${mission.toLowerCase()}.json`, { method: "HEAD" }).then(
      (r) => live && setOk(r.ok),
      () => live && setOk(false),
    );
    return () => {
      live = false;
    };
  }, [mission]);
  return ok;
}

interface ListItem {
  key: string;
  name: string;
  secondary: string;
  facet: string;
}

function enumEntries(catalog: Catalog, q: string): ListItem[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out: ListItem[] = [];
  const add = (ns: "comm" | "param", map: Catalog["enums"]) => {
    for (const [name, e] of Object.entries(map)) {
      if (tokens.length) {
        const hay = `${name} ${e.members.map((m) => `${m.name} ${m.value}`).join(" ")}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) continue;
      }
      out.push({ key: `${ns}:${name}`, name, secondary: `${ns}.${name} · ${e.members.length} members`, facet: ns });
    }
  };
  add("comm", catalog.enums);
  add("param", catalog.paramEnums);
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const FACET_LABEL: Record<string, string> = { comm: "Commands (comm)", param: "Parameters (param)" };

function Skeletons() {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[200px_340px_minmax(0,1fr)] gap-px">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 p-4">
          {Array.from({ length: 10 }, (_, j) => (
            <Skeleton key={j} className="h-6 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CatalogBrowser() {
  const [params, setParams] = useQueryStates(parsers);
  const { mission, tab, item, q, sys } = params;
  const state = useCatalog(mission);
  const jtyu = useMissionAvailable("JTYU");
  const dq = useDeferredValue(q);
  const searchRef = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState({ sig: "", n: PAGE });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const catalog = state?.status === "ready" ? state.catalog : null;

  // Everything matching the query (before the subsystem facet), so facet counts stay meaningful.
  const base = useMemo<ListItem[]>(() => {
    if (!catalog) return [];
    if (tab === "enums") return enumEntries(catalog, dq);
    const kind = tab === "commands" ? "command" : "parameter";
    return searchCatalog(catalog, dq, { kind, limit: Infinity }).map((r) => ({
      key: r.name,
      name: r.name,
      secondary: r.q,
      facet: r.subsystem,
    }));
  }, [catalog, tab, dq]);

  const facets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of base) counts.set(r.facet, (counts.get(r.facet) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (tab === "enums" ? (a[0] < b[0] ? -1 : 1) : b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
  }, [base, tab]);

  const results = useMemo(() => (sys ? base.filter((r) => r.facet === sys) : base), [base, sys]);
  const sig = `${mission}|${tab}|${dq}|${sys ?? ""}`;
  const visibleCount = more.sig === sig ? more.n : PAGE;
  const visible = results.slice(0, visibleCount);

  const counts = useMemo(() => {
    if (!catalog) return null;
    return {
      commands: Object.keys(catalog.commands).length,
      parameters: Object.keys(catalog.parameters).length,
      enums: Object.keys(catalog.enums).length + Object.keys(catalog.paramEnums).length,
    };
  }, [catalog]);

  const selectedExists = !!catalog && !!item && (tab === "commands" ? !!catalog.commands[item] : tab === "parameters" ? !!catalog.parameters[item] : item.includes(":") && !!(item.startsWith("param:") ? catalog.paramEnums : catalog.enums)[item.slice(item.indexOf(":") + 1)]);

  const select = (key: string | null, replace = false) => void setParams({ item: key }, { history: replace ? "replace" : "push" });

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = visible.findIndex((r) => r.key === item);
    const next = visible[Math.min(visible.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next) return;
    select(next.key, true);
    requestAnimationFrame(() => document.getElementById(`cat-${CSS.escape(next.key)}`)?.focus());
  };

  const description = catalog ? (
    <span>
      <span className="font-mono text-xs">{catalog.source}</span> · generated {new Date(catalog.generatedAt).toISOString().slice(0, 10)} · {counts?.commands.toLocaleString()} commands, {counts?.parameters.toLocaleString()} parameters
    </span>
  ) : (
    "Every telecommand and telemetry parameter the procedures can use."
  );

  return (
    <div className="flex h-dvh flex-col">
      <PageHeader
        title="TM/TC catalog"
        description={description}
        actions={
          <div role="radiogroup" aria-label="Mission" className="inline-flex h-8 items-center rounded-lg border p-0.5 text-xs">
            {(["FF", ...(jtyu || mission === "JTYU" ? (["JTYU"] as const) : [])] as Mission[]).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mission === m}
                onClick={() => void setParams({ mission: m, item: null, sys: null, q: null }, { history: "push" })}
                className={cn("h-full rounded-md px-3 font-medium transition-colors", mission === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {m}
              </button>
            ))}
          </div>
        }
      />

      {!state ? (
        <Skeletons />
      ) : state.status !== "ready" ? (
        <div className="grid flex-1 place-items-center p-8">
          <div className="max-w-md space-y-2 text-center">
            <BookOpen className="mx-auto size-8 text-muted-foreground" />
            <p className="font-medium">{state.status === "missing" ? `The ${mission} catalog has not been generated yet` : "The catalog could not be loaded"}</p>
            <p className="text-sm text-muted-foreground">
              {state.status === "missing" ? (
                <>
                  Run <code className="rounded bg-muted px-1 font-mono text-xs">npm run catalog:build</code> to produce <code className="rounded bg-muted px-1 font-mono text-xs">public/catalog/{mission.toLowerCase()}.json</code>.
                </>
              ) : (
                state.message
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[210px_340px_minmax(0,1fr)]">
          {/* facets */}
          <nav aria-label="Subsystems" className="hidden min-h-0 overflow-y-auto border-r p-2 xl:block">
            <p className="px-2 pt-1 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{tab === "enums" ? "Namespace" : "Subsystem"}</p>
            <button type="button" onClick={() => void setParams({ sys: null })} aria-current={!sys} className={cn("flex w-full items-center justify-between rounded-md px-2 py-1 text-sm", !sys ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
              All <span className="tabular text-xs text-muted-foreground">{base.length.toLocaleString()}</span>
            </button>
            {facets.map(([f, n]) => (
              <button
                key={f}
                type="button"
                onClick={() => void setParams({ sys: sys === f ? null : f })}
                aria-current={sys === f}
                className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-sm", sys === f ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}
              >
                <span className="truncate">{FACET_LABEL[f] ?? f}</span>
                <span className="tabular text-xs text-muted-foreground">{n.toLocaleString()}</span>
              </button>
            ))}
          </nav>

          {/* list */}
          <div className={cn("flex min-h-0 flex-col border-r", item && selectedExists && "max-md:hidden")}>
            <div className="space-y-2 border-b p-3">
              <Tabs value={tab} onValueChange={(v) => void setParams({ tab: v as Tab, item: null, sys: null }, { history: "push" })}>
                <TabsList className="w-full">
                  {TABS.map((t) => (
                    <TabsTrigger key={t} value={t} className="capitalize">
                      {t}
                      <span className="tabular text-[11px] text-muted-foreground">{counts?.[t].toLocaleString()}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="relative">
                <Input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => void setParams({ q: e.target.value || null }, { history: "replace" })}
                  placeholder={tab === "enums" ? "Search enums and members…" : "Search names, paths, descriptions…"}
                  aria-label="Search the catalog"
                  className="h-8 pr-8"
                />
                <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-muted px-1 font-mono text-[10px] text-muted-foreground">/</kbd>
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {results.length.toLocaleString()} {results.length === 1 ? "result" : "results"}
                {sys && ` in ${FACET_LABEL[sys] ?? sys}`}
              </p>
            </div>

            {results.length === 0 ? (
              <div className="grid flex-1 place-items-center p-6 text-center">
                <div className="space-y-1">
                  <SearchX className="mx-auto size-6 text-muted-foreground" />
                  <p className="text-sm font-medium">Nothing matches</p>
                  <p className="text-xs text-muted-foreground">Try a shorter name, or part of the description.</p>
                </div>
              </div>
            ) : (
              <div role="listbox" aria-label={tab} onKeyDown={onListKey} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {visible.map((r) => {
                  const on = r.key === item;
                  return (
                    <button
                      key={r.key}
                      id={`cat-${r.key}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      tabIndex={on || (!selectedExists && r === visible[0]) ? 0 : -1}
                      onClick={() => select(r.key)}
                      className={cn("flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50", on ? "bg-muted" : "hover:bg-muted/50")}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        {tab === "commands" ? <Terminal className="size-3 shrink-0 text-muted-foreground" /> : tab === "parameters" ? <Radio className="size-3 shrink-0 text-muted-foreground" /> : null}
                        <span className="truncate font-mono text-[13px] font-medium">{r.name}</span>
                      </span>
                      <span className="w-full truncate font-mono text-[11px] text-muted-foreground">{r.secondary}</span>
                    </button>
                  );
                })}
                {results.length > visible.length && (
                  <button type="button" onClick={() => setMore({ sig, n: visibleCount + PAGE })} className="my-1 w-full rounded-lg border border-dashed py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground">
                    Show {Math.min(PAGE, results.length - visible.length)} more ({(results.length - visible.length).toLocaleString()} hidden)
                  </button>
                )}
              </div>
            )}
          </div>

          {/* detail */}
          <div className={cn("min-h-0 overflow-y-auto", !(item && selectedExists) && "max-md:hidden")}>
            {catalog && item && selectedExists ? (
              <div className="p-5 lg:p-6">
                <button type="button" onClick={() => select(null)} className="mb-3 text-xs text-muted-foreground hover:text-foreground md:hidden">
                  ← Back to the list
                </button>
                <CatalogDetail catalog={catalog} tab={tab} item={item} />
              </div>
            ) : (
              <div className="grid h-full place-items-center p-8 text-center">
                <div className="max-w-xs space-y-2">
                  <BookOpen className="mx-auto size-8 text-muted-foreground" />
                  <p className="font-medium">{item ? "That item is not in this catalog" : "Pick something to inspect"}</p>
                  <p className="text-sm text-muted-foreground">
                    Arguments, enum values and a ready-to-paste usage snippet appear here. Use <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">↑</kbd> <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">↓</kbd> to move through the list.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
