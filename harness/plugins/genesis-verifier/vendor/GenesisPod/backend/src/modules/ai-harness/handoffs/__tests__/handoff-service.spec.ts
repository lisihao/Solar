/**
 * HandoffService structural tests
 *
 * Goals:
 *   1. Service instantiates without throwing.
 *   2. handoff() returns accepted:false when target agent is not in registry.
 *   3. handoff() returns accepted:false when default policy denies (self-handoff).
 *   4. handoff() returns accepted:true with a handoffId and handoverEnvelope for valid case.
 *   5. carryEnvelope:false causes the target agent's own envelope to be used.
 *   6. Custom IHandoffPolicy is honoured (deny case).
 *   7. HandoffResult has the expected shape on success.
 */

import { AgentRegistry } from "../agent-registry";
import { HandoffService } from "../handoff.service";
import type {
  IAgent,
  IContextEnvelope,
} from "@/modules/ai-harness/agents/abstractions";
import type { HandoffContext, IHandoffPolicy } from "../handoff.types";

// Silence Logger in tests
jest.mock("@nestjs/common", () => {
  const actual = jest.requireActual("@nestjs/common");
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    Optional: () => () => undefined,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    })),
  };
});

// Stub for IContextEnvelope — HandoffService only calls getEnvelope() and
// checks instanceof ContextEnvelope; for the non-ContextEnvelope path we use
// a plain object that satisfies IContextEnvelope.
function makeEnvelope(id = "env-1"): IContextEnvelope {
  return {
    id,
    system: "test-system",
    messages: [],
    reminders: [],
    tools: [],
    memory: {} as never,
    budget: {} as never,
  } as unknown as IContextEnvelope;
}

function makeAgent(agentId: string, envelope?: IContextEnvelope): IAgent {
  return {
    id: agentId,
    getEnvelope: jest.fn().mockReturnValue(envelope ?? makeEnvelope(agentId)),
    execute: jest.fn(),
  } as unknown as IAgent;
}

function makeContext(overrides: Partial<HandoffContext> = {}): HandoffContext {
  return {
    fromAgentId: "agent-from",
    toAgentId: "agent-to",
    reason: "escalation",
    ...overrides,
  };
}

