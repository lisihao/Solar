import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";

export interface StrategyRuleEntry {
  id: string;
  condition: string;
  action: string;
  category: "search" | "demo" | "agent";
}

@Injectable()
export class StrategyLoaderService implements OnModuleInit {
  private readonly logger = new Logger(StrategyLoaderService.name);
  private strategies: StrategyRuleEntry[] = [];

  onModuleInit(): void {
    this.loadStrategies();
  }

  private loadStrategies(): void {
    try {
      // __dirname works in both src/ (ts-node) and dist/ (compiled)
      // because nest-cli.json assets copies strategies/*.md to dist/
      const filePath = join(
        __dirname,
        "..",
        "strategies",
        "research-strategies.md",
      );
      const content = readFileSync(filePath, "utf-8");
      this.strategies = this.parseStrategies(content);
      this.logger.log(`Loaded ${this.strategies.length} research strategies`);
    } catch (error) {
      this.logger.warn(
        `Failed to load strategies file: ${error instanceof Error ? error.message : String(error)}`,
      );
      this.strategies = [];
    }
  }

  /**
   * Get strategies applicable to a given topic type.
   * Falls back to 'ALL' condition rules when no type-specific match exists.
   */
  getApplicableStrategies(topicType: string): StrategyRuleEntry[] {
    const typeConditionMap: Record<string, string[]> = {
      product: ["PRODUCT_RESEARCH"],
      market: ["MARKET_RESEARCH", "MARKET_DATA", "GLOBAL_TOPIC"],
      technology: ["TECHNOLOGY_RESEARCH", "TECHNICAL_TOPIC"],
      strategy: ["STRATEGY_RESEARCH"],
      audience: ["AUDIENCE_RESEARCH", "GLOBAL_TOPIC"],
      trend: ["CURRENT_EVENTS", "GLOBAL_TOPIC"],
    };

    const conditions = typeConditionMap[topicType] ?? [];
    return this.strategies.filter(
      (s) =>
        s.condition === "ALL" ||
        conditions.some((c) => s.condition.includes(c)),
    );
  }

  getAllStrategies(): StrategyRuleEntry[] {
    return [...this.strategies];
  }

  private parseStrategies(content: string): StrategyRuleEntry[] {
    const rules: StrategyRuleEntry[] = [];
    let currentCategory: "search" | "demo" | "agent" = "search";
    let ruleIndex = 0;

    for (const line of content.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.startsWith("## Search Rules")) {
        currentCategory = "search";
      } else if (trimmed.startsWith("## Demo Rules")) {
        currentCategory = "demo";
      } else if (trimmed.startsWith("## Agent Config Rules")) {
        currentCategory = "agent";
      } else if (trimmed.startsWith("- ") && trimmed.includes(":")) {
        const colonIndex = trimmed.indexOf(":");
        const condition = trimmed.slice(2, colonIndex).trim();
        const action = trimmed.slice(colonIndex + 1).trim();
        if (condition && action) {
          rules.push({
            id: `rule_${++ruleIndex}`,
            condition,
            action,
            category: currentCategory,
          });
        }
      }
    }

    return rules;
  }
}
