'use client';

import { useEffect, useMemo, useCallback, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';

// Notion Block Types
interface NotionRichText {
  type: 'text';
  text: { content: string };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    code?: boolean;
    color?: string;
  };
  plain_text: string;
}

interface NotionBlock {
  id?: string;
  type: string;
  [key: string]: unknown;
}

// BlockNote Types
interface BlockNoteTextContent {
  type: 'text';
  text: string;
  styles?: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    code?: boolean;
  };
}

interface BlockNoteBlock {
  id: string;
  type: string;
  content?: BlockNoteTextContent[];
  props?: Record<string, unknown>;
}

interface NotionPageEditorProps {
  initialBlocks: NotionBlock[];
  onChange?: (blocks: NotionBlock[]) => void;
  readOnly?: boolean;
}

/**
 * 将 Notion 块格式转换为 BlockNote 格式
 */
function notionToBlockNote(notionBlocks: NotionBlock[]): BlockNoteBlock[] {
  if (!notionBlocks || notionBlocks.length === 0) {
    return [
      {
        id: 'initial-block',
        type: 'paragraph',
        content: [],
      },
    ];
  }

  const blocks: BlockNoteBlock[] = [];

  for (const block of notionBlocks) {
    const converted = convertNotionBlock(block);
    if (converted) {
      blocks.push(converted);
    }
  }

  return blocks.length > 0
    ? blocks
    : [{ id: 'initial-block', type: 'paragraph', content: [] }];
}

function convertNotionBlock(block: NotionBlock): BlockNoteBlock | null {
  if (!block || !block.type) return null;

  const id = block.id || `block-${Math.random().toString(36).substr(2, 9)}`;
  const richText = getRichText(block);
  const content = convertRichTextToContent(richText);

  switch (block.type) {
    case 'paragraph':
      return { id, type: 'paragraph', content };

    case 'heading_1':
      return { id, type: 'heading', props: { level: 1 }, content };

    case 'heading_2':
      return { id, type: 'heading', props: { level: 2 }, content };

    case 'heading_3':
      return { id, type: 'heading', props: { level: 3 }, content };

    case 'bulleted_list_item':
      return { id, type: 'bulletListItem', content };

    case 'numbered_list_item':
      return { id, type: 'numberedListItem', content };

    case 'to_do':
      return {
        id,
        type: 'checkListItem',
        props: {
          checked: (block.to_do as { checked?: boolean })?.checked || false,
        },
        content,
      };

    case 'code':
      return {
        id,
        type: 'codeBlock',
        props: {
          language:
            (block.code as { language?: string })?.language || 'plain text',
        },
        content,
      };

    case 'quote':
      return { id, type: 'paragraph', content }; // BlockNote 没有原生 quote，用段落代替

    case 'image':
      const imageData = block.image as
        | { file?: { url?: string }; external?: { url?: string } }
        | undefined;
      const imageUrl = imageData?.file?.url || imageData?.external?.url || '';
      return {
        id,
        type: 'image',
        props: { url: imageUrl },
        content: [],
      };

    case 'divider':
      return {
        id,
        type: 'paragraph',
        content: [{ type: 'text', text: '---' }],
      };

    default:
      // 对于不支持的块类型，尝试提取文本内容
      if (content.length > 0) {
        return { id, type: 'paragraph', content };
      }
      return null;
  }
}

function getRichText(block: NotionBlock): NotionRichText[] {
  const blockContent = block[block.type] as Record<string, unknown> | undefined;
  if (!blockContent) return [];
  const richText = (blockContent.rich_text || blockContent.text) as
    | NotionRichText[]
    | undefined;
  return richText || [];
}

function convertRichTextToContent(
  richText: NotionRichText[]
): BlockNoteTextContent[] {
  if (!richText || richText.length === 0) return [];

  return richText
    .filter((rt) => rt.plain_text)
    .map((rt) => ({
      type: 'text',
      text: rt.plain_text,
      styles: {
        bold: rt.annotations?.bold || false,
        italic: rt.annotations?.italic || false,
        underline: rt.annotations?.underline || false,
        strike: rt.annotations?.strikethrough || false,
        code: rt.annotations?.code || false,
      },
    }));
}

/**
 * 将 BlockNote 格式转换回 Notion 格式（用于保存）
 */
