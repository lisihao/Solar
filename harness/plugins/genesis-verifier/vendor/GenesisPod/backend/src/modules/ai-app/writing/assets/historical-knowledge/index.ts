/**
 * 中国历史知识库 - 索引文件
 *
 * 从 JSON 文件加载历史知识数据
 * 覆盖中国3000年历史，包括：
 * - 12个主要朝代的详细知识
 * - 约600个年号
 * - 约2000个重大事件
 * - 约3000个历史人物
 */

import * as fs from "fs";
import * as path from "path";
import { Logger } from "@nestjs/common";
import {
  DynastyKnowledge,
  EraName,
  HistoricalEvent,
  HistoricalFigure,
  Anachronism,
  KnowledgeIndex,
} from "./types";

const logger = new Logger("HistoricalKnowledge");

// 知识库根目录
const KNOWLEDGE_BASE_PATH = __dirname;

/**
 * 加载 JSON 文件
 */
function loadJsonFile<T>(filename: string): T | null {
  const filePath = path.join(KNOWLEDGE_BASE_PATH, filename);
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as T;
    }
  } catch (error) {
    logger.error(
      `Failed to load ${filename}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return null;
}

/**
 * 加载朝代知识
 */
function loadDynastyKnowledge(dynasty: string): DynastyKnowledge | null {
  const dynastyFileMap: Record<string, string> = {
    秦朝: "dynasties/qin.json",
    汉朝: "dynasties/han.json",
    三国: "dynasties/sanguo.json",
    晋朝: "dynasties/jin.json",
    南北朝: "dynasties/nanbeichao.json",
    隋朝: "dynasties/sui.json",
    唐朝: "dynasties/tang.json",
    五代十国: "dynasties/wudai.json",
    宋朝: "dynasties/song.json",
    元朝: "dynasties/yuan.json",
    明朝: "dynasties/ming.json",
    清朝: "dynasties/qing.json",
  };

  const filename = dynastyFileMap[dynasty];
  if (!filename) {
    return null;
  }

  return loadJsonFile<DynastyKnowledge>(filename);
}

/**
 * 加载所有朝代知识
 */
function loadAllDynasties(): Map<string, DynastyKnowledge> {
  const dynasties = new Map<string, DynastyKnowledge>();
  const dynastyNames = [
    "秦朝",
    "汉朝",
    "三国",
    "晋朝",
    "南北朝",
    "隋朝",
    "唐朝",
    "五代十国",
    "宋朝",
    "元朝",
    "明朝",
    "清朝",
  ];

  for (const name of dynastyNames) {
    const knowledge = loadDynastyKnowledge(name);
    if (knowledge) {
      dynasties.set(name, knowledge);
    }
  }

  return dynasties;
}

/**
 * 加载年号表
 */
function loadEraNames(): {
  version: string;
  totalCount: number;
  eraNames: EraName[];
} | null {
  return loadJsonFile("era-names.json");
}

/**
 * 加载历史事件
 */
function loadEvents(): {
  version: string;
  totalCount: number;
  events: HistoricalEvent[];
} | null {
  return loadJsonFile("events.json");
}

/**
 * 加载历史人物（合并多个分类文件）
 */
function loadFigures(): {
  version: string;
  totalCount: number;
  figures: HistoricalFigure[];
} | null {
  // 尝试加载合并文件
  const combined = loadJsonFile<{
    version: string;
    totalCount: number;
    figures: HistoricalFigure[];
  }>("figures.json");
  if (combined) {
    return combined;
  }

  // 否则从分类文件加载并合并
  const allFigures: HistoricalFigure[] = [];
  const figureFiles = [
    "figures-emperors.json",
    "figures-officials.json",
    "figures-scholars.json",
  ];

  for (const filename of figureFiles) {
    const data = loadJsonFile<{ figures: HistoricalFigure[] }>(filename);
    if (data?.figures) {
      allFigures.push(...data.figures);
    }
  }

  if (allFigures.length === 0) {
    return null;
  }

  return {
    version: "1.0",
    totalCount: allFigures.length,
    figures: allFigures,
  };
}

/**
 * 加载跨朝代禁忌
 */
function loadAnachronisms(): {
  version: string;
  totalCount: number;
  anachronisms: Anachronism[];
} | null {
  return loadJsonFile("anachronisms.json");
}

/**
 * 获取知识库统计信息
 */
function getKnowledgeStats(): KnowledgeIndex {
  const dynasties = loadAllDynasties();
  const eraNames = loadEraNames();
  const events = loadEvents();
  const figures = loadFigures();
  const anachronisms = loadAnachronisms();

  let totalEntries = 0;
  for (const [, dynasty] of dynasties) {
    for (const category of Object.values(dynasty.categories)) {
      totalEntries += category.length;
    }
  }

  return {
    version: "1.0",
    lastUpdated: new Date().toISOString(),
    statistics: {
      totalDynasties: dynasties.size,
      totalEntries,
      totalEraNames: eraNames?.totalCount || 0,
      totalEvents: events?.totalCount || 0,
      totalFigures: figures?.totalCount || 0,
      totalAnachronisms: anachronisms?.totalCount || 0,
    },
    dynasties: Array.from(dynasties.keys()),
  };
}

// 导出加载函数
export {
  loadDynastyKnowledge,
  loadAllDynasties,
  loadEraNames,
  loadEvents,
  loadFigures,
  loadAnachronisms,
  getKnowledgeStats,
  KNOWLEDGE_BASE_PATH,
};

// 导出类型
export * from "./types";
