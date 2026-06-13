import { IsInt, Min, Max } from "class-validator";

export class ReplanDto {
  @IsInt()
  @Min(1)
  @Max(6)
  startPhase!: number;
}
