import { AsyncLocalStorage } from "async_hooks";

export interface BillingContextData {
  userId: string;
  moduleType: string;
  operationType: string;
  referenceId?: string;
  description?: string;
}

class BillingContextStore {
  private storage = new AsyncLocalStorage<BillingContextData>();

  run<T>(data: BillingContextData, fn: () => T): T {
    return this.storage.run(data, fn);
  }

  get(): BillingContextData | undefined {
    return this.storage.getStore();
  }
}

export const BillingContext = new BillingContextStore();
