/**
 * State Transition Validator
 *
 * Generic finite-state-machine guard that validates state transitions.
 * Consumers define allowed transitions; the validator enforces them.
 *
 * Non-Injectable (pure class) — consumers instantiate with their own transition map.
 */

export interface StateTransitionMap<TState extends string> {
  [from: string]: TState[];
}

/**
 * Error thrown when an invalid state transition is attempted.
 */
export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly allowed: string[],
  ) {
    super(
      `Invalid state transition: ${from} → ${to}. Allowed from ${from}: [${allowed.join(", ")}]`,
    );
    this.name = "InvalidTransitionError";
  }
}

export class StateTransitionValidator<TState extends string> {
  private readonly transitions: Map<TState, Set<TState>>;
  private readonly terminalStates: Set<TState>;

  /**
   * @param transitionMap - Map of state → allowed next states
   * @param terminalStates - States with no outgoing transitions (optional, auto-detected if omitted)
   */
  constructor(
    transitionMap: StateTransitionMap<TState>,
    terminalStates?: TState[],
  ) {
    this.transitions = new Map();

    for (const [from, toStates] of Object.entries(transitionMap)) {
      this.transitions.set(from as TState, new Set(toStates));
    }

    if (terminalStates) {
      this.terminalStates = new Set(terminalStates);
    } else {
      // Auto-detect: states that appear as keys but have empty next-state sets,
      // or states that appear only as targets but never as sources
      this.terminalStates = new Set();
      for (const [state, nextStates] of this.transitions) {
        if (nextStates.size === 0) {
          this.terminalStates.add(state);
        }
      }
    }
  }

  /**
   * Check if a transition from `from` to `to` is allowed.
   */
  canTransition(from: TState, to: TState): boolean {
    const allowed = this.transitions.get(from);
    if (!allowed) return false;
    return allowed.has(to);
  }

  /**
   * Assert that a transition is valid. Throws InvalidTransitionError if not.
   */
  assertTransition(from: TState, to: TState): void {
    if (!this.canTransition(from, to)) {
      const allowed = this.getNextStates(from);
      throw new InvalidTransitionError(from, to, allowed);
    }
  }

  /**
   * Get allowed next states from a given state.
   */
  getNextStates(from: TState): TState[] {
    const allowed = this.transitions.get(from);
    return allowed ? Array.from(allowed) : [];
  }

  /**
   * Check if a state is terminal (no outgoing transitions).
   */
  isTerminal(state: TState): boolean {
    return this.terminalStates.has(state);
  }

  /**
   * Get all terminal states.
   */
  getTerminalStates(): TState[] {
    return Array.from(this.terminalStates);
  }

  /**
   * Get all registered states.
   */
  getAllStates(): TState[] {
    const states = new Set<TState>();
    for (const [from, toStates] of this.transitions) {
      states.add(from);
      for (const to of toStates) {
        states.add(to);
      }
    }
    return Array.from(states);
  }
}
