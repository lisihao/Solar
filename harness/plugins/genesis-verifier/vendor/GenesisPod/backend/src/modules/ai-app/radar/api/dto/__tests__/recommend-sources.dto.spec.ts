/**
 * RecommendedSourceCandidateDto 单元测试
 *
 * 2026-05-17 prod 事故回归：
 *   LLM (radar-discovery.stage) 返回 confidence 是 0-1 浮点（prompt 明文 +
 *   stage 内 Math.max/min(0,1) clamp），但 DTO 误用 @IsInt() @Max(100)，
 *   iPhone 用户接受 AI 推荐源时 7 个候选全 fail，前端轮询重试日志风暴。
 *
 * 本 spec 锁定 DTO contract：
 *   - 接受 LLM 实际返回的 0-1 float (0.85)
 *   - 拒绝 0-100 老 contract (85)
 *   - 拒 NaN / Infinity / string
 *   - 边界 0 / 1 接受；-0.1 / 1.5 拒
 *   - 缺省可（@IsOptional）
 *
 * 此外校验 AcceptRecommendedSourcesDto nested 校验链路真实工作（防 ValidateNested
 * 配错 ValidationPipe whitelist 后 silently 通过）。
 */

import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  AcceptRecommendedSourcesDto,
  RecommendedSourceCandidateDto,
} from "../recommend-sources.dto";

async function getCandidateErrors(
  payload: Partial<RecommendedSourceCandidateDto>,
) {
  const inst = plainToInstance(RecommendedSourceCandidateDto, payload);
  return validate(inst);
}

const validBase: Partial<RecommendedSourceCandidateDto> = {
  type: "RSS" as RecommendedSourceCandidateDto["type"],
  identifier: "https://openai.com/blog/rss.xml",
  label: "OpenAI Blog",
};

describe("RecommendedSourceCandidateDto.confidence (2026-05-17 prod fix)", () => {
  it("accepts LLM 返回的 0-1 float (0.85)", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: 0.85 });
    expect(errs).toEqual([]);
  });

  it("accepts 边界值 0", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: 0 });
    expect(errs).toEqual([]);
  });

  it("accepts 边界值 1", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: 1 });
    expect(errs).toEqual([]);
  });

  it("rejects 旧 contract 0-100 整数 (85) —— 防回归到 @IsInt", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: 85 });
    expect(errs.length).toBeGreaterThan(0);
    expect(JSON.stringify(errs)).toMatch(/confidence/);
  });

  it("rejects > 1 (1.5)", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: 1.5 });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rejects 负数 (-0.1)", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: -0.1 });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rejects NaN", async () => {
    const errs = await getCandidateErrors({ ...validBase, confidence: NaN });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rejects Infinity", async () => {
    const errs = await getCandidateErrors({
      ...validBase,
      confidence: Infinity,
    });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("rejects string", async () => {
    const errs = await getCandidateErrors({
      ...validBase,
      confidence: "0.85" as unknown as number,
    });
    expect(errs.length).toBeGreaterThan(0);
  });

  it("accepts 缺省 (optional)", async () => {
    const errs = await getCandidateErrors({ ...validBase });
    expect(errs).toEqual([]);
  });
});

describe("AcceptRecommendedSourcesDto.candidates nested validation", () => {
  it("rejects when any candidate has out-of-range confidence (生产事故重现：7 候选全 0.85 float)", async () => {
    // 用旧 contract（整数 85）应被拒，证明 nested 校验链路真实工作
    const inst = plainToInstance(AcceptRecommendedSourcesDto, {
      candidates: [
        { ...validBase, confidence: 85 },
        { ...validBase, identifier: "foo", confidence: 92 },
      ],
    });
    const errs = await validate(inst);
    expect(errs.length).toBeGreaterThan(0);
  });

  it("accepts 7 个候选全 0.85-0.95 float（生产场景）", async () => {
    const inst = plainToInstance(AcceptRecommendedSourcesDto, {
      candidates: Array.from({ length: 7 }, (_, i) => ({
        type: "RSS",
        identifier: `https://acct${i}.example/rss`,
        label: `Account ${i}`,
        rationale: "test",
        confidence: 0.85 + i * 0.01,
      })),
    });
    const errs = await validate(inst);
    expect(errs).toEqual([]);
  });

  it("rejects type=X candidate at DTO layer with isEnum constraint (2026-05-17 业务策略：accept 路径禁 X)", async () => {
    const inst = plainToInstance(AcceptRecommendedSourcesDto, {
      candidates: [
        {
          type: "X",
          identifier: "@elonmusk",
          label: "Elon",
          rationale: "test",
          confidence: 0.9,
        },
      ],
    });
    const errs = await validate(inst);
    // 强断言：必须是 candidates -> nested -> type 的 isEnum 校验失败，
    // 不能用 toMatch(/type/) 宽匹配（防止 @IsEnum 被改成 @IsString 等错改静默通过）
    expect(errs.length).toBeGreaterThan(0);
    const candidateErr = errs.find((e) => e.property === "candidates");
    expect(candidateErr).toBeDefined();
    const typeErr = candidateErr?.children?.[0]?.children?.find(
      (c) => c.property === "type",
    );
    expect(typeErr).toBeDefined();
    expect(typeErr?.constraints).toHaveProperty("isEnum");
  });

  it("rejects > 20 candidates (ArrayMaxSize)", async () => {
    const inst = plainToInstance(AcceptRecommendedSourcesDto, {
      candidates: Array.from({ length: 21 }, () => ({
        ...validBase,
        confidence: 0.5,
      })),
    });
    const errs = await validate(inst);
    expect(errs.length).toBeGreaterThan(0);
  });
});
