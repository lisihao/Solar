/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the ai-provider-logos utility
vi.mock('@/lib/constants/ai-provider-logos', () => ({
  getProviderBrand: vi.fn((name: string) => {
    const lower = name.toLowerCase();
    if (lower.includes('gpt') || lower.includes('openai')) {
      return {
        name: 'OpenAI',
        logo: '/icons/ai/openai.svg',
        color: '#10a37f',
        gradient: '',
      };
    }
    if (lower.includes('claude') || lower.includes('anthropic')) {
      return {
        name: 'Claude',
        logo: '/icons/ai/claude.svg',
        color: '#d97706',
        gradient: '',
      };
    }
    if (lower.includes('gemini')) {
      return {
        name: 'Google Gemini',
        logo: '/icons/ai/gemini.svg',
        color: '#4285f4',
        gradient: '',
      };
    }
    return { name: 'AI', logo: '', color: '#6b7280', gradient: '' };
  }),
}));

import { ModelBadge } from '../ModelBadge';

describe('ModelBadge', () => {
  it('renders the model ID as label when no displayName is provided', () => {
    render(<ModelBadge modelId="gpt-4o" />);
    expect(screen.getByText('gpt-4o')).toBeInTheDocument();
  });

  it('renders displayName when provided instead of modelId', () => {
    render(<ModelBadge modelId="gpt-4o" displayName="GPT-4o" />);
    expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    // modelId text should not be shown separately as the label
    const label = screen.getByRole('img', { hidden: true }).parentElement
      ?.textContent;
    expect(label).toContain('GPT-4o');
  });

  it('renders provider logo image when brand has a logo', () => {
    render(<ModelBadge modelId="gpt-4o" />);
    const img = screen.getByRole('img', { hidden: true });
    expect(img.getAttribute('src')).toContain('/icons/ai/openai.svg');
    expect(img.getAttribute('alt')).toBe('OpenAI');
  });

  it('does not render img when brand has no logo (unknown provider)', () => {
    render(<ModelBadge modelId="unknown-model-xyz" />);
    expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  });

  it('uses default variant styling by default', () => {
    const { container } = render(<ModelBadge modelId="gpt-4o" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-indigo-50');
    expect(badge.className).toContain('text-indigo-600');
  });

  it('uses compact variant styling when variant=compact', () => {
    const { container } = render(
      <ModelBadge modelId="gpt-4o" variant="compact" />
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('font-mono');
    expect(badge.className).toContain('text-indigo-700');
  });

  it('uses subtle variant styling when variant=subtle', () => {
    const { container } = render(
      <ModelBadge modelId="gpt-4o" variant="subtle" />
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('bg-gray-100');
    expect(badge.className).toContain('text-gray-500');
  });

  it('applies custom className to the badge span', () => {
    const { container } = render(
      <ModelBadge modelId="gpt-4o" className="my-custom-class" />
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toContain('my-custom-class');
  });

  it('sets title attribute to modelId when no displayName', () => {
    const { container } = render(<ModelBadge modelId="gpt-4o" />);
    const badge = container.firstChild as HTMLElement;
    expect(badge.title).toBe('gpt-4o');
  });

  it('sets title attribute to displayName (modelId) format when displayName is provided', () => {
    const { container } = render(
      <ModelBadge modelId="gpt-4o" displayName="GPT-4o" />
    );
    const badge = container.firstChild as HTMLElement;
    expect(badge.title).toBe('GPT-4o (gpt-4o)');
  });

  it('renders Claude badge with correct logo for claude model', () => {
    render(<ModelBadge modelId="claude-3-opus" />);
    const img = screen.getByRole('img', { hidden: true });
    expect(img.getAttribute('src')).toContain('/icons/ai/claude.svg');
    expect(img.getAttribute('alt')).toBe('Claude');
  });

  it('renders as a span element', () => {
    const { container } = render(<ModelBadge modelId="gpt-4o" />);
    expect(container.firstChild?.nodeName).toBe('SPAN');
  });
});
