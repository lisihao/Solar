import { AbortableScope } from "../abortable-scope";

describe("AbortableScope", () => {
  describe("add + abort firing", () => {
    it("invokes the listener when the signal aborts", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      const listener = jest.fn();
      scope.add(ac.signal, listener);
      expect(listener).not.toHaveBeenCalled();
      ac.abort();
      expect(listener).toHaveBeenCalledTimes(1);
      scope.dispose();
    });

    it("tracks registered listeners in size", () => {
      const scope = new AbortableScope();
      const a = new AbortController();
      const b = new AbortController();
      scope.add(a.signal, jest.fn());
      scope.add(b.signal, jest.fn());
      expect(scope.size).toBe(2);
      scope.dispose();
    });

    it("fires the listener only once even if abort is signalled again (once:true)", () => {
      // listener registered with {once:true}; a second abort() is a no-op on an
      // already-aborted controller, and dispose afterwards stays safe.
      const scope = new AbortableScope();
      const ac = new AbortController();
      const listener = jest.fn();
      scope.add(ac.signal, listener);
      ac.abort();
      ac.abort();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(() => scope.dispose()).not.toThrow();
    });
  });

  describe("already-aborted signal", () => {
    it("fires the listener immediately and does not register it", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      ac.abort();
      const listener = jest.fn();
      const cleanup = scope.add(ac.signal, listener);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(scope.size).toBe(0);
      // cleanup for the immediate path is a no-op
      expect(() => cleanup()).not.toThrow();
      scope.dispose();
    });

    it("swallows a throwing listener on the immediate path", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      ac.abort();
      expect(() =>
        scope.add(ac.signal, () => {
          throw new Error("boom");
        }),
      ).not.toThrow();
      scope.dispose();
    });
  });

  describe("manual cleanup function", () => {
    it("removes a single listener and shrinks size", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      const listener = jest.fn();
      const cleanup = scope.add(ac.signal, listener);
      expect(scope.size).toBe(1);
      cleanup();
      expect(scope.size).toBe(0);
      ac.abort();
      expect(listener).not.toHaveBeenCalled();
    });

    it("is idempotent when called twice", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      const cleanup = scope.add(ac.signal, jest.fn());
      cleanup();
      expect(() => cleanup()).not.toThrow();
      expect(scope.size).toBe(0);
    });
  });

  describe("dispose", () => {
    it("removes all listeners so none fire afterwards", () => {
      const scope = new AbortableScope();
      const a = new AbortController();
      const b = new AbortController();
      const la = jest.fn();
      const lb = jest.fn();
      scope.add(a.signal, la);
      scope.add(b.signal, lb);
      scope.dispose();
      a.abort();
      b.abort();
      expect(la).not.toHaveBeenCalled();
      expect(lb).not.toHaveBeenCalled();
      expect(scope.size).toBe(0);
    });

    it("is idempotent", () => {
      const scope = new AbortableScope();
      scope.add(new AbortController().signal, jest.fn());
      scope.dispose();
      expect(() => scope.dispose()).not.toThrow();
      expect(scope.isDisposed).toBe(true);
    });

    it("throws when adding after dispose", () => {
      const scope = new AbortableScope();
      scope.dispose();
      expect(() => scope.add(new AbortController().signal, jest.fn())).toThrow(
        "AbortableScope is already disposed",
      );
    });

    it("reports isDisposed correctly", () => {
      const scope = new AbortableScope();
      expect(scope.isDisposed).toBe(false);
      scope.dispose();
      expect(scope.isDisposed).toBe(true);
    });
  });

  describe("Symbol.dispose (explicit resource management)", () => {
    it("disposes via Symbol.dispose", () => {
      const scope = new AbortableScope();
      const ac = new AbortController();
      const listener = jest.fn();
      scope.add(ac.signal, listener);
      scope[Symbol.dispose]?.();
      expect(scope.isDisposed).toBe(true);
      ac.abort();
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
