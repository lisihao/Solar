'use client';

import { useState } from 'react';
import Modal from '@/components/ui/dialogs/Modal';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';
import { PHASE_KEYS } from '@/lib/constants/ai-planning';
import { CheckCircle2, RefreshCw } from 'lucide-react';

interface ReplanModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (startPhase: number) => void;
  totalPhases: number;
  isReplanning?: boolean;
}

export function ReplanModal({
  open,
  onClose,
  onConfirm,
  totalPhases,
  isReplanning = false,
}: ReplanModalProps) {
  const { t } = useTranslation();
  const [selectedPhase, setSelectedPhase] = useState(1);

  const handleConfirm = () => {
    onConfirm(selectedPhase);
  };

  const getPhaseLabel = (phase: number): string | null => {
    if (phase === 1) return t('aiPlanning.replan.resetAll');
    if (phase === 2) return t('aiPlanning.replan.reSearch');
    if (phase === totalPhases) return t('aiPlanning.replan.rewriteOnly');
    return null;
  };

  const getPhaseStatusTag = (
    phase: number
  ): {
    text: string;
    className: string;
    icon: typeof CheckCircle2;
  } => {
    if (phase >= selectedPhase) {
      return {
        text: t('aiPlanning.replan.willRedo'),
        className: 'bg-blue-50 text-blue-600',
        icon: RefreshCw,
      };
    }
    return {
      text: t('aiPlanning.replan.willKeep'),
      className: 'bg-green-50 text-green-600',
      icon: CheckCircle2,
    };
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('aiPlanning.replan.title')}
      subtitle={t('aiPlanning.replan.description')}
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isReplanning}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw
              className={cn('h-4 w-4', isReplanning && 'animate-spin')}
            />
            {t('aiPlanning.replan.confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Phase selection hint */}
        <p className="text-sm text-gray-600">
          {t('aiPlanning.replan.selectPhase')}
        </p>

        {/* Phase radio list */}
        <div className="space-y-2">
          {Array.from({ length: totalPhases }, (_, i) => i + 1).map((phase) => {
            const phaseKey = PHASE_KEYS[phase];
            const label = getPhaseLabel(phase);
            const statusTag = getPhaseStatusTag(phase);
            const StatusIcon = statusTag.icon;

            return (
              <label
                key={phase}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all',
                  selectedPhase === phase
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                {/* Radio button */}
                <input
                  type="radio"
                  name="replan-phase"
                  value={phase}
                  checked={selectedPhase === phase}
                  onChange={() => setSelectedPhase(phase)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border-2',
                    selectedPhase === phase
                      ? 'border-blue-500 bg-blue-500'
                      : 'border-gray-300'
                  )}
                >
                  {selectedPhase === phase && (
                    <span className="flex h-full items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                  )}
                </span>

                {/* Phase number circle */}
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    selectedPhase === phase
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-600'
                  )}
                >
                  {phase}
                </span>

                {/* Phase name and label */}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      selectedPhase === phase
                        ? 'text-blue-900'
                        : 'text-gray-900'
                    )}
                  >
                    {t(`aiPlanning.phases.${phaseKey}`)}
                  </span>
                  {label && (
                    <span className="text-xs text-gray-500">{label}</span>
                  )}
                </div>

                {/* Status tag */}
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium',
                    statusTag.className
                  )}
                >
                  <StatusIcon className="h-3 w-3" />
                  {statusTag.text}
                </span>
              </label>
            );
          })}
        </div>

        {/* Bottom hint */}
        <p className="text-xs text-gray-500">{t('aiPlanning.replan.hint')}</p>
      </div>
    </Modal>
  );
}

export default ReplanModal;
