import { gate, reply } from "@/lib/bifrost/guard";
import { getRun } from "@/lib/bifrost/runs";

/** Server-sent events: replays the run's events (from Last-Event-ID + 1) and then follows it until `done`. */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { runId } = await ctx.params;
  const rec = getRun(runId);
  if (!rec || rec.ownerId !== g.uid) return reply({ error: "Run not found" }, 404);

  const last = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("from") ?? "-1");
  let next = Number.isFinite(last) ? last + 1 : 0;
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = () => {
        try {
          if (next < rec.offset) next = rec.offset;
          while (next - rec.offset < rec.events.length) {
            const ev = rec.events[next - rec.offset];
            controller.enqueue(enc.encode(`id: ${next}\ndata: ${JSON.stringify(ev)}\n\n`));
            next++;
            if (ev.type === "done") {
              cleanup();
              controller.close();
              return;
            }
          }
        } catch {
          cleanup();
        }
      };
      const beat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);
      cleanup = () => {
        clearInterval(beat);
        rec.listeners.delete(pump);
      };
      rec.listeners.add(pump);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      pump();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
