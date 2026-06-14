/**
 * MCP External Server Admin DTOs
 */

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  IsIn,
  IsObject,
} from "class-validator";

export class CreateExternalServerDto {
  @ApiProperty({ description: "Unique server identifier", example: "my-tools" })
  @IsString()
  serverId!: string;

  @ApiProperty({ description: "Display name", example: "My Tools Server" })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    description: "Server description",
    example: "External tool server for data processing",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "Transport type",
    enum: ["sse", "http"],
    example: "sse",
  })
  @IsString()
  @IsIn(["sse", "http"])
  transport!: string;

  @ApiProperty({
    description: "Server URL",
    example: "https://mcp.example.com/sse",
  })
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;

  @ApiPropertyOptional({ description: "Enable server", default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: "Auto-connect on startup",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoConnect?: boolean;

  @ApiPropertyOptional({ description: "Additional metadata" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateExternalServerDto {
  @ApiPropertyOptional({ description: "Display name" })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: "Server description" })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "Transport type",
    enum: ["sse", "http"],
  })
  @IsOptional()
  @IsString()
  @IsIn(["sse", "http"])
  transport?: string;

  @ApiPropertyOptional({ description: "Server URL" })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiPropertyOptional({ description: "Enable server" })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: "Auto-connect on startup" })
  @IsOptional()
  @IsBoolean()
  autoConnect?: boolean;

  @ApiPropertyOptional({ description: "Additional metadata" })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
