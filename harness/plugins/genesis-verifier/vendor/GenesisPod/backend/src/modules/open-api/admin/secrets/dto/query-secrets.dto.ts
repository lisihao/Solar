import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsEnum,
  MaxLength,
  Matches,
} from "class-validator";
import { Type, Transform } from "class-transformer";
import { SecretCategory as PrismaSecretCategory } from "@prisma/client";

const SecretCategory = PrismaSecretCategory ?? {
  AI_MODEL: "AI_MODEL",
  SYSTEM: "SYSTEM",
  INTEGRATION: "INTEGRATION",
  OTHER: "OTHER",
};

export class QuerySecretsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsEnum(SecretCategory)
  category?: PrismaSecretCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: "Search term cannot exceed 200 characters" })
  @Matches(/^[a-zA-Z0-9\s\-_]*$/, {
    message: "Search term contains invalid characters",
  })
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: "Provider filter cannot exceed 100 characters" })
  provider?: string;

  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  isActive?: boolean;
}
