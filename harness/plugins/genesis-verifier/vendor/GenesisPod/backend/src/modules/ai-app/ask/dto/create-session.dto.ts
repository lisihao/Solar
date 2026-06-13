import { IsOptional, IsString, MaxLength } from "class-validator";

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  modelId?: string;
}
