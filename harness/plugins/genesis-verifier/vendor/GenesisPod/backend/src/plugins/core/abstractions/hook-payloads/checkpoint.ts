/**
 * CHECKPOINT_SAVE / CHECKPOINT_LOAD hook payload
 *
 * Fire point：MissionCheckpointService.save / .load
 * Plugin 用例：
 *   - 替换 checkpoint backend（DB / S3 / Redis）
 *   - 加密 checkpoint payload（plugin 包装）
 */

export interface CheckpointSavePayload {
  readonly missionId: string;
  readonly stage: string;
  readonly snapshot: unknown; // 业务侧自定义 payload，不透明
  readonly completedKeys: ReadonlyArray<string>;
}

export interface CheckpointLoadPayload {
  readonly missionId: string;
}

export interface CheckpointLoadResultPayload {
  readonly snapshot: unknown;
  readonly stage: string;
  readonly completedKeys: ReadonlyArray<string>;
}
