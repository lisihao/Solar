import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  MaxLength,
  MinLength,
  IsDateString,
} from "class-validator";
import { SecretCategory as PrismaSecretCategory } from "@prisma/client";

const SecretCategory = PrismaSecretCategory ?? {
  AI_MODEL: "AI_MODEL",
  SYSTEM: "SYSTEM",
  INTEGRATION: "INTEGRATION",
  OTHER: "OTHER",
};

export class UpdateSecretDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: "Description cannot exceed 2,000 characters" })
  description?: string;

  @IsOptional()
  @IsEnum(SecretCategory)
  category?: PrismaSecretCategory;

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

  @IsOptional()
  @IsString()
  @MinLength(1, { message: "Secret value cannot be empty" })
  @MaxLength(100000, {
    message: "Secret value cannot exceed 100,000 characters",
  })
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

export class UpdateSecretValueDto {
  @IsString()
  @MinLength(1, { message: "Secret value cannot be empty" })
  @MaxLength(100000, {
    message: "Secret value cannot exceed 100,000 characters",
  })
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}
