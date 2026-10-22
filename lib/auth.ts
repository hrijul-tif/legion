import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { MosRole } from "@/lib/lifecycle";

export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  color: string;
  title: string | null;
  roles: MosRole[];
}

/** Verified current user (JWT checked by getClaims) with their MOS profile. Redirects to /login if absent. */
export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await findCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function findCurrentUser(): Promise<CurrentUser | null> {
  // Auth is per-request; stop prerendering here (supabase-js reads the clock when validating the session).
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, display_name, initials, color, title, roles")
    .eq("id", uid)
    .single();
  if (!profile) return null;
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    initials: profile.initials,
    color: profile.color,
    title: profile.title,
    roles: profile.roles as MosRole[],
  };
}
