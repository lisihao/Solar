import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsObject,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { CharacterRole } from "@prisma/client";

export class CreateCharacterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsEnum(CharacterRole)
  role?: CharacterRole;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  appearance?: Record<string, any>;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  personality?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  background?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  abilities?: string[];

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  currentState?: Record<string, any>;
}

export class UpdateCharacterDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsEnum(CharacterRole)
  role?: CharacterRole;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  appearance?: Record<string, any>;

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  personality?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  background?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  abilities?: string[];

  @IsOptional()
  @IsObject()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column; Record<string,unknown> is not assignable to InputJsonValue
  currentState?: Record<string, any>;
}

export class CreateCharacterRelationshipDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  targetCharacterId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  relationshipType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
