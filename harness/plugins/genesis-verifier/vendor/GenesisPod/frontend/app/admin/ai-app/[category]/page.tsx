import { notFound } from 'next/navigation';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  AI_APP_CATEGORIES,
  type AiAppCategoryId,
  type AiAppCategoryModule,
} from '@/lib/features/admin/ai-app-categories';
import AiAppCategoryView from '@/components/admin/ai-app/AiAppCategoryView';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: readonly AiAppCategoryId[] = [
  'insights',
  'planning',
  'content',
  'labs',
];

/**
 * docs 来源优先级：
 *  1. `frontend/lib/generated/ai-app-docs/` (build-time bundled, 由
 *     scripts/sync-architecture-docs.js 在 `next build` 前同步进来)
 *  2. `<repo>/docs/architecture/ai-app/` (本地 dev 跳过 sync 时的兜底)
 *
 * Docker 镜像里只有 frontend/ 在 build context，所以 (1) 是生产路径；
 * 都读不到就回退到占位文案。
 */
const BUNDLED_REL_PATH = ['lib', 'generated', 'ai-app-docs'];
const REPO_ROOT_RELATIVE_DOCS_DIR = ['docs', 'architecture', 'ai-app'];

async function findDocsRoot(): Promise<string | null> {
  const candidates = [
    path.resolve(process.cwd(), ...BUNDLED_REL_PATH),
    path.resolve(process.cwd(), '..', ...REPO_ROOT_RELATIVE_DOCS_DIR),
    path.resolve(process.cwd(), ...REPO_ROOT_RELATIVE_DOCS_DIR),
  ];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  return null;
}

async function readFirstAvailable(
  docsRoot: string,
  candidates: string[]
): Promise<{ relPath: string; content: string } | null> {
  for (const rel of candidates) {
    const abs = path.join(docsRoot, rel);
    try {
      const content = await fs.readFile(abs, 'utf-8');
      return { relPath: rel, content };
    } catch {
      // try next
    }
  }
  return null;
}

export interface ResolvedModuleDoc extends AiAppCategoryModule {
  /** Doc 是否成功加载 */
  loaded: boolean;
  /** 命中的文档相对路径（docs/architecture/ai-app/ 下） */
  resolvedDocPath: string | null;
  /** Markdown 内容；未命中时给占位 */
  content: string;
}

export default async function AiAppCategoryPage({
  params,
}: {
  params: { category: string };
}) {
  if (!(VALID_CATEGORIES as readonly string[]).includes(params.category)) {
    notFound();
  }
  const category = AI_APP_CATEGORIES[params.category as AiAppCategoryId];
  const docsRoot = await findDocsRoot();

  const resolvedModules: ResolvedModuleDoc[] = await Promise.all(
    category.modules.map(async (mod) => {
      if (!docsRoot) {
        return {
          ...mod,
          loaded: false,
          resolvedDocPath: null,
          content: missingDocsPlaceholder(mod),
        };
      }
      const hit = await readFirstAvailable(docsRoot, mod.docCandidates);
      if (!hit) {
        return {
          ...mod,
          loaded: false,
          resolvedDocPath: null,
          content: missingDocsPlaceholder(mod),
        };
      }
      return {
        ...mod,
        loaded: true,
        resolvedDocPath: hit.relPath,
        content: hit.content,
      };
    })
  );

  return (
    <AiAppCategoryView
      categoryId={category.id}
      titleKey={category.titleKey}
      descriptionKey={category.descriptionKey}
      overviewDiagram={category.overviewDiagram}
      modules={resolvedModules}
    />
  );
}

function missingDocsPlaceholder(mod: AiAppCategoryModule): string {
  return [
    `# ${mod.label}`,
    '',
    `> ${mod.blurb}`,
    '',
    '架构文档即将上线。',
  ].join('\n');
}
