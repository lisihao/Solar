import { Test } from "@nestjs/testing";
import { LatexRepairService } from "../latex-repair.service";
import { ChatFacade } from "@/modules/ai-harness/facade";

describe("LatexRepairService", () => {
  let service: LatexRepairService;
  let mockChatFacade: { chat: jest.Mock };

  beforeEach(async () => {
    mockChatFacade = { chat: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LatexRepairService,
        { provide: ChatFacade, useValue: mockChatFacade },
      ],
    }).compile();
    service = moduleRef.get(LatexRepairService);
  });

  describe("early exit (no LLM needed)", () => {
    it("leaves clean markdown untouched without calling LLM", async () => {
      const input = "Good formula: $\\alpha + \\beta$ here.";
      const result = await service.repairMarkdown(input);
      expect(result.changed).toBe(false);
      expect(result.repaired).toBe(input);
      expect(mockChatFacade.chat).not.toHaveBeenCalled();
    });
  });

  describe("LLM repair path", () => {
    it("calls LLM when pre-cleanup does not fully resolve issues", async () => {
      const input = "Bare TTLT_r=\\sum_{s \\in S_r} T_{r,s} in prose.";
      mockChatFacade.chat.mockResolvedValue({
        content: "Bare $TTLT_r=\\sum_{s \\in S_r} T_{r,s}$ in prose.",
        isError: false,
      });
      const result = await service.repairMarkdown(input);
      expect(mockChatFacade.chat).toHaveBeenCalledTimes(1);
      expect(result.changed).toBe(true);
      expect(result.repaired).toContain("$TTLT_r=");
    });

    it("rejects LLM response that lengthens content excessively", async () => {
      const input = "Bare \\frac{a}{b} here.";
      mockChatFacade.chat.mockResolvedValue({
        content: "LONG REWRITE ".repeat(100),
        isError: false,
      });
      const result = await service.repairMarkdown(input);
      expect(result.changed).toBe(false);
      expect(result.failureReason).toBe("llm_response_length_out_of_bounds");
    });

    it("rejects LLM response that does not reduce issues", async () => {
      const input = "Bare \\frac{a}{b} here.";
      mockChatFacade.chat.mockResolvedValue({
        content: "Still \\frac{a}{b} bare.",
        isError: false,
      });
      const result = await service.repairMarkdown(input);
      expect(result.changed).toBe(false);
      expect(result.failureReason).toBe("no_improvement");
    });

    it("keeps original when LLM throws", async () => {
      const input = "Bare \\frac{a}{b} formula.";
      mockChatFacade.chat.mockRejectedValue(new Error("api timeout"));
      const result = await service.repairMarkdown(input);
      expect(result.changed).toBe(false);
      expect(result.failureReason).toContain("llm_error");
    });

    it("strips leading/trailing code fence from LLM response", async () => {
      const input =
        "A paragraph mentioning \\frac{a}{b} in text, without wrappers, quite long.";
      mockChatFacade.chat.mockResolvedValue({
        content:
          "```markdown\nA paragraph mentioning $\\frac{a}{b}$ in text, without wrappers, quite long.\n```",
        isError: false,
      });
      const result = await service.repairMarkdown(input);
      expect(result.repaired).not.toContain("```");
      expect(result.repaired).toContain("$\\frac{a}{b}$");
    });
  });

  // ==================== Boundary-marker defense ====================
  //
  // The user prompt wraps the payload in `--- DOCUMENT START ---` /
  // `--- DOCUMENT END ---`. Some LLMs echo these markers back (and
  // sometimes continue hallucinating new content past the end marker).
  // stripBoundaryMarkers is the safety net — see the cleanup incident
  // where 22 stored reports had up to 2.8 MB of hallucinated tail content.
  describe("boundary-marker stripping", () => {
    it("truncates at first --- DOCUMENT END --- and drops hallucinated tail", async () => {
      const input =
        "Intro with bare \\frac{a}{b} formula embedded inside some prose.";
      // LLM correctly repairs the body but echoes the end marker then
      // hallucinates a whole new section afterward.
      const hallucination =
        "\n\n## 3. New Hallucinated Chapter\n\nThis should never be kept. ".repeat(
          20,
        );
      mockChatFacade.chat.mockResolvedValue({
        content:
          "Intro with bare $\\frac{a}{b}$ formula embedded inside some prose.\n\n--- DOCUMENT END ---" +
          hallucination,
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      expect(result.changed).toBe(true);
      expect(result.repaired).not.toContain("--- DOCUMENT END ---");
      expect(result.repaired).not.toContain("Hallucinated Chapter");
      expect(result.repaired).toContain("$\\frac{a}{b}$");
    });

    it("strips leading --- DOCUMENT START --- prefix without damaging body", async () => {
      const input = "Body with bare \\frac{a}{b} that needs fixing please.";
      mockChatFacade.chat.mockResolvedValue({
        content:
          "--- DOCUMENT START ---\nBody with bare $\\frac{a}{b}$ that needs fixing please.",
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      expect(result.changed).toBe(true);
      expect(result.repaired).not.toContain("DOCUMENT START");
      expect(result.repaired.startsWith("Body with bare")).toBe(true);
    });

    it("handles BOTH markers: strips prefix + truncates at end marker", async () => {
      const input = "Some text with \\frac{x}{y} inline inside this prose.";
      mockChatFacade.chat.mockResolvedValue({
        content:
          "--- DOCUMENT START ---\nSome text with $\\frac{x}{y}$ inline inside this prose.\n--- DOCUMENT END ---\n\nStuff that must be dropped.",
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      expect(result.changed).toBe(true);
      expect(result.repaired).not.toContain("DOCUMENT START");
      expect(result.repaired).not.toContain("DOCUMENT END");
      expect(result.repaired).not.toContain("must be dropped");
      expect(result.repaired).toContain("$\\frac{x}{y}$");
    });

    it("does not strip a non-prefix DOCUMENT START (keeps the body intact)", async () => {
      // If the marker appears mid-body (unusual but possible), leave it —
      // truncating could eat legitimate content. Only prefix matches strip.
      // Input padded so the echoed marker phrase stays within the 85%-120%
      // length-guard envelope.
      const input =
        "Report paragraph one with \\frac{p}{q} embedded in some technical prose. " +
        "The phrase DOCUMENT START is literally quoted inside this sentence body. " +
        "Continuing the paragraph with additional context and filler characters.";
      mockChatFacade.chat.mockResolvedValue({
        content:
          "Report paragraph one with $\\frac{p}{q}$ embedded in some technical prose. " +
          "The phrase --- DOCUMENT START --- is quoted inside this sentence body. " +
          "Continuing the paragraph with additional context and filler characters.",
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      // The quoted marker survived (we only strip leading prefix).
      expect(result.repaired).toContain("DOCUMENT START");
    });

    it("passes through clean responses (no markers) unchanged", async () => {
      const input = "Plain \\frac{a}{b} formula needs repair please here now.";
      mockChatFacade.chat.mockResolvedValue({
        content: "Plain $\\frac{a}{b}$ formula needs repair please here now.",
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      expect(result.changed).toBe(true);
      expect(result.repaired).toBe(
        "Plain $\\frac{a}{b}$ formula needs repair please here now.",
      );
    });

    it("truncates at the FIRST end marker (multiple markers guard)", async () => {
      const input = "Source with \\frac{m}{n} inline in a paragraph here.";
      mockChatFacade.chat.mockResolvedValue({
        content:
          "Source with $\\frac{m}{n}$ inline in a paragraph here.\n--- DOCUMENT END ---\nDROP-1\n--- DOCUMENT END ---\nDROP-2",
        isError: false,
      });

      const result = await service.repairMarkdown(input);

      expect(result.repaired).not.toContain("DROP-1");
      expect(result.repaired).not.toContain("DROP-2");
      expect(result.repaired).not.toContain("DOCUMENT END");
    });
  });

  // ==================== Chunked-path boundary preservation ====================
  //
  // Regression for the 9-章规划-只输出-2-3章 incident: when the doc is
  // larger than MAX_CHUNK_CHARS the repair runs per-H2 chunk. Previously
  // each LLM-repaired chunk was `.trim()`ed and then all chunks were joined
  // with `""`, which ate the trailing `\n` separator between chunks — the
  // next chunk's `## N. 标题` heading fused onto the previous chunk's last
  // character. The frontend chapter splitter is line-anchored (`^##\s+`) so
  // any such glued heading silently hides an entire chapter.
  describe("chunked path — chunk boundary preservation", () => {
    // Build content large enough to trigger chunked repair (>30 KB per
    // MAX_CHUNK_CHARS). Three H2 sections; only the middle one contains
    // a broken bare LaTeX command so only that chunk goes to the LLM.
    const padding = (seed: string, totalLen: number) =>
      seed.repeat(Math.ceil(totalLen / seed.length)).slice(0, totalLen);
    const largeBody = (): string => {
      const prose1 = padding(
        "第一章正文，普通中文段落，不含任何 LaTeX 命令。",
        11000,
      );
      // The middle chunk carries a bare `\frac` that the validator will flag.
      const prose2Clean = padding(
        "第二章正文，普通中文段落，保证长度。",
        10500,
      );
      const prose2 = `${prose2Clean}\n\n该段最终总结：**研究输入**。\nTrailing \\frac{a}{b} formula.`;
      const prose3 = padding(
        "第三章正文，普通中文段落，用来触发 split 边界。",
        11000,
      );
      return [
        `## 1. 第一章标题`,
        prose1,
        ``,
        `## 2. 第二章标题`,
        prose2,
        ``,
        `## 3. 第三章标题`,
        prose3,
        ``,
      ].join("\n");
    };

    it("keeps every `## N.` heading at line start after LLM repair (no glue)", async () => {
      const input = largeBody();
      // Mock LLM: accept the middle chunk, return fixed content WITH trailing
      // whitespace (as real models often do) — the bug was that `.trim()`
      // ate that whitespace AND the chunk-separator `\n`.
      mockChatFacade.chat.mockImplementation(async (opts: unknown) => {
        const req = opts as { messages: Array<{ content: string }> };
        const userPrompt = req.messages[req.messages.length - 1].content;
        // Extract the payload between our document sentinels
        const m = userPrompt.match(
          /--- DOCUMENT START ---\n([\s\S]*?)\n--- DOCUMENT END ---/,
        );
        const payload = m ? m[1] : userPrompt;
        const repaired = payload.replace(/\\frac\{a\}\{b\}/g, "$\\frac{a}{b}$");
        return { content: `${repaired}\n\n  \n   `, isError: false };
      });

      const result = await service.repairMarkdown(input);

      // The repair must at least not reject outright (no_improvement would
      // indicate mock didn't fix the issue). Accept either `changed: true`
      // or `false` but the structural guarantee below must hold either way.
      const h2s = (result.repaired.match(/^##\s+\d+\.\s/gm) || []).length;
      expect(h2s).toBe(3);

      // No glue: the string `## 3.` must be preceded by a newline, never by
      // regular content character.
      const h3Idx = result.repaired.indexOf("## 3. 第三章标题");
      expect(h3Idx).toBeGreaterThan(0);
      expect(result.repaired[h3Idx - 1]).toBe("\n");
    });

    it("chunk whose LLM response has no trailing newline still yields line-start headings", async () => {
      const input = largeBody();
      mockChatFacade.chat.mockImplementation(async (opts: unknown) => {
        const req = opts as { messages: Array<{ content: string }> };
        const userPrompt = req.messages[req.messages.length - 1].content;
        const m = userPrompt.match(
          /--- DOCUMENT START ---\n([\s\S]*?)\n--- DOCUMENT END ---/,
        );
        const payload = m ? m[1] : userPrompt;
        const repaired = payload.replace(/\\frac\{a\}\{b\}/g, "$\\frac{a}{b}$");
        // Deliberately return content with NO trailing whitespace at all —
        // this is the exact shape that triggered the incident (the old
        // `.trim()` produced this shape even from a well-formed response).
        return { content: repaired, isError: false };
      });

      const result = await service.repairMarkdown(input);
      const h2s = (result.repaired.match(/^##\s+\d+\.\s/gm) || []).length;
      expect(h2s).toBe(3);
      const h3Idx = result.repaired.indexOf("## 3. 第三章标题");
      expect(result.repaired[h3Idx - 1]).toBe("\n");
    });
  });
});
