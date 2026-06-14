import { IsString, IsOptional } from "class-validator";

export class AddToCollectionDto {
  @IsString()
  resourceId!: string;

  @IsOptional()
  @IsString()
  note?: string;
}
