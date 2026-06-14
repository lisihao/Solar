/**
 * 取消任务响应 DTO
 */

import { ApiProperty } from "@nestjs/swagger";

/**
 * 取消任务响应 DTO
 */
export class CancelResponseDto {
  @ApiProperty({
    description: "是否取消成功",
    example: true,
  })
  success!: boolean;
}
