/**
 * Ingest baseline snapshot regression — P1 commit 3
 *
 * 退场条件改为 mock-snapshot 回归 (来源:
 * docs/architecture/ai-app/library/wiki/2026-05-12-multi-pass-and-locale-consensus.md
 * §9 P1 退场条件)：在 mock 模式下,LLM 输出由 makeChat().mockResolvedValue 锁定,
 * 改 skill md prompt 不会改变 mock spec 行为。因此 P1 commit 3 的可机器判定
 * 退场断言只能是 snapshot 回归 (固定 mock → 固定 WikiDiff.items + 固定
 * lastIngestMetrics)。真 LLM 改 prompt 后的 H2 出现率 / bodyLen 提升留 P4
 * manual / E2E 验证 (真 BYOK key + 真 KB)。
 *
 * Fixture 包(ff59e6f7a)：
 *  - source-docs/{zh-tech,en-tech,mixed}.md        — 输入 rawContent
 *  - baseline.golden.json {mockedChatResponse,expectedDiffItems,metrics}
 *  - expected-concepts.json {expectedSlugs, ...}   — ground truth 概念清单
 *
 * 每 fixture 3 个 it:
 *  1. WikiDiff.create.mock.calls[0][0].data.items 与 expectedDiffItems 深度相等
 *  2. service.lastIngestMetrics 与 baseline.metrics 字段一致 (subset compare —
 *     baseline 不存 droppedSources / totalSourcesSeen / droppedByReason,
 *     fixture metrics 只锁 pageCount/avgBodyLength/h2CoverageRate/truncatedOneLiners)
 *  3. 每条 mock 输出 creates[].slug 都是 expected-concepts.expectedSlugs 的子集
 *     (mocked 锁定 3 个 slug, expected 是 8-10 个完整概念清单, 自洽性测试)
 */

import * as fs from "fs";
import * as path from "path";
import { WikiIngestService } from "../wiki-ingest.service";

// Reuse the same facade mock as the main spec: spy on wrapExternalContent
// so this spec is isolated from real engine wiring.
jest.mock("../../../../ai-engine/facade", () => {
  const actual = jest.requireActual("../../../../ai-engine/facade");
  return {
    ...actual,
    wrapExternalContent: jest.fn(
      (content: string, opts: { title?: string; maxLength?: number }) =>
        `<external_source title="${opts?.title ?? ""}" maxLength="${
          opts?.maxLength ?? "default"
        }">${content}</external_source>`,
    ),
  };
});

const FIXTURES_DIR = path.join(__dirname, "fixtures", "ingest-baseline");
const SOURCE_DOCS_DIR = path.join(FIXTURES_DIR, "source-docs");

interface BaselineEntry {
  mockedChatResponse: string;
  expectedDiffItems: {
    creates: Array<{ slug: string; [k: string]: unknown }>;
    updates: Array<{ slug: string; [k: string]: unknown }>;
    deletes: string[];
  };
  metrics: {
    pageCount: number;
    avgBodyLength: number;
    h2CoverageRate: number;
    truncatedOneLiners: number;
  };
}

interface ExpectedConceptsEntry {
  expectedSlugs: string[];
  minPageCount: number;
  expectedH2Pattern: string;
  expectedCategories: string[];
}

const baseline = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "baseline.golden.json"), "utf-8"),
) as Record<string, BaselineEntry>;

const expectedConcepts = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, "expected-concepts.json"), "utf-8"),
) as Record<string, ExpectedConceptsEntry>;

// Local mock factories — intentionally NOT imported from wiki-ingest.service.spec.ts
// (spec mocks live inside that file's describe scope; sharing them across specs
// creates cross-file load-order coupling we don't want).
function makePrismaMock(docId: string, rawContent: string) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    knowledgeBaseDocument: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: docId,
          title: docId,
          rawContent,
          rawContentUri: null,
        },
      ]),
    },
    wikiKnowledgeBaseConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    wikiPage: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    wikiDiff: {
      create: jest
        .fn()
        .mockImplementation(
          async ({ data }: { data: Record<string, unknown> }) => ({
            id: "diff-baseline",
            ...data,
          }),
        ),
    },
    knowledgeBase: {
      findUnique: jest.fn().mockResolvedValue({ wikiEnabled: true }),
    },
  };
}

function makeKbService() {
  return { hasAccess: jest.fn().mockResolvedValue(true) };
}

function makeDiffService() {
  return {
    computeKbBaselineHash: jest.fn().mockResolvedValue("baseline-h-fixture"),
  };
}

