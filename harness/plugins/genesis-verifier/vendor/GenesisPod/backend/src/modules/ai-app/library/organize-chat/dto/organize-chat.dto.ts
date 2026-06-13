import {
  IsString,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { OrganizeScope } from "@prisma/client";

/** 会话历史单条（多轮"继续追加指令"用；v1 拼进 systemPrompt，见 ADR-006 BLK-4）*/
export class OrganizeHistoryMessageDto {
  @IsString()
  @MaxLength(20)
  role!: string; // user | assistant

  @IsString()
  @MaxLength(8000)
  content!: string;
}

export class OrganizeChatDto {
  @IsString()
  @MaxLength(4000)
  message!: string;

  /** 整理范围（粗粒度，作 session 标签）：BOOKMARKS / NOTES / EXTERNAL */
  @IsOptional()
  @IsEnum(OrganizeScope)
  scope?: OrganizeScope;

  /**
   * 精确数据源类型（前端按当前 tab 传）：驱动跨源整理工具流。
   * BOOKMARK/DRIVE 走集合视图；NOTE/IMAGE/FEISHU 走 list-source-items + assign。
   * 不传则按书签处理（向后兼容）。
   */
  @IsOptional()
  @IsString()
  @IsIn(["BOOKMARK", "NOTE", "IMAGE", "FEISHU", "NOTION", "DRIVE"])
  itemType?: string;

  /** 续聊已有会话；不传则新建 */
  @IsOptional()
  @IsString()
  sessionId?: string;

  /** 限定某集合（可选上下文）*/
  @IsOptional()
  @IsString()
  collectionId?: string;

  /** 指定模型；不传走默认 CHAT 模型 */
  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrganizeHistoryMessageDto)
  conversationHistory?: OrganizeHistoryMessageDto[];
}
