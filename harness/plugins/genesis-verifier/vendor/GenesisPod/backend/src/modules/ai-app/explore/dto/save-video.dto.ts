import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsObject,
} from "class-validator";
import { Prisma } from "@prisma/client";

export class SaveVideoDto {
  @IsString()
  @IsNotEmpty()
  videoId!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  url!: string;

  @IsArray()
  @IsOptional()
  transcript?: Prisma.InputJsonValue[];

  @IsString()
  @IsOptional()
  translatedText?: string;

  @IsObject()
  @IsOptional()
  aiReport?: Prisma.InputJsonValue;
}
