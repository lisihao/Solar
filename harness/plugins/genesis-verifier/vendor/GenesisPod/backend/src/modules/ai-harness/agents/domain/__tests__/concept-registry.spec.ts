/**
 * DomainConceptRegistry + DomainAdapterRegistry 单测 (PR-N)
 */

import { DomainConceptRegistry } from "../concept-registry";
import { DomainAdapterRegistry, type IDomainAdapter } from "../domain-adapter";

describe("DomainConceptRegistry (PR-N)", () => {
  it("registers + retrieves concepts", () => {
    const reg = new DomainConceptRegistry();
    reg.register({
      id: "topic-insights.topic",
      moduleId: "topic-insights",
      displayName: "Topic",
      description: "research topic",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "depth", type: "string" },
      ],
    });
    expect(reg.has("topic-insights.topic")).toBe(true);
    expect(reg.get("topic-insights.topic")?.displayName).toBe("Topic");
  });

  it("listByModule filters", () => {
    const reg = new DomainConceptRegistry();
    reg.register({
      id: "ti.x",
      moduleId: "topic-insights",
      displayName: "X",
      description: "",
      fields: [],
    });
    reg.register({
      id: "rs.y",
      moduleId: "research",
      displayName: "Y",
      description: "",
      fields: [],
    });
    expect(reg.listByModule("topic-insights")).toHaveLength(1);
    expect(reg.listByModule("research")).toHaveLength(1);
  });

  it("describeForLLM produces compact text", () => {
    const reg = new DomainConceptRegistry();
    reg.register({
      id: "x.dim",
      moduleId: "x",
      displayName: "Dimension",
      description: "research dimension",
      fields: [
        { name: "name", type: "string", required: true },
        { name: "score", type: "number" },
      ],
    });
    const txt = reg.describeForLLM(["x.dim"]);
    expect(txt).toContain("x.dim");
    expect(txt).toContain("Dimension");
    expect(txt).toContain("name:string*");
    expect(txt).toContain("score:number");
  });
});

describe("DomainAdapterRegistry (PR-N)", () => {
  it("registers + retrieves adapter by conceptId", async () => {
    const reg = new DomainAdapterRegistry();
    const stored = new Map<string, { id: string; data: { value: number } }>();
    const adapter: IDomainAdapter<{ value: number }> = {
      conceptId: "x.thing",
      fetch: async (id) => {
        const row = stored.get(id);
        return row ? { conceptId: "x.thing", id, data: row.data } : null;
      },
      save: async (entity) => {
        stored.set(entity.id, { id: entity.id, data: entity.data });
      },
    };
    reg.register(adapter);
    const got = reg.get<{ value: number }>("x.thing");
    expect(got).toBeDefined();
    await got!.save({ conceptId: "x.thing", id: "1", data: { value: 42 } });
    const back = await got!.fetch("1");
    expect(back?.data.value).toBe(42);
  });
});
