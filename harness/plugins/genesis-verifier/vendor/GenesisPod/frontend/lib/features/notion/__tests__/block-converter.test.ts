/**
 * Tests for lib/notion/block-converter.ts
 *
 * Pure conversion functions: Notion blocks <-> BlockNote blocks.
 * No HTTP mocks needed. @blocknote/core is mocked at the type level.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock @blocknote/core — we only need the type shapes; no real editor needed
vi.mock('@blocknote/core', () => ({
  Block: {},
  PartialBlock: {},
}));

import {
  notionBlocksToBlockNote,
  blockNoteToNotionBlocks,
  extractPlainText,
} from '../block-converter';

// ---------------------------------------------------------------------------
// Helpers: minimal Notion block factories
// ---------------------------------------------------------------------------

function notionBlock(
  type: string,
  richText: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    href?: string;
  }> = [],
  extras: Record<string, unknown> = {}
) {
  return {
    id: `block-${Math.random().toString(36).slice(2)}`,
    type,
    [type]: {
      rich_text: richText.map((rt) => ({
        type: 'text' as const,
        text: { content: rt.text, link: rt.href ? { url: rt.href } : null },
        annotations: {
          bold: rt.bold ?? false,
          italic: rt.italic ?? false,
          strikethrough: false,
          underline: false,
          code: false,
        },
        plain_text: rt.text,
        href: rt.href ?? null,
      })),
      ...extras,
    },
    ...extras,
  };
}

function blockNoteBlock(
  type: string,
  content: unknown[] = [],
  props: Record<string, unknown> = {},
  id = 'bn-id'
) {
  return { id, type, content, props } as Parameters<
    typeof blockNoteToNotionBlocks
  >[0][number];
}

// ---------------------------------------------------------------------------
// notionBlocksToBlockNote
// ---------------------------------------------------------------------------

describe('notionBlocksToBlockNote', () => {
  it('returns a single empty paragraph for empty input', () => {
    const result = notionBlocksToBlockNote([]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('paragraph');
  });

  it('returns a single empty paragraph for null/undefined input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = notionBlocksToBlockNote(null as any);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('paragraph');
  });

  it('converts paragraph block', () => {
    const blocks = [notionBlock('paragraph', [{ text: 'Hello world' }])];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('paragraph');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = result[0].content as any[];
    expect(content[0].text).toBe('Hello world');
  });

  it('converts heading_1 to heading with level 1', () => {
    const blocks = [notionBlock('heading_1', [{ text: 'Main Title' }])];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('heading');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.level).toBe(1);
  });

  it('converts heading_2 to heading with level 2', () => {
    const blocks = [notionBlock('heading_2', [{ text: 'Sub Title' }])];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('heading');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.level).toBe(2);
  });

  it('converts heading_3 to heading with level 3', () => {
    const blocks = [notionBlock('heading_3', [{ text: 'Sub-Sub Title' }])];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('heading');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.level).toBe(3);
  });

  it('converts bulleted_list_item to bulletListItem', () => {
    const blocks = [
      notionBlock('bulleted_list_item', [{ text: 'Item 1' }]),
      notionBlock('bulleted_list_item', [{ text: 'Item 2' }]),
    ];
    const result = notionBlocksToBlockNote(blocks);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('bulletListItem');
    expect(result[1].type).toBe('bulletListItem');
  });

  it('converts numbered_list_item to numberedListItem', () => {
    const blocks = [
      notionBlock('numbered_list_item', [{ text: 'Step 1' }]),
      notionBlock('numbered_list_item', [{ text: 'Step 2' }]),
    ];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('numberedListItem');
  });

  it('converts to_do to checkListItem', () => {
    const block = {
      ...notionBlock('to_do', [{ text: 'Buy groceries' }]),
      to_do: {
        rich_text: [
          {
            type: 'text' as const,
            text: { content: 'Buy groceries', link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
            },
            plain_text: 'Buy groceries',
            href: null,
          },
        ],
        checked: true,
      },
    };

    const result = notionBlocksToBlockNote([block]);

    expect(result[0].type).toBe('checkListItem');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.checked).toBe(true);
  });

  it('converts quote to paragraph with gray color', () => {
    const blocks = [notionBlock('quote', [{ text: 'A famous quote' }])];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('paragraph');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.textColor).toBe('gray');
  });

  it('converts code block with language', () => {
    const block = {
      id: 'code-block',
      type: 'code',
      code: {
        rich_text: [
          {
            type: 'text' as const,
            text: { content: 'console.log("hi")', link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
            },
            plain_text: 'console.log("hi")',
            href: null,
          },
        ],
        language: 'javascript',
      },
    };

    const result = notionBlocksToBlockNote([block]);

    expect(result[0].type).toBe('codeBlock');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.language).toBe('javascript');
  });

  it('converts divider to separator paragraph', () => {
    const blocks = [{ id: 'div-1', type: 'divider' }];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('paragraph');
  });

  it('converts image block with file URL', () => {
    const blocks = [
      {
        id: 'img-1',
        type: 'image',
        image: {
          file: { url: 'https://example.com/photo.png' },
          caption: [],
        },
      },
    ];

    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('image');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.url).toBe('https://example.com/photo.png');
  });

  it('converts image block with external URL', () => {
    const blocks = [
      {
        id: 'img-2',
        type: 'image',
        image: {
          external: { url: 'https://cdn.example.com/banner.jpg' },
          caption: [
            {
              plain_text: 'A banner',
              type: 'text' as const,
              text: { content: 'A banner', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
              },
              href: null,
            },
          ],
        },
      },
    ];

    const result = notionBlocksToBlockNote(blocks);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.url).toBe(
      'https://cdn.example.com/banner.jpg'
    );
  });

  it('skips image block when no URL available', () => {
    const blocks = [
      {
        id: 'img-3',
        type: 'image',
        image: { caption: [] },
      },
    ];

    const result = notionBlocksToBlockNote(blocks);

    // image with no url should produce no image block
    expect(result.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('handles callout with emoji icon', () => {
    const block = {
      id: 'callout-1',
      type: 'callout',
      callout: {
        rich_text: [
          {
            type: 'text' as const,
            text: { content: 'Important note', link: null },
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
            },
            plain_text: 'Important note',
            href: null,
          },
        ],
        icon: { emoji: '💡' },
      },
    };

    const result = notionBlocksToBlockNote([block]);

    expect(result[0].type).toBe('paragraph');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((result[0] as any).props?.backgroundColor).toBe('yellow');
  });

  it('converts table block with children rows', () => {
    const block = {
      id: 'table-1',
      type: 'table',
      table: { table_width: 2 },
      children: [
        {
          table_row: {
            cells: [
              [
                {
                  type: 'text' as const,
                  text: { content: 'Col A', link: null },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                  },
                  plain_text: 'Col A',
                  href: null,
                },
              ],
              [
                {
                  type: 'text' as const,
                  text: { content: 'Col B', link: null },
                  annotations: {
                    bold: false,
                    italic: false,
                    strikethrough: false,
                    underline: false,
                    code: false,
                  },
                  plain_text: 'Col B',
                  href: null,
                },
              ],
            ],
          },
        },
      ],
    };

    const result = notionBlocksToBlockNote([block]);

    expect(result[0].type).toBe('table');
  });

  it('flushes pending list items before starting a new list type', () => {
    const blocks = [
      notionBlock('bulleted_list_item', [{ text: 'Bullet' }]),
      notionBlock('numbered_list_item', [{ text: 'Number' }]),
    ];
    const result = notionBlocksToBlockNote(blocks);

    expect(result[0].type).toBe('bulletListItem');
    expect(result[1].type).toBe('numberedListItem');
  });

  it('handles bold and italic text annotations', () => {
    const blocks = [
      notionBlock('paragraph', [{ text: 'Bold text', bold: true }]),
    ];
    const result = notionBlocksToBlockNote(blocks);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = result[0].content as any[];
    expect(content[0].styles?.bold).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// blockNoteToNotionBlocks
// ---------------------------------------------------------------------------

describe('blockNoteToNotionBlocks', () => {
  it('converts paragraph block', () => {
    const blocks = [
      blockNoteBlock('paragraph', [
        { type: 'text', text: 'Hello', styles: {} },
      ]),
    ];
    const result = blockNoteToNotionBlocks(blocks);

    expect(result[0].type).toBe('paragraph');
    expect(result[0].paragraph?.rich_text![0]!.plain_text).toBe('Hello');
  });

  it('converts heading to heading_1', () => {
    const block = {
      ...blockNoteBlock(
        'heading',
        [{ type: 'text', text: 'Title', styles: {} }],
        { level: 1 }
      ),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('heading_1');
    expect(result[0].heading_1?.rich_text![0]!.plain_text).toBe('Title');
  });

  it('converts heading to heading_2', () => {
    const block = {
      ...blockNoteBlock(
        'heading',
        [{ type: 'text', text: 'Sub', styles: {} }],
        { level: 2 }
      ),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('heading_2');
  });

  it('converts heading to heading_3', () => {
    const block = {
      ...blockNoteBlock(
        'heading',
        [{ type: 'text', text: 'Sub-sub', styles: {} }],
        { level: 3 }
      ),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('heading_3');
  });

  it('converts bulletListItem to bulleted_list_item', () => {
    const block = blockNoteBlock('bulletListItem', [
      { type: 'text', text: 'Bullet', styles: {} },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('bulleted_list_item');
    expect(result[0].bulleted_list_item?.rich_text![0]!.plain_text).toBe(
      'Bullet'
    );
  });

  it('converts numberedListItem to numbered_list_item', () => {
    const block = blockNoteBlock('numberedListItem', [
      { type: 'text', text: 'Step 1', styles: {} },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('numbered_list_item');
  });

  it('converts checkListItem to to_do', () => {
    const block = {
      ...blockNoteBlock(
        'checkListItem',
        [{ type: 'text', text: 'Task', styles: {} }],
        { checked: true }
      ),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('to_do');
    expect(result[0].to_do?.checked).toBe(true);
  });

  it('converts codeBlock to code with language', () => {
    const block = {
      ...blockNoteBlock(
        'codeBlock',
        [{ type: 'text', text: 'const x = 1;', styles: {} }],
        { language: 'typescript' }
      ),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('code');
    expect(result[0].code?.language).toBe('typescript');
  });

  it('converts image block with url', () => {
    const block = {
      ...blockNoteBlock('image', [], {
        url: 'https://example.com/img.png',
        caption: 'A photo',
      }),
    };
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('image');
    expect(result[0].image?.external?.url).toBe('https://example.com/img.png');
  });

  it('skips image block when no url', () => {
    const block = { ...blockNoteBlock('image', [], { url: undefined }) };
    const result = blockNoteToNotionBlocks([block]);

    expect(result.filter((b) => b.type === 'image')).toHaveLength(0);
  });

  it('converts unknown block type to paragraph', () => {
    const block = blockNoteBlock('customWidget', [
      { type: 'text', text: 'Custom', styles: {} },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].type).toBe('paragraph');
  });

  it('handles nested children recursively', () => {
    const child = blockNoteBlock(
      'paragraph',
      [{ type: 'text', text: 'Child', styles: {} }],
      {},
      'child-id'
    );
    const parent = {
      ...blockNoteBlock(
        'paragraph',
        [{ type: 'text', text: 'Parent', styles: {} }],
        {},
        'parent-id'
      ),
      children: [child],
    };

    const result = blockNoteToNotionBlocks([parent]);

    expect(result).toHaveLength(2);
    expect(result[1].paragraph?.rich_text![0]!.plain_text).toBe('Child');
  });

  it('converts bold style to bold annotation', () => {
    const block = blockNoteBlock('paragraph', [
      { type: 'text', text: 'Bold', styles: { bold: true } },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].paragraph?.rich_text![0]!.annotations?.bold).toBe(true);
  });

  it('converts italic style to italic annotation', () => {
    const block = blockNoteBlock('paragraph', [
      { type: 'text', text: 'Italic', styles: { italic: true } },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].paragraph?.rich_text![0]!.annotations?.italic).toBe(true);
  });

  it('converts strike style to strikethrough annotation', () => {
    const block = blockNoteBlock('paragraph', [
      { type: 'text', text: 'Struck', styles: { strike: true } },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].paragraph?.rich_text![0]!.annotations?.strikethrough).toBe(
      true
    );
  });

  it('converts link inline content to Notion rich text with link', () => {
    const block = blockNoteBlock('paragraph', [
      {
        type: 'link',
        href: 'https://example.com',
        content: [{ type: 'text', text: 'Click here', styles: {} }],
      },
    ]);
    const result = blockNoteToNotionBlocks([block]);

    expect(result[0].paragraph?.rich_text![0]!.text?.link?.url).toBe(
      'https://example.com'
    );
    expect(result[0].paragraph?.rich_text![0]!.plain_text).toBe('Click here');
  });

  it('handles empty blocks array', () => {
    const result = blockNoteToNotionBlocks([]);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractPlainText
// ---------------------------------------------------------------------------

describe('extractPlainText', () => {
  it('extracts plain text from paragraph blocks', () => {
    const blocks = [notionBlock('paragraph', [{ text: 'Hello' }])];
    const result = extractPlainText(blocks);

    expect(result).toContain('Hello');
  });

  it('extracts text from multiple blocks separated by newlines', () => {
    const blocks = [
      notionBlock('paragraph', [{ text: 'Line 1' }]),
      notionBlock('paragraph', [{ text: 'Line 2' }]),
    ];
    const result = extractPlainText(blocks);

    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
  });

  it('handles blocks with no rich_text', () => {
    const blocks = [{ id: 'div-1', type: 'divider' }];

    const result = extractPlainText(blocks);

    expect(result).toBe('');
  });

  it('returns empty string for empty input', () => {
    const result = extractPlainText([]);
    expect(result).toBe('');
  });

  it('concatenates multiple rich_text items within a block', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text' as const,
              text: { content: 'Hello ', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
              },
              plain_text: 'Hello ',
              href: null,
            },
            {
              type: 'text' as const,
              text: { content: 'World', link: null },
              annotations: {
                bold: false,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
              },
              plain_text: 'World',
              href: null,
            },
          ],
        },
      },
    ];

    const result = extractPlainText(blocks);

    expect(result).toBe('Hello World');
  });
});
