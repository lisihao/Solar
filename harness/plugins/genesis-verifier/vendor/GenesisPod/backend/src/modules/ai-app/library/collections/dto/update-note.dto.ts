import { IsString } from "class-validator";

export class UpdateNoteDto {
  @IsString()
  note!: string;
}
