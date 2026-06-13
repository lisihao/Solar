/**
 * AiApiCallerService — 推理模型 token 耗尽自愈（reasoning-token-bump）spec
 *
 * 根因（Railway 日志 2026-06-11/12 实测）：推理模型（deepseek-v4-flash）把 max_tokens
 * 全花在 Chain-of-Thought，可见输出为空 → 旧行为直接抛 Non-retryable 错，无 failover
 * 时整调用废。修复：检测到推理耗尽（visible 空 + reasoning_tokens 占满）时，把 max_tokens
 * 顶到模型已知上限重试一次（只在真耗尽才多花一轮）。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { of } from "rxjs";
import { AiApiCallerService } from "../ai-api-caller.service";
import { OpenaiCaller } from "../openai-caller";
import { AnthropicCaller } from "../anthropic-caller";
import { CohereCaller } from "../cohere-caller";
import { GoogleCaller } from "../google-caller";
import { XaiCaller } from "../xai-caller";
import { ModelCapabilityService } from "../../models/capability/model-capability.service";
import type { ChatMessage } from "../../types/task-profile.types";

/** 推理耗尽帧：可见 content 空，reasoning_tokens 占满 completion_tokens（>90%），finish=length */
function makeReasoningExhausted() {
  return of({
    data: {
      choices: [{ message: { content: "" }, finish_reason: "length" }],
      usage: {
        total_tokens: 8100,
        prompt_tokens: 100,
        completion_tokens: 7900,
        completion_tokens_details: { reasoning_tokens: 7900 },
      },
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as Record<string, unknown>,
  } as never);
}

function makeOk(content: string) {
  return of({
    data: {
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { total_tokens: 200, prompt_tokens: 100, completion_tokens: 100 },
    },
    status: 200,
    statusText: "OK",
    headers: {},
    config: {} as Record<string, unknown>,
  } as never);
}

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: "Summarize." },
];

describe("AiApiCallerService — 推理 token 耗尽自愈", () => {
  let service: AiApiCallerService;
  let httpMock: { post: jest.Mock };

  beforeEach(async () => {
    httpMock = { post: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiApiCallerService,
        OpenaiCaller,
        AnthropicCaller,
        CohereCaller,
        GoogleCaller,
        XaiCaller,
        { provide: HttpService, useValue: httpMock },
        ModelCapabilityService,
      ],
    }).compile();
    service = module.get<AiApiCallerService>(AiApiCallerService);
  });

  afterEach(() => jest.clearAllMocks());

  it("推理耗尽 → 顶高 max_tokens 重试一次 → 拿到输出（不再判废）", async () => {
    httpMock.post
      .mockReturnValueOnce(makeReasoningExhausted())
      .mockReturnValueOnce(makeOk("最终摘要内容"));

    const res = await service.callOpenAICompatibleAPI(
      "https://api.deepseek.com/v1/chat/completions",
      "ds-key",
      "deepseek-v4-flash",
      MESSAGES,
      8000, // 初始 max_tokens（被耗尽）
      undefined,
      120000,
      "max_tokens",
      undefined,
      undefined,
      undefined,
      undefined,
      true, // isReasoning
      undefined, // 非 JSON → 跳过 salvage/degrade，直达 token-bump
      undefined,
      undefined,
      undefined,
      "deepseek",
    );

    expect(res.content).toBe("最终摘要内容");
    expect(httpMock.post).toHaveBeenCalledTimes(2);
    // 第二次请求的 max_tokens 被顶高（预留输出空间）
    const retryBody = httpMock.post.mock.calls[1][1] as Record<string, unknown>;
    expect(retryBody["max_tokens"] as number).toBeGreaterThan(8000);
  });

  it("耗尽且重试仍空 → 抛推理耗尽错（交上层 failover），且只重试一次", async () => {
    httpMock.post
      .mockReturnValueOnce(makeReasoningExhausted())
      .mockReturnValueOnce(makeReasoningExhausted());

    await expect(
      service.callOpenAICompatibleAPI(
        "https://api.deepseek.com/v1/chat/completions",
        "ds-key",
        "deepseek-v4-flash",
        MESSAGES,
        8000,
        undefined,
        120000,
        "max_tokens",
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
        "deepseek",
      ),
    ).rejects.toThrow(/推理模型的 token 全部用于内部思考/);
    // 单次 bump 预算：1 原始 + 1 重试 = 2，不死循环
    expect(httpMock.post).toHaveBeenCalledTimes(2);
  });
});
