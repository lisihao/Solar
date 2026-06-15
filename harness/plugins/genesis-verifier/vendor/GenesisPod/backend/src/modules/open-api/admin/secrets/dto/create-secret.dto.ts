import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  MaxLength,
  MinLength,
  Matches,
  IsDateString,
} from "class-validator";
import { SecretCategory as PrismaSecretCategory } from "@prisma/client";

const SecretCategory = PrismaSecretCategory ?? {
  AI_MODEL: "AI_MODEL",
  SYSTEM: "SYSTEM",
  INTEGRATION: "INTEGRATION",
  OTHER: "OTHER",
};

export class CreateSecretDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  @Matches(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, {
    message: "name must be lowercase alphanumeric with hyphens only",
  })
  name!: string;

  @IsString()
  @MaxLength(200)
  displayName!: string;

  @IsString()
  @MinLength(1, { message: "Secret value cannot be empty" })
  @MaxLength(100000, {
    message: "Secret value cannot exceed 100,000 characters",
  })
  value!: string;

  @IsOptional()
  @IsEnum(SecretCategory)
  category?: PrismaSecretCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: "Description cannot exceed 2,000 characters" })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
