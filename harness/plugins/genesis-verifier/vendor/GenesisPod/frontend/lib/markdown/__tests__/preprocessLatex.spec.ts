import { describe, it, expect } from 'vitest';
import { preprocessLatex } from '../preprocessLatex';

describe('preprocessLatex — preserves well-formed input', () => {
  it('does NOT strip $ around `}$punct` when $ is legitimate closing delimiter', () => {
    // Real damage: pattern `}$；` in `$\frac{a}{b}$；若` — the `}$` IS the
    // closing of inline math followed by Chinese punctuation. Earlier
    // version's regex `/\}\$+([;；,，。.：:）)])/g` stripped the $.
    // Wrap in CJK-heavy prose so wrapBareDisplayMath doesn't trigger.
    const input =
      '前面的中文说明文字很多充当段落上下文。' +
      '若 $w(q)=\\frac{q-\\theta_0}{\\theta_a-\\theta_0}$；若 $q \\ge \\theta_a$，' +
      '后面的中文说明继续描述这个公式的语义。';
    const out = preprocessLatex(input);
    expect(out).toContain('\\theta_0}$；');
  });

  it('does NOT merge adjacent inline math across CJK prose', () => {
    // Real damage: `$A$<CJK prose>$B$<CJK prose>$C$` was matched by the
    // fragment-merge regex when the CJK prose landed in groups a/b — only
    // `mid` was checked for CJK. Both surrounding blocks got eaten.
    const input =
      '若 $q < \\theta_0$ 则有效贡献为 0；若 $\\theta_0 \\le q < \\theta_a$，则按线性折减 $w(q)=\\frac{q-\\theta_0}{\\theta_a-\\theta_0}$';
    const out = preprocessLatex(input);
    expect(out).toContain('$q < \\theta_0$');
    expect(out).toContain('$\\theta_0 \\le q < \\theta_a$');
    expect(out).toContain('$w(q)=\\frac{q-\\theta_0}{\\theta_a-\\theta_0}$');
  });

  it('still merges genuinely-fragmented formulas (ascii middle, no CJK)', () => {
    // Step 7.5 was INTENDED to fix: `$A$<ascii+command>$B$` → `$A<mid>B$`.
    // With CJK=prose guard in both `a` and `b` groups, this still works
    // when the three groups are all ASCII/math-only.
    const input = '$A$ \\cdot \\beta $B$';
    const out = preprocessLatex(input);
    // After merge: $A \cdot \beta B$ (one continuous math block)
    expect(out).toMatch(/\$A \\cdot \\beta B\$/);
  });

  it('preserves the exact v6 damaged segment from production', () => {
    // Full segment from report 0013ea31 v6 — must survive preprocessing.
    const input = `时间贡献。可设任务质量得分为 $q$，最低可接受阈值为 $\\theta_a$，完全无效阈值为 $\\theta_0$，若 $q < \\theta_0$ 则有效贡献为 0；若 $\\theta_0 \\le q < \\theta_a$，则按线性折减 $w(q)=\\frac{q-\\theta_0}{\\theta_a-\\theta_0}$；若 $q \\ge \\theta_a$`;
    const out = preprocessLatex(input);
    expect(out).toBe(input);
  });

  it('does not touch inline math with simple CJK punctuation around it', () => {
    const input = '公式 $\\alpha + \\beta$，其和为常数。';
    expect(preprocessLatex(input)).toBe(input);
  });

  it('still strips genuinely stray $$ patterns around closing braces', () => {
    // Pattern like `}$$} — keep this damage-fix working (require 2+ $)
    const input = '$T_{\\mathrm{end}$$}$';
    const out = preprocessLatex(input);
    // Should remove the stray extra $$ — but not the legitimate closing $
    expect(out).not.toContain('$$}');
  });

  it('does NOT merge across fullwidth punctuation (，；。) between $..$', () => {
    // Real v6 damage (user-reported 2026-04-18):
    //   $E_i\in[0,1]$，$\tau_{min}<\tau_{full}$，$\omega_j$ 非负
    // The fullwidth comma `，` (U+FF0C) is NOT in \u4e00-\u9fff ideograph
    // range, so earlier CJK guard missed it and step 7.5 merged three
    // legitimate inline blocks into one, stripping four valid `$`.
    const input =
      '建议至少满足以下约束：$E_i\\in[0,1]$，$\\tau_{min}<\\tau_{full}$，$\\omega_j$ 非负且总和为 1，$\\alpha_k\\ge1$，$\\lambda_k\\ge0$，$\\phi_i\\ge0$，并对 $r_i^{max}$ 给出业务上限。';
    const out = preprocessLatex(input);
    // Every individual inline block must survive intact
    expect(out).toContain('$E_i\\in[0,1]$');
    expect(out).toContain('$\\tau_{min}<\\tau_{full}$');
    expect(out).toContain('$\\omega_j$');
    expect(out).toContain('$\\alpha_k\\ge1$');
    expect(out).toContain('$\\lambda_k\\ge0$');
    expect(out).toContain('$\\phi_i\\ge0$');
    expect(out).toContain('$r_i^{max}$');
  });
});
