/**
 * CoverArtistAgent — 封面工程师
 *
 * S5 craft-cover: 三级 fallback（user URL → body 第一张 img → image-gen 或 placehold.co）
 * 输出平台 schema：WeChat thumb_media_id + crop_multi / XHS cover / Twitter og:image。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { buildPromptFromDuty } from "../../services/duty-loader";

const Input = z.object({
  platform: z.string(),
  title: z.string(),
  contentId: z.string(),
  userProvidedCoverUrl: z.string().nullable(),
  bodyFirstImgUrl: z.string().nullable(),
  imageGenerationAllowed: z.boolean(),
});

const CropEntry = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

const Output = z.object({
  platform: z.string(),
  coverUrl: z.string(),
  thumbMediaId: z.string().nullable(),
  cropMultiList: z.array(CropEntry).default([]),
  fallbackUsed: z.enum(["none", "first-body-img", "image-gen", "placehold"]),
});

export type CoverArtistInput = z.infer<typeof Input>;
export type CoverArtistOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "social.cover-artist",
  version: "1.0.0",
  identity: {
    role: "cover-artist",
    description:
      "封面工程师 —— 三级 fallback + crop_multi schema + placehold 兜底",
  },
  loop: "react",
  toolCategories: ["generation", "information"],
  taskProfile: { creativity: "medium", outputLength: "short" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 3_000, maxIterations: 3 },
})
export class CoverArtistAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return buildPromptFromDuty(
      "cover-artist",
      "craft-cover",
      input as unknown as Record<string, unknown>,
    );
  }
}