function blockNoteToNotion(blocks: BlockNoteBlock[]): NotionBlock[] {
  return blocks
    .map((block) => convertBlockNoteBlock(block))
    .filter((b): b is NotionBlock => b !== null);
}

function convertBlockNoteBlock(block: BlockNoteBlock): NotionBlock | null {
  if (!block) return null;

  const richText = convertContentToRichText(block.content || []);

  switch (block.type) {
    case 'paragraph':
      return {
        id: block.id,
        type: 'paragraph',
        paragraph: { rich_text: richText },
      };

    case 'heading':
      const level = (block.props?.level as number) || 1;
      const headingType = `heading_${Math.min(level, 3)}` as
        | 'heading_1'
        | 'heading_2'
        | 'heading_3';
      return {
        id: block.id,
        type: headingType,
        [headingType]: { rich_text: richText },
      };

    case 'bulletListItem':
      return {
        id: block.id,
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: richText },
      };

    case 'numberedListItem':
      return {
        id: block.id,
        type: 'numbered_list_item',
        numbered_list_item: { rich_text: richText },
      };

    case 'checkListItem':
      return {
        id: block.id,
        type: 'to_do',
        to_do: {
          rich_text: richText,
          checked: block.props?.checked || false,
        },
      };

    case 'codeBlock':
      return {
        id: block.id,
        type: 'code',
        code: {
          rich_text: richText,
          language: block.props?.language || 'plain text',
        },
      };

    case 'image':
      return {
        id: block.id,
        type: 'image',
        image: {
          type: 'external',
          external: { url: block.props?.url || '' },
        },
      };

    default:
      if (richText.length > 0) {
        return {
          id: block.id,
          type: 'paragraph',
          paragraph: { rich_text: richText },
        };
      }
      return null;
  }
}

function convertContentToRichText(
  content: BlockNoteTextContent[]
): NotionRichText[] {
  if (!content || content.length === 0) return [];

  return content
    .filter((item) => item.type === 'text' && item.text)
    .map((item) => ({
      type: 'text',
      text: { content: item.text },
      annotations: {
        bold: item.styles?.bold || false,
        italic: item.styles?.italic || false,
        underline: item.styles?.underline || false,
        strikethrough: item.styles?.strike || false,
        code: item.styles?.code || false,
        color: 'default',
      },
      plain_text: item.text,
    }));
}

export default function NotionPageEditor({
  initialBlocks,
  onChange,
  readOnly = false,
}: NotionPageEditorProps) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 转换初始内容
  const initialContent = useMemo(
    () => notionToBlockNote(initialBlocks),
    [initialBlocks]
  );

  // 创建编辑器实例
  const editor = useCreateBlockNote({
    initialContent,
  });

  // 防抖保存
  const debouncedSave = useCallback(
    (blocks: unknown[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        const notionBlocks = blockNoteToNotion(blocks as BlockNoteBlock[]);
        onChange?.(notionBlocks);
      }, 1000);
    },
    [onChange]
  );

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="notion-editor">
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        onChange={() => {
          if (!readOnly) {
            debouncedSave(editor.document);
          }
        }}
        theme="light"
      />
      <style jsx global>{`
        .notion-editor .bn-container {
          font-family:
            -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica,
            'Apple Color Emoji', Arial, sans-serif;
        }

        .notion-editor .bn-editor {
          padding: 0;
        }

        .notion-editor [data-content-editable-leaf] {
          padding: 3px 2px;
        }

        .notion-editor .bn-block-group {
          margin: 0;
        }

        .notion-editor .bn-inline-content {
          font-size: 16px;
          line-height: 1.5;
        }

        .notion-editor h1 {
          font-size: 1.875rem;
          font-weight: 600;
          margin-top: 2rem;
          margin-bottom: 1rem;
        }

        .notion-editor h2 {
          font-size: 1.5rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.75rem;
        }

        .notion-editor h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 1rem;
          margin-bottom: 0.5rem;
        }

        .notion-editor code {
          font-family:
            'SFMono-Regular', Menlo, Consolas, 'PT Mono', 'Liberation Mono',
            Courier, monospace;
          font-size: 85%;
          background-color: rgba(135, 131, 120, 0.15);
          padding: 0.2em 0.4em;
          border-radius: 3px;
        }

        .notion-editor pre {
          background-color: rgb(247, 246, 243);
          padding: 1rem;
          border-radius: 6px;
          overflow-x: auto;
        }
      `}</style>
    </div>
  );
}
