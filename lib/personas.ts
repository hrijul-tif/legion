import type { MosRole } from "./lifecycle";

// Fictional demo people. The seed script creates them; the login page offers one-click sign-in.
export interface Persona {
  email: string;
  displayName: string;
  initials: string;
  title: string;
  color: string;
  roles: MosRole[];
  blurb: string;
}

export const PERSONAS: Persona[] = [
  { email: "asha.rao@mos.test", displayName: "Asha Rao", initials: "AR", title: "Flight Ops Engineer", color: "#38bdf8", roles: ["author"], blurb: "Writes and dry-runs procedures" },
  { email: "rohan.mehta@mos.test", displayName: "Rohan Mehta", initials: "RM", title: "Flight Ops Engineer", color: "#a78bfa", roles: ["author"], blurb: "Writes procedures, often on the same ones as Asha" },
  { email: "meera.iyer@mos.test", displayName: "Meera Iyer", initials: "MI", title: "Senior Ops Engineer", color: "#f472b6", roles: ["reviewer", "author"], blurb: "Reviews code before it goes to test" },
  { email: "kabir.singh@mos.test", displayName: "Kabir Singh", initials: "KS", title: "Test Engineer", color: "#fbbf24", roles: ["tester"], blurb: "Runs snapshots on the simulator and records results" },
  { email: "nisha.verma@mos.test", displayName: "Nisha Verma", initials: "NV", title: "Mission Director", color: "#34d399", roles: ["approver"], blurb: "Clears procedures for flight, rolls back" },
  { email: "dev.kapoor@mos.test", displayName: "Dev Kapoor", initials: "DK", title: "Ops Lead", color: "#fb7185", roles: ["admin"], blurb: "Every role, plus user management" },
];
