import {
  StateTransitionValidator,
  InvalidTransitionError,
} from "../state-transition-validator";

type TestState = "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED";

const TEST_TRANSITIONS = {
  PENDING: ["EXECUTING", "CANCELLED"] as TestState[],
  EXECUTING: ["COMPLETED", "FAILED", "CANCELLED"] as TestState[],
  COMPLETED: [] as TestState[],
  FAILED: ["PENDING"] as TestState[], // allow retry
  CANCELLED: [] as TestState[],
};

describe("StateTransitionValidator", () => {
  let validator: StateTransitionValidator<TestState>;

  beforeEach(() => {
    validator = new StateTransitionValidator(TEST_TRANSITIONS);
  });

  describe("canTransition", () => {
    it("should allow valid transitions", () => {
      expect(validator.canTransition("PENDING", "EXECUTING")).toBe(true);
      expect(validator.canTransition("PENDING", "CANCELLED")).toBe(true);
      expect(validator.canTransition("EXECUTING", "COMPLETED")).toBe(true);
      expect(validator.canTransition("EXECUTING", "FAILED")).toBe(true);
      expect(validator.canTransition("FAILED", "PENDING")).toBe(true);
    });

    it("should reject invalid transitions", () => {
      expect(validator.canTransition("PENDING", "COMPLETED")).toBe(false);
      expect(validator.canTransition("COMPLETED", "EXECUTING")).toBe(false);
      expect(validator.canTransition("CANCELLED", "PENDING")).toBe(false);
    });

    it("should reject unknown states", () => {
      expect(validator.canTransition("UNKNOWN" as TestState, "EXECUTING")).toBe(
        false,
      );
    });
  });

  describe("assertTransition", () => {
    it("should not throw for valid transitions", () => {
      expect(() =>
        validator.assertTransition("PENDING", "EXECUTING"),
      ).not.toThrow();
    });

    it("should throw InvalidTransitionError for invalid transitions", () => {
      expect(() => validator.assertTransition("PENDING", "COMPLETED")).toThrow(
        InvalidTransitionError,
      );
    });

    it("should include from/to/allowed in error", () => {
      try {
        validator.assertTransition("PENDING", "COMPLETED");
        fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const ite = err as InvalidTransitionError;
        expect(ite.from).toBe("PENDING");
        expect(ite.to).toBe("COMPLETED");
        expect(ite.allowed).toContain("EXECUTING");
        expect(ite.allowed).toContain("CANCELLED");
      }
    });
  });

  describe("getNextStates", () => {
    it("should return allowed next states", () => {
      const next = validator.getNextStates("EXECUTING");
      expect(next).toEqual(
        expect.arrayContaining(["COMPLETED", "FAILED", "CANCELLED"]),
      );
      expect(next).toHaveLength(3);
    });

    it("should return empty array for terminal states", () => {
      expect(validator.getNextStates("COMPLETED")).toEqual([]);
    });

    it("should return empty array for unknown states", () => {
      expect(validator.getNextStates("UNKNOWN" as TestState)).toEqual([]);
    });
  });

  describe("isTerminal", () => {
    it("should detect terminal states (auto-detected)", () => {
      expect(validator.isTerminal("COMPLETED")).toBe(true);
      expect(validator.isTerminal("CANCELLED")).toBe(true);
    });

    it("should not mark non-terminal states as terminal", () => {
      expect(validator.isTerminal("PENDING")).toBe(false);
      expect(validator.isTerminal("EXECUTING")).toBe(false);
      expect(validator.isTerminal("FAILED")).toBe(false);
    });
  });

  describe("with explicit terminal states", () => {
    it("should use explicit terminal states", () => {
      const v = new StateTransitionValidator(TEST_TRANSITIONS, [
        "COMPLETED",
        "FAILED",
        "CANCELLED",
      ]);
      expect(v.isTerminal("FAILED")).toBe(true);
      expect(v.getTerminalStates()).toEqual(
        expect.arrayContaining(["COMPLETED", "FAILED", "CANCELLED"]),
      );
    });
  });

  describe("getAllStates", () => {
    it("should return all states", () => {
      const states = validator.getAllStates();
      expect(states).toEqual(
        expect.arrayContaining([
          "PENDING",
          "EXECUTING",
          "COMPLETED",
          "FAILED",
          "CANCELLED",
        ]),
      );
    });
  });
});
