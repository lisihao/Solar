/**
 * useWikiIngestPolling
 *
 * 把 WikiTab 内的 fire-and-forget ingest 进度轮询逻辑抽成独立 hook，
 * 避免 WikiTab.tsx 越过 god-class 防护阈值。
 *
 * 关键设计（2026-05-13 race fix）：
 *  - fire-and-forget POST 后，后端异步 worker 注册 in-memory progress
 *    有 ~1-3s 延迟。期间 GET /ingest-progress 返回 null。
 *  - 首轮 poll 直接 setProgress(null) + 停轮询 → Screenshot_77 反馈
 *    "进度条不显示，必须刷新页面才出现"。
 *  - 修复：null 宽限 5 次（~15s），看过真实 progress 后才允许 null
 *    触发"完成 / 退出"语义。
 */

import { useEffect } from 'react';
import { wikiApi, type WikiIngestProgress } from '@/lib/api/wiki';
import { logger } from '@/lib/utils/logger';

interface UseWikiIngestPollingArgs {
  /** 是否激活轮询（用户点了"开始 ingest"或检测到 in-flight） */
  ingestActive: boolean;
  /** 当前 KB（轮询主键） */
  kbId: string | null;
  /** 进度 setter */
  setIngestProgress: (p: WikiIngestProgress | null) => void;
  /** 激活 setter（null 进度且看过真实数据时设 false 退出轮询） */
  setIngestActive: (v: boolean) => void;
}

const POLL_INTERVAL_MS = 3000;
const NULL_POLL_GRACE = 5;

/** 主轮询：每 3s 拉一次后端进度 */
export function useWikiIngestPolling({
  ingestActive,
  kbId,
  setIngestProgress,
  setIngestActive,
}: UseWikiIngestPollingArgs): void {
  useEffect(() => {
    if (!ingestActive || !kbId) return;
    let cancelled = false;
    let sawRealProgress = false;
    let nullPollsBeforeFirstHit = 0;
    const poll = async () => {
      try {
        const r = await wikiApi.getIngestProgress(kbId);
        if (cancelled) return;
        if (r.progress) {
          sawRealProgress = true;
          setIngestProgress(r.progress);
          return;
        }
        if (sawRealProgress) {
          setIngestProgress(null);
          setIngestActive(false);
          return;
        }
        nullPollsBeforeFirstHit += 1;
        if (nullPollsBeforeFirstHit > NULL_POLL_GRACE) {
          // backend 始终没注册 progress（异步 worker 早早抛错或被吞）
          setIngestProgress(null);
          setIngestActive(false);
        }
        // 否则保留占位 banner，下一轮再试
      } catch (err) {
        logger?.warn?.('[wiki] poll ingest-progress failed', err);
      }
    };
    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ingestActive, kbId, setIngestProgress, setIngestActive]);
}

/** 进入页面时探测 in-flight ingest（用户刷新 / 换 tab 回来），自动恢复轮询 */
export function useWikiIngestInflightProbe(
  kbId: string | null,
  setIngestProgress: (p: WikiIngestProgress | null) => void,
  setIngestActive: (v: boolean) => void
): void {
  useEffect(() => {
    if (!kbId) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await wikiApi.getIngestProgress(kbId);
        if (cancelled) return;
        if (r.progress) {
          setIngestProgress(r.progress);
          setIngestActive(true);
        }
      } catch {
        // ignore — first-load probe failure is non-fatal
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kbId, setIngestProgress, setIngestActive]);
}
