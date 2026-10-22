import type { Metadata } from "next";
import { Suspense } from "react";
import { MosLogo } from "@/components/mos/logo";
import { LoginPanel } from "./login-panel";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-background bg-grid px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-[-20%] mx-auto h-[520px] max-w-3xl rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
      <div className="relative w-full max-w-4xl">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <MosLogo />
          <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Write, test, approve and fly procedures — in one place.</h1>
          <p className="max-w-xl text-balance text-muted-foreground">
            No terminal, no branches, no pull requests. Every snapshot is frozen, reviewed, tested and approved, and every move is on the record.
          </p>
        </div>
        <Suspense>
          <LoginPanel searchParams={searchParams} demoMode={process.env.DEMO_MODE === "true"} />
        </Suspense>
      </div>
    </main>
  );
}
