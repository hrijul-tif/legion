"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CornerDownRight, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { addReviewComment, setCommentResolved } from "@/app/actions/collab";
import { RelativeTime } from "@/components/mos/time";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { hasRole } from "@/lib/lifecycle";
import type { SnapshotPageData } from "@/lib/data/snapshot";
import type { ReviewComment } from "@/lib/data/types";
import { person } from "./derive";

export function useCommentActions(snapshotId: string) {
  const add = async (line: number | null, body: string): Promise<boolean> => {
    const res = await addReviewComment(snapshotId, line, body);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(line ? `Comment added on line ${line}` : "Comment added");
    return true;
  };
  const resolve = async (id: string, resolved: boolean): Promise<boolean> => {
    const res = await setCommentResolved(id, resolved);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    return true;
  };
  return { add, resolve };
}
export type CommentActions = ReturnType<typeof useCommentActions>;

export function CommentComposer({
  placeholder,
  submitLabel = "Comment",
  onSubmit,
  onCancel,
  autoFocus,
  className,
}: {
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Monaco grabs focus on the gutter click that opened us; take it back once its mouse handling is done.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => ref.current?.focus(), 90);
    return () => clearTimeout(t);
  }, [autoFocus]);

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    const ok = await onSubmit(text);
    setBusy(false);
    if (ok) {
      setBody("");
      onCancel?.();
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Textarea
        ref={ref}
        value={body}
        rows={3}
        disabled={busy}
        placeholder={placeholder ?? "Leave a comment…"}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        className="min-h-16 resize-y bg-background text-[13px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          <kbd className="rounded border px-1 font-mono text-[10px]">⌘↵</kbd> to post{onCancel ? " · Esc to cancel" : ""}
        </span>
        <div className="flex gap-1.5">
          {onCancel && (
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={submit} disabled={!body.trim() || busy}>
            {busy && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CommentItem({ c, data, actions }: { c: ReviewComment; data: SnapshotPageData; actions: CommentActions }) {
  const author = person(data, c.author_id);
  const resolvedBy = c.resolved_by ? person(data, c.resolved_by) : null;
  const canResolve = c.author_id === data.me.id || hasRole(data.me.roles, "reviewer");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const resolved = !!c.resolved_at;
  const collapsed = resolved && !open;

  const toggle = async () => {
    setBusy(true);
    await actions.resolve(c.id, !resolved);
    setBusy(false);
  };

  return (
    <div className={cn("flex gap-2.5", resolved && "opacity-80")}>
      <UserAvatar user={author} size={24} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
          <span className="font-medium text-foreground">{author.displayName}</span>
          <RelativeTime date={c.created_at} className="text-muted-foreground" />
          {resolved && (
            <span className="inline-flex items-center gap-1 text-tone-success">
              <CheckCircle2 className="size-3" /> resolved{resolvedBy ? ` by ${resolvedBy.displayName}` : ""}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {resolved && (
              <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} className="text-muted-foreground">
                {open ? "Hide" : "Show"}
              </Button>
            )}
            {canResolve && (
              <Button variant="ghost" size="xs" disabled={busy} onClick={toggle} className="text-muted-foreground hover:text-foreground">
                {busy ? <Loader2 className="animate-spin" /> : resolved ? <RotateCcw /> : <CheckCircle2 />}
                {resolved ? "Reopen" : "Resolve"}
              </Button>
            )}
          </span>
        </div>
        <p className={cn("mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words", collapsed && "line-clamp-1 text-muted-foreground")}>{c.body}</p>
      </div>
    </div>
  );
}

/** One thread: comments for a single line, with a reply affordance. Used inside Monaco view zones and the general thread. */
export function CommentThread({
  comments,
  data,
  actions,
  onReply,
  line,
  canComment,
  className,
}: {
  comments: ReviewComment[];
  data: SnapshotPageData;
  actions: CommentActions;
  onReply?: () => void;
  line: number | null;
  canComment: boolean;
  className?: string;
}) {
  const open = comments.filter((c) => !c.resolved_at).length;
  return (
    <div className={cn("mx-3 my-1.5 rounded-lg border bg-card text-card-foreground shadow-xs", open > 0 ? "border-l-2 border-l-tone-warn" : "border-l-2 border-l-tone-muted", className)}>
      <div className="space-y-3 p-3">
        {line != null && (
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            line {line} · {open > 0 ? `${open} open` : "all resolved"}
          </p>
        )}
        {comments.map((c) => (
          <CommentItem key={c.id} c={c} data={data} actions={actions} />
        ))}
        {canComment && onReply && (
          <Button variant="ghost" size="xs" onClick={onReply} className="-ml-1 text-muted-foreground hover:text-foreground">
            <CornerDownRight /> Reply
          </Button>
        )}
      </div>
    </div>
  );
}
