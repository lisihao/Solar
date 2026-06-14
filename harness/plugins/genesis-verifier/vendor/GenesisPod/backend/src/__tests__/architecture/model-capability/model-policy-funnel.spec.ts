/**
 * Model Policy Funnel — 架构看护测试（Capability Contract · Guard）
 *
 * 2026-05-21 根因治理：模型选择曾被 5 套机制各自断言，导致"配了 grok-4 却用
 * grok-3-mini"。根治方案是在 AiChatService 的 modelType→model 解析处设单一权威
 * （resolveEffectiveModelType，见 ai-engine/llm/models/selection/model-policy.ts），所有
 * 调用经此漏斗按 downgradePolicy 解析。
 *
 * 本 spec 锁住该不变量：**任何人移除 AiChatService 里的策略闸 → 这条测试就挂。**
 * 这是"彻底解决（不可复发）"的守护，与 model-policy.spec.ts（解析器单测）belt-and-suspenders。
 *
 * 注：禁止"散落 modelType: CHAT_FAST 绕过漏斗"的存量 burn-down 守护放在 P3
 * （需先把 ~40 处内联迁移到 resolver 调用，再加 no-direct-tier 断言 + baseline）。
 */

import * as fs from "fs";
import * as path from "path";

const AI_CHAT_SERVICE = path.resolve(
  __dirname,
  "../../../modules/ai-engine/llm/chat/ai-chat.service.ts",
);

function readSource(): string {
  return fs.readFileSync(AI_CHAT_SERVICE, "utf-8");
}

/** 去掉注释，只看真实代码（避免注释里的字样误判）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("Capability Contract · model policy funnel guard", () => {
  it("AiChatService imports the single-authority resolver", () => {
    const code = stripComments(readSource());
    expect(code).toMatch(
      /import\s*\{[^}]*resolveEffectiveModelType[^}]*\}\s*from\s*["'][^"']*selection\/model-policy["']/,
    );
  });

  it("AiChatService invokes resolveEffectiveModelType in the resolution path", () => {
    const code = stripComments(readSource());
    // 必须有真实调用（不只是 import），否则漏斗形同虚设
    expect(code).toMatch(/resolveEffectiveModelType\s*\(/);
  });

  it("AiChatService reads the downgrade policy via normalizeDowngradePolicy", () => {
    const code = stripComments(readSource());
    expect(code).toMatch(/normalizeDowngradePolicy\s*\(/);
  });

  // ★ 2026-05-21 多路审视发现的 BLOCKER：失败 fallback 池曾用 raw modelType（CHAT_FAST）
  //   绕过策略闸。下面两条锁住"模型池查询必须喂 effectiveModelType"，防回归。
  it("fallback model pool query uses the effective type, not raw modelType", () => {
    const code = stripComments(readSource());
    // fallback 调用以 triedModelIds 为第二参 —— 必须喂 effectiveModelType（而非 raw
    // modelType）。这正是多路审视发现的 BLOCKER，锁死防回归。
    expect(code).toMatch(
      /getAllEnabledModelsByType\(\s*effectiveModelType,\s*triedModelIds/,
    );
  });

  it("model resolution (incl. chatStream) routes through the effective type", () => {
    const code = stripComments(readSource());
    expect(code).toMatch(/getDefaultModelByType\(\s*effectiveModelType/);
  });

  it("the model-policy module exposes quality-first as the default", () => {
    const policySrc = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../modules/ai-engine/llm/models/selection/model-policy.ts",
      ),
      "utf-8",
    );
    expect(policySrc).toMatch(
      /DEFAULT_DOWNGRADE_POLICY[^=]*=\s*["']quality-first["']/,
    );
  });
});
