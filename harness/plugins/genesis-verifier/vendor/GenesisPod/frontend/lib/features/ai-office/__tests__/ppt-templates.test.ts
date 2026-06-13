/**
 * Tests for lib/ai-office/ppt-templates.ts
 *
 * Covers: PPT_TEMPLATES data integrity, getAllTemplates(),
 * getTemplateById(), getTemplatesByCategory(), getTemplateStyles().
 */

import { describe, it, expect } from 'vitest';
import {
  PPT_TEMPLATES,
  getAllTemplates,
  getTemplateById,
  getTemplatesByCategory,
  getTemplateStyles,
  type PPTTemplate,
} from '../ppt-templates';

// ---------------------------------------------------------------------------
// PPT_TEMPLATES — data integrity
// ---------------------------------------------------------------------------

describe('PPT_TEMPLATES', () => {
  const templateIds = Object.keys(PPT_TEMPLATES);

  it('contains at least 10 templates', () => {
    expect(templateIds.length).toBeGreaterThanOrEqual(10);
  });

  it('every template has a non-empty id matching its key', () => {
    for (const [key, tmpl] of Object.entries(PPT_TEMPLATES)) {
      expect(tmpl.id).toBe(key);
    }
  });

  it('every template has a non-empty name and nameCn', () => {
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(tmpl.name.length).toBeGreaterThan(0);
      expect(tmpl.nameCn.length).toBeGreaterThan(0);
    }
  });

  it('every template has a valid category', () => {
    const validCategories = [
      'corporate',
      'minimal',
      'modern',
      'creative',
      'academic',
      'premium',
    ];
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(validCategories).toContain(tmpl.category);
    }
  });

  it('every template colors object has required color keys', () => {
    const requiredKeys = [
      'primary',
      'secondary',
      'accent',
      'background',
      'text',
      'textLight',
      'textSecondary',
      'textTertiary',
      'decorative',
    ];
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      for (const key of requiredKeys) {
        expect(tmpl.colors).toHaveProperty(key);
      }
    }
  });

  it('every template has heading and body fonts', () => {
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(typeof tmpl.fonts.heading).toBe('string');
      expect(tmpl.fonts.heading.length).toBeGreaterThan(0);
      expect(typeof tmpl.fonts.body).toBe('string');
    }
  });

  it('every template has a positive title font size', () => {
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(tmpl.typography.title).toBeGreaterThan(0);
    }
  });

  it('every template has decoration flags as booleans', () => {
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(typeof tmpl.decorations.showTopBar).toBe('boolean');
      expect(typeof tmpl.decorations.showBottomBar).toBe('boolean');
      expect(typeof tmpl.decorations.useCardLayout).toBe('boolean');
    }
  });

  it('every template style has a layoutStyle of "light" or "dark"', () => {
    for (const tmpl of Object.values(PPT_TEMPLATES)) {
      expect(['light', 'dark']).toContain(tmpl.style.layoutStyle);
    }
  });

  it('corporate template is a dark layoutStyle', () => {
    expect(PPT_TEMPLATES.corporate.style.layoutStyle).toBe('dark');
  });

  it('academic template is a light layoutStyle', () => {
    expect(PPT_TEMPLATES.academic.style.layoutStyle).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// getAllTemplates()
// ---------------------------------------------------------------------------

describe('getAllTemplates', () => {
  it('returns an array', () => {
    expect(Array.isArray(getAllTemplates())).toBe(true);
  });

  it('returns the same number of entries as PPT_TEMPLATES keys', () => {
    expect(getAllTemplates().length).toBe(Object.keys(PPT_TEMPLATES).length);
  });

  it('every returned item is a PPTTemplate with required fields', () => {
    for (const tmpl of getAllTemplates()) {
      expect(tmpl).toHaveProperty('id');
      expect(tmpl).toHaveProperty('name');
      expect(tmpl).toHaveProperty('colors');
      expect(tmpl).toHaveProperty('typography');
    }
  });
});

// ---------------------------------------------------------------------------
// getTemplateById()
// ---------------------------------------------------------------------------

describe('getTemplateById', () => {
  it('returns the correct template for "corporate"', () => {
    const tmpl = getTemplateById('corporate');
    expect(tmpl.id).toBe('corporate');
  });

  it('returns the correct template for "academic"', () => {
    const tmpl = getTemplateById('academic');
    expect(tmpl.id).toBe('academic');
  });

  it('returns the correct template for "executive-white"', () => {
    const tmpl = getTemplateById('executive-white');
    expect(tmpl.id).toBe('executive-white');
  });

  it('returns corporate as fallback for an unknown id', () => {
    const tmpl = getTemplateById('non-existent-id');
    expect(tmpl.id).toBe('corporate');
  });

  it('returns a template with all required color properties', () => {
    const tmpl = getTemplateById('genspark-pro');
    expect(tmpl.colors.primary).toBeTruthy();
    expect(tmpl.colors.background).toBeTruthy();
  });

  it('premium templates have glow color defined', () => {
    const pro = getTemplateById('genspark-pro');
    expect(pro.colors.glow).toBeTruthy();
    const purple = getTemplateById('tech-purple');
    expect(purple.colors.glow).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getTemplatesByCategory()
// ---------------------------------------------------------------------------

describe('getTemplatesByCategory', () => {
  it('returns only templates matching the requested category', () => {
    const academic = getTemplatesByCategory('academic');
    for (const tmpl of academic) {
      expect(tmpl.category).toBe('academic');
    }
  });

  it('returns at least 2 academic templates', () => {
    expect(getTemplatesByCategory('academic').length).toBeGreaterThanOrEqual(2);
  });

  it('returns at least 1 corporate template', () => {
    expect(getTemplatesByCategory('corporate').length).toBeGreaterThanOrEqual(
      1
    );
  });

  it('returns at least 3 premium templates', () => {
    expect(getTemplatesByCategory('premium').length).toBeGreaterThanOrEqual(3);
  });

  it('returns an empty array for a non-existent category', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = getTemplatesByCategory('unknown' as any);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTemplateStyles()
// ---------------------------------------------------------------------------

describe('getTemplateStyles', () => {
  it('returns a string', () => {
    const tmpl = getTemplateById('corporate');
    expect(typeof getTemplateStyles(tmpl)).toBe('string');
  });

  it('contains --template-primary CSS variable', () => {
    const tmpl = getTemplateById('corporate');
    expect(getTemplateStyles(tmpl)).toContain('--template-primary');
  });

  it('contains the primary color value', () => {
    const tmpl = getTemplateById('corporate');
    const styles = getTemplateStyles(tmpl);
    expect(styles).toContain(tmpl.colors.primary);
  });

  it('contains --template-background', () => {
    const tmpl = getTemplateById('minimal');
    expect(getTemplateStyles(tmpl)).toContain('--template-background');
  });

  it('contains --template-font-heading with font value', () => {
    const tmpl = getTemplateById('academic');
    const styles = getTemplateStyles(tmpl);
    expect(styles).toContain('--template-font-heading');
    expect(styles).toContain(tmpl.fonts.heading);
  });

  it('contains --template-border-radius', () => {
    const tmpl = getTemplateById('modern');
    expect(getTemplateStyles(tmpl)).toContain('--template-border-radius');
  });
});

// ---------------------------------------------------------------------------
// Typography hierarchy integrity
// ---------------------------------------------------------------------------

describe('typography hierarchy', () => {
  it('title font size >= heading1 font size for all templates', () => {
    for (const tmpl of getAllTemplates()) {
      expect(tmpl.typography.title).toBeGreaterThanOrEqual(
        tmpl.typography.heading1
      );
    }
  });

  it('heading1 font size >= body font size for all templates', () => {
    for (const tmpl of getAllTemplates()) {
      expect(tmpl.typography.heading1).toBeGreaterThanOrEqual(
        tmpl.typography.body
      );
    }
  });

  it('body font size >= caption font size for all templates', () => {
    for (const tmpl of getAllTemplates()) {
      expect(tmpl.typography.body).toBeGreaterThanOrEqual(
        tmpl.typography.caption
      );
    }
  });
});
