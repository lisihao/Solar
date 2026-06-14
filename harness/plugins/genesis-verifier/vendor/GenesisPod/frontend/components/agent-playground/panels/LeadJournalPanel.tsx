/**
 * LeadJournalPanel — 展示 Leader-Replanner-Lite 全程产物
 *
 * 上游：`mission.leaderJournal` + `mission.leaderOverallScore` + `mission.leaderSigned` +
 *        `mission.leaderVerdict`（来自 backend Lead M0/M6/M7 milestone）
 *
 * 4 个区块（按 mission 进度逐步显示）：
 *   1. M0 Goals      — Lead 自己声明的 successCriteria / qualityBar / deliverables
 *   2. M0 Initial Risks — Lead 主动识别的风险
 *   3. M6 Foreword   — Lead 写的 meta-level 执行摘要
 *   4. M7 Sign-Off   — Lead 签字 / 拒签 + accountabilityNote
 */

'use client';

import { CheckCircle2, AlertCircle, XCircle, ShieldAlert } from 'lucide-react';
import type { MissionDetail } from '@/services/agent-playground/api';
import { ExpandableText } from '@/components/agent-playground/ui';

interface Props {
  mission: MissionDetail;
}

export function LeadJournalPanel({ mission }: Props) {
  const journal = mission.leaderJournal;
  const goals = journal?.plan?.goals;
  const risks = journal?.plan?.initialRisks ?? [];
  const foreword = journal?.foreword;
  const signed = mission.leaderSigned;
  const verdict = mission.leaderVerdict;
  const score = mission.leaderOverallScore;

  // 全部为空时不渲染
  if (!goals && !foreword && score == null) return null;

  return (
    <section className="space-y-3">
      {/* ── M7 Sign-Off badge（最显眼，放最上面）── */}
      {score != null && (
        <div
          className={`rounded-2xl border p-4 shadow-sm ${
            signed === false
              ? 'border-red-200 bg-red-50/50'
              : verdict === 'excellent'
                ? 'border-emerald-200 bg-emerald-50/50'
                : verdict === 'good'
                  ? 'border-blue-200 bg-blue-50/50'
                  : 'border-amber-200 bg-amber-50/50'
          }`}
        >
          <div className="flex items-start gap-3">
            {signed === false ? (
              <XCircle className="h-6 w-6 flex-shrink-0 text-red-600" />
            ) : (
              <CheckCircle2
                className={`h-6 w-6 flex-shrink-0 ${
                  verdict === 'excellent'
                    ? 'text-emerald-600'
                    : verdict === 'good'
                      ? 'text-blue-600'
                      : 'text-amber-600'
                }`}
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-900">
                {signed === false
                  ? 'Leader 拒绝签字'
                  : `Leader 签字交付 · ${verdict ?? '—'}`}
                <span className="font-mono ml-2 text-xs text-gray-500">
                  {score}/100
                </span>
              </p>
              {signed === false && mission.errorMessage && (
                <p className="mt-1 text-xs leading-relaxed text-red-700">
                  {mission.errorMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── M6 Foreword ── */}
      {foreword && (
        <section className="rounded-2xl border border-violet-100 bg-violet-50/30 p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-violet-600" />
            <p className="text-sm font-bold text-violet-900">
              Foreword by Lead
            </p>
            <span className="text-[10px] text-violet-600/70">
              （M6 综合视角，非 Writer 摘要）
            </span>
          </div>

          {foreword.whatWeAnswered && foreword.whatWeAnswered.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                我们回答了什么
              </p>
              <ul className="space-y-1.5">
                {foreword.whatWeAnswered.map((a, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-[12px] ring-1 ring-violet-100"
                  >
                    {a.addressed === 'yes' ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                    ) : a.addressed === 'partial' ? (
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-600" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900">{a.criterion}</p>
                      <ExpandableText
                        text={a.evidence}
                        maxChars={140}
                        className="mt-0.5 block text-[11px] text-gray-600"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {foreword.whatRemainsUnclear &&
            foreword.whatRemainsUnclear.length > 0 && (
              <div className="mb-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                  没回答 / 证据不足
                </p>
                <ul className="space-y-1">
                  {foreword.whatRemainsUnclear.map((u, i) => (
                    <li
                      key={i}
                      className="rounded-md bg-amber-50/60 px-2.5 py-1.5 text-[12px] text-gray-800 ring-1 ring-amber-100"
                    >
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {foreword.howToRead && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                如何阅读本报告
              </p>
              <div className="rounded-md bg-white/70 px-2.5 py-1.5 ring-1 ring-violet-100">
                <ExpandableText
                  text={foreword.howToRead}
                  maxChars={260}
                  className="text-[12px] leading-relaxed text-gray-800"
                />
              </div>
            </div>
          )}

          {foreword.recommendedFollowUp &&
            foreword.recommendedFollowUp.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">
                  建议的后续研究方向
                </p>
                <ul className="space-y-1">
                  {foreword.recommendedFollowUp.map((r, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-1.5 text-[12px] text-gray-700"
                    >
                      <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-500" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </section>
      )}

      {/* ── M1+ 过程决策记录（折叠） ── */}
      {journal?.decisions && journal.decisions.length > 0 && (
        <details className="group rounded-xl border border-blue-100 bg-blue-50/30 p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-blue-700 hover:text-blue-900">
            Lead 过程决策记录 · {journal.decisions.length} 次 ▾
            <span className="ml-2 text-[10px] font-normal text-blue-600/70">
              （M0/M1/M6 累积，M7 签字时引用作为问责依据）
            </span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {journal.decisions.map((d, i) => (
              <li
                key={i}
                className="rounded-md bg-white/80 px-2.5 py-1.5 text-[11px] ring-1 ring-blue-100"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono rounded bg-blue-100 px-1 py-0 text-[9px] font-medium text-blue-700">
                    {d.phase}
                  </span>
                  <span className="font-mono text-[9px] text-gray-500">
                    {d.at?.slice(11, 16)}
                  </span>
                  <span className="flex-1 truncate font-medium text-gray-900">
                    {d.decision}
                  </span>
                </div>
                <ExpandableText
                  text={d.rationale}
                  maxChars={120}
                  className="mt-0.5 block text-[10px] leading-relaxed text-gray-600"
                />
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── M0 Goals + Risks（折叠展示） ── */}
      {goals && (
        <details className="group rounded-xl border border-gray-200 bg-white p-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-gray-600 hover:text-gray-900">
            Lead M0 Plan · 目标 / 质量底线 / 风险 ▾
          </summary>
          <div className="mt-2 space-y-2 text-[12px]">
            {goals.successCriteria.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-600">
                  成功标准
                </p>
                <ul className="space-y-0.5 pl-4">
                  {goals.successCriteria.map((c, i) => (
                    <li key={i} className="list-decimal text-gray-700">
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid gap-2 md:grid-cols-2">
              <div className="rounded bg-gray-50 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  质量底线
                </p>
                <p className="text-gray-800">
                  ≥ {goals.qualityBar.minSources} sources · ≥{' '}
                  {goals.qualityBar.minCoverage} coverage
                </p>
                {goals.qualityBar.hardConstraints.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {goals.qualityBar.hardConstraints.map((c, i) => (
                      <li key={i} className="text-[11px] text-amber-700">
                        ★ {c}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded bg-gray-50 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">
                  期望产出
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {goals.deliverables.map((d, i) => (
                    <li key={i} className="text-[11px] text-gray-700">
                      • {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {risks.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  初始风险
                </p>
                <ul className="space-y-1">
                  {risks.map((r, i) => (
                    <li
                      key={i}
                      className="rounded bg-amber-50/60 px-2 py-1 text-[11px] ring-1 ring-amber-100"
                    >
                      <span
                        className={`mr-1.5 rounded px-1 py-0 text-[9px] font-medium ${
                          r.severity === 'high'
                            ? 'bg-red-100 text-red-700'
                            : r.severity === 'medium'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {r.severity}
                      </span>
                      <span className="font-medium text-gray-900">
                        {r.type}
                      </span>
                      <span className="ml-2 text-gray-600">
                        缓解: {r.mitigation}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
