import {
  IsString,
  IsArray,
  IsOptional,
  ArrayMinSize,
  ArrayMaxSize,
  IsUUID,
  ValidateIf,
} from "class-validator";

export class GenerateReportDto {
  @ValidateIf((o) => !o.taskId)
  @IsArray()
  @ArrayMinSize(2, {
    message: "At least 2 resources are required when using resourceIds",
  })
  @ArrayMaxSize(10, { message: "Maximum 10 resources allowed" })
  @IsString({ each: true })
  resourceIds?: string[];

  @IsString()
  @IsOptional()
  templateId?: string;

  @IsString()
  @IsOptional()
  template?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  userId!: string;

  @IsOptional()
  @IsUUID("4")
  taskId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
