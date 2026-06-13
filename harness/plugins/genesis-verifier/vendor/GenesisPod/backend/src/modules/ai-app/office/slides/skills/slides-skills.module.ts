/**
 * Slides Skills Module
 * 幻灯片技能注册模块
 *
 * 职责：
 * - 注册 10 个 code-based Slides 技能到 SkillRegistry
 * - 通过 PromptSkillBridge 自动注册 11 个 prompt 技能（从 SKILL.md）
 *
 * Code-based 技能（NestJS Provider，有 DI 依赖）：
 * - Layer 0: page-pipeline
 * - Layer 3: template-matcher, page-type-selection
 * - Layer 4: template-rendering, chart-renderer, image-fetcher
 * - Layer 4.5: content-analyzer, layout-optimizer
 * - Layer 6: quality-audit
 * - Layer 7: slide-thinking
 *
 * Prompt 技能（SKILL.md → PromptSkillBridge 自动注册）：
 * - task-decomposition, outline-planning, four-step-design,
 *   content-compression, data-supplement, voice-narration,
 *   content-polisher, fact-checker, layout-fixer,
 *   terminology-unifier, transition-checker
 */

import { Module, OnModuleInit, Logger, forwardRef } from "@nestjs/common";
import { HttpModule } from "@nestjs/axios";
import { SkillRegistry, PromptSkillBridge } from "@/modules/ai-harness/facade";
import { SkillLoaderService } from "@/modules/ai-engine/facade";
import { AiEngineModule } from "@/modules/ai-engine/ai-engine.module";
import { AIModelService } from "../../core/ai-model.service";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { BrowserModule } from "@/common/browser/browser.module";

// Code-based skills (NestJS Providers with DI dependencies)
import { PagePipelineSkill } from "./page-pipeline.skill";
import { TemplateMatcherSkill } from "./template-matcher.skill";
import { PageTypeSelectionSkill } from "./page-type-selection.skill";
import { TemplateRenderingSkill } from "./template-rendering.skill";
import { ChartRendererSkill } from "./chart-renderer.skill";
import { ImageFetcherSkill } from "./image-fetcher.skill";
import { ContentAnalyzerSkill } from "./content-analyzer.skill";
import { LayoutOptimizerSkill } from "./layout-optimizer.skill";
import { QualityAuditSkill } from "./quality-audit.skill";
import { SlideThinkingSkill } from "./slide-thinking.skill";
import { SlideHtmlGenerationSkill } from "./slide-html-generation.skill";

// DI-dependent prompt skills (still needed as NestJS providers for controller/service injection)
import { ContentCompressionSkill } from "./content-compression.skill";
import { DataSupplementSkill } from "./data-supplement.skill";
import { VoiceNarrationSkill } from "./voice-narration.skill";
import { LayoutFixerSkill } from "./layout-fixer.skill";
import { ContentPolisherSkill } from "./content-polisher.skill";
import { FactCheckerSkill } from "./fact-checker.skill";

// Enhancement skills (v6.1: quality improvement pipeline)
import { DesignTokenInjectorSkill } from "./design-token-injector.skill";
import { SmartContentExtractorSkill } from "./smart-content-extractor.skill";
import { SlideVisualValidatorSkill } from "./slide-visual-validator.skill";
import { SlideIterativeRefinerSkill } from "./slide-iterative-refiner.skill";
import { DeckConsistencyAuditorSkill } from "./deck-consistency-auditor.skill";
import { SlideSelfHealerSkill } from "./slide-self-healer.skill";

/**
 * Code-based Slides 技能列表
 * (5 pure prompt 技能通过 PromptSkillBridge 从 SKILL.md 自动注册)
 */
const SLIDES_CODE_SKILL_PROVIDERS = [
  // Layer 0 - Orchestration
  PagePipelineSkill,
  // Layer 3 - Template Dispatch
  TemplateMatcherSkill,
  PageTypeSelectionSkill,
  // Layer 4 - Content Generation (code tools)
  TemplateRenderingSkill,
  ChartRendererSkill,
  ImageFetcherSkill,
  SlideHtmlGenerationSkill, // v6.0: AI HTML generation
  ContentCompressionSkill, // DI-dependent: used by page-pipeline, slides-engine
  DataSupplementSkill, // DI-dependent: used by content-compression
  // Layer 4.5 - Content-Driven Layout
  ContentAnalyzerSkill,
  LayoutOptimizerSkill,
  // Layer 5.5 - DI-dependent prompt skills (used by ai-edit.service)
  LayoutFixerSkill,
  ContentPolisherSkill,
  FactCheckerSkill,
  // Layer 6 - Quality Assurance
  QualityAuditSkill,
  // Layer 7 - Monitoring & Transparency
  SlideThinkingSkill,
  // Layer 8 - Voice & Narration (DI-dependent: used by slides.controller)
  VoiceNarrationSkill,
  // Enhancement skills (v6.1: quality improvement pipeline)
  // Layer 2 - Understanding
  SmartContentExtractorSkill,
  // Layer 3 - Design
  DesignTokenInjectorSkill,
  // Layer 5 - Optimization
  SlideIterativeRefinerSkill,
  SlideSelfHealerSkill,
  // Layer 6 - Quality
  SlideVisualValidatorSkill,
  DeckConsistencyAuditorSkill,
];

@Module({
  // 使用 forwardRef 打破循环: AiEngineModule → AiImageModule → AiOfficeModule → SlidesSkillsModule → AiEngineModule
  imports: [
    forwardRef(() => AiEngineModule),
    HttpModule,
    PrismaModule,
    BrowserModule,
  ],
  providers: [AIModelService, ...SLIDES_CODE_SKILL_PROVIDERS],
  exports: [AIModelService, ...SLIDES_CODE_SKILL_PROVIDERS],
})
export class SlidesSkillsModule implements OnModuleInit {
  private readonly logger = new Logger(SlidesSkillsModule.name);

