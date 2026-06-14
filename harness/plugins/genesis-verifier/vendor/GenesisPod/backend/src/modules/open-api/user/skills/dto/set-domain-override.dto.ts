import { IsBoolean } from "class-validator";

export class SetDomainOverrideDto {
  @IsBoolean()
  enabled!: boolean;
}
