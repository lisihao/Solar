/**
 * PredictionRecalibrationScheduler —— 前瞻预测到期回扫裁决（Foresight L3）
 *
 * 上游：docs/architecture/playground-foresight-plan.md L3 §5.2
 *
 * 每 6 小时扫一批"到期且未裁决"的预测，全自动裁决（web 检索 + LLM）后回填 Brier。
 *
 * 守门：
 *   - opt-in：ENABLE_PREDICTION_CALIBRATION !== "true" 时整体 disabled（后台静默动作默认关）
 *   - 单 pod 重入保护：isRunning flag（@Cron 间隔远大于单轮耗时，仅防极端慢轮叠加）
 *   - 单轮 batch 上限，避免一次烧太多 LLM/搜索
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PredictionCalibrationService } from "./prediction-calibration.service";

const BATCH_SIZE = 50;

@Injectable()
export class PredictionRecalibrationScheduler {
  private readonly log = new Logger(PredictionRecalibrationScheduler.name);
  private isRunning = false;

  constructor(private readonly calibration: PredictionCalibrationService) {}

  @Cron(CronExpression.EVERY_6_HOURS, {
    name: "prediction-recalibration-sweep",
    disabled: process.env.ENABLE_PREDICTION_CALIBRATION !== "true",
  })
  async sweep(): Promise<void> {
    if (this.isRunning) {
      this.log.warn(
        "[calibration] previous sweep still running, skipping tick",
      );
      return;
    }
    this.isRunning = true;
    try {
      const due = await this.calibration.getDuePredictions(BATCH_SIZE);
      if (due.length === 0) return;
      this.log.log(`[calibration] sweeping ${due.length} due prediction(s)`);

      let resolved = 0;
      let needsReview = 0;
      for (const p of due) {
        try {
          const judgment = await this.calibration.judgeOutcome({
            predictionText: p.predictionText,
            resolutionCriteria: p.resolutionCriteria,
            topic: p.topic,
          });
          await this.calibration.resolvePrediction(
            p.id,
            judgment,
            p.probability,
          );
          if (judgment.outcome === null || judgment.needsReview)
            needsReview += 1;
          else resolved += 1;
        } catch (err) {
          this.log.warn(
            `[calibration] resolve prediction=${p.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.log.log(
        `[calibration] sweep done: ${resolved} auto-resolved, ${needsReview} needs-review`,
      );
    } catch (err) {
      this.log.error(
        `[calibration] sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
