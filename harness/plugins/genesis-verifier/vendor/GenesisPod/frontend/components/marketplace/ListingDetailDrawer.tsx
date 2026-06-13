'use client';

import { Check, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { cn } from '@/lib/utils/common';
import {
  SENIORITY_LABEL,
  TOOL_SOURCE_LABEL,
  type AnyListing,
} from './marketplace.types';
import { KIND_META, RatingMeta } from './listing-shared';
import { findListing } from './marketplace.catalog';

interface ListingDetailDrawerProps {
  listing: AnyListing | null;
  acquired: boolean;
  onClose: () => void;
  onAcquire: () => void;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 py-2 text-sm">
      <span className="w-20 flex-shrink-0 text-gray-400">{label}</span>
      <div className="min-w-0 flex-1 text-gray-700">{children}</div>
    </div>
  );
}

function ChipList({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="text-gray-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => {
        const ref = findListing(id);
        return (
          <span
            key={id}
            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
          >
            {ref?.name ?? id}
          </span>
        );
      })}
    </div>
  );
}

export function ListingDetailDrawer({
  listing,
  acquired,
  onClose,
  onAcquire,
}: ListingDetailDrawerProps) {
  if (!listing) return null;
  const meta = KIND_META[listing.kind];
  const Icon = meta.Icon;

  const acquireLabel = acquired
    ? '已加入我的专家团'
    : listing.kind === 'team'
      ? '一键组建到我的专家团'
      : listing.kind === 'agent'
        ? '招聘到我的专家团'
        : listing.kind === 'workflow'
          ? '套用为新 Team'
          : '加入我的专家团';

  return (
    <Modal
      open={!!listing}
      onClose={onClose}
      size="lg"
      title={listing.name}
      subtitle={listing.tagline}
      footer={
        <Button onClick={onAcquire} disabled={acquired}>
          {acquired ? (
            <Check className="mr-2 h-4 w-4" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          {acquireLabel}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* 头部 */}
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow',
              listing.kind === 'agent' ? listing.avatarGradient : meta.gradient
            )}
          >
            {listing.kind === 'agent' ? (
              <span className="text-2xl font-semibold">{listing.name[0]}</span>
            ) : (
              <Icon className="h-7 w-7" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  meta.soft,
                  meta.text
                )}
              >
                {listing.kind === 'agent' ? listing.role : meta.label}
              </span>
              <span className="text-xs text-gray-400">{listing.publisher}</span>
            </div>
            <div className="mt-1.5">
              <RatingMeta rating={listing.rating} installs={listing.installs} />
            </div>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-gray-600">
          {listing.description}
        </p>

        {/* 类型专属详情 */}
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-1">
          <Row label="分类">{listing.category}</Row>
          <Row label="标签">
            <div className="flex flex-wrap gap-1.5">
              {listing.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-gray-200"
                >
                  {t}
                </span>
              ))}
            </div>
          </Row>

          {listing.kind === 'team' && (
            <>
              <Row label="成员角色">
                <ChipList ids={listing.agentIds} />
              </Row>
              <Row label="自带技能">
                <ChipList ids={listing.skillIds} />
              </Row>
              <Row label="自带工具">
                <ChipList ids={listing.toolIds} />
              </Row>
              <Row label="工作流">
                <div className="flex flex-wrap items-center gap-1.5">
                  {listing.stages.map((s, i) => (
                    <span
                      key={`${s}-${i}`}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-gray-200">
                        {s}
                      </span>
                      {i < listing.stages.length - 1 && (
                        <span className="text-gray-300">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </Row>
            </>
          )}
          {listing.kind === 'agent' && (
            <>
              <Row label="资历">{SENIORITY_LABEL[listing.seniority]}</Row>
              <Row label="默认模型">{listing.defaultModel}</Row>
              <Row label="自带技能">
                <ChipList ids={listing.skillIds} />
              </Row>
              <Row label="自带工具">
                <ChipList ids={listing.toolIds} />
              </Row>
              <Row label="单次算力">约 {listing.costPerRun} credits</Row>
            </>
          )}
          {listing.kind === 'tool' && (
            <>
              <Row label="来源">{TOOL_SOURCE_LABEL[listing.source]}</Row>
              <Row label="副作用">
                {listing.sideEffect === 'none'
                  ? '只读（无副作用）'
                  : listing.sideEffect === 'idempotent'
                    ? '幂等写'
                    : '有破坏性'}
              </Row>
            </>
          )}
          {listing.kind === 'skill' && (
            <>
              <Row label="适用角色">
                {listing.activatesFor.length > 0
                  ? listing.activatesFor.join(' / ')
                  : '通用'}
              </Row>
              {listing.allowedTools && listing.allowedTools.length > 0 && (
                <Row label="可用工具">
                  <ChipList ids={listing.allowedTools} />
                </Row>
              )}
            </>
          )}
          {listing.kind === 'workflow' && (
            <>
              <Row label="团队规模">{listing.teamSize} 人</Row>
              <Row label="角色">{listing.roles.join(' · ')}</Row>
              <Row label="阶段">
                <div className="flex flex-wrap items-center gap-1.5">
                  {listing.stages.map((s, i) => (
                    <span key={s} className="inline-flex items-center gap-1.5">
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 ring-1 ring-gray-200">
                        {s}
                      </span>
                      {i < listing.stages.length - 1 && (
                        <span className="text-gray-300">→</span>
                      )}
                    </span>
                  ))}
                </div>
              </Row>
            </>
          )}
        </div>

        {/* 技能指令正文预览（教什么）—— 来自原始 .skill.md body */}
        {listing.kind === 'skill' &&
          listing.instructionsPreview &&
          listing.instructionsPreview.trim().length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  技能指令
                </span>
                <span className="text-xs text-gray-400">
                  装配后将作为方法论注入 Agent 的系统提示
                </span>
              </div>
              <pre className="font-mono max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 text-xs leading-relaxed text-gray-600">
                {listing.instructionsPreview}
              </pre>
            </div>
          )}
      </div>
    </Modal>
  );
}
