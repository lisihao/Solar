import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import { Prisma } from "@prisma/client";

export class CreateWorkspaceTaskDto {
  @IsString()
  @IsNotEmpty({ message: "templateId 不能为空" })
  templateId!: string;

  @IsString()
  @IsNotEmpty({ message: "model 不能为空" })
  model!: string;

  @IsOptional()
  @IsString()
  question?: string;

  @IsOptional()
  @IsObject()
  overrides?: Record<string, Prisma.InputJsonValue>;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMinSize(2, { message: "resourceIds 至少需要选择 2 个资源" })
  @IsUUID("4", { each: true, message: "resourceIds 必须是有效的 UUID" })
  resourceIds?: string[];
}