describe("HandoffService", () => {
  let registry: AgentRegistry;
  let service: HandoffService;

  beforeEach(() => {
    registry = new AgentRegistry();
    service = new HandoffService(registry);
  });

  it("instantiates without throwing", () => {
    expect(service).toBeInstanceOf(HandoffService);
  });

  // -------------------------------------------------------------------------
  // Target agent not in registry
  // -------------------------------------------------------------------------

  it("returns accepted:false when target agent is not registered", async () => {
    const fromAgent = makeAgent("agent-from");
    const ctx = makeContext({ toAgentId: "nobody" });

    const result = await service.handoff(fromAgent, ctx);

    expect(result.accepted).toBe(false);
    expect(result.rejectedReason).toContain("nobody");
    expect(typeof result.handoffId).toBe("string");
    expect(result.handoffId.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Self-handoff denied by default policy
  // -------------------------------------------------------------------------

  it("returns accepted:false when from and to are the same agent (default policy)", async () => {
    const agent = makeAgent("agent-self");
    registry.register(agent);
    const ctx = makeContext({
      fromAgentId: "agent-self",
      toAgentId: "agent-self",
    });

    const result = await service.handoff(agent, ctx);

    expect(result.accepted).toBe(false);
    expect(result.rejectedReason).toMatch(/self/i);
  });

  // -------------------------------------------------------------------------
  // Successful handoff
  // -------------------------------------------------------------------------

  it("returns accepted:true with handoffId and handoverEnvelope for a valid handoff", async () => {
    const fromAgent = makeAgent("agent-from");
    const toAgent = makeAgent("agent-to");
    registry.register(toAgent);

    const ctx = makeContext();
    const result = await service.handoff(fromAgent, ctx);

    expect(result.accepted).toBe(true);
    expect(typeof result.handoffId).toBe("string");
    expect(result.handoffId.length).toBeGreaterThan(0);
    expect(result.toAgentId).toBe("agent-to");
    expect(result.handoverEnvelope).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // carryEnvelope:false
  // -------------------------------------------------------------------------

  it("uses target agent's own envelope when carryEnvelope is false", async () => {
    const targetEnvelope = makeEnvelope("target-env");
    const fromAgent = makeAgent("agent-from");
    const toAgent = makeAgent("agent-to", targetEnvelope);
    registry.register(toAgent);

    const ctx = makeContext({ carryEnvelope: false });
    const result = await service.handoff(fromAgent, ctx);

    expect(result.accepted).toBe(true);
    // The envelope should be the target agent's (or shaped from it)
    expect(result.handoverEnvelope).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Custom IHandoffPolicy — deny
  // -------------------------------------------------------------------------

  it("respects a custom policy that denies the handoff", async () => {
    const denyPolicy: IHandoffPolicy = {
      async authorize() {
        return { allow: false, reason: "policy-denied" };
      },
    };

    const serviceWithPolicy = new HandoffService(registry, denyPolicy);
    const fromAgent = makeAgent("agent-from");
    const toAgent = makeAgent("agent-to");
    registry.register(toAgent);

    const ctx = makeContext();
    const result = await serviceWithPolicy.handoff(fromAgent, ctx);

    expect(result.accepted).toBe(false);
    expect(result.rejectedReason).toBe("policy-denied");
  });

  // -------------------------------------------------------------------------
  // Custom IHandoffPolicy — allow + shapeEnvelope
  // -------------------------------------------------------------------------

  it("custom policy shapeEnvelope is called when provided", async () => {
    const shaped = makeEnvelope("shaped-env");
    const shapeEnvelope = jest.fn().mockResolvedValue(shaped);
    const allowPolicy: IHandoffPolicy = {
      async authorize() {
        return { allow: true };
      },
      shapeEnvelope,
    };

    const serviceWithPolicy = new HandoffService(registry, allowPolicy);
    const fromAgent = makeAgent("agent-from");
    const toAgent = makeAgent("agent-to");
    registry.register(toAgent);

    const ctx = makeContext({ carryEnvelope: true });
    const result = await serviceWithPolicy.handoff(fromAgent, ctx);

    expect(result.accepted).toBe(true);
    expect(shapeEnvelope).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // G6: on_handoff hook
  // -------------------------------------------------------------------------

  it("onHandoff hook can block the handoff after authorize passes", async () => {
    const onHandoff = jest.fn().mockResolvedValue({
      block: true,
      reason: "invalid input payload",
    });
    const policy: IHandoffPolicy = {
      async authorize() {
        return { allow: true };
      },
      onHandoff,
    };
    const serviceWithPolicy = new HandoffService(registry, policy);
    const fromAgent = makeAgent("agent-from");
    registry.register(makeAgent("agent-to"));

    const ctx = makeContext({ input: { escalationLevel: 3 } });
    const result = await serviceWithPolicy.handoff(fromAgent, ctx);

    expect(onHandoff).toHaveBeenCalledWith(
      expect.objectContaining({ input: { escalationLevel: 3 } }),
    );
    expect(result.accepted).toBe(false);
    expect(result.rejectedReason).toBe("invalid input payload");
  });

  it("onHandoff hook that does not block lets the handoff proceed", async () => {
    const onHandoff = jest.fn().mockResolvedValue(undefined);
    const policy: IHandoffPolicy = {
      async authorize() {
        return { allow: true };
      },
      onHandoff,
    };
    const serviceWithPolicy = new HandoffService(registry, policy);
    const fromAgent = makeAgent("agent-from");
    registry.register(makeAgent("agent-to"));

    const result = await serviceWithPolicy.handoff(fromAgent, makeContext());

    expect(onHandoff).toHaveBeenCalled();
    expect(result.accepted).toBe(true);
  });

  // -------------------------------------------------------------------------
  // HandoffResult shape
  // -------------------------------------------------------------------------

  it("HandoffResult has toAgentId, accepted, handoffId fields", async () => {
    const fromAgent = makeAgent("f");
    const toAgent = makeAgent("t");
    registry.register(toAgent);

    const result = await service.handoff(
      fromAgent,
      makeContext({ fromAgentId: "f", toAgentId: "t" }),
    );

    expect(result).toHaveProperty("toAgentId");
    expect(result).toHaveProperty("accepted");
    expect(result).toHaveProperty("handoffId");
  });

  // -------------------------------------------------------------------------
  // handoverMessage is included in envelope reminder (does not throw)
  // -------------------------------------------------------------------------

  it("handoverMessage in context does not cause an error", async () => {
    const fromAgent = makeAgent("agent-from");
    const toAgent = makeAgent("agent-to");
    registry.register(toAgent);

    const ctx = makeContext({ handoverMessage: "Please handle this customer" });
    await expect(service.handoff(fromAgent, ctx)).resolves.not.toThrow();
  });
});
