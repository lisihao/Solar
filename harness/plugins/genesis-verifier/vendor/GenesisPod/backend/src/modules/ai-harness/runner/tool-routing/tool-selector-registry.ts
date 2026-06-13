/**
 * ToolSelectorRegistry —— 多 selector 共存 + 按 selector id 查找
 *
 * 业务方为不同场景注册不同 selector：
 *   - '{app}.data-source' (按 dimension type / industry 选)
 *   - '{app}.evidence' (优先用 cached / 然后 web)
 *   - 'research.search' (Google + Bing 融合)
 *
 * Loop 调用方在 spec 里声明 selectorId，Harness 通过 registry 查到对应 selector 用。
 */

import { Injectable, Logger } from "@nestjs/common";
import { IToolSelector, SimpleAllowlistSelector } from "./tool-selector";

@Injectable()
export class ToolSelectorRegistry {
  private readonly log = new Logger(ToolSelectorRegistry.name);
  private readonly selectors = new Map<string, IToolSelector>();
  private readonly defaultSelector = new SimpleAllowlistSelector();

  register(selector: IToolSelector): void {
    if (this.selectors.has(selector.id)) {
      this.log.warn(
        `ToolSelector "${selector.id}" already registered — overwriting`,
      );
    }
    this.selectors.set(selector.id, selector);
  }

  get(id?: string): IToolSelector {
    if (!id) return this.defaultSelector;
    return this.selectors.get(id) ?? this.defaultSelector;
  }

  list(): readonly string[] {
    return [...this.selectors.keys()];
  }
}
