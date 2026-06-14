import { IsArray, IsOptional, IsUUID, ArrayUnique } from "class-validator";

export class UpdateWorkspaceResourcesDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true, message: "addResourceIds 必须是有效的 UUID" })
  addResourceIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true, message: "removeResourceIds 必须是有效的 UUID" })
  removeResourceIds?: string[];
}
