import { IsString, IsOptional } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class GenerateDemoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;
}
