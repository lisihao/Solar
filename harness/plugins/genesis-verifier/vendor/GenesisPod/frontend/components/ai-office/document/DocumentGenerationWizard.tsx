'use client';

/**
 * 文档生成向导
 * 引导用户选择文档类型、模板和生成选项
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TEMPLATES,
  GENERATION_OPTIONS,
  type DocumentCategory,
  type DocumentTemplateConfig,
} from '@/lib/templates/document-templates';
import { useI18n } from '@/lib/i18n';
import { Modal } from '@/components/ui/dialogs/Modal';

interface DocumentGenerationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (config: GenerationConfig) => void;
  selectedResourceCount: number;
}

export interface GenerationConfig {
  category: DocumentCategory;
  template: DocumentTemplateConfig;
  options: {
    detailLevel: number;
    tone: string;
    extensions: string[];
  };
}

export default function DocumentGenerationWizard({
  isOpen,
  onClose,
  onGenerate,
  selectedResourceCount,
}: DocumentGenerationWizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [selectedCategory, setSelectedCategory] =
    useState<DocumentCategory | null>(null);
  const [selectedTemplate, setSelectedTemplate] =
    useState<DocumentTemplateConfig | null>(null);
  const [detailLevel, setDetailLevel] = useState(2);
  const [tone, setTone] = useState('academic');
  const [extensions, setExtensions] = useState<string[]>([
    'searchImages',
    'fetchData',
  ]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (step < 3) setStep(step + 1);
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleGenerate = () => {
    if (!selectedTemplate) return;

    onGenerate({
      category: selectedCategory!,
      template: selectedTemplate,
      options: {
        detailLevel,
        tone,
        extensions,
      },
    });
    onClose();
  };

  const toggleExtension = (id: string) => {
    setExtensions((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const wizardTitle = (
    <div className="flex items-center space-x-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600">
        <Sparkles className="h-6 w-6 text-white" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-gray-900">
          {t('office.documentWizard.createDocument')}
        </h2>
        <p className="text-sm text-gray-600">
          {t('office.documentWizard.basedOnResources', {
            count: selectedResourceCount,
          })}
        </p>
      </div>
    </div>
  );

  const wizardFooter = (
    <div className="flex w-full items-center justify-between">
      <button
        onClick={step === 1 ? onClose : handleBack}
        className="flex items-center space-x-2 rounded-lg px-4 py-2 text-gray-700 transition-colors hover:bg-gray-200"
      >
        {step === 1 ? (
          <>{t('common.cancel')}</>
        ) : (
          <>
            <ChevronLeft className="h-4 w-4" />
            <span>{t('common.previous')}</span>
          </>
        )}
      </button>

      <div className="text-sm text-gray-500">
        {t('office.documentWizard.stepProgress', {
          current: step,
          total: 3,
        })}
      </div>

      <button
        onClick={step === 3 ? handleGenerate : handleNext}
        disabled={!selectedCategory || (step === 2 && !selectedTemplate)}
        className="flex items-center space-x-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2 font-medium text-white transition-all hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
      >
        {step === 3 ? (
          <>
            <Sparkles className="h-4 w-4" />
            <span>{t('office.documentWizard.startGeneration')}</span>
          </>
        ) : (
          <>
            <span>{t('common.next')}</span>
            <ChevronRight className="h-4 w-4" />
          </>
        )}
      </button>
    </div>
  );

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={wizardTitle}
      size="2xl"
      headerClassName="bg-gradient-to-r from-blue-50 to-purple-50"
      footerClassName="bg-gray-50"
      footer={wizardFooter}
    >
      {/* Progress Steps */}
      <div className="border-b border-gray-200 bg-gray-50 px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          {[
            { num: 1, label: t('office.documentWizard.steps.selectType') },
            {
              num: 2,
              label: t('office.documentWizard.steps.selectTemplate'),
            },
            {
              num: 3,
              label: t('office.documentWizard.steps.configureOptions'),
            },
          ].map((s, idx) => (
            <React.Fragment key={s.num}>
              <div className="flex items-center space-x-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                    step >= s.num
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {s.num}
                </div>
                <span
                  className={`text-sm font-medium ${
                    step >= s.num ? 'text-gray-900' : 'text-gray-400'
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {idx < 2 && (
                <div
                  className={`mx-4 h-1 flex-1 rounded-full transition-all ${
                    step > s.num ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Step 1: 选择文档类型 */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="mb-6 text-center">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">
                {t('office.documentWizard.selectDocumentType')}
              </h3>
              <p className="text-sm text-gray-600">
                {t('office.documentWizard.documentTypeDescription')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {DOCUMENT_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    setSelectedTemplate(DOCUMENT_TEMPLATES[cat.id][0]);
                  }}
                  className={`rounded-xl border-2 p-6 text-left transition-all hover:shadow-md ${
                    selectedCategory === cat.id
                      ? 'border-blue-600 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="mb-3 text-3xl">{cat.name.split(' ')[0]}</div>
                  <h4 className="mb-1 font-semibold text-gray-900">
                    {cat.name.split(' ').slice(1).join(' ')}
                  </h4>
                  <p className="text-sm text-gray-600">{cat.description}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: 选择模板 */}
        {step === 2 && selectedCategory && (
          <div className="space-y-4">
            <div className="mb-6 text-center">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">
                {t('office.documentWizard.selectTemplate')}
              </h3>
              <p className="text-sm text-gray-600">
                {t('office.documentWizard.selectTemplateDescription')}
              </p>
            </div>
            <div className="space-y-3">
              {DOCUMENT_TEMPLATES[selectedCategory].map((template) => (
                <button
                  key={template.id}
                  onClick={() => setSelectedTemplate(template)}
                  className={`w-full rounded-xl border-2 p-5 text-left transition-all hover:shadow-md ${
                    selectedTemplate?.id === template.id
                      ? 'border-blue-600 bg-blue-50 shadow-md'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{template.icon}</span>
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          {template.name}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {t('office.documentWizard.estimatedTime')}:{' '}
                          {template.estimatedTime}
                        </p>
                      </div>
                    </div>
                    {template.supportedExtensions && (
                      <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-700">
                        {t('office.documentWizard.smartExpansionSupported')}
                      </span>
                    )}
                  </div>
                  <p className="mb-3 text-sm text-gray-600">
                    {template.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {template.sections.slice(0, 4).map((section) => (
                      <span
                        key={section.id}
                        className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                      >
                        {section.title}
                      </span>
                    ))}
                    {template.sections.length > 4 && (
                      <span className="text-xs text-gray-500">
                        {t('office.documentWizard.moreCount', {
                          count: template.sections.length - 4,
                        })}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: 配置选项 */}
        {step === 3 && selectedTemplate && (
          <div className="space-y-6">
            <div className="mb-6 text-center">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">
                {t('office.documentWizard.configureOptions')}
              </h3>
              <p className="text-sm text-gray-600">
                {t('office.documentWizard.configureOptionsDescription')}
              </p>
            </div>

            {/* 详细程度 */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-700">
                {t('office.documentWizard.detailLevel')}
              </label>
              <div className="grid grid-cols-3 gap-3">
                {GENERATION_OPTIONS.detailLevel.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setDetailLevel(option.value)}
                    className={`rounded-lg border-2 p-4 transition-all ${
                      detailLevel === option.value
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="mb-1 font-semibold text-gray-900">
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-600">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 语言风格 */}
            <div>
              <label className="mb-3 block text-sm font-medium text-gray-700">
                {t('office.documentWizard.languageStyle')}
              </label>
              <div className="grid grid-cols-2 gap-3">
                {GENERATION_OPTIONS.tone.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setTone(option.value)}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      tone === option.value
                        ? 'border-blue-600 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="mb-1 font-semibold text-gray-900">
                      {option.label}
                    </div>
                    <div className="text-xs text-gray-600">
                      {option.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 智能资源扩展 */}
            {selectedTemplate.supportedExtensions && (
              <div>
                <label className="mb-3 block text-sm font-medium text-gray-700">
                  {t('office.documentWizard.smartResourceExpansion')}{' '}
                  <span className="text-xs text-gray-500">
                    {t('office.documentWizard.recommended')}
                  </span>
                </label>
                <div className="space-y-2">
                  {GENERATION_OPTIONS.extensionOptions.map((option) => (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={extensions.includes(option.id)}
                        onChange={() => toggleExtension(option.id)}
                        className="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <div className="ml-3">
                        <div className="font-medium text-gray-900">
                          {option.label}
                        </div>
                        <div className="text-sm text-gray-600">
                          {option.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
