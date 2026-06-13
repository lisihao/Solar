import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  Max,
} from "class-validator";

export enum ReadStatus {
  UNREAD = "UNREAD",
  READING = "READING",
  COMPLETED = "COMPLETED",
  ARCHIVED = "ARCHIVED",
}

export class UpdateCollectionItemDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsEnum(ReadStatus)
  readStatus?: ReadStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  readProgress?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
