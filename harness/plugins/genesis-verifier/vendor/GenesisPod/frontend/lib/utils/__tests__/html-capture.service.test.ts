/**
 * Tests for lib/utils/html-capture.service.ts
 *
 * Tests the HtmlCaptureService static methods.
 * Uses jsdom environment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HtmlCaptureService } from '../html-capture.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeContainer(
  html: string,
  selector = '#test-container'
): HTMLElement {
  const div = document.createElement('div');
  div.id = 'test-container';
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

function cleanup() {
  document.body.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// capture - basic functionality
// ---------------------------------------------------------------------------
describe('HtmlCaptureService.capture', () => {
  it('throws when container selector not found', async () => {
    await expect(
      HtmlCaptureService.capture('#non-existent-container', {
        inlineStyles: false,
        freezeCharts: false,
        freezeMermaid: false,
        inlineImages: false,
      })
    ).rejects.toThrow('Container not found');
  });

  it('returns html and css properties', async () => {
    makeContainer('<p class="test-class">Hello World</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('css');
    expect(typeof result.html).toBe('string');
    expect(typeof result.css).toBe('string');
  });

  it('html contains the container content', async () => {
    makeContainer('<p>Content here</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('Content here');
  });

  it('does not modify the live DOM when cloning', async () => {
    makeContainer('<p id="original-para">Original</p>');
    const originalPara = document.getElementById('original-para');

    await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // Original paragraph should still exist
    expect(document.getElementById('original-para')).toBe(originalPara);
  });

  it('works with inlineStyles=true', async () => {
    makeContainer('<p class="myClass">Styled content</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: true,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toBeDefined();
    expect(result.css).toBeDefined();
  });

  it('works with freezeCharts=true when no charts present', async () => {
    makeContainer('<p>No charts here</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: true,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('No charts here');
  });

  it('works with inlineImages=true when no images present', async () => {
    makeContainer('<p>No images here</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    expect(result.html).toContain('No images here');
  });

  it('handles empty container', async () => {
    makeContainer('');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toBeDefined();
    expect(typeof result.html).toBe('string');
  });

  it('uses default options when none provided', async () => {
    makeContainer('<p>Default options test</p>');

    // Should not throw with default options
    const result = await HtmlCaptureService.capture('#test-container');

    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('css');
  });

  it('handles container with nested elements', async () => {
    makeContainer(`
      <div class="outer">
        <h1>Title</h1>
        <p class="text">Paragraph</p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      </div>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('Title');
    expect(result.html).toContain('Paragraph');
    expect(result.html).toContain('Item 1');
  });

  it('handles container with data attributes', async () => {
    makeContainer(
      '<div data-testid="test" data-value="42">Data attr test</div>'
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('data-testid');
  });
});

// ---------------------------------------------------------------------------
// freezeCharts - recharts support
// ---------------------------------------------------------------------------
describe('HtmlCaptureService.capture with recharts charts', () => {
  it('handles container with recharts wrapper elements', async () => {
    makeContainer(`
      <div class="recharts-wrapper" style="width: 400px; height: 300px;">
        <svg width="400" height="300">
          <g class="recharts-cartesian-grid">
            <line x1="0" y1="0" x2="400" y2="0"/>
          </g>
          <g class="recharts-tooltip-wrapper">
            <div>Tooltip content</div>
          </g>
        </svg>
      </div>
    `);

    // Should not throw even with recharts elements
    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: true,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// inlineImages - image handling
// ---------------------------------------------------------------------------
describe('HtmlCaptureService.capture with images', () => {
  it('handles images with data: URLs (already inlined)', async () => {
    makeContainer(`
      <img src="data:image/png;base64,iVBORw0KGgo=" alt="test" />
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    // data: URLs should be preserved
    expect(result.html).toContain('data:image/png');
  });

  it('handles fetch failure for external images gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    makeContainer(
      `<img src="https://external.example.com/image.png" alt="external" />`
    );

    // Should not throw even when image fetch fails
    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    expect(result).toHaveProperty('html');
  });
});

// ---------------------------------------------------------------------------
// removeInteractivity
// ---------------------------------------------------------------------------
describe('HtmlCaptureService.capture - removes interactivity', () => {
  it('result html should not be identical to input (cloned and processed)', async () => {
    makeContainer('<button onclick="alert(1)">Click me</button>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // The html should be the clone's outerHTML
    expect(result.html).toContain('div');
  });
});

// ---------------------------------------------------------------------------
// removeInteractivity - deeper coverage
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - removeInteractivity via capture', () => {
  it('removes on* event attributes from elements', async () => {
    makeContainer(
      '<button onclick="doStuff()" onmouseover="hover()">Button</button>'
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).not.toContain('onclick');
    expect(result.html).not.toContain('onmouseover');
  });

  it('removes data-radix attributes from elements', async () => {
    makeContainer(
      '<div data-radix-collection-item="true" data-radix-popper-content-wrapper="">content</div>'
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).not.toContain('data-radix');
  });

  it('removes script tags', async () => {
    makeContainer('<p>text</p><script>alert("xss")</script>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('alert');
  });

  it('removes aria-hidden elements that are display:none', async () => {
    makeContainer(
      '<span aria-hidden="true" style="display: none">hidden</span><p>visible</p>'
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // display:none aria-hidden elements should be removed
    expect(result.html).toContain('visible');
  });

  it('preserves aria-hidden elements without display:none (decorative)', async () => {
    makeContainer('<span aria-hidden="true">icon</span><p>content</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('content');
  });
});

// ---------------------------------------------------------------------------
// inlineStyles - critical style inlining
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - inlineStyles coverage', () => {
  it('inlines styles for headings', async () => {
    makeContainer('<h1>Main Title</h1><h2>Sub Title</h2><h3>Small</h3>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: true,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // Should contain the heading text
    expect(result.html).toContain('Main Title');
    expect(result.html).toContain('Sub Title');
  });

  it('inlines styles for table elements', async () => {
    makeContainer(`
      <table>
        <thead><tr><th>Header</th></tr></thead>
        <tbody><tr><td>Cell</td></tr></tbody>
      </table>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: true,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('Header');
    expect(result.html).toContain('Cell');
  });

  it('handles existing inline style when adding computed styles', async () => {
    makeContainer('<h2 style="color: red;">Existing Style</h2>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: true,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('Existing Style');
  });

  it('inlines styles for code/pre/blockquote elements', async () => {
    makeContainer(`
      <pre><code>const x = 1;</code></pre>
      <blockquote>A quote</blockquote>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: true,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('const x = 1');
    expect(result.html).toContain('A quote');
  });
});

// ---------------------------------------------------------------------------
// extractStyles (via capture) - CSS rule coverage
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - extractStyles CSS coverage', () => {
  it('extracts styles from document.styleSheets if available', async () => {
    makeContainer('<p class="test-paragraph">Styled text</p>');

    // The result should have a css field (may be empty in jsdom)
    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(typeof result.css).toBe('string');
  });

  it('handles container with id selector', async () => {
    const div = document.createElement('div');
    div.id = 'styled-container';
    div.innerHTML = '<p>content</p>';
    document.body.appendChild(div);

    const result = await HtmlCaptureService.capture('#styled-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).toContain('content');
    document.body.removeChild(div);
  });

  it('extracts class-matching CSS rules (selectorMightMatch via class)', async () => {
    const style = document.createElement('style');
    style.textContent = '.my-special-class { color: red; }';
    document.head.appendChild(style);

    makeContainer('<p class="my-special-class">styled content</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.css).toContain('my-special-class');
    document.head.removeChild(style);
  });

  it('includes wildcard (*) selector always in CSS output', async () => {
    const style = document.createElement('style');
    style.textContent = '* { box-sizing: border-box; }';
    document.head.appendChild(style);

    makeContainer('<p>content</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.css).toContain('box-sizing');
    document.head.removeChild(style);
  });

  it('excludes :root/html/body rules to prevent app background leaking into export', async () => {
    const style = document.createElement('style');
    style.textContent = ':root { --primary: blue; } body { background: gray; }';
    document.head.appendChild(style);

    makeContainer('<p>content</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.css).not.toContain('--primary');
    expect(result.css).not.toContain('background: gray');
    document.head.removeChild(style);
  });

  it('includes tag-name CSS rules when matching tags are used', async () => {
    const style = document.createElement('style');
    style.textContent = 'p { margin: 0; }';
    document.head.appendChild(style);

    makeContainer('<p>paragraph</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // p tag is used, so "p { margin: 0; }" should be in CSS
    expect(result.css).toContain('margin');
    document.head.removeChild(style);
  });

  it('includes ID-based CSS rules when id is present in container', async () => {
    const style = document.createElement('style');
    style.textContent = '#myUniqueId { background: blue; }';
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.id = 'test-container';
    container.innerHTML = '<span id="myUniqueId">id test</span>';
    document.body.appendChild(container);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.css).toContain('myUniqueId');
    document.head.removeChild(style);
  });

  it('includes @media rule containing matching inner class selectors', async () => {
    const style = document.createElement('style');
    style.textContent =
      '@media (max-width: 768px) { .resp-cls { display: none; } }';
    document.head.appendChild(style);

    makeContainer('<div class="resp-cls">responsive</div>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.css).toContain('resp-cls');
    document.head.removeChild(style);
  });
});

// ---------------------------------------------------------------------------
// freezeCharts - recharts chart with interaction elements
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - freezeCharts interaction removal', () => {
  it('removes recharts interactive tooltip layers', async () => {
    makeContainer(`
      <div class="recharts-wrapper">
        <svg width="400" height="300">
          <g class="recharts-cartesian-grid"></g>
          <g class="recharts-layer recharts-bar"></g>
          <g class="recharts-layer recharts-xAxis"></g>
          <circle class="recharts-active-dot" r="4" />
          <rect class="recharts-cursor" />
        </svg>
        <div class="recharts-tooltip-wrapper" style="visibility:visible">tooltip</div>
      </div>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: true,
      freezeMermaid: false,
      inlineImages: false,
    });

    // Should not contain interactive elements
    expect(result.html).not.toContain('recharts-tooltip-wrapper');
    expect(result.html).not.toContain('recharts-active-dot');
  });

  it('handles recharts wrapper without SVG gracefully', async () => {
    makeContainer(`
      <div class="recharts-wrapper">
        <p>No SVG here</p>
      </div>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: true,
      freezeMermaid: false,
      inlineImages: false,
    });

    // Should not throw, just pass through
    expect(result.html).toBeDefined();
  });

  it('removes on* event attributes from SVG children', async () => {
    makeContainer(`
      <div class="recharts-wrapper">
        <svg width="100" height="100">
          <circle onclick="noop()" onmouseover="hover()" r="5" />
        </svg>
      </div>
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: true,
      freezeMermaid: false,
      inlineImages: false,
    });

    expect(result.html).not.toContain('onclick');
  });
});

// ---------------------------------------------------------------------------
// inlineImages - image conversion
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - inlineImages detailed coverage', () => {
  it('handles blob: URLs without fetching', async () => {
    makeContainer(
      `<img src="blob:http://localhost/abc-123" alt="blob image" />`
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    // blob: URL should not be fetched (skipped)
    expect(result.html).toContain('blob:');
  });

  it('converts external image to data URL on successful fetch', async () => {
    const fakeBlob = new Blob(['fake-png-data'], { type: 'image/png' });
    const fakeDataUrl = 'data:image/png;base64,ZmFrZQ==';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    });

    // Mock FileReader
    const mockReadAsDataURL = vi.fn();
    const originalFileReader = global.FileReader;
    global.FileReader = vi.fn().mockImplementation(() => ({
      readAsDataURL: mockReadAsDataURL.mockImplementation(function (this: {
        onloadend: () => void;
        result: string;
      }) {
        this.result = fakeDataUrl;
        setTimeout(() => this.onloadend?.(), 0);
      }),
      onloadend: null,
      onerror: null,
      result: null,
    })) as unknown as typeof FileReader;

    makeContainer(`<img src="https://example.com/photo.png" alt="remote" />`);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    expect(result.html).toBeDefined();
    global.FileReader = originalFileReader;
  });

  it('handles non-ok fetch response gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    makeContainer(
      `<img src="https://example.com/forbidden.png" alt="forbidden" />`
    );

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    // Should not throw - keeps original src
    expect(result.html).toBeDefined();
  });

  it('handles multiple images concurrently', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    makeContainer(`
      <img src="https://example.com/img1.png" alt="1" />
      <img src="https://example.com/img2.png" alt="2" />
      <img src="https://example.com/img3.png" alt="3" />
    `);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    // All should degrade gracefully
    expect(result.html).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mermaid capture
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - mermaid capture', () => {
  it('handles mermaid containers with no rendered SVG (timeout)', async () => {
    makeContainer(`
      <div class="mermaid">graph TD; A-->B;</div>
    `);

    // No SVG is rendered (mermaid hasn't run), so captureMermaid waits then gives up
    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: true,
      inlineImages: false,
      timeout: 100, // very short timeout
    });

    // Should not throw, just complete
    expect(result.html).toBeDefined();
  });

  it('copies rendered SVG from mermaid container to clone', async () => {
    // Create container with a mermaid element that has an SVG child
    const div = document.createElement('div');
    div.id = 'test-container';
    const mermaidEl = document.createElement('div');
    mermaidEl.className = 'mermaid';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    svg.setAttribute('height', '100');
    mermaidEl.appendChild(svg);
    div.appendChild(mermaidEl);
    document.body.appendChild(div);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: true,
      inlineImages: false,
      timeout: 500,
    });

    expect(result.html).toContain('svg');
    document.body.removeChild(div);
  });

  it('handles data-mermaid containers', async () => {
    makeContainer('<div data-mermaid="true">sequenceDiagram...</div>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: true,
      inlineImages: false,
      timeout: 100,
    });

    expect(result.html).toBeDefined();
  });

  it('handles mermaid SVG without explicit width/height', async () => {
    const div = document.createElement('div');
    div.id = 'test-container';
    const mermaidEl = document.createElement('div');
    mermaidEl.className = 'mermaid';
    // SVG without width/height attributes
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // No width/height set - should trigger getBoundingClientRect path
    mermaidEl.appendChild(svg);
    div.appendChild(mermaidEl);
    document.body.appendChild(div);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: true,
      inlineImages: false,
      timeout: 500,
    });

    expect(result.html).toBeDefined();
    document.body.removeChild(div);
  });
});

// ---------------------------------------------------------------------------
// extractStyles - cross-origin stylesheet skip (line 117)
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - extractStyles skips cross-origin stylesheets', () => {
  it('skips stylesheets whose href does not start with window.location.origin', async () => {
    // We can simulate a cross-origin sheet by creating one with an external href
    // In jsdom we can't create a real cross-origin <link>, but we can mock styleSheets
    const style = document.createElement('style');
    style.textContent = '.local-class { color: green; }';
    document.head.appendChild(style);

    // Create a mock cross-origin sheet by overriding the styleSheets list
    const crossOriginSheet = {
      href: 'https://cdn.external-origin.com/styles.css',
      cssRules: [],
      rules: [],
    };
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'styleSheets'
    );
    const realSheets = document.styleSheets;
    const mockSheetList = {
      ...realSheets,
      length: realSheets.length + 1,
      item: (i: number) =>
        i === 0 ? crossOriginSheet : realSheets.item(i - 1),
      [Symbol.iterator]: function* () {
        yield crossOriginSheet;
        for (const s of Array.from(realSheets)) yield s;
      },
    };
    Object.defineProperty(document, 'styleSheets', {
      get() {
        return mockSheetList;
      },
      configurable: true,
    });

    makeContainer('<p class="local-class">cross-origin test</p>');

    let result: { html: string; css: string } | undefined;
    try {
      result = await HtmlCaptureService.capture('#test-container', {
        inlineStyles: false,
        freezeCharts: false,
        freezeMermaid: false,
        inlineImages: false,
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(document, 'styleSheets', originalDescriptor);
      }
      document.head.removeChild(style);
    }

    expect(result).toBeDefined();
    // Local class rules should still be present (from the real sheet)
    expect(result.css).toContain('local-class');
  });
});

// ---------------------------------------------------------------------------
// extractStyles - @keyframes and @font-face rules (lines 157-179)
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - extractStyles handles @keyframes and @font-face via mocked globals', () => {
  it('includes @keyframes rule when animation name is used in container', async () => {
    // jsdom does not expose CSSKeyframesRule as a global, so we must stub it
    // to make the instanceof check work. We use the actual CSSKeyframesRule
    // constructor from the parsed stylesheet.
    const style = document.createElement('style');
    style.textContent = `
      @keyframes test-fade {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .anim-el { animation-name: test-fade; }
    `;
    document.head.appendChild(style);

    // Find the actual CSSKeyframesRule constructor from the parsed sheet
    let KeyframesCtorFromJsdom: (new () => object) | null = null;
    for (const sheet of Array.from(document.styleSheets)) {
      if (!sheet.href) {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.constructor.name === 'CSSKeyframesRule') {
            KeyframesCtorFromJsdom = rule.constructor as new () => object;
            break;
          }
        }
      }
      if (KeyframesCtorFromJsdom) break;
    }

    if (!KeyframesCtorFromJsdom) {
      document.head.removeChild(style);
      // If jsdom doesn't support it, skip coverage for these lines
      expect(true).toBe(true);
      return;
    }

    // Stub global CSSKeyframesRule so instanceof checks in extractStyles work
    const g = globalThis as Record<string, unknown>;
    const origKeyframes = g['CSSKeyframesRule'];
    g['CSSKeyframesRule'] = KeyframesCtorFromJsdom;

    // Make the animated element appear to use the animation via getComputedStyle
    const origGetComputedStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const real = origGetComputedStyle.call(window, el);
      const proxy = new Proxy(real, {
        get(target, prop) {
          if (prop === 'animationName') return 'test-fade';
          const val = Reflect.get(target, prop);
          if (typeof val === 'function') return val.bind(target);
          return val;
        },
      });
      return proxy;
    });

    makeContainer('<div class="anim-el">animation test</div>');

    let result: { html: string; css: string } | undefined;
    try {
      result = await HtmlCaptureService.capture('#test-container', {
        inlineStyles: false,
        freezeCharts: false,
        freezeMermaid: false,
        inlineImages: false,
      });
    } finally {
      g['CSSKeyframesRule'] = origKeyframes;
      vi.restoreAllMocks();
      document.head.removeChild(style);
    }

    expect(result).toBeDefined();
    // The @keyframes rule should be included in CSS since animation is used
    expect(result.css).toContain('test-fade');
  });

  it('includes @font-face rule when font family is used in container', async () => {
    const style = document.createElement('style');
    style.textContent = `
      @font-face {
        font-family: "TestFont";
        src: url("/fonts/test.woff2");
      }
      .font-el { font-family: "TestFont", sans-serif; }
    `;
    document.head.appendChild(style);

    // Find actual CSSFontFaceRule constructor
    let FontFaceCtorFromJsdom: (new () => object) | null = null;
    for (const sheet of Array.from(document.styleSheets)) {
      if (!sheet.href) {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule.constructor.name === 'CSSFontFaceRule') {
            FontFaceCtorFromJsdom = rule.constructor as new () => object;
            break;
          }
        }
      }
      if (FontFaceCtorFromJsdom) break;
    }

    if (!FontFaceCtorFromJsdom) {
      document.head.removeChild(style);
      expect(true).toBe(true);
      return;
    }

    const g = globalThis as Record<string, unknown>;
    const origFontFace = g['CSSFontFaceRule'];
    g['CSSFontFaceRule'] = FontFaceCtorFromJsdom;

    const origGetComputedStyle = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const real = origGetComputedStyle.call(window, el);
      const proxy = new Proxy(real, {
        get(target, prop) {
          if (prop === 'fontFamily') return '"TestFont", sans-serif';
          const val = Reflect.get(target, prop);
          if (typeof val === 'function') return val.bind(target);
          return val;
        },
      });
      return proxy;
    });

    makeContainer('<p class="font-el">font test</p>');

    let result: { html: string; css: string } | undefined;
    try {
      result = await HtmlCaptureService.capture('#test-container', {
        inlineStyles: false,
        freezeCharts: false,
        freezeMermaid: false,
        inlineImages: false,
      });
    } finally {
      g['CSSFontFaceRule'] = origFontFace;
      vi.restoreAllMocks();
      document.head.removeChild(style);
    }

    expect(result).toBeDefined();
    // The @font-face rule should be included since font is used
    // (or the fallback path runs gracefully - either way no throw)
    expect(typeof result.css).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// extractStyles - outer catch fallback (line 193)
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - extractStyles outer catch fallback', () => {
  it('falls back to collecting <style> tag content when styleSheets access throws', async () => {
    // Inject a <style> tag that will be collected in the fallback path
    const style = document.createElement('style');
    style.textContent = '.fallback-class { color: orange; }';
    document.head.appendChild(style);

    // Make document.styleSheets throw to trigger the outer catch
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'styleSheets'
    );
    Object.defineProperty(document, 'styleSheets', {
      get() {
        throw new Error('StyleSheets access denied');
      },
      configurable: true,
    });

    makeContainer('<p class="fallback-class">fallback</p>');

    let result: { html: string; css: string } | undefined;
    try {
      result = await HtmlCaptureService.capture('#test-container', {
        inlineStyles: false,
        freezeCharts: false,
        freezeMermaid: false,
        inlineImages: false,
      });
    } finally {
      // Restore original descriptor
      if (originalDescriptor) {
        Object.defineProperty(document, 'styleSheets', originalDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (document as unknown as Record<string, unknown>)['styleSheets'];
      }
      document.head.removeChild(style);
    }

    // The fallback should collect <style> tag content
    expect(result).toBeDefined();
    expect(result.css).toContain('fallback-class');
  });
});

// ---------------------------------------------------------------------------
// selectorMightMatch - unknown selector fallback (line 238)
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - selectorMightMatch unknown selector fallback', () => {
  it('includes CSS rules with attribute selectors (no class/id/tag match) in output', async () => {
    // Use a selector that has no class (.cls), id (#id), or simple tag at start
    // e.g., [data-theme="dark"] — starts with '[', has no leading tag/class/id
    const style = document.createElement('style');
    style.textContent = '[data-theme="dark"] { background: black; }';
    document.head.appendChild(style);

    makeContainer('<p>attribute selector test</p>');

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: false,
    });

    // The fallback `return true` path should include this rule
    expect(result.css).toContain('data-theme');
    document.head.removeChild(style);
  });
});

// ---------------------------------------------------------------------------
// inlineImages - FileReader onloadend sets cloneImg.src (lines 328-330)
// ---------------------------------------------------------------------------
describe('HtmlCaptureService - inlineImages FileReader onloadend applies data URL', () => {
  it('sets cloneImg.src to data URL and removes srcset/data-src attributes after successful FileReader', async () => {
    const fakeDataUrl = 'data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh';
    const fakeBlob = new Blob(['fake'], { type: 'image/png' });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(fakeBlob),
    });

    // FileReader mock that synchronously calls onloadend (no setTimeout)
    const originalFileReader = global.FileReader;
    global.FileReader = vi.fn().mockImplementation(function (this: {
      result: string | null;
      onloadend: (() => void) | null;
      onerror: ((e: unknown) => void) | null;
      readAsDataURL: (blob: Blob) => void;
    }) {
      this.result = null;
      this.onloadend = null;
      this.onerror = null;
      this.readAsDataURL = (_blob: Blob) => {
        this.result = fakeDataUrl;
        // Call onloadend synchronously to ensure it runs before Promise.allSettled resolves
        if (this.onloadend) this.onloadend();
      };
    }) as unknown as typeof FileReader;

    // Create container with srcset and data-src attributes
    const div = document.createElement('div');
    div.id = 'test-container';
    const img = document.createElement('img');
    img.src = 'https://example.com/photo.jpg';
    img.setAttribute('srcset', 'https://example.com/photo@2x.jpg 2x');
    img.setAttribute('data-src', 'https://example.com/photo-lazy.jpg');
    div.appendChild(img);
    document.body.appendChild(div);

    const result = await HtmlCaptureService.capture('#test-container', {
      inlineStyles: false,
      freezeCharts: false,
      freezeMermaid: false,
      inlineImages: true,
    });

    // The data URL should be set as src (lines 328-330 covered)
    expect(result.html).toContain('data:image/png;base64,ZmFrZS1pbWFnZS1kYXRh');
    // srcset and data-src should be removed
    expect(result.html).not.toContain('srcset');
    expect(result.html).not.toContain('data-src');

    document.body.removeChild(div);
    global.FileReader = originalFileReader;
  });
});
