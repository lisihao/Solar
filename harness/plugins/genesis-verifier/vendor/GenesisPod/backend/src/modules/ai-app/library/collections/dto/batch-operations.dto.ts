import {
  IsString,
  IsArray,
  IsOptional,
  IsEnum,
  ArrayMinSize,
} from "class-validator";
import { ReadStatus } from "./update-item.dto";

export class BatchMoveItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds!: string[];

  @IsString()
  targetCollectionId!: string;
}

export class BatchDeleteItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds!: string[];
}

export class BatchUpdateTagsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds!: string[];

  @IsArray()
  @IsString({ each: true })
  tags!: string[];

  @IsOptional()
  @IsEnum(["add", "remove", "set"])
  operation?: "add" | "remove" | "set";
}

export class BatchUpdateStatusDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  itemIds!: string[];

  @IsEnum(ReadStatus)
  status!: ReadStatus;
}