function makeChat(content: string) {
  return {
    chat: jest.fn().mockResolvedValue({
      content,
      model: "test-model",
      usage: { totalTokens: 0 },
    }),
  };
}

function makeSkillLoader() {
  return {
    getSkillById: jest
      .fn()
      .mockResolvedValue({ content: "wiki-ingest mock system prompt" }),
  };
}

// Map fixture name → synthetic documentId (matches baseline.golden.json sources)
const DOC_IDS: Record<string, string> = {
  "zh-tech.md": "doc-zh-tech",
  "en-tech.md": "doc-en-tech",
  "mixed.md": "doc-mixed",
};

describe("WikiIngestService baseline snapshot regression", () => {
  for (const docName of ["zh-tech.md", "en-tech.md", "mixed.md"] as const) {
    describe(`${docName} fixture`, () => {
      let service: WikiIngestService;
      let prisma: ReturnType<typeof makePrismaMock>;
      const docId = DOC_IDS[docName];
      const rawContent = fs.readFileSync(
        path.join(SOURCE_DOCS_DIR, docName),
        "utf-8",
      );
      const entry = baseline[docName];
      const conceptsEntry = expectedConcepts[docName];

      beforeEach(() => {
        prisma = makePrismaMock(docId, rawContent);
        const kbService = makeKbService();
        const diffService = makeDiffService();
        const chat = makeChat(entry.mockedChatResponse);
        const skillLoader = makeSkillLoader();
        service = new WikiIngestService(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prisma as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          kbService as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          diffService as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chat as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          skillLoader as any,
        );
      });

      it("ingest produces WikiDiff.items matching baseline.golden.expectedDiffItems", async () => {
        await service.ingest("u-baseline", "kb-baseline", [docId]);

        expect(prisma.wikiDiff.create).toHaveBeenCalledTimes(1);
        const [createArgs] = prisma.wikiDiff.create.mock.calls[0] as [
          { data: { items: unknown } },
        ];
        // 深度比对 — soft-drop (sources 4 不变式) + soft-trim (oneLiner > 280)
        // 在 service 内已经把 mockedChatResponse 处理成 expectedDiffItems。
        // toMatchObject 允许 actual 多字段 — P3 批 1 后 zod locale.default('zh')
        // 自动给 creates/updates 加 locale,baseline (P0 mock snapshot) 不含
        // 该字段,subset 比对仍正确。
        expect(createArgs.data.items).toMatchObject(entry.expectedDiffItems);
      });

      it("service.lastIngestMetrics matches baseline.golden.metrics", async () => {
        await service.ingest("u-baseline", "kb-baseline", [docId]);

        const m = service.lastIngestMetrics;
        expect(m).not.toBeNull();
        // baseline 只锁 4 个字段;droppedSources / totalSourcesSeen /
        // droppedByReason 是 service 内部统计,不是退场条件,subset 比较即可。
        expect(m!.pageCount).toBe(entry.metrics.pageCount);
        expect(m!.avgBodyLength).toBe(entry.metrics.avgBodyLength);
        // h2CoverageRate 浮点 — 用 toBeCloseTo (2 位小数,fixture 是 0.67 截断
        // 自实际 2/3 = 0.6667)
        expect(m!.h2CoverageRate).toBeCloseTo(entry.metrics.h2CoverageRate, 2);
        expect(m!.truncatedOneLiners).toBe(entry.metrics.truncatedOneLiners);
      });

      it("expectedSlugs in expected-concepts.json contain all mocked LLM creates[].slug", async () => {
        // mocked LLM output 只锁定 3 个最 representative slug;
        // expected-concepts.json 是真 LLM 该输出的 ~10 个完整概念集合。
        // 这里断言 mocked 是 expected 的 SUBSET — fixture 自洽性测试,确保
        // 我们 mock 的 3 个 slug 真的是 expected ground truth 里的概念,
        // 不是凭空造的字符串。
        await service.ingest("u-baseline", "kb-baseline", [docId]);

        const [createArgs] = prisma.wikiDiff.create.mock.calls[0] as [
          { data: { items: { creates: Array<{ slug: string }> } } },
        ];
        const persistedSlugs = createArgs.data.items.creates.map((c) => c.slug);
        const expectedSlugSet = new Set(conceptsEntry.expectedSlugs);
        for (const slug of persistedSlugs) {
          expect(expectedSlugSet.has(slug)).toBe(true);
        }
      });
    });
  }
});
