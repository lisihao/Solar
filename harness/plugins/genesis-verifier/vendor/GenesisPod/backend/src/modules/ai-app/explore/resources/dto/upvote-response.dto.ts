import { ApiProperty } from "@nestjs/swagger";

/**
 * 点赞响应 DTO
 */
export class UpvoteResponseDto {
  @ApiProperty({ description: "是否成功" })
  success!: boolean;

  @ApiProperty({ description: "是否已点赞" })
  upvoted!: boolean;

  @ApiProperty({ description: "当前点赞数" })
  upvoteCount!: number;
}

/**
 * 用户点赞列表响应 DTO
 */
export class UserUpvotesResponseDto {
  @ApiProperty({ description: "已点赞的资源ID列表", type: [String] })
  resourceIds!: string[];
}
