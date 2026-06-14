/**
 * AI Image Service (Refactored)
 *
 * This is the main facade service that coordinates image generation by delegating
 * to specialized services for prompt enhancement, image generation, and storage.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  MessageEvent,
  Optional,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { Observable, Subject } from "rxjs";
import { BillingContext } from "../../../platform/facade";
// 直接从具体文件导入，避免通过 barrel export 引发循环依赖
import { ContentExtractorService } from "../../../../common/content-processing/content-extractor.service";
import {
  DataFetchingService,
  DataFetchingResult,
} from "../../../../common/content-processing/data-fetching.service";
import { AIModelType, Prisma } from "@prisma/client";
import { ChatFacade } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  MissionContext,
} from "@/modules/ai-harness/facade";
import { LruMap } from "@/common/utils/lru-map";
import {
  ProcessingStep,
  PromptEngineeringInsights,
  GeneratedImageResult,
  GenerateImageOptions,
  createDefaultInsights,
} from "../core/image.types";

// Re-export types for external modules
export type { GeneratedImageResult } from "../core/image.types";
import {
  InfographicTemplateService,
  InfographicContent,
  InfographicSection,
} from "../infographic/infographic.service";
import { PromptEnhancementService } from "./prompt-enhancement.service";
import { ImageGenerationService } from "./image-generation.service";
import { ImageStorageService } from "../storage/storage.service";
import { Imagen4PromptService } from "./imagen4-prompt.service";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  USER_EVENT_NAME,
  MODULE,
  ACTION,
  type UserEventPayload,
} from "@/common/observability/user-event.types";
import {
  parseUrlInput,
  getUrlStepTitle,
  extractCleanContent,
  mergeNegativePrompts,
  formatInformationArchitectureStep,
  getDimensions,
} from "../core/image.utils";
import {
  MIN_CONTENT_LENGTH,
  MIN_PROMPT_LENGTH,
  CONTENT_PREVIEW_LENGTH,
  URL_CONTENT_PREVIEW_LENGTH,
} from "../core/image.constants";

@Injectable()
export class AiImageService {
  private readonly logger = new Logger(AiImageService.name);
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentExtractor: ContentExtractorService,
    private readonly infographicTemplate: InfographicTemplateService,
    private readonly dataFetchingService: DataFetchingService,
    private readonly promptEnhancementService: PromptEnhancementService,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly imageStorageService: ImageStorageService,
    private readonly imagen4PromptService: Imagen4PromptService,
    private readonly chatFacade: ChatFacade,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Get all available models (text + image)
   * ★ 完全通过 AIFacade 获取，不再直接访问数据库
   */
  async getAvailableModels() {
    // Use AIFacade to get available models (now includes icon and isDefault)
    const textModelsData = await this.chatFacade.getAvailableModels(
      AIModelType.CHAT,
    );
    const imageModelsData = await this.chatFacade.getAvailableModels(
      AIModelType.IMAGE_GENERATION,
    );

    this.logger.log(
      `[getAvailableModels] Found ${textModelsData.length} CHAT models, ${imageModelsData.length} IMAGE_GENERATION models`,
    );

    // Map to UI-friendly format (AIFacade now returns icon and isDefault)
    const textModels = textModelsData.map((m) => ({
      id: m.dbId || m.id,
      name: m.name,
      provider: m.provider,
      modelId: m.id,
      icon: m.icon,
      isDefault: m.isDefault || false,
    }));

    const imageModels = imageModelsData.map((m) => ({
      id: m.dbId || m.id,
      name: m.name,
      provider: m.provider,
      modelId: m.id,
      icon: m.icon,
      isDefault: m.isDefault || false,
    }));

    return {
      textModels,
      imageModels,
    };
  }

  /**
   * SSE streaming image generation - real-time progress updates
   */
  generateImageStream(options: GenerateImageOptions): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();

    const executeWithBilling = () =>
      this.executeStreamGeneration(options, subject);
    const billingWrapped = options.userId
      ? () =>
          BillingContext.run(
            {
              userId: options.userId!,
              moduleType: "ai-image",
              operationType: "generate",
              description: `图片生成`,
            },
            executeWithBilling,
          )
      : executeWithBilling;
    billingWrapped().catch((error) => {
      this.logger.error(`Stream generation error: ${error.message}`);
      subject.next({
        data: JSON.stringify({
          type: "error",
          error: error.message,
        }),
      });
      subject.complete();
    });

    return subject.asObservable();
  }

  /**
   * Execute streaming generation (internal method)
   */
  private async executeStreamGeneration(
    options: GenerateImageOptions,
    subject: Subject<MessageEvent>,
  ): Promise<void> {
    const {
      prompt,
      urls,
      content,
      imageBase64,
      files,
      imageModelId,
      style,
      aspectRatio,
      negativePrompt,
      skipEnhancement,
      templateLayout: userTemplateLayout,
      userId,
    } = options;

    // Generate a request ID for kernel process tracking
    const requestId = randomUUID();

    // Spawn AI Kernel process for tracking
    if (this.missionExecutor && userId) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "image-generation",
          teamSessionId: requestId,
          input: {
            prompt: (prompt || "").slice(0, 200),
            hasUrls: !!(urls && urls.length > 0),
          },
        });
        this.kernelProcessIds.set(requestId, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    const imgProcessId = this.kernelProcessIds.get(requestId);

    const runGeneration = async () => {
      let mergedNegativePrompt = negativePrompt?.trim();
      const processingSteps: ProcessingStep[] = [];

      const emitStep = (
        stepId: string,
        title: string,
        status: ProcessingStep["status"],
        stepContent?: string,
      ) => {
        const step: ProcessingStep = {
          step: stepId,
          title,
          status,
          content: stepContent,
          timestamp: new Date().toISOString(),
        };

        const existing = processingSteps.find((s) => s.step === stepId);
        if (existing) {
          Object.assign(existing, step);
        } else {
          processingSteps.push(step);
        }

        subject.next({
          data: JSON.stringify({
            type: "step",
            step,
            allSteps: processingSteps,
          }),
        });
      };

      try {
        // Validation
        const hasUrls = urls && urls.length > 0 && urls.some((u) => u.trim());
        const hasFiles = files && files.length > 0;
        if (!prompt && !hasUrls && !content && !imageBase64 && !hasFiles) {
          throw new BadRequestException("At least one input is required");
        }

        // Step 1: Content Extraction
        this.logger.log(
          "========== STREAM STEP 1: Content Extraction ==========",
        );
        const contentParts: string[] = [];

        if (prompt) {
          contentParts.push(`User prompt: ${prompt}`);
          emitStep("prompt_input", "User Prompt Received", "completed", prompt);
        }

        if (hasUrls) {
          for (const urlInput of urls) {
            if (!urlInput.trim()) continue;

            const { url: trimmedUrl, description: userDescription } =
              parseUrlInput(urlInput);
            const stepId = `url_${Date.now()}`;
            const stepTitle = getUrlStepTitle(trimmedUrl, "extracting");

            emitStep(stepId, stepTitle, "processing", trimmedUrl);
            this.logger.log(
              `[STREAM 1] Extracting content from: ${trimmedUrl}`,
            );

            try {
              const urlContent =
                await this.contentExtractor.extractFromUrl(trimmedUrl);
              const cleanContent = extractCleanContent(urlContent);

              if (cleanContent.length < MIN_CONTENT_LENGTH) {
                emitStep(
                  stepId,
                  `${stepTitle} - Failed`,
                  "error",
                  `Insufficient content extracted (${cleanContent.length} chars)`,
                );
                throw new Error(
                  `Failed to extract sufficient content from ${trimmedUrl}`,
                );
              }

              contentParts.push(`Content from ${trimmedUrl}:\n${urlContent}`);
              if (userDescription) {
                contentParts.push(
                  `User instruction for this content: ${userDescription}`,
                );
              }

              let stepContent =
                urlContent.slice(0, URL_CONTENT_PREVIEW_LENGTH) +
                (urlContent.length > URL_CONTENT_PREVIEW_LENGTH ? "..." : "");
              if (userDescription) {
                stepContent += `\n\n📝 User instruction: ${userDescription}`;
              }

              emitStep(
                stepId,
                getUrlStepTitle(trimmedUrl, "extracted"),
                "completed",
                stepContent,
              );
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : "Unknown error";
              emitStep(stepId, `${stepTitle} - Failed`, "error", errorMsg);
              throw error;
            }
          }
        }

        if (content) {
          contentParts.push(`Text content:\n${content}`);
          emitStep(
            "text_content",
            "Text Content Received",
            "completed",
            content.slice(0, CONTENT_PREVIEW_LENGTH) +
              (content.length > CONTENT_PREVIEW_LENGTH ? "..." : ""),
          );
        }

        if (hasFiles) {
          for (const file of files) {
            const stepId = `file_${file.filename}`;
            emitStep(stepId, `Processing ${file.filename}`, "processing");

            try {
              const fileContent = await this.contentExtractor.extractFromFile(
                file.buffer,
                file.mimeType,
                file.filename,
              );
              contentParts.push(
                `Content from file "${file.filename}":\n${fileContent}`,
              );
              emitStep(
                stepId,
                `Extracted from ${file.filename}`,
                "completed",
                fileContent.slice(0, CONTENT_PREVIEW_LENGTH) +
                  (fileContent.length > CONTENT_PREVIEW_LENGTH ? "..." : ""),
              );
            } catch (error) {
              const errorMsg =
                error instanceof Error ? error.message : "Unknown error";
              emitStep(
                stepId,
                `Failed to process ${file.filename}`,
                "error",
                errorMsg,
              );
              throw error;
            }
          }
        }

        if (imageBase64) {
          emitStep(
            "image_reference",
            "Reference Image Prepared",
            "completed",
            "Image will be used as reference for generation",
          );
        }

        let inputContent = contentParts.join("\n\n---\n\n");

        // Content validation
        const hasDirectPrompt = !!prompt && prompt.trim().length > 0;
        const hasReferenceImage = !!imageBase64;
        if (
          inputContent.length < MIN_CONTENT_LENGTH &&
          !hasDirectPrompt &&
          !hasReferenceImage
        ) {
          throw new Error("No valid content could be extracted from the input");
        }

        if (inputContent.length < MIN_PROMPT_LENGTH && !hasReferenceImage) {
          throw new Error("Please provide a more detailed prompt");
        }

        emitStep(
          "content_check",
          "Content Extraction Complete",
          "completed",
          `${inputContent.length} characters`,
        );

        // Step 1.5: Smart Data Fetching
        let dataFetchingResult: DataFetchingResult | null = null;
        try {
          const detection =
            this.dataFetchingService.detectDataFetchingNeed(inputContent);

          if (detection.needsFetching) {
            emitStep(
              "data_fetching",
              "Fetching Real-time Data",
              "processing",
              `Intent: ${detection.intent}`,
            );

            const fetchPromise =
              this.dataFetchingService.processDataFetching(inputContent);
            const timeoutPromise = new Promise<DataFetchingResult>(
              (_, reject) =>
                setTimeout(
                  () => reject(new Error("Data fetching timeout (5s)")),
                  5000,
                ),
            );

            try {
              dataFetchingResult = await Promise.race([
                fetchPromise,
                timeoutPromise,
              ]);

              if (dataFetchingResult.fetchedData.length > 0) {
                inputContent = dataFetchingResult.enrichedContent;
                emitStep(
                  "data_fetching",
                  "Real-time Data Retrieved",
                  "completed",
                  `Fetched ${dataFetchingResult.fetchedData.length} data sources`,
                );
              } else {
                emitStep(
                  "data_fetching",
                  "No External Data Found",
                  "completed",
                  "Proceeding with original content",
                );
              }
            } catch (timeoutError) {
              emitStep(
                "data_fetching",
                "Data Fetching Skipped",
                "completed",
                "Timeout - proceeding with original content",
              );
            }
          }
        } catch (error) {
          this.logger.error(`[STREAM 1.5] Data fetching error: ${error}`);
        }

        // Step 2: AI Prompt Generation (with 4-Agent Visual Design Team)
        this.logger.log(
          "========== STREAM STEP 2: AI Prompt Generation ==========",
        );
        let textModelUsed: string | undefined;
        let promptInsights = createDefaultInsights(inputContent);
        let enhancedPrompt = "";

        if (skipEnhancement) {
          textModelUsed = "Direct Input";
          promptInsights.renderingMode = "ai_image";
          promptInsights.imagePrompt = inputContent;
          emitStep("prompt_generate", "Using Direct Input", "completed");
        } else {
          // Try 4-Agent Visual Design Team first
          let use4AgentTeam = true;

          try {
            emitStep(
              "team_collaboration",
              "Visual Design Team 协作中",
              "processing",
              "4-Agent 协作：Content → Layout → Visual → Style",
            );

            // Use Imagen4PromptService for 4-agent collaboration
            const imagen4Result =
              await this.imagen4PromptService.generateImagen4Prompt(
                {
                  prompt: inputContent,
                  content,
                  urls,
                  style,
                  aspectRatio: aspectRatio as "1:1" | "16:9" | "9:16" | "4:3",
                  templateLayout: userTemplateLayout,
                },
                (event) => {
                  // Progress callback for each agent phase
                  const phaseNames: Record<string, string> = {
                    content: "Content Agent 内容分析",
                    layout: "Layout Agent 构图规划",
                    visual: "Visual Agent 视觉设计",
                    style: "Style Agent Prompt 生成",
                    complete: "团队协作完成",
                  };
                  const statusText =
                    event.status === "started"
                      ? "开始"
                      : event.status === "completed"
                        ? "完成"
                        : "进行中";
                  emitStep(
                    `agent_${event.phase}`,
                    `${phaseNames[event.phase] || event.phase} ${statusText}`,
                    event.status === "failed"
                      ? "error"
                      : event.status === "completed"
                        ? "completed"
                        : "processing",
                    event.message,
                  );
                },
              );

            // Use the 4-agent result
            promptInsights = imagen4Result.insights;
            promptInsights.imagePrompt = imagen4Result.finalPrompt;
            mergedNegativePrompt = mergeNegativePrompts(mergedNegativePrompt, [
              imagen4Result.negativePrompt,
            ]);
            textModelUsed = "Visual Design Team (4-Agent)";

            emitStep(
              "team_collaboration",
              "Visual Design Team 协作完成",
              "completed",
              `生成 Imagen 4 优化 Prompt: ${imagen4Result.finalPrompt.slice(0, 150)}...`,
            );

            this.logger.log(
              `[STREAM 2] 4-Agent collaboration completed in ${imagen4Result.statistics.totalDuration}ms`,
            );
          } catch (teamError) {
            // Fallback to original single LLM approach
            use4AgentTeam = false;
            this.logger.warn(
              `[STREAM 2] Team collaboration failed, falling back to single LLM: ${teamError instanceof Error ? teamError.message : teamError}`,
            );
            emitStep(
              "team_collaboration",
              "团队协作失败，使用快速模式",
              "completed",
              "回退到单次 LLM 调用",
            );
          }

          // Fallback: Original single LLM approach
          if (!use4AgentTeam) {
            emitStep(
              "prompt_generate",
              "Generating Image Prompt with AI",
              "processing",
            );

            const textModel =
              await this.imageGenerationService.getDefaultTextModel();
            if (!textModel) {
              emitStep(
                "prompt_generate",
                "No Text Model Available",
                "error",
                "Please configure a text model",
              );
              throw new Error("No text model configured");
            }

            textModelUsed = textModel.displayName;
            emitStep("prompt_generate", `Using ${textModelUsed}`, "processing");

            // ★ 使用 enhancePromptWithLLM，内部通过 AIFacade 调用 LLM
            const rawEnhancedPrompt =
              await this.promptEnhancementService.enhancePromptWithLLM(
                inputContent,
                textModel.modelId,
              );

            promptInsights =
              this.promptEnhancementService.parsePromptEnhancementResponse(
                rawEnhancedPrompt,
                inputContent,
              );
            emitStep(
              "prompt_generate",
              "AI Prompt Generated",
              "completed",
              promptInsights.imagePrompt?.slice(0, 200) + "...",
            );
          }
        }

        const composedPrompt =
          this.promptEnhancementService.composeFinalImagePrompt(
            promptInsights,
            style,
          );
        enhancedPrompt = composedPrompt.prompt;
        mergedNegativePrompt = mergeNegativePrompts(
          mergedNegativePrompt,
          composedPrompt.negativeCandidates,
        );

        // Emit prompt insights
        if (promptInsights.designJournal.length > 0) {
          promptInsights.designJournal.forEach((entry, index) => {
            emitStep(
              `prompt_journal_${index + 1}`,
              entry.title || `Design Journal Step ${index + 1}`,
              "completed",
              entry.narrative,
            );
          });
        }

        const infoStep = formatInformationArchitectureStep(
          promptInsights.informationArchitecture,
        );
        if (infoStep) {
          emitStep(
            "prompt_information",
            "Information Architecture",
            "completed",
            infoStep,
          );
        }

        // Step 3: Image Generation
        this.logger.log(
          "========== STREAM STEP 3: Image Generation ==========",
        );
        const dimensions = getDimensions(aspectRatio || "1:1");
        let generatedImageUrl: string | undefined;
        let imageModelUsed: string = "HTML Renderer";

        const renderingMode = promptInsights.renderingMode;

        if (renderingMode === "html_render" || renderingMode === "hybrid") {
          emitStep(
            "html_render",
            renderingMode === "hybrid"
              ? "Generating HTML Infographic with AI Background"
              : "Generating HTML Infographic",
            "processing",
          );

          try {
            if (userTemplateLayout) {
              promptInsights.templateLayout = userTemplateLayout;
            }

            const infographicContent =
              this.convertToInfographicContent(promptInsights);
            let backgroundImageBase64: string | undefined;

            if (renderingMode === "hybrid") {
              emitStep(
                "background_gen",
                "Generating AI Background",
                "processing",
              );

              const imageModelConfig = imageModelId
                ? await this.imageGenerationService.getModelById(imageModelId)
                : await this.imageGenerationService.getDefaultImageModel();

              // ★ 检查 apiKey 或 secretKey 存在（secretKey 通过 SecretsService 解析）
              if (
                imageModelConfig &&
                (imageModelConfig.apiKey || imageModelConfig.secretKey)
              ) {
                try {
                  const bgPrompt =
                    promptInsights.backgroundPrompt ||
                    "Abstract professional background, subtle geometric patterns, gradient, modern, clean";
                  backgroundImageBase64 =
                    await this.imageGenerationService.callImageGenerationAPI(
                      imageModelConfig,
                      bgPrompt,
                      dimensions,
                      mergedNegativePrompt,
                      undefined,
                      userId,
                    );
                  imageModelUsed = imageModelConfig.displayName;
                  emitStep(
                    "background_gen",
                    `Background Generated with ${imageModelUsed}`,
                    "completed",
                  );
                } catch (error) {
                  emitStep(
                    "background_gen",
                    "Background Generation Skipped",
                    "completed",
                    "Using solid color background",
                  );
                }
              }
            }

            emitStep("html_render", "Rendering HTML Template", "processing");
            generatedImageUrl =
              await this.infographicTemplate.generateInfographic(
                infographicContent,
                backgroundImageBase64 ? { backgroundImageBase64 } : undefined,
              );
            emitStep("html_render", "HTML Infographic Complete", "completed");

            if (renderingMode === "hybrid") {
              imageModelUsed = `HTML + ${imageModelUsed}`;
            }
          } catch (error) {
            emitStep("html_render", "HTML Rendering Failed", "error");
            throw error;
          }
        } else {
          // ai_image mode
          emitStep("ai_image", "Generating Pure AI Image", "processing");

          const imageModelConfig = imageModelId
            ? await this.imageGenerationService.getModelById(imageModelId)
            : await this.imageGenerationService.getDefaultImageModel();

          // ★ 检查 apiKey 或 secretKey 存在
          if (!imageModelConfig?.apiKey && !imageModelConfig?.secretKey) {
            emitStep("ai_image", "No Image Model Available", "error");
            throw new Error("No image model configured");
          }

          imageModelUsed = imageModelConfig.displayName;
          emitStep("ai_image", `Using ${imageModelUsed}`, "processing");

          generatedImageUrl =
            await this.imageGenerationService.callImageGenerationAPI(
              imageModelConfig,
              enhancedPrompt,
              dimensions,
              mergedNegativePrompt,
              imageBase64,
              userId,
            );
          emitStep("ai_image", "AI Image Generated", "completed");
        }

        if (!generatedImageUrl) {
          throw new Error("Image generation failed");
        }

        // Step 4: Save to database
        emitStep("save_db", "Saving to Database", "processing");

        const uploadedImageUrl =
          await this.imageStorageService.uploadImageToStorage(
            generatedImageUrl,
            userId,
          );

        const savedImage = await this.prisma.generatedImage.create({
          data: {
            prompt: prompt || inputContent.slice(0, 500),
            enhancedPrompt: enhancedPrompt?.slice(0, 2000),
            imageUrl: uploadedImageUrl,
            width: dimensions.width,
            height: dimensions.height,
            userId: userId || null,
            textModelUsed: textModelUsed || null,
            imageModelUsed: imageModelUsed || null,
            isBookmarked: false,
            processingSteps:
              processingSteps as unknown as Prisma.InputJsonValue,
            promptInsights: promptInsights as unknown as Prisma.InputJsonValue,
          },
        });

        emitStep("save_db", "Saved to Database", "completed");

        if (this.eventEmitter && userId) {
          this.eventEmitter.emit(USER_EVENT_NAME, {
            userId,
            module: MODULE.AI_IMAGE,
            action: ACTION.COMPLETED,
            resourceType: "GeneratedImage",
            resourceId: savedImage.id,
          } satisfies UserEventPayload);
        }

        // Cleanup old images
        if (userId) {
          await this.imageStorageService.cleanupOldImages(userId);
        }

        // Send final result
        subject.next({
          data: JSON.stringify({
            type: "complete",
            result: {
              id: savedImage.id,
              imageUrl: uploadedImageUrl,
              prompt: prompt || inputContent.slice(0, 500),
              enhancedPrompt,
              width: dimensions.width,
              height: dimensions.height,
              createdAt: savedImage.createdAt.toISOString(),
              processingSteps,
              textModelUsed,
              imageModelUsed,
              promptInsights,
            },
          }),
        });

        // Complete AI Kernel process
        this.completeKernelProcess(requestId, { imageId: savedImage.id });

        subject.complete();
      } catch (error) {
        this.logger.error(`Stream generation failed: ${error}`);
        // Fail AI Kernel process
        this.failKernelProcess(
          requestId,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    };

    if (imgProcessId) {
      await MissionContext.run(
        { agentProcessId: imgProcessId, userId, agentId: "image-generation" },
        runGeneration,
      );
    } else {
      await runGeneration();
    }
  }

  private completeKernelProcess(
    requestId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(requestId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(requestId);
  }

  private failKernelProcess(requestId: string, error: string): void {
    const processId = this.kernelProcessIds.get(requestId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to fail process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(requestId);
  }

  /**
   * Generate image (non-streaming version)
   */
  async generateImage(
    options: GenerateImageOptions,
  ): Promise<GeneratedImageResult> {
    // Implementation similar to executeStreamGeneration but without streaming
    // For brevity, delegating to stream version and collecting result
    return new Promise((resolve, reject) => {
      let result: GeneratedImageResult | null = null;

      this.generateImageStream(options).subscribe({
        next: (event) => {
          const data = JSON.parse(event.data as string);
          if (data.type === "complete") {
            result = data.result;
          } else if (data.type === "error") {
            reject(new Error(data.error));
          }
        },
        complete: () => {
          if (result) {
            resolve(result);
          } else {
            reject(new Error("Generation completed without result"));
          }
        },
        error: (err) => reject(err),
      });
    });
  }

  /**
   * Convert PromptEngineeringInsights to InfographicContent
   */
  private convertToInfographicContent(
    insights: PromptEngineeringInsights,
  ): InfographicContent {
    const info = insights.informationArchitecture;
    const visual = insights.visualLanguage;

    this.logger.log(
      `[convertToInfographicContent] Title: ${info.title}, Sections count: ${info.sections?.length || 0}`,
    );

    let sections: InfographicSection[] = [];

    if (info.sections && info.sections.length > 0) {
      sections = info.sections.map((section) => ({
        title: section.title || "Section",
        summary: section.summary,
        bullets: section.bullets || [],
        metrics: (section.metrics || []).map((m) => ({
          label: m.label || "",
          value: m.value || "",
          comparison: m.comparison,
        })),
        iconType: section.iconType || section.visual?.type,
        sectionType: section.sectionType,
      }));
    } else {
      // Fallback: create simple content from prompt
      this.logger.warn(
        "[convertToInfographicContent] No sections found, creating fallback content",
      );

      const promptText = insights.imagePrompt || "";
      const lines = promptText
        .split(/[.。\n]/)
        .filter((line) => line.trim().length > 10)
        .slice(0, 6);

      if (lines.length > 0) {
        sections = [
          {
            title: "Key Points",
            summary: "Main highlights from the content",
            bullets: lines.slice(0, 4).map((l) => l.trim().slice(0, 100)),
            metrics: [],
            iconType: "lightbulb",
          },
        ];
      }
    }

    // If still no content, create placeholder
    if (sections.length === 0) {
      sections = [
        {
          title: "Content Summary",
          summary:
            "This infographic summarizes the key information from the source material.",
          bullets: [
            "Key information extracted from the content",
            "Structured for easy reading",
            "Professional presentation format",
          ],
          metrics: [],
          iconType: "chart",
        },
      ];
    }

    const templateLayout = insights.templateLayout || "cards";

    const validDesignStyles = [
      "consulting",
      "tech",
      "minimal",
      "creative",
      "dark",
      "academic",
      "business",
    ] as const;
    const validFontStyles = ["sans", "serif", "mono", "rounded"] as const;
    const validBorderRadius = ["none", "small", "medium", "large"] as const;
    const validShadowStyle = ["none", "subtle", "medium", "strong"] as const;
    const validTemplateLayouts = [
      "cards",
      "center_visual",
      "timeline",
      "comparison",
      "pyramid",
      "radial",
      "statistics",
      "checklist",
      "funnel",
      "matrix",
      "ranking",
    ] as const;

    const designStyle = validDesignStyles.includes(
      visual.designStyle as (typeof validDesignStyles)[number],
    )
      ? (visual.designStyle as (typeof validDesignStyles)[number])
      : "consulting";

    const fontStyle = validFontStyles.includes(
      visual.fontStyle as (typeof validFontStyles)[number],
    )
      ? (visual.fontStyle as (typeof validFontStyles)[number])
      : "sans";

    const borderRadius = validBorderRadius.includes(
      visual.borderRadius as (typeof validBorderRadius)[number],
    )
      ? (visual.borderRadius as (typeof validBorderRadius)[number])
      : "medium";

    const shadowStyle = validShadowStyle.includes(
      visual.shadowStyle as (typeof validShadowStyle)[number],
    )
      ? (visual.shadowStyle as (typeof validShadowStyle)[number])
      : "medium";

    const finalTemplateLayout = validTemplateLayouts.includes(
      templateLayout as (typeof validTemplateLayouts)[number],
    )
      ? (templateLayout as (typeof validTemplateLayouts)[number])
      : "cards";

    return {
      title: info.title || "Infographic",
      subtitle: info.subtitle,
      heroStatement: info.heroStatement,
      sections,
      callToAction: info.callToAction,
      colorScheme: {
        primary: visual.primaryColor || "#1e3a5f",
        accent: visual.accentColor || "#0891b2",
        background: visual.backgroundColor || "#f8fafc",
        text: visual.textColor || "#334155",
      },
      styleOptions: {
        style: designStyle,
        fontStyle: fontStyle,
        templateLayout: finalTemplateLayout,
        borderRadius: borderRadius,
        shadowStyle: shadowStyle,
        centerVisualTitle: info.centerVisualTitle,
        centerVisualItems: info.centerVisualItems,
      },
    };
  }

  // ============ History & Storage Methods (delegated) ============

  async getHistory(userId?: string): Promise<GeneratedImageResult[]> {
    return this.imageStorageService.getHistory(userId);
  }

  async getImage(id: string): Promise<GeneratedImageResult | null> {
    return this.imageStorageService.getImage(id);
  }

  async getPublicImage(id: string) {
    return this.imageStorageService.getPublicImage(id);
  }

  async deleteImage(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.imageStorageService.deleteImage(id, userId);
  }

  async getBookmarkedImages(userId?: string) {
    return this.imageStorageService.getBookmarkedImages(userId);
  }

  async addBookmark(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.imageStorageService.addBookmark(id, userId);
  }

  async removeBookmark(
    id: string,
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.imageStorageService.removeBookmark(id, userId);
  }

  async updateVisibility(
    id: string,
    visibility: "PRIVATE" | "PUBLIC",
    userId?: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.imageStorageService.updateVisibility(id, visibility, userId);
  }

  async cleanupOldImages(userId: string | null): Promise<number> {
    return this.imageStorageService.cleanupOldImages(userId);
  }

  async cleanupAllUsersImages(): Promise<{
    totalDeleted: number;
    usersCleaned: number;
    orphanDeleted: number;
  }> {
    return this.imageStorageService.cleanupAllUsersImages();
  }

  async getImageStats() {
    return this.imageStorageService.getImageStats();
  }

  async deleteAllImages(): Promise<number> {
    return this.imageStorageService.deleteAllImages();
  }

  async autoTagImages(userId: string) {
    return this.imageStorageService.autoTagImages(userId);
  }

  async analyzeStyles(userId: string) {
    return this.imageStorageService.analyzeStyles(userId);
  }

  async clusterVisualThemes(userId: string) {
    return this.imageStorageService.clusterVisualThemes(userId);
  }
}
