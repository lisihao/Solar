import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";

export class CreateVolumeDto {
  @IsNumber()
  @Min(1)
  volumeNumber!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  synopsis?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWords?: number;
}

export class UpdateVolumeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  synopsis?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetWords?: number;
}
