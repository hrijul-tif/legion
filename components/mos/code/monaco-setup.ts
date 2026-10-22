"use client";

import type * as Monaco from "monaco-editor";
import { registerCatalogIntellisense, type CatalogIntellisenseHandle } from "@/lib/editor/catalog-intellisense";
import { loadCatalog } from "@/lib/catalog/load";
import type { Catalog } from "@/lib/catalog/types";

type Mission = Catalog["mission"];

/**
 * One catalog-intellisense registration per Monaco instance, shared by every read-only viewer.
 * Models opt in with `bindModelToMission`; models that never opted in (e.g. the "original" side of a diff)
 * get no catalog hovers or diagnostics, so frozen history stays free of squiggles.
 */
const SETUP = Symbol.for("mos.catalogIntellisense");
type Registry = { handle: CatalogIntellisenseHandle; missions: Map<string, Mission>; catalogs: Map<Mission, Catalog> };
type WithRegistry = typeof Monaco & { [SETUP]?: Registry };

function registryFor(monaco: typeof Monaco): Registry {
  const m = monaco as WithRegistry;
  if (m[SETUP]) return m[SETUP];
  const missions = new Map<string, Mission>();
  const catalogs = new Map<Mission, Catalog>();
  const handle = registerCatalogIntellisense(monaco, {
    getCatalog: (model) => {
      const mission = missions.get(model.uri.toString());
      return mission ? catalogs.get(mission) : undefined;
    },
  });
  m[SETUP] = { handle, missions, catalogs };
  return m[SETUP];
}

/** Enable TM/TC hover docs (comm.X / param.Y) on a model. Returns a disposer. Never throws. */
export function bindModelToMission(monaco: typeof Monaco, model: Monaco.editor.ITextModel, mission: Mission): () => void {
  try {
    const reg = registryFor(monaco);
    const key = model.uri.toString();
    reg.missions.set(key, mission);
    if (reg.catalogs.has(mission)) reg.handle.revalidate();
    else
      void loadCatalog(mission)
        .then((c) => {
          reg.catalogs.set(mission, c);
          reg.handle.revalidate();
        })
        .catch(() => undefined);
    return () => {
      reg.missions.delete(key);
    };
  } catch {
    return () => undefined;
  }
}
