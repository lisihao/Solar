/**
 * RAG Module DTOs
 */

import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  IsUrl,
  IsUUID,
  IsIn,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { KnowledgeBaseSourceType } from "@prisma/client";

// Knowledge base type enum
export type KnowledgeBaseType = "PERSONAL" | "TEAM";

// ==================== Knowledge Base DTOs ====================

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: "Name of the knowledge base" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: "Description of the knowledge base" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: KnowledgeBaseSourceType,
    description: "Primary source type (for backward compatibility)",
  })
  @IsEnum(KnowledgeBaseSourceType)
  sourceType!: KnowledgeBaseSourceType;

  @ApiPropertyOptional({
    description: "Multiple source types supported by this knowledge base",
    type: [String],
    enum: KnowledgeBaseSourceType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];

  @ApiPropertyOptional({
    description: "Google Drive connection ID (for GOOGLE_DRIVE source)",
  })
  @IsOptional()
  @IsUUID()
  googleDriveConnectionId?: string;

  @ApiPropertyOptional({
    description: "Google Drive folder IDs to sync",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  googleDriveFolderIds?: string[];

  @ApiPropertyOptional({
    description: "Google Drive file IDs to sync (individual files)",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  googleDriveFileIds?: string[];

  @ApiPropertyOptional({
    description: "Knowledge base type (PERSONAL or TEAM)",
    enum: ["PERSONAL", "TEAM"],
    default: "PERSONAL",
  })
  @IsOptional()
  @IsIn(["PERSONAL", "TEAM"])
  type?: KnowledgeBaseType;

  @ApiPropertyOptional({
    description: "Team ID (required for TEAM type)",
  })
  @IsOptional()
  @IsUUID()
  teamId?: string;
}

export class UpdateKnowledgeBaseDto {
  @ApiPropertyOptional({ description: "Name of the knowledge base" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Description of the knowledge base" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Multiple source types supported by this knowledge base",
    type: [String],
    enum: KnowledgeBaseSourceType,
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceTypes?: string[];

  @ApiPropertyOptional({
    description: "Google Drive folder IDs to sync",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  googleDriveFolderIds?: string[];

  @ApiPropertyOptional({
    description: "Google Drive file IDs to sync (individual files)",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  googleDriveFileIds?: string[];
}

// ==================== Document DTOs ====================

export class AddDocumentDto {
  @ApiProperty({ description: "Title of the document" })
  @IsString()
  title!: string;

  @ApiProperty({ description: "Raw content of the document" })
  @IsString()
  content!: string;

  @ApiPropertyOptional({ description: 'Source type (e.g., "manual", "url")' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ description: "Source URL" })
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  @ApiPropertyOptional({ description: "MIME type of the document" })
  @IsOptional()
  @IsString()
  mimeType?: string;
}

// ==================== Query DTOs ====================

export class RAGQueryDto {
  @ApiProperty({ description: "The query to search for" })
  @IsString()
  query!: string;

  @ApiProperty({
    description: "Knowledge base IDs to search in",
    type: [String],
  })
  @IsArray()
  @IsUUID("4", { each: true })
  knowledgeBaseIds!: string[];

  @ApiPropertyOptional({
    description: "Number of results to retrieve",
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  topK?: number;

  @ApiPropertyOptional({
    description: "Use HyDE query enhancement",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  useHyde?: boolean;

  @ApiPropertyOptional({
    description: "Use Cohere reranking",
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  useRerank?: boolean;

  @ApiPropertyOptional({
    description: "Balance between vector (1) and keyword (0) search",
    default: 0.5,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridAlpha?: number;

  @ApiPropertyOptional({
    description: "Minimum relevance score threshold",
    default: 0.3,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore?: number;
}

export class SimpleQueryDto {
  @ApiProperty({ description: "The query to search for" })
  @IsString()
  query!: string;

  @ApiProperty({
    description: "Knowledge base IDs to search in",
    type: [String],
  })
  @IsArray()
  @IsUUID("4", { each: true })
  knowledgeBaseIds!: string[];

  @ApiPropertyOptional({
    description: "Number of results to retrieve",
    default: 5,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50)
  topK?: number;
}

// ==================== Batch Add Resources DTOs ====================

export class ExternalResourceDto {
  @ApiProperty({
    description:
      "External source ID (Google Drive file ID, Notion page ID, etc.)",
  })
  @IsString()
  sourceId!: string;

  @ApiProperty({ description: "Title/name of the resource" })
  @IsString()
  title!: string;

  @ApiProperty({
    description:
      "Type of external source (google_drive, notion, url, bookmark, note)",
  })
  @IsString()
  sourceType!: string;

  @ApiPropertyOptional({ description: "MIME type of the resource" })
  @IsOptional()
  @IsString()
  mimeType?: string;

  @ApiPropertyOptional({ description: "Source URL of the resource" })
  @IsOptional()
  @IsString()
  sourceUrl?: string;
}

export class AddResourcesDto {
  @ApiProperty({
    description: "List of external resources to add",
    type: [ExternalResourceDto],
  })
  @IsArray()
  resources!: ExternalResourceDto[];
}

// ==================== URL Import DTOs ====================

export class FetchUrlDto {
  @ApiProperty({ description: "The URL to fetch and preview" })
  @IsUrl()
  url!: string;
}

export class ImportUrlsDto {
  @ApiProperty({
    description: "List of URLs to import",
    type: [String],
  })
  @IsArray()
  @IsUrl({}, { each: true })
  urls!: string[];
}

// ==================== Bookmark Import DTOs ====================

export class ImportBookmarksDto {
  @ApiProperty({
    description: "List of bookmark resource IDs to import",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  bookmarkIds!: string[];
}

// ==================== Note Import DTOs ====================

export class ImportNotesDto {
  @ApiProperty({
    description: "List of note IDs to import",
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  noteIds!: string[];

  @ApiPropertyOptional({
    description: "Whether to auto-sync when notes are updated",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;
}

// ==================== OCR Import DTOs ====================

export class OcrResultDto {
  @ApiProperty({ description: "URL of the uploaded image" })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ description: "Title for the document" })
  @IsString()
  title!: string;

  @ApiProperty({ description: "OCR extracted content (may be user-edited)" })
  @IsString()
  content!: string;
}

export class ImportOcrDto {
  @ApiProperty({
    description: "List of OCR results to import",
    type: [OcrResultDto],
  })
  @IsArray()
  documents!: OcrResultDto[];
}
