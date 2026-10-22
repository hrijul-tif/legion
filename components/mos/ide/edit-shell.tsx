"use client";

import { useLayoutEffect, useState } from "react";
import type { EditLoad } from "@/lib/ide/types";
import { FrozenState } from "./frozen-state";
import { Workspace } from "./workspace";

/**
 * Chooses between the workspace and the frozen/forbidden state. Once a working copy was submitted from this page the
 * server data flips to "frozen" underneath the open dialog; the shell keeps the workspace on screen until the
 * navigation the dialog started takes over (and drops it when the route is hidden by <Activity>).
 */
export function EditShell({ load }: { load: EditLoad }) {
  const editable = load.block.kind === "ok";
  const [mountedEditable] = useState(editable);
  const [submitted, setSubmitted] = useState(false);

  useLayoutEffect(() => {
    return () => setSubmitted(false);
  }, []);

  if (editable || (mountedEditable && submitted)) {
    return (
      <Workspace data={load.data} onSubmitted={() => setSubmitted(true)} />
    );
  }
  if (load.block.kind === "ok") return null;
  return <FrozenState data={load.data} block={load.block} />;
}
