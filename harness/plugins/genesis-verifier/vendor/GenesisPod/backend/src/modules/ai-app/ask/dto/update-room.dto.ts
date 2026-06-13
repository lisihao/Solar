import { IsObject, IsOptional, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { RoomConfigDto } from "./create-room.dto";

export class UpdateRoomDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RoomConfigDto)
  roomConfig?: RoomConfigDto;
}
