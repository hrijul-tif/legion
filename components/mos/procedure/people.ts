import type { Profile } from "@/lib/data/types";

export interface Person {
  id: string;
  displayName: string;
  initials: string;
  color: string;
}

export type People = Record<string, Person>;

export function toPeople(profiles: Record<string, Profile>): People {
  return Object.fromEntries(
    Object.values(profiles).map((p) => [p.id, { id: p.id, displayName: p.display_name, initials: p.initials, color: p.color }]),
  );
}

export function personOf(people: People, id: string | null | undefined): Person {
  return (id && people[id]) || { id: id ?? "", displayName: "Unknown user", initials: "?", color: "#64748b" };
}
