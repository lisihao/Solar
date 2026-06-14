import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class UpsertCustomProviderDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: "slug must be lowercase alphanumeric + dash",
  })
  @MaxLength(50)
  slug!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(500)
  endpoint!: string;

  @IsString()
  @Matches(/^(openai|anthropic|google|cohere)$/, {
    message: "apiFormat must be one of: openai / anthropic / google / cohere",
  })
  apiFormat!: string;

  @IsString()
  @MaxLength(100)
  testModel!: string;

  @IsArray()
  @IsString({ each: true })
  capabilities!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  iconUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
