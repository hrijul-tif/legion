"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createProcedure } from "@/app/actions/lifecycle";
import type { Mission } from "@/lib/data/types";

const FF_CONVENTION = /^FF_A\d{2}_(FCP|CRP)_[A-Z0-9]+_\d{3}_[A-Za-z0-9_]+$/;
const FF_PARTS = /^FF_A\d{2}_(FCP|CRP)_([A-Z0-9]+)_\d{3}_/;

export function NewProcedureDialog({ folders }: { folders: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [mission, setMission] = useState<Mission>("FF");
  const [folder, setFolder] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const ids = { name: useId(), folder: useId(), desc: useId(), list: useId() };

  const trimmed = name.trim();
  const nameError = trimmed.length < 3 ? "At least 3 characters" : trimmed.length > 120 ? "At most 120 characters" : /\s/.test(trimmed) ? "No spaces — use underscores" : null;
  const offConvention = mission === "FF" && trimmed.length >= 3 && !nameError && !FF_CONVENTION.test(trimmed);

  const suggestedFolder = useMemo(() => {
    const m = FF_PARTS.exec(trimmed);
    return m ? `${m[2]}/${m[1]}` : null;
  }, [trimmed]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError) return;
    startTransition(async () => {
      const res = await createProcedure({ name: trimmed, description: description.trim(), mission, folder: folder.trim().replace(/^\/+|\/+$/g, "") });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Created ${trimmed} — opening the editor`);
      setOpen(false);
      router.push(`/snapshots/${res.data.snapshotId}/edit`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" /> New procedure
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>New procedure</DialogTitle>
            <DialogDescription>Creates the procedure and your first working copy (#1), then opens it in the editor.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FF_AXX_FCP_EPS_001_Description"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-invalid={touched && !!nameError}
              autoFocus
            />
            <p className={touched && nameError ? "text-xs text-destructive" : offConvention ? "text-xs text-tone-warn" : "text-xs text-muted-foreground"}>
              {touched && nameError
                ? nameError
                : offConvention
                  ? "Doesn't follow FF_AXX_{FCP|CRP}_{SUBSYS}_{NNN}_{Description} — allowed, but harder to find."
                  : "Convention: FF_AXX_{FCP|CRP}_{SUBSYS}_{NNN}_{Description}. Unique, 3–120 characters."}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label>Mission</Label>
            <ToggleGroup type="single" variant="outline" value={mission} onValueChange={(v) => v && setMission(v as Mission)} className="w-fit">
              <ToggleGroupItem value="FF" className="px-4">FF</ToggleGroupItem>
              <ToggleGroupItem value="JTYU" className="px-4">JTYU</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={ids.folder}>Folder</Label>
            <Input
              id={ids.folder}
              list={ids.list}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="EPS/FCP"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <datalist id={ids.list}>
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            {suggestedFolder && folder !== suggestedFolder && (
              <button
                type="button"
                onClick={() => setFolder(suggestedFolder)}
                className="inline-flex w-fit items-center gap-1 rounded-md px-1 text-xs text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Sparkles className="size-3" /> Use <span className="font-mono">{suggestedFolder}</span> from the name
              </button>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={ids.desc}>Description</Label>
            <Textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this procedure do, and when is it run?" rows={3} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" data-icon="inline-start" />} Create and open editor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
