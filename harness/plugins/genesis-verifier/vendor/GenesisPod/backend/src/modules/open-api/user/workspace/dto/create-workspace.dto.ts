import { ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

export class CreateWorkspaceDto {
  @IsArray()
  @ArrayNotEmpty({ message: "resourceIds 不能为空" })
  @IsUUID("4", { each: true, message: "resourceIds 必须是有效的 UUID" })
  resourceIds!: string[];
}
