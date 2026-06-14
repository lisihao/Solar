#!/usr/bin/env node

/**
 * 批量替换 console 调用为 logger
 * Usage: node scripts/replace-console.mjs <file1> <file2> ...
 */

import fs from 'fs';
import path from 'path';

const LOGGER_IMPORT = "import { logger } from '@/lib/utils/logger';";

function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf-8');
    let modified = false;

    // 检查是否已经导入 logger
    const hasLoggerImport = content.includes("from '@/lib/utils/logger'") ||
                           content.includes('from "@/lib/utils/logger"');

    // 检查是否有 console 调用
    const hasConsole = /console\.(log|error|warn|info|debug)\(/.test(content);

    if (!hasConsole) {
      console.log(`✓ Skipped (no console): ${filePath}`);
      return;
    }

    // 如果没有导入 logger，添加导入
    if (!hasLoggerImport) {
      // 找到最后一个 import 语句的位置
      const importRegex = /^import\s+.*?;?\s*$/gm;
      const imports = content.match(importRegex);

      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1];
        const lastImportIndex = content.lastIndexOf(lastImport);
        const insertPosition = lastImportIndex + lastImport.length;

        content = content.slice(0, insertPosition) +
                 '\n' + LOGGER_IMPORT +
                 content.slice(insertPosition);
        modified = true;
      }
    }

    // 替换 console 调用
    const replacements = [
      { from: /console\.log\(/g, to: 'logger.debug(' },
      { from: /console\.error\(/g, to: 'logger.error(' },
      { from: /console\.warn\(/g, to: 'logger.warn(' },
      { from: /console\.info\(/g, to: 'logger.info(' },
      { from: /console\.debug\(/g, to: 'logger.debug(' },
    ];

    let replaceCount = 0;
    replacements.forEach(({ from, to }) => {
      const matches = content.match(from);
      if (matches) {
        replaceCount += matches.length;
        content = content.replace(from, to);
        modified = true;
      }
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`✓ Replaced ${replaceCount} console calls: ${filePath}`);
    } else {
      console.log(`✓ No changes needed: ${filePath}`);
    }

  } catch (error) {
    console.error(`✗ Error processing ${filePath}:`, error.message);
  }
}

// 处理命令行参数
const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('Usage: node replace-console.mjs <file1> <file2> ...');
  process.exit(1);
}

console.log(`Processing ${files.length} files...`);
files.forEach(processFile);
console.log('Done!');
