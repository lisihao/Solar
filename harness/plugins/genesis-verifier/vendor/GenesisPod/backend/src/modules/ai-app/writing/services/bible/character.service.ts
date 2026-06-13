import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import {
  CreateCharacterDto,
  UpdateCharacterDto,
} from "../../dto/character.dto";

@Injectable()
export class CharacterService {
  private readonly logger = new Logger(CharacterService.name);

  constructor(private readonly prisma: PrismaService) {
    void this.logger;
  }

  async create(projectId: string, userId: string, dto: CreateCharacterDto) {
    const bible = await this.getBibleByProject(projectId, userId);

    return this.prisma.writingCharacter.create({
      data: {
        bibleId: bible.id,
        name: dto.name,
        aliases: dto.aliases || [],
        role: dto.role || "SUPPORTING",
        appearance: dto.appearance || {},
        personality: dto.personality || {},
        background: dto.background,
        abilities: dto.abilities || [],
        currentState: dto.currentState || {},
      },
    });
  }

  async findAll(projectId: string, userId: string) {
    const bible = await this.getBibleByProject(projectId, userId);

    return this.prisma.writingCharacter.findMany({
      where: { bibleId: bible.id },
      orderBy: { createdAt: "asc" },
    });
  }

  async findOne(id: string, projectId: string, userId: string) {
    const bible = await this.getBibleByProject(projectId, userId);

    const character = await this.prisma.writingCharacter.findFirst({
      where: { id, bibleId: bible.id },
      include: {
        relationships: {
          include: {
            targetCharacter: {
              select: { id: true, name: true },
            },
          },
        },
        appearances: {
          include: {
            scene: {
              select: { id: true, sceneNumber: true, chapterId: true },
            },
          },
        },
      },
    });

    if (!character) {
      throw new NotFoundException("Character not found");
    }

    return character;
  }

  async update(
    id: string,
    projectId: string,
    userId: string,
    dto: UpdateCharacterDto,
  ) {
    const bible = await this.getBibleByProject(projectId, userId);

    const character = await this.prisma.writingCharacter.findFirst({
      where: { id, bibleId: bible.id },
    });

    if (!character) {
      throw new NotFoundException("Character not found");
    }

    // If currentState is being updated, add to stateTimeline
    const updateData: Record<string, unknown> = {
      ...(dto as Record<string, unknown>),
    };
    if (dto.currentState) {
      updateData.stateTimeline = {
        push: {
          state: dto.currentState,
          timestamp: new Date().toISOString(),
        },
      };
    }

    return this.prisma.writingCharacter.update({
      where: { id },
      data: updateData,
    });
  }

  async delete(id: string, projectId: string, userId: string) {
    const bible = await this.getBibleByProject(projectId, userId);

    const character = await this.prisma.writingCharacter.findFirst({
      where: { id, bibleId: bible.id },
    });

    if (!character) {
      throw new NotFoundException("Character not found");
    }

    return this.prisma.writingCharacter.delete({
      where: { id },
    });
  }

