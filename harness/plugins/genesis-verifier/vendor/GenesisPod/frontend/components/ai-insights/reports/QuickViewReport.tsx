'use client';

/**
 * Quick View Report Component
 *
 * 紧凑的精华视图，将报告的核心内容浓缩为可 3-5 分钟快速阅读的格式。
 * 内容全部来自已加载的 report 数据（无后端请求）。
 */

import { useMemo } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TopicReport, TopicEvidence } from '@/lib/types/topic-insights';
import { useI18n } from '@/lib/i18n';
import { LoadingState } from '@/components/ui/states';

/**
 * Strip LaTeX math, raw LaTeX commands, and citation references from plain-text
 * display contexts (quick view cards) where math rendering is not available.
 */
function cleanQuickViewText(text: string): string {
  if (!text) return text;
  // Remove display math $$...$$
  let cleaned = text.replace(/\$\$[\s\S]*?\$\$/g, '');
  // Remove inline math $...$ — keep the inner text stripped of commands
  cleaned = cleaned.replace(/\$([^$\n]+)\$/g, (_match, inner: string) =>
    inner
      .replace(/\\[a-zA-Z]+\{?[^}]*\}?/g, '')
      .replace(/[_^{}\\]/g, '')
      .trim()
  );
  // Remove remaining bare LaTeX commands (e.g. \alpha, \frac{a}{b})
  cleaned = cleaned.replace(/\\[a-zA-Z]+\{[^}]*\}/g, '');
  cleaned = cleaned.replace(/\\[a-zA-Z]+/g, '');
  // Remove leftover LaTeX structural characters
  cleaned = cleaned.replace(/[{}\\^_]/g, '');
  // Remove citation references [N] and [N][M]
  cleaned = cleaned.replace(/(?:\[\d+\])+/g, '');
  // Remove word count patterns (e.g. （约3000字）, （本维度约2500字）)
  cleaned = cleaned.replace(/[（(][^）)]*约?\d+字[）)]/g, '');
  // Strip markdown bold **text** → text
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  // Strip markdown italic *text* → text
  cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
  // Strip remaining bullet markers at line start
  cleaned = cleaned.replace(/^[-*]\s+/gm, '');
  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

/**
 * Strip citations [N] and word counts from markdown content while preserving
 * markdown structure (headers, lists, bold, etc.) for ReactMarkdown rendering.
 */
function stripCitationsAndWordCount(text: string): string {
  if (!text) return text;
  let result = text;
  // Remove citation references [N] and [N][M]
  result = result.replace(/(?:\[\d+\])+/g, '');
  // Remove word count patterns
  result = result.replace(/[（(][^）)]*约?\d+字[）)]/g, '');
  // Collapse multiple spaces
  result = result.replace(/ {2,}/g, ' ');
  return result;
}

interface QuickViewReportProps {
  report: TopicReport | null;
  evidence?: TopicEvidence[];
  isLoading?: boolean;
}

