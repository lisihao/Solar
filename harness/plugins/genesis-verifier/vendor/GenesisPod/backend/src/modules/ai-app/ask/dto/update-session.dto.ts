import { IsOptional, IsString, MaxLength, IsBoolean } from "class-validator";

export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  modelId?: string;

  @IsOptional()
  @IsBoolean()
  isBookmarked?: boolean;
}
