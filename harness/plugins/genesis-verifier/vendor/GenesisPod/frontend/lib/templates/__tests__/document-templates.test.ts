/**
 * Tests for lib/templates/document-templates.ts
 *
 * Covers: DOCUMENT_CATEGORIES shape, DOCUMENT_TEMPLATES structure per
 * category, GENERATION_OPTIONS constants, and TemplateSection ordering.
 */

import { describe, it, expect } from 'vitest';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_TEMPLATES,
  GENERATION_OPTIONS,
  type DocumentCategory,
  type DocumentTemplateConfig,
} from '../document-templates';

// ---------------------------------------------------------------------------
// DOCUMENT_CATEGORIES
// ---------------------------------------------------------------------------

describe('DOCUMENT_CATEGORIES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(DOCUMENT_CATEGORIES)).toBe(true);
    expect(DOCUMENT_CATEGORIES.length).toBeGreaterThan(0);
  });

  it('every category has an id, name, description, and color', () => {
    for (const cat of DOCUMENT_CATEGORIES) {
      expect(typeof cat.id).toBe('string');
      expect(cat.id.length).toBeGreaterThan(0);
      expect(typeof cat.name).toBe('string');
      expect(typeof cat.description).toBe('string');
      expect(typeof cat.color).toBe('string');
    }
  });

  it('contains a research_report category', () => {
    expect(DOCUMENT_CATEGORIES.some((c) => c.id === 'research_report')).toBe(
      true
    );
  });

  it('contains a research_page category', () => {
    expect(DOCUMENT_CATEGORIES.some((c) => c.id === 'research_page')).toBe(
      true
    );
  });

  it('contains 7 categories', () => {
    // research_report, academic_review, technical_doc, business_proposal,
    // presentation, blog_article, research_page
    expect(DOCUMENT_CATEGORIES.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// DOCUMENT_TEMPLATES — top-level keys
// ---------------------------------------------------------------------------

describe('DOCUMENT_TEMPLATES top-level structure', () => {
  const expectedKeys: DocumentCategory[] = [
    'research_report',
    'academic_review',
    'technical_doc',
    'business_proposal',
    'presentation',
    'blog_article',
    'research_page',
    'custom',
  ];

  it('has all expected category keys', () => {
    for (const key of expectedKeys) {
      expect(DOCUMENT_TEMPLATES).toHaveProperty(key);
    }
  });

  it('every category maps to an array', () => {
    for (const key of expectedKeys) {
      expect(Array.isArray(DOCUMENT_TEMPLATES[key])).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Helper — iterate all templates across categories
// ---------------------------------------------------------------------------

function allTemplates(): DocumentTemplateConfig[] {
  const all: DocumentTemplateConfig[] = [];
  for (const templates of Object.values(DOCUMENT_TEMPLATES)) {
    all.push(...templates);
  }
  return all;
}

// ---------------------------------------------------------------------------
// DocumentTemplateConfig — required fields
// ---------------------------------------------------------------------------

describe('DocumentTemplateConfig fields', () => {
  it('every template has a non-empty id', () => {
    for (const tmpl of allTemplates()) {
      expect(typeof tmpl.id).toBe('string');
      expect(tmpl.id.length).toBeGreaterThan(0);
    }
  });

  it('every template has a non-empty name', () => {
    for (const tmpl of allTemplates()) {
      expect(tmpl.name.length).toBeGreaterThan(0);
    }
  });

  it('every template has a description', () => {
    for (const tmpl of allTemplates()) {
      expect(typeof tmpl.description).toBe('string');
    }
  });

  it('every template has an estimatedTime string', () => {
    for (const tmpl of allTemplates()) {
      expect(typeof tmpl.estimatedTime).toBe('string');
      expect(tmpl.estimatedTime.length).toBeGreaterThan(0);
    }
  });

  it('every template has a sections array', () => {
    for (const tmpl of allTemplates()) {
      expect(Array.isArray(tmpl.sections)).toBe(true);
    }
  });

  it('every template has a valid tone in styleGuide', () => {
    const validTones = ['academic', 'business', 'casual', 'technical'];
    for (const tmpl of allTemplates()) {
      expect(validTones).toContain(tmpl.styleGuide.tone);
    }
  });

  it('every template has a headingStyle of "numbered" or "unnumbered"', () => {
    for (const tmpl of allTemplates()) {
      expect(['numbered', 'unnumbered']).toContain(
        tmpl.styleGuide.headingStyle
      );
    }
  });

  it('supportedExtensions is a boolean', () => {
    for (const tmpl of allTemplates()) {
      expect(typeof tmpl.supportedExtensions).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// TemplateSection — ordering and required fields
// ---------------------------------------------------------------------------

describe('TemplateSection ordering', () => {
  it('sections within a template have unique order values', () => {
    for (const tmpl of allTemplates()) {
      const orders = tmpl.sections.map((s) => s.order);
      const unique = new Set(orders);
      expect(unique.size).toBe(orders.length);
    }
  });

  it('sections within a template are ordered starting from 1', () => {
    for (const tmpl of allTemplates()) {
      if (tmpl.sections.length > 0) {
        const minOrder = Math.min(...tmpl.sections.map((s) => s.order));
        expect(minOrder).toBe(1);
      }
    }
  });

  it('every section has a non-empty id and title', () => {
    for (const tmpl of allTemplates()) {
      for (const sec of tmpl.sections) {
        expect(sec.id.length).toBeGreaterThan(0);
        expect(sec.title.length).toBeGreaterThan(0);
      }
    }
  });

  it('every section has a non-empty aiPrompt', () => {
    for (const tmpl of allTemplates()) {
      for (const sec of tmpl.sections) {
        expect(sec.aiPrompt.length).toBeGreaterThan(0);
      }
    }
  });

  it('required is a boolean on every section', () => {
    for (const tmpl of allTemplates()) {
      for (const sec of tmpl.sections) {
        expect(typeof sec.required).toBe('boolean');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Specific well-known templates
// ---------------------------------------------------------------------------

describe('standard-research-report template', () => {
  const tmpl = DOCUMENT_TEMPLATES.research_report.find(
    (t) => t.id === 'standard-research-report'
  );

  it('exists', () => {
    expect(tmpl).toBeDefined();
  });

  it('has academic tone', () => {
    expect(tmpl?.styleGuide.tone).toBe('academic');
  });

  it('has APA citation format', () => {
    expect(tmpl?.styleGuide.citationFormat).toBe('APA');
  });

  it('has at least 6 sections including abstract and conclusion', () => {
    const ids = tmpl?.sections.map((s) => s.id) ?? [];
    expect(ids).toContain('abstract');
    expect(ids).toContain('conclusion');
    expect(ids.length).toBeGreaterThanOrEqual(6);
  });

  it('all required sections are marked required', () => {
    const requiredSections = [
      'abstract',
      'introduction',
      'results',
      'conclusion',
    ];
    for (const sec of tmpl?.sections ?? []) {
      if (requiredSections.includes(sec.id)) {
        expect(sec.required).toBe(true);
      }
    }
  });

  it('supports extensions', () => {
    expect(tmpl?.supportedExtensions).toBe(true);
  });
});

describe('custom-document template', () => {
  const tmpl = DOCUMENT_TEMPLATES.custom[0];

  it('exists', () => {
    expect(tmpl).toBeDefined();
  });

  it('has empty sections array', () => {
    expect(tmpl.sections).toEqual([]);
  });

  it('supports extensions', () => {
    expect(tmpl.supportedExtensions).toBe(true);
  });
});

describe('api-documentation template', () => {
  const tmpl = DOCUMENT_TEMPLATES.technical_doc.find(
    (t) => t.id === 'api-documentation'
  );

  it('exists', () => {
    expect(tmpl).toBeDefined();
  });

  it('has technical tone', () => {
    expect(tmpl?.styleGuide.tone).toBe('technical');
  });

  it('does NOT support extensions', () => {
    expect(tmpl?.supportedExtensions).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GENERATION_OPTIONS
// ---------------------------------------------------------------------------

describe('GENERATION_OPTIONS', () => {
  it('has 3 detailLevel options', () => {
    expect(GENERATION_OPTIONS.detailLevel.length).toBe(3);
  });

  it('detail levels have values 1, 2, 3', () => {
    const values = GENERATION_OPTIONS.detailLevel.map((d) => d.value);
    expect(values).toEqual([1, 2, 3]);
  });

  it('has 4 tone options', () => {
    expect(GENERATION_OPTIONS.tone.length).toBe(4);
  });

  it('tone options include academic, business, casual, technical', () => {
    const values = GENERATION_OPTIONS.tone.map((t) => t.value);
    expect(values).toContain('academic');
    expect(values).toContain('business');
    expect(values).toContain('casual');
    expect(values).toContain('technical');
  });

  it('has extensionOptions as an array with at least 3 items', () => {
    expect(Array.isArray(GENERATION_OPTIONS.extensionOptions)).toBe(true);
    expect(GENERATION_OPTIONS.extensionOptions.length).toBeGreaterThanOrEqual(
      3
    );
  });

  it('every extensionOption has an id, label, and description', () => {
    for (const opt of GENERATION_OPTIONS.extensionOptions) {
      expect(typeof opt.id).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.description).toBe('string');
    }
  });
});
