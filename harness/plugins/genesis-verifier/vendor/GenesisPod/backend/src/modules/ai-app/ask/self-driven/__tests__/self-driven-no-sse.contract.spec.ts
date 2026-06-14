import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Contract guard (stage 5): the self-driven transport must stay decoupled from
 * any single HTTP connection. The original long-held SSE-over-POST stream set an
 * HTTP/2-illegal `Connection: keep-alive` header and blocked the connection for
 * the 10-min HITL gate, which the Railway edge reset. Lock that out so it cannot
 * be reintroduced — live events go over the Socket.IO room, history over /replay.
 */
describe("self-driven transport contract", () => {
  const dir = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");

  it("the controller holds no SSE stream / illegal Connection header", () => {
    const controller = read("ask-self-driven.controller.ts");
    expect(controller).not.toContain("text/event-stream");
    expect(controller).not.toMatch(/setHeader\(\s*["']Connection["']/);
    // The whole-mission for-await SSE drive must live in the background dispatcher,
    // never in a request handler.
    expect(controller).not.toContain("for await");
  });

  it("exposes the decoupled endpoints", () => {
    const controller = read("ask-self-driven.controller.ts");
    expect(controller).toContain('@Post("run")');
    expect(controller).toContain("streamNamespace");
  });
});