export function QuickViewReport({
  report,
  evidence = [],
  isLoading = false,
}: QuickViewReportProps) {
  const { t } = useI18n();

  // Extract top findings per dimension
  const dimensionFindings = useMemo(() => {
    if (!report?.dimensionAnalyses) return [];
    return report.dimensionAnalyses
      .filter((da) => da.keyFindings && da.keyFindings.length > 0)
      .map((da) => ({
        name: da.dimension?.name || '未知维度',
        findings: da.keyFindings.slice(0, 3),
      }));
  }, [report?.dimensionAnalyses]);

  // Extract top trends across all dimensions
  const topTrends = useMemo(() => {
    if (!report?.dimensionAnalyses) return [];
    const trends: Array<{
      dimensionName: string;
      trend: string;
      direction: string;
      timeframe: string;
    }> = [];
    for (const da of report.dimensionAnalyses) {
      const name = da.dimension?.name || '未知维度';
      for (const t of (da.trends || []).slice(0, 2)) {
        trends.push({
          dimensionName: name,
          trend: t.trend,
          direction: t.direction,
          timeframe: t.timeframe,
        });
      }
    }
    return trends;
  }, [report?.dimensionAnalyses]);

  // Extract challenges and opportunities
  const riskAndOpportunities = useMemo(() => {
    if (!report?.dimensionAnalyses)
      return { challenges: [], opportunities: [] };
    const challenges: Array<{ dimensionName: string; text: string }> = [];
    const opportunities: Array<{ dimensionName: string; text: string }> = [];
    for (const da of report.dimensionAnalyses) {
      const name = da.dimension?.name || '未知维度';
      for (const c of (da.challenges || []).slice(0, 1)) {
        challenges.push({
          dimensionName: name,
          text: cleanQuickViewText(c.challenge),
        });
      }
      for (const o of (da.opportunities || []).slice(0, 1)) {
        opportunities.push({
          dimensionName: name,
          text: cleanQuickViewText(o.opportunity),
        });
      }
    }
    return { challenges, opportunities };
  }, [report?.dimensionAnalyses]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState text={t('topicResearch.reportEditor.loadingReport')} />
      </div>
    );
  }

  if (!report) {
    return null;
  }

  const directionLabels: Record<string, string> = {
    increasing: '↑',
    decreasing: '↓',
    stable: '→',
    emerging: '✦',
  };

  return (
    <div className="h-full overflow-auto">
      <div className="space-y-6 p-6">
        {/* Executive Summary */}
        {report.executiveSummary && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-900">执行摘要</h2>
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-5">
              <article className="prose prose-sm prose-gray prose-strong:text-blue-600 dark:prose-strong:text-blue-400 max-w-none leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {stripCitationsAndWordCount(report.executiveSummary)}
                </ReactMarkdown>
              </article>
            </div>
          </section>
        )}

        {/* Key Findings by Dimension */}
        {dimensionFindings.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              {t('topicResearch.reportEditor.keyFindings')}
            </h2>
            <div className="space-y-2.5">
              {dimensionFindings.map((dim) => (
                <div
                  key={dim.name}
                  className="rounded-xl border border-gray-100 bg-white p-3"
                >
                  <h3 className="mb-2 text-base font-bold text-gray-800">
                    {dim.name}
                  </h3>
                  <ul className="space-y-1.5">
                    {dim.findings.map((f, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 text-sm leading-relaxed text-gray-600"
                      >
                        <span
                          className={`mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            f.significance === 'high'
                              ? 'bg-red-400'
                              : f.significance === 'medium'
                                ? 'bg-amber-400'
                                : 'bg-green-400'
                          }`}
                        />
                        <span>{cleanQuickViewText(f.finding)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Trend Overview */}
        {topTrends.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              {t('topicResearch.reportEditor.trendAnalysis')}
            </h2>
            <div className="rounded-xl border border-gray-100 bg-white p-4">
              <div className="space-y-2">
                {topTrends.map((tr, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 w-5 flex-shrink-0 text-center text-base">
                      {directionLabels[tr.direction] || '→'}
                    </span>
                    <div className="leading-relaxed">
                      <span className="font-medium text-gray-800">
                        {cleanQuickViewText(tr.trend)}
                      </span>
                      <span className="ml-1.5 text-xs text-gray-400">
                        {tr.dimensionName} · {tr.timeframe}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Risk & Opportunity Speed Scan */}
        {(riskAndOpportunities.challenges.length > 0 ||
          riskAndOpportunities.opportunities.length > 0) && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              风险与机遇速览
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {/* Challenges */}
              {riskAndOpportunities.challenges.length > 0 && (
                <div className="rounded-xl border border-red-100 bg-red-50/50 p-4">
                  <h3 className="mb-2 text-base font-bold text-red-700">
                    {t('topicResearch.reportEditor.challenges')}
                  </h3>
                  <ol className="list-decimal space-y-2 pl-5">
                    {riskAndOpportunities.challenges.map((c, idx) => (
                      <li
                        key={idx}
                        className="text-sm leading-relaxed text-red-600/80"
                      >
                        <span className="font-bold text-red-600">
                          {c.dimensionName}
                        </span>
                        {'：'}
                        {c.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {/* Opportunities */}
              {riskAndOpportunities.opportunities.length > 0 && (
                <div className="rounded-xl border border-green-100 bg-green-50/50 p-4">
                  <h3 className="mb-2 text-base font-bold text-green-700">
                    {t('topicResearch.reportEditor.opportunities')}
                  </h3>
                  <ol className="list-decimal space-y-2 pl-5">
                    {riskAndOpportunities.opportunities.map((o, idx) => (
                      <li
                        key={idx}
                        className="text-sm leading-relaxed text-green-600/80"
                      >
                        <span className="font-bold text-green-600">
                          {o.dimensionName}
                        </span>
                        {'：'}
                        {o.text}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Risk Assessment (structured, if available) */}
        {report.riskAssessment &&
          report.riskAssessment.riskMatrix &&
          report.riskAssessment.riskMatrix.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-bold text-gray-900">
                {report.riskAssessment.title || '风险评估'}
              </h2>
              <div className="overflow-x-auto rounded-xl border border-red-100">
                <Table className="w-full text-sm">
                  <THead className="bg-red-50">
                    <Tr>
                      <Th className="px-3 py-1.5 text-left font-medium text-red-700">
                        风险类型
                      </Th>
                      <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                        概率
                      </Th>
                      <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                        影响
                      </Th>
                      <Th className="px-3 py-1.5 text-center font-medium text-red-700">
                        时间窗口
                      </Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {report.riskAssessment.riskMatrix.map((risk, idx) => {
                      const probColor =
                        risk.probability === '高'
                          ? 'bg-red-100 text-red-700'
                          : risk.probability === '中'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-green-100 text-green-700';
                      const impactColor =
                        risk.impact === '高'
                          ? 'bg-red-100 text-red-700'
                          : risk.impact === '中'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-green-100 text-green-700';
                      return (
                        <Tr key={idx} className="border-t border-red-50">
                          <Td className="px-3 py-1.5 text-gray-700">
                            {risk.riskType}
                          </Td>
                          <Td className="px-3 py-1.5 text-center">
                            <span
                              className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${probColor}`}
                            >
                              {risk.probability}
                            </span>
                          </Td>
                          <Td className="px-3 py-1.5 text-center">
                            <span
                              className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${impactColor}`}
                            >
                              {risk.impact}
                            </span>
                          </Td>
                          <Td className="px-3 py-1.5 text-center text-gray-500">
                            {risk.timeframe}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            </section>
          )}

        {/* Strategic Recommendations (structured, if available) */}
        {report.strategicRecommendations && (
          <section>
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              {report.strategicRecommendations.title || '战略建议'}
            </h2>
            <div className="space-y-2.5">
              {report.strategicRecommendations.forEnterprise && (
                <div className="rounded-xl border border-gray-100 bg-white p-3">
                  <h3 className="mb-2 text-sm font-bold text-indigo-700">
                    对企业决策者
                  </h3>
                  {report.strategicRecommendations.forEnterprise.shortTerm
                    ?.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        短期 (6-12月)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {report.strategicRecommendations.forEnterprise.shortTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanQuickViewText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                  {report.strategicRecommendations.forEnterprise.midTerm
                    ?.length > 0 && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        中期 (1-3年)
                      </span>
                      <ul className="mt-1 space-y-0.5">
                        {report.strategicRecommendations.forEnterprise.midTerm.map(
                          (s, i) => (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-gray-600"
                            >
                              {cleanQuickViewText(s)}
                            </li>
                          )
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {report.strategicRecommendations.forInvestors && (
                <div className="rounded-xl border border-gray-100 bg-white p-3">
                  <h3 className="mb-2 text-sm font-bold text-emerald-700">
                    对投资者
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {report.strategicRecommendations.forInvestors.opportunities
                      ?.length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-green-500">
                          看好方向
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {report.strategicRecommendations.forInvestors.opportunities.map(
                            (s, i) => (
                              <li
                                key={i}
                                className="text-sm leading-relaxed text-gray-600"
                              >
                                {cleanQuickViewText(s)}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                    {report.strategicRecommendations.forInvestors.risks
                      ?.length > 0 && (
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-red-500">
                          警惕风险
                        </span>
                        <ul className="mt-1 space-y-0.5">
                          {report.strategicRecommendations.forInvestors.risks.map(
                            (s, i) => (
                              <li
                                key={i}
                                className="text-sm leading-relaxed text-gray-600"
                              >
                                {cleanQuickViewText(s)}
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
