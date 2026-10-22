"use client";

import { useTheme } from "next-themes";
import { Check, ChevronsUpDown, LogOut, Moon, Sun, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "./user-avatar";
import type { CurrentUser } from "@/lib/auth";
import type { Persona } from "@/lib/personas";
import { signInAsPersona, signOut } from "@/app/login/actions";

export function UserMenu({ user, personas }: { user: CurrentUser; personas: Persona[] }) {
  const { resolvedTheme, setTheme } = useTheme();
  const switchTo = (email: string) => {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("next", window.location.pathname + window.location.search);
    void signInAsPersona(fd);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left transition hover:bg-sidebar-accent group-data-[collapsed=true]/user:justify-center">
        <UserAvatar user={user} size={30} />
        <span className="min-w-0 flex-1 group-data-[collapsed=true]/user:hidden">
          <span className="block truncate text-sm font-medium">{user.displayName}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{user.roles.join(" · ")}</span>
        </span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground group-data-[collapsed=true]/user:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{user.email}</DropdownMenuLabel>
        {personas.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5 text-xs">
              <Users className="size-3.5" /> Switch persona
            </DropdownMenuLabel>
            {personas.map((p) => (
              <DropdownMenuItem key={p.email} onSelect={() => p.email !== user.email && switchTo(p.email)} className="gap-2">
                <UserAvatar user={p} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.displayName}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{p.roles.join(" · ")}</span>
                </span>
                {p.email === user.email && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <Sun /> : <Moon />} {resolvedTheme === "dark" ? "Light" : "Dark"} theme
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
