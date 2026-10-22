"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { setUserRoles } from "@/app/actions/collab";
import { UserAvatar } from "@/components/mos/user-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLES, type MosRole } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  color: string;
  title: string | null;
  roles: MosRole[];
}

const ROLE_HELP: Record<MosRole, string> = {
  author: "Create procedures, write working copies, submit snapshots.",
  reviewer: "Pass or fail the code of submitted snapshots.",
  tester: "Run snapshots in test and record the result.",
  approver: "Clear snapshots for PROD, roll back, withdraw and retire.",
  admin: "Every role, plus user management and settings.",
};

function RoleChips({ user, isSelf }: { user: AdminUser; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const [roles, setRoles] = useOptimistic(user.roles, (_: MosRole[], next: MosRole[]) => next);

  const toggle = (role: MosRole) => {
    const next = roles.includes(role) ? roles.filter((r) => r !== role) : ROLES.filter((r) => r === role || roles.includes(r));
    startTransition(async () => {
      setRoles(next);
      const res = await setUserRoles(user.id, next);
      if (res.ok) toast.success(`${user.displayName} is now ${next.length ? next.join(", ") : "without any role"}`);
      else toast.error(res.error);
    });
  };

  return (
    <div className={cn("flex flex-wrap gap-1.5 transition-opacity", pending && "opacity-70")} role="group" aria-label={`Roles for ${user.displayName}`}>
      {ROLES.map((role) => {
        const on = roles.includes(role);
        const locked = isSelf && role === "admin" && on;
        return (
          <Tooltip key={role}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-pressed={on}
                disabled={locked}
                onClick={() => toggle(role)}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium capitalize transition-colors disabled:cursor-not-allowed",
                  on ? "border-primary/40 bg-primary/10 text-foreground" : "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                )}
              >
                {on && <Check className="size-3 text-primary" />}
                {role}
              </button>
            </TooltipTrigger>
            <TooltipContent>{locked ? "You cannot remove your own admin role." : ROLE_HELP[role]}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function RoleEditor({ users, selfId }: { users: AdminUser[]; selfId: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader className="bg-muted/30">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-9 pl-4 text-xs font-medium">Person</TableHead>
            <TableHead className="h-9 pr-4 text-xs font-medium">Roles</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-3">
                  <UserAvatar user={u} size={32} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {u.displayName}
                      {u.id === selfId && <span className="rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">you</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.title ? `${u.title} · ` : ""}
                      <span className="font-mono">{u.email}</span>
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell className="pr-4">
                <RoleChips user={u} isSelf={u.id === selfId} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