  constructor(
    private readonly skillRegistry: SkillRegistry,
    private readonly promptSkillBridge: PromptSkillBridge,
    // R0-A5: 注册 office slides skills 目录到 engine SkillLoader
    private readonly skillLoader: SkillLoaderService,
    // Code-based skills
    private readonly pagePipeline: PagePipelineSkill,
    private readonly templateMatcher: TemplateMatcherSkill,
    private readonly pageTypeSelection: PageTypeSelectionSkill,
    private readonly templateRendering: TemplateRenderingSkill,
    private readonly chartRenderer: ChartRendererSkill,
    private readonly imageFetcher: ImageFetcherSkill,
    private readonly slideHtmlGeneration: SlideHtmlGenerationSkill,
    private readonly contentAnalyzer: ContentAnalyzerSkill,
    private readonly layoutOptimizer: LayoutOptimizerSkill,
    private readonly qualityAudit: QualityAuditSkill,
    private readonly slideThinking: SlideThinkingSkill,
    // DI-dependent prompt skills
    private readonly contentCompression: ContentCompressionSkill,
    private readonly dataSupplement: DataSupplementSkill,
    private readonly voiceNarration: VoiceNarrationSkill,
    private readonly layoutFixer: LayoutFixerSkill,
    private readonly contentPolisher: ContentPolisherSkill,
    private readonly factChecker: FactCheckerSkill,
    // Enhancement skills
    private readonly designTokenInjector: DesignTokenInjectorSkill,
    private readonly smartContentExtractor: SmartContentExtractorSkill,
    private readonly slideVisualValidator: SlideVisualValidatorSkill,
    private readonly slideIterativeRefiner: SlideIterativeRefinerSkill,
    private readonly deckConsistencyAuditor: DeckConsistencyAuditorSkill,
    private readonly slideSelfHealer: SlideSelfHealerSkill,
  ) {}

  /**
   * 模块初始化时注册技能
   *
   * 1. 注册 code-based skills (NestJS Provider)
   * 2. 通过 PromptSkillBridge 注册 prompt skills (SKILL.md)
   */
  async onModuleInit() {
    // R0-A5 (2026-05-04): 注册 slides skill 目录（替代 engine 硬编码 office/slides/skills）
    const path = await import("path");
    await this.skillLoader.addSkillDirectory({
      path: path.resolve(__dirname),
      domain: "office",
      recursive: false,
    });

    // Step 1: Register code-based skills
    this.logger.log("Registering code-based Slides skills...");

    const codeSkills = [
      this.pagePipeline,
      this.templateMatcher,
      this.pageTypeSelection,
      this.templateRendering,
      this.chartRenderer,
      this.imageFetcher,
      this.slideHtmlGeneration,
      this.contentAnalyzer,
      this.layoutOptimizer,
      this.qualityAudit,
      this.slideThinking,
      // DI-dependent prompt skills (registered here so Bridge skips them)
      this.contentCompression,
      this.dataSupplement,
      this.voiceNarration,
      this.layoutFixer,
      this.contentPolisher,
      this.factChecker,
      // Enhancement skills
      this.designTokenInjector,
      this.smartContentExtractor,
      this.slideVisualValidator,
      this.slideIterativeRefiner,
      this.deckConsistencyAuditor,
      this.slideSelfHealer,
    ];

    let registered = 0;
    for (const skill of codeSkills) {
      try {
        if (this.isValidSkill(skill)) {
          this.skillRegistry.register(skill);
          registered++;
          this.logger.debug(`Registered skill: ${skill.id} (${skill.layer})`);
        } else {
          const skillName =
            skill && typeof skill === "object" && "name" in skill
              ? String((skill as Record<string, unknown>).name)
              : "Unknown Skill";
          this.logger.warn(
            `Skill ${skillName} does not implement ISkill interface, skipping`,
          );
        }
      } catch (error) {
        const errorMsg =
          error instanceof Error
            ? error.message
            : "Unknown error during skill registration";
        this.logger.error(`Failed to register skill: ${errorMsg}`);
      }
    }

    this.logger.log(
      `Code-based skills registered: ${registered}/${codeSkills.length}`,
    );

    // Step 2: Bridge prompt skills from SKILL.md
    this.logger.log("Bridging prompt skills from SKILL.md...");
    const bridgeResult = await this.promptSkillBridge.registerDomain("office");
    this.logger.log(
      `Prompt skills bridged: registered=${bridgeResult.registered.length}, ` +
        `skipped=${bridgeResult.skipped.length}, errors=${bridgeResult.errors.length}`,
    );

    if (bridgeResult.registered.length > 0) {
      this.logger.log(`  registered: [${bridgeResult.registered.join(", ")}]`);
    }
    if (bridgeResult.errors.length > 0) {
      for (const err of bridgeResult.errors) {
        this.logger.error(`  error: ${err.id} - ${err.error}`);
      }
    }

    // 输出注册统计
    const stats = this.skillRegistry.getStats();
    this.logger.debug(`SkillRegistry stats: ${JSON.stringify(stats)}`);
  }

  /**
   * 验证技能是否实现了 ISkill 接口
   */
  private isValidSkill(skill: unknown): skill is {
    id: string;
    name: string;
    description: string;
    layer: string;
    domain: string;
    execute: Function;
  } {
    const s = skill as Record<string, unknown>;
    return (
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      typeof s.description === "string" &&
      typeof s.layer === "string" &&
      typeof s.domain === "string" &&
      typeof s.execute === "function"
    );
  }
}
