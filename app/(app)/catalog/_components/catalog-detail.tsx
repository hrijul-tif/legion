"use client";

import { Fragment, useState } from "react";
import { ChevronRight, Radio, Terminal } from "lucide-react";
import type { Catalog, CatalogEnum } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { commandSnippet, parameterSnippet } from "./snippets";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        {hint && <span className="font-normal tracking-normal normal-case">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]", className)}>{children}</code>;
}

function EnumMembers({ ns, name, e }: { ns: "comm" | "param"; name: string; e: CatalogEnum | undefined }) {
  if (!e) return <p className="text-xs text-muted-foreground">Enum {name} is not in this catalog.</p>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-xs">
        <tbody className="divide-y">
          {e.members.map((m) => (
            <tr key={m.name} className="group hover:bg-muted/40">
              <td className="px-2.5 py-1 font-mono">
                {ns}.{name}.<span className="text-foreground">{m.name}</span>
              </td>
              <td className="px-2.5 py-1 text-muted-foreground">{String(m.value)}</td>
              <td className="w-8 px-1 py-0.5 text-right opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <CopyButton text={`${ns}.${name}.${m.name}`} label={`Copy ${m.name}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Snippet({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/30">
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-all">{code}</pre>
      <div className="flex items-center justify-between border-t bg-muted/40 px-2 py-1.5">
        <span className="text-[11px] text-muted-foreground">Required arguments only, with placeholder values</span>
        <CopyButton text={code} label="Copy usage snippet" variant="outline" size="xs">
          Copy usage snippet
        </CopyButton>
      </div>
    </div>
  );
}

function Header({ icon, kind, name, q, subsystem, importLine, extra }: { icon: React.ReactNode; kind: string; name: string; q?: string; subsystem?: string; importLine: string; extra?: React.ReactNode }) {
  return (
    <header className="space-y-2 border-b pb-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium [&_svg]:size-3">
          {icon}
          {kind}
        </span>
        {subsystem && <span className="rounded-full border px-2 py-0.5 font-medium">{subsystem}</span>}
        {extra}
      </div>
      <div className="flex items-center gap-1.5">
        <h2 className="min-w-0 truncate font-mono text-lg font-semibold tracking-tight" title={name}>
          {name}
        </h2>
        <CopyButton text={name} label="Copy class name" />
      </div>
      <p className="font-mono text-xs text-muted-foreground">{importLine}</p>
      {q && (
        <div className="flex items-center gap-1.5">
          <Mono>{q}</Mono>
          <CopyButton text={q} label="Copy qualified name" />
        </div>
      )}
    </header>
  );
}

function CommandDetail({ catalog, name }: { catalog: Catalog; name: string }) {
  const cmd = catalog.commands[name];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!cmd) return null;
  const fixed = Object.entries(cmd.fixed);
  return (
    <div className="space-y-6">
      <Header icon={<Terminal />} kind="Command" name={name} q={cmd.q} subsystem={cmd.subsystem} importLine={`comm.${name}  ·  import framework.${catalog.mission.toLowerCase()}.commands as comm`} />
      {cmd.description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{cmd.description}</p>}

      <Section title="Usage">
        <Snippet code={commandSnippet(catalog, name)} />
      </Section>

      <Section title="Arguments" hint={cmd.args.length ? `${cmd.args.length} you can set` : undefined}>
        {cmd.args.length === 0 ? (
          <p className="text-sm text-muted-foreground">This command takes no arguments.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Name</th>
                  <th className="px-2.5 py-1.5 font-medium">Type</th>
                  <th className="px-2.5 py-1.5 font-medium">Required</th>
                  <th className="px-2.5 py-1.5 font-medium">Default</th>
                  <th className="hidden px-2.5 py-1.5 font-medium lg:table-cell">Wire name</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cmd.args.map((a) => {
                  const e = a.enum ? catalog.enums[a.enum] : undefined;
                  const expanded = !!open[a.name];
                  return (
                    <Fragment key={a.name}>
                      <tr className="align-top hover:bg-muted/30">
                        <td className="px-2.5 py-1.5 font-mono text-[12px] font-medium">{a.name}</td>
                        <td className="px-2.5 py-1.5">
                          {a.type === "enum" && a.enum ? (
                            <button type="button" onClick={() => setOpen((o) => ({ ...o, [a.name]: !o[a.name] }))} aria-expanded={expanded} className="inline-flex items-center gap-1 rounded font-mono text-[12px] text-tone-info hover:underline">
                              <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
                              {a.enum}
                              <span className="text-muted-foreground">({e?.members.length ?? 0})</span>
                            </button>
                          ) : (
                            <span className="font-mono text-[12px]">{a.type}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5">{a.required ? <span className="font-medium text-foreground">required</span> : <span className="text-muted-foreground">optional</span>}</td>
                        <td className="max-w-40 truncate px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground" title={a.default == null ? undefined : String(a.default)}>
                          {a.default == null ? "—" : String(a.default)}
                        </td>
                        <td className="hidden px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground lg:table-cell">{a.wire === a.name ? "same" : a.wire}</td>
                      </tr>
                      {expanded && a.enum && (
                        <tr>
                          <td colSpan={5} className="bg-muted/20 p-2.5">
                            <EnumMembers ns="comm" name={a.enum} e={e} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {cmd.args.some((a) => a.description) && (
        <Section title="Argument notes">
          <dl className="space-y-1.5 text-xs">
            {cmd.args
              .filter((a) => a.description)
              .map((a) => (
                <div key={a.name} className="flex gap-3">
                  <dt className="w-44 shrink-0 truncate font-mono font-medium">{a.name}</dt>
                  <dd className="text-muted-foreground">{a.description}</dd>
                </div>
              ))}
          </dl>
        </Section>
      )}

      {fixed.length > 0 && (
        <Section title="Fixed by the catalog" hint="pre-assigned, you never pass these">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <tbody className="divide-y">
                {fixed.map(([k, v]) => (
                  <tr key={k}>
                    <td className="w-1/2 px-2.5 py-1 font-mono text-muted-foreground">{k}</td>
                    <td className="px-2.5 py-1 font-mono">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}

function ParameterDetail({ catalog, name }: { catalog: Catalog; name: string }) {
  const p = catalog.parameters[name];
  if (!p) return null;
  return (
    <div className="space-y-6">
      <Header icon={<Radio />} kind="Parameter" name={name} q={p.q} subsystem={p.subsystem} importLine={`param.${name}  ·  import framework.${catalog.mission.toLowerCase()}.parameters as param`} />
      {p.description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{p.description}</p>}

      <Section title="Usage">
        <Snippet code={parameterSnippet(catalog, name)} />
      </Section>

      <Section title="Details">
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-xs">
            <tbody className="divide-y">
              <tr>
                <td className="w-40 px-2.5 py-1.5 text-muted-foreground">Kind</td>
                <td className="px-2.5 py-1.5 font-mono">{p.kind}</td>
              </tr>
              <tr>
                <td className="px-2.5 py-1.5 text-muted-foreground">Value field</td>
                <td className="px-2.5 py-1.5 font-mono">{p.field}</td>
              </tr>
              <tr>
                <td className="px-2.5 py-1.5 text-muted-foreground">Type</td>
                <td className="px-2.5 py-1.5 font-mono">{p.type === "enum" && p.enum ? `enum ${p.enum}` : p.type}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {p.type === "enum" && p.enum && (
        <Section title="Values" hint={p.enum}>
          <EnumMembers ns="param" name={p.enum} e={catalog.paramEnums[p.enum]} />
        </Section>
      )}
    </div>
  );
}

function EnumDetail({ catalog, ns, name }: { catalog: Catalog; ns: "comm" | "param"; name: string }) {
  const e = (ns === "comm" ? catalog.enums : catalog.paramEnums)[name];
  return (
    <div className="space-y-6">
      <Header
        icon={<Terminal />}
        kind={ns === "comm" ? "Command enum" : "Parameter enum"}
        name={name}
        importLine={`${ns}.${name}  ·  ${e?.members.length ?? 0} members`}
      />
      <Section title="Members" hint="Use the member name in code; the value is what goes on the wire">
        <EnumMembers ns={ns} name={name} e={e} />
      </Section>
    </div>
  );
}

export function CatalogDetail({ catalog, tab, item }: { catalog: Catalog; tab: "commands" | "parameters" | "enums"; item: string }) {
  // Reset expanded rows when the selection changes.
  if (tab === "commands") return <CommandDetail key={item} catalog={catalog} name={item} />;
  if (tab === "parameters") return <ParameterDetail key={item} catalog={catalog} name={item} />;
  const [ns, ...rest] = item.split(":");
  return <EnumDetail key={item} catalog={catalog} ns={ns === "param" ? "param" : "comm"} name={rest.join(":")} />;
}
