/**
 * Unit tests for SocialEventRelay
 *
 * SocialEventRelay extends EventRelayFramework and passes "social" as the
 * namespace prefix to the parent constructor.
 *
 * We mock EventBus and EventRelayFramework at the module level to avoid
 * pulling in the full harness stack.
 */

import {
  EventBus,
  EventRelayFramework,
} from "@/modules/ai-harness/facade";
import { SocialEventRelay } from "../social-event-relay";

// ---------------------------------------------------------------------------
// Mock EventRelayFramework — capture constructor args and expose spy methods
// ---------------------------------------------------------------------------

const mockSetAbortRegistry = jest.fn();
const mockRelayAgentEvents = jest.fn();
const mockEmitLifecycle = jest.fn();
const mockTickCost = jest.fn();
const mockClearMission = jest.fn();

let capturedEventBus: unknown;
let capturedNamespace: unknown;

jest.mock("@/modules/ai-harness/facade", () => ({
  EventRelayFramework: jest.fn().mockImplementation(function (
    this: Record<string, unknown>,
    eventBus: unknown,
    namespace: unknown,
  ) {
    capturedEventBus = eventBus;
    capturedNamespace = namespace;
    this.setAbortRegistry = mockSetAbortRegistry;
    this.relayAgentEvents = mockRelayAgentEvents;
    this.emitLifecycle = mockEmitLifecycle;
    this.tickCost = mockTickCost;
    this.clearMission = mockClearMission;
  }),
  EventBus: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockEventBus(): EventBus {
  return { emit: jest.fn(), on: jest.fn() } as unknown as EventBus;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SocialEventRelay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedEventBus = undefined;
    capturedNamespace = undefined;
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe("constructor", () => {
    it("should call super with the provided eventBus and the social namespace", () => {
      const eventBus = makeMockEventBus();

      new SocialEventRelay(eventBus);

      expect(EventRelayFramework).toHaveBeenCalledTimes(1);
      expect(capturedEventBus).toBe(eventBus);
      expect(capturedNamespace).toBe("social");
    });

    it("should create a distinct instance per call", () => {
      const eb1 = makeMockEventBus();
      const eb2 = makeMockEventBus();

      const r1 = new SocialEventRelay(eb1);
      const r2 = new SocialEventRelay(eb2);

      // They are separate instances
      expect(r1).not.toBe(r2);
    });
  });

  // -------------------------------------------------------------------------
  // Inherited method delegation
  // -------------------------------------------------------------------------

  describe("inherited methods — delegation to EventRelayFramework", () => {
    it("setAbortRegistry should be callable on the instance", () => {
      const eventBus = makeMockEventBus();
      const relay = new SocialEventRelay(eventBus);
      const fakeRegistry = { getSignal: jest.fn() };

      (
        relay as unknown as { setAbortRegistry: typeof mockSetAbortRegistry }
      ).setAbortRegistry(fakeRegistry);

      expect(mockSetAbortRegistry).toHaveBeenCalledWith(fakeRegistry);
    });

    it("clearMission should be callable on the instance", () => {
      const eventBus = makeMockEventBus();
      const relay = new SocialEventRelay(eventBus);

      (relay as unknown as { clearMission: (id: string) => void }).clearMission(
        "mission-001",
      );

      expect(mockClearMission).toHaveBeenCalledWith("mission-001");
    });
  });
});
