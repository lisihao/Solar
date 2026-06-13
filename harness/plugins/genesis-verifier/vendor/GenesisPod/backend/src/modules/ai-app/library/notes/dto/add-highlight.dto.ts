import { IsString, IsNumber, IsOptional } from "class-validator";

/**
 * 添加高亮DTO
 */
export class AddHighlightDto {
  @IsString()
  text!: string;

  @IsNumber()
  startOffset!: number;

  @IsNumber()
  endOffset!: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