  /**
   * 获取角色关系图谱数据
   * 返回所有角色及其关系，用于可视化
   */
  async getRelationshipGraph(projectId: string, userId: string) {
    const bible = await this.getBibleByProject(projectId, userId);

    // 获取所有角色及其关系
    const characters = await this.prisma.writingCharacter.findMany({
      where: { bibleId: bible.id },
      select: {
        id: true,
        name: true,
        role: true,
        aliases: true,
        personality: true,
        background: true, // ★ 添加 background 字段用于提取关系
        relationships: {
          select: {
            id: true,
            targetCharacterId: true,
            relationshipType: true,
            description: true,
            targetCharacter: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // ★ 去重：合并相似名称的角色（处理 "王昭儿"、"王美人"、"王昭儿（王美人）" 等情况）
    const seenNames = new Map<
      string,
      { id: string; name: string; role: string; aliases: string[] }
    >();
    const deduplicatedCharacters = characters.filter((char) => {
      // 解析 "王昭儿（王美人）" 格式
      const aliasMatch = char.name.match(/^(.+?)（(.+?)）$/);
      const namesToCheck = [char.name.toLowerCase()];
      if (aliasMatch) {
        namesToCheck.push(aliasMatch[1].toLowerCase());
        namesToCheck.push(aliasMatch[2].toLowerCase());
      }
      // 也检查别名
      for (const alias of char.aliases || []) {
        namesToCheck.push(alias.toLowerCase());
      }

      // 检查是否已有相似名称的角色
      for (const [key, existing] of seenNames) {
        if (namesToCheck.includes(key)) {
          // 已存在，跳过此角色（合并到已存在的角色）
          this.logger.debug(
            `Deduplicating character: ${char.name} (duplicate of ${existing.name})`,
          );
          return false;
        }
        // 检查现有角色的名字是否在当前角色的名字列表中
        if (namesToCheck.some((n) => existing.name.toLowerCase().includes(n))) {
          return false;
        }
      }

      // 记录此角色的所有名字变体
      for (const name of namesToCheck) {
        seenNames.set(name, {
          id: char.id,
          name: char.name,
          role: char.role,
          aliases: char.aliases,
        });
      }
      return true;
    });

    // 构建节点和边
    const nodes = deduplicatedCharacters.map((char) => ({
      id: char.id,
      name: char.name,
      role: char.role,
      aliases: char.aliases,
      // 从 personality 中提取 traits
      traits:
        typeof char.personality === "object" && char.personality
          ? ((char.personality as Record<string, unknown> | null)?.[
              "traits"
            ] as unknown[]) || []
          : [],
    }));

    const edges: Array<{
      id: string;
      source: string;
      target: string;
      type: string;
      label: string;
      description?: string;
    }> = [];

    // 只包含去重后角色的关系，并且目标也在去重后的列表中
    const validNodeIds = new Set(deduplicatedCharacters.map((c) => c.id));
    // 创建角色名到ID的映射，用于从 personality.relationships 中查找
    const nameToId = new Map<string, string>();
    for (const char of deduplicatedCharacters) {
      nameToId.set(char.name.toLowerCase(), char.id);
      // 也添加解析后的名字
      const aliasMatch = char.name.match(/^(.+?)（(.+?)）$/);
      if (aliasMatch) {
        nameToId.set(aliasMatch[1].toLowerCase(), char.id);
        nameToId.set(aliasMatch[2].toLowerCase(), char.id);
      }
      for (const alias of char.aliases || []) {
        nameToId.set(alias.toLowerCase(), char.id);
      }
      // ★ 增强：添加名字的各种变体（去掉常见后缀/前缀）
      const nameParts = char.name
        .replace(/（.+?）/g, "") // 移除括号内容
        .replace(/[【】\[\]]/g, "") // 移除方括号
        .trim();
      if (nameParts && nameParts !== char.name.toLowerCase()) {
        nameToId.set(nameParts.toLowerCase(), char.id);
      }
    }

    // ★ 模糊名称查找函数 - 尝试多种方式匹配角色名
    const findCharacterIdByName = (targetName: string): string | undefined => {
      const normalizedTarget = targetName.toLowerCase().trim();

      // 1. 精确匹配
      if (nameToId.has(normalizedTarget)) {
        return nameToId.get(normalizedTarget);
      }

      // 2. 去除常见称谓后匹配（如 "沈姑娘" -> "沈苑"）
      const withoutTitle = normalizedTarget
        .replace(
          /(?:姑娘|小姐|公子|先生|夫人|大人|太太|姐姐|妹妹|哥哥|弟弟)$/g,
          "",
        )
        .trim();
      if (withoutTitle && nameToId.has(withoutTitle)) {
        return nameToId.get(withoutTitle);
      }

      // 3. 部分匹配（名字是否包含在已知角色名中，或已知角色名是否包含这个名字）
      for (const [knownName, id] of nameToId) {
        // 跳过太短的名字避免误匹配
        if (normalizedTarget.length < 2 || knownName.length < 2) continue;

        // 一个包含另一个
        if (
          knownName.includes(normalizedTarget) ||
          normalizedTarget.includes(knownName)
        ) {
          return id;
        }

        // 姓氏匹配（如果名字至少2个字，且姓相同）
        if (normalizedTarget.length >= 2 && knownName.length >= 2) {
          if (
            normalizedTarget[0] === knownName[0] &&
            (normalizedTarget.slice(1) ===
              knownName.slice(1, normalizedTarget.length) ||
              knownName.slice(1) ===
                normalizedTarget.slice(1, knownName.length))
          ) {
            return id;
          }
        }
      }

      return undefined;
    };

    // 已添加的边的集合，用于去重
    const addedEdges = new Set<string>();

    this.logger.debug(
      `Building relationship graph: ${deduplicatedCharacters.length} characters, nameToId map size: ${nameToId.size}`,
    );

    for (const char of deduplicatedCharacters) {
      // 1. 从数据库关系表添加边
      this.logger.debug(
        `Character ${char.name}: ${char.relationships.length} db relationships`,
      );
      for (const rel of char.relationships) {
        // 只添加目标角色也在有效列表中的边
        if (validNodeIds.has(rel.targetCharacterId)) {
          const edgeKey = `${char.id}-${rel.targetCharacterId}`;
          if (!addedEdges.has(edgeKey)) {
            edges.push({
              id: rel.id,
              source: char.id,
              target: rel.targetCharacterId,
              type: rel.relationshipType,
              label: rel.relationshipType,
              description: rel.description || undefined,
            });
            addedEdges.add(edgeKey);
            this.logger.debug(
              `Added db relationship: ${char.name} -> ${rel.targetCharacter?.name} (${rel.relationshipType})`,
            );
          }
        }
      }

      // 2. ★ 从 personality.relationships 中提取关系（用于未显式添加关系的角色）
      const personality = char.personality as Record<string, unknown> | null;
      this.logger.debug(
        `Character ${char.name} personality.relationships: ${JSON.stringify(personality?.relationships || "none")}`,
      );
      if (personality?.relationships) {
        const relationshipsData = personality.relationships;
        // relationships 可能有三种格式:
        // 1. 字符串数组 ["与苏清婉为主仆关系"]
        // 2. 对象格式 { "苏清婉": "主仆关系" }
        // 3. 对象数组 [{ target: "苏清婉", relation: "主仆关系" }]
        if (Array.isArray(relationshipsData)) {
          this.logger.debug(
            `Processing array format relationships: ${relationshipsData.length} items`,
          );
          for (const relItem of relationshipsData) {
            // ★ 格式3: 对象数组 [{ target: "角色名", relation: "关系类型" }]
            if (
              typeof relItem === "object" &&
              relItem !== null &&
              "target" in relItem
            ) {
              const targetName = String(relItem.target);
              const relationType = String(relItem.relation || "关联");
              const targetId = findCharacterIdByName(targetName);
              this.logger.debug(
                `Object array format: looking for "${targetName}" -> ${targetId ? "found" : "not found"}`,
              );
              if (targetId && targetId !== char.id) {
                const edgeKey = `${char.id}-${targetId}`;
                const reverseKey = `${targetId}-${char.id}`;
                if (!addedEdges.has(edgeKey) && !addedEdges.has(reverseKey)) {
                  edges.push({
                    id: `auto-${char.id}-${targetId}`,
                    source: char.id,
                    target: targetId,
                    type: relationType,
                    label:
                      relationType.length > 6
                        ? relationType.slice(0, 6)
                        : relationType,
                  });
                  addedEdges.add(edgeKey);
                  this.logger.debug(
                    `Added object-array relationship: ${char.name} -> ${targetName} (${relationType})`,
                  );
                }
              }
            } else {
              // 格式1: 字符串数组
              this.parseAndAddRelationshipWithFinder(
                String(relItem),
                char.id,
                findCharacterIdByName,
                edges,
                addedEdges,
              );
            }
          }
        } else if (typeof relationshipsData === "object") {
          // 格式2: 对象格式 { "苏清婉": "主仆关系" }
          this.logger.debug(
            `Processing object format relationships: ${Object.keys(relationshipsData).length} items`,
          );
          for (const [targetName, relationType] of Object.entries(
            relationshipsData,
          )) {
            const targetId = findCharacterIdByName(targetName);
            this.logger.debug(
              `Looking for "${targetName}" in nameToId: ${targetId ? "found" : "not found"}`,
            );
            if (targetId && targetId !== char.id) {
              const edgeKey = `${char.id}-${targetId}`;
              const reverseKey = `${targetId}-${char.id}`;
              if (!addedEdges.has(edgeKey) && !addedEdges.has(reverseKey)) {
                edges.push({
                  id: `auto-${char.id}-${targetId}`,
                  source: char.id,
                  target: targetId,
                  type: String(relationType),
                  label: String(relationType),
                });
                addedEdges.add(edgeKey);
                this.logger.debug(
                  `Added personality relationship: ${char.name} -> ${targetName} (${relationType})`,
                );
              }
            }
          }
        }
      }

      // 3. ★ 从 background 字段提取关系（如 "与掌事姑姑是监管关系"）
      const background = char.background as string;
      if (background) {
        this.logger.debug(
          `Character ${char.name} background: ${background.substring(0, 100)}...`,
        );
        // 尝试匹配多种关系描述格式
        const relationPatterns = [
          /(?:与|和)([^，。,\.]+?)(?:是|为|有)([^，。,\.]*?关系)/g,
          /([^，。,\.]+?)(?:是|为)[她他]的([^，。,\.]+)/g,
        ];
        for (const pattern of relationPatterns) {
          let match;
          while ((match = pattern.exec(background)) !== null) {
            this.logger.debug(
              `Found background relationship match: ${match[0]}`,
            );
            this.parseAndAddRelationshipWithFinder(
              match[0],
              char.id,
              findCharacterIdByName,
              edges,
              addedEdges,
            );
          }
        }
      }
    }

    // 4. ★ 从 WorldSetting 章节记录中提取关系（格式: [关系] 沈苑 → 掌事姑姑: 描述）
    const chapterSettings = await this.prisma.worldSetting.findMany({
      where: {
        bibleId: bible.id,
        category: { startsWith: "第" }, // 章节设定
      },
      select: {
        category: true,
        description: true,
      },
    });

    this.logger.debug(
      `Found ${chapterSettings.length} chapter settings to parse for relationships`,
    );

    for (const setting of chapterSettings) {
      if (!setting.description) continue;

      // 匹配 [关系] 标签后的内容，支持 "A → B: 描述" 格式
      const relationRegex = /\[关系\]\s*([^\[]+)/g;
      let match;
      while ((match = relationRegex.exec(setting.description)) !== null) {
        const relationText = match[1].trim();
        this.logger.debug(
          `[${setting.category}] Found relation tag: ${relationText}`,
        );

        // 解析 "沈苑 → 掌事姑姑: 描述" 或 "沈苑 → 掌事姑姑：描述" 格式
        const arrowMatch = relationText.match(
          /^(.+?)\s*(?:→|➡|->)+\s*(.+?)\s*[:：]\s*(.+)$/,
        );
        if (arrowMatch) {
          const sourceName = arrowMatch[1].trim();
          const targetName = arrowMatch[2].trim();
          const relationDesc = arrowMatch[3].trim();

          const sourceId = findCharacterIdByName(sourceName);
          const targetId = findCharacterIdByName(targetName);

          this.logger.debug(
            `Parsed: "${sourceName}" (${sourceId ? "found" : "not found"}) → "${targetName}" (${targetId ? "found" : "not found"})`,
          );

          if (sourceId && targetId && sourceId !== targetId) {
            const edgeKey = `${sourceId}-${targetId}`;
            const reverseKey = `${targetId}-${sourceId}`;
            if (!addedEdges.has(edgeKey) && !addedEdges.has(reverseKey)) {
              // 从描述中提取简短的关系类型
              let relationType = relationDesc;
              // 尝试提取关系类型关键词
              const typeMatch = relationDesc.match(
                /(监管|主仆|师徒|父子|母女|兄弟|姐妹|朋友|仇敌|恋人|夫妻|同门|同袍|同事|上下级)/,
              );
              if (typeMatch) {
                relationType = typeMatch[1];
              } else if (relationDesc.length > 6) {
                relationType = relationDesc.slice(0, 6);
              }

              edges.push({
                id: `chapter-${setting.category}-${sourceId}-${targetId}`,
                source: sourceId,
                target: targetId,
                type: relationType,
                label: relationType,
                description: relationDesc,
              });
              addedEdges.add(edgeKey);
              this.logger.debug(
                `Added chapter relationship: ${sourceName} → ${targetName} (${relationType})`,
              );
            }
          }
        }
      }
    }

    this.logger.log(
      `Relationship graph built: ${nodes.length} nodes, ${edges.length} edges`,
    );
    return { nodes, edges };
  }

  /**
   * 添加角色关系
   */
  async addRelationship(
    characterId: string,
    projectId: string,
    userId: string,
    dto: {
      targetCharacterId: string;
      relationshipType: string;
      description?: string;
    },
  ) {
    const bible = await this.getBibleByProject(projectId, userId);

    // 验证源角色
    const character = await this.prisma.writingCharacter.findFirst({
      where: { id: characterId, bibleId: bible.id },
    });
    if (!character) {
      throw new NotFoundException("Character not found");
    }

    // 验证目标角色
    const targetCharacter = await this.prisma.writingCharacter.findFirst({
      where: { id: dto.targetCharacterId, bibleId: bible.id },
    });
    if (!targetCharacter) {
      throw new NotFoundException("Target character not found");
    }

    // 创建关系
    return this.prisma.characterRelationship.create({
      data: {
        characterId,
        targetCharacterId: dto.targetCharacterId,
        relationshipType: dto.relationshipType,
        description: dto.description,
      },
      include: {
        targetCharacter: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * 删除角色关系
   */
  async deleteRelationship(
    relationshipId: string,
    projectId: string,
    userId: string,
  ) {
    const bible = await this.getBibleByProject(projectId, userId);

    const relationship = await this.prisma.characterRelationship.findFirst({
      where: { id: relationshipId },
      include: {
        character: {
          select: { bibleId: true },
        },
      },
    });

    if (!relationship || relationship.character.bibleId !== bible.id) {
      throw new NotFoundException("Relationship not found");
    }

    return this.prisma.characterRelationship.delete({
      where: { id: relationshipId },
    });
  }

  /**
   * 解析关系字符串并添加到边列表
   * @param findCharacterId - 角色名称查找函数（支持模糊匹配）
   */
  private parseAndAddRelationshipWithFinder(
    relStr: string,
    sourceId: string,
    findCharacterId: (name: string) => string | undefined,
    edges: Array<{
      id: string;
      source: string;
      target: string;
      type: string;
      label: string;
      description?: string;
    }>,
    addedEdges: Set<string>,
  ): void {
    // 多种关系格式解析
    const patterns = [
      // "与苏清婉为主仆关系" 或 "和苏清婉是朋友关系"
      /(?:与|和)(.+?)(?:为|是|：|:)(.+?)(?:关系)?$/,
      // "苏清婉: 主仆关系" 或 "苏清婉：朋友"
      /^(.+?)(?:：|:)\s*(.+?)(?:关系)?$/,
      // "A → B: 描述" 格式
      /^(.+?)\s*(?:→|->)\s*(.+?)(?::|：)\s*(.+)$/,
      // "A 和 B 是 XX 关系"
      /^(.+?)\s*(?:和|与)\s*(.+?)\s*(?:是|为)\s*(.+?)(?:关系)?$/,
    ];

    for (const pattern of patterns) {
      const match = relStr.match(pattern);
      if (match) {
        let targetName: string;
        let relationType: string;

        if (match.length === 4) {
          // 三组匹配：source, target, type
          targetName = match[2].trim();
          relationType = match[3].trim();
        } else {
          // 两组匹配：target, type
          targetName = match[1].trim();
          relationType = match[2].trim();
        }

        // 使用模糊匹配查找目标角色ID
        const targetId = findCharacterId(targetName);

        if (targetId && targetId !== sourceId) {
          const edgeKey = `${sourceId}-${targetId}`;
          const reverseKey = `${targetId}-${sourceId}`;
          if (!addedEdges.has(edgeKey) && !addedEdges.has(reverseKey)) {
            edges.push({
              id: `auto-${sourceId}-${targetId}`,
              source: sourceId,
              target: targetId,
              type: relationType,
              label:
                relationType.length > 6
                  ? relationType.slice(0, 6)
                  : relationType,
              description: relStr,
            });
            addedEdges.add(edgeKey);
            this.logger.debug(
              `Extracted relationship: ${sourceId} -> ${targetId} (${relationType}) from "${relStr}"`,
            );
          }
        } else {
          this.logger.debug(
            `Could not find target character "${targetName}" for relationship: ${relStr}`,
          );
        }
        break; // 只使用第一个匹配的模式
      }
    }
  }

  private async getBibleByProject(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
      include: { storyBible: true },
    });

    if (!project) {
      throw new ForbiddenException("Project not found or access denied");
    }

    if (!project.storyBible) {
      throw new NotFoundException("Story Bible not found");
    }

    return project.storyBible;
  }
}
