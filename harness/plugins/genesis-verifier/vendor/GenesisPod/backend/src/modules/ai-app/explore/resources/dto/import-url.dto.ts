import { IsUrl, IsEnum } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * 从URL导入资源 DTO
 */
export class ImportUrlDto {
  @ApiProperty({
    description: "资源URL",
    example: "https://arxiv.org/abs/2301.07041",
  })
  @IsUrl()
  url!: string;

  @ApiProperty({
    description: "资源类型",
    enum: ["PAPER", "BLOG", "REPORT", "NEWS", "YOUTUBE_VIDEO", "POLICY"],
    example: "PAPER",
  })
  @IsEnum(["PAPER", "BLOG", "REPORT", "NEWS", "YOUTUBE_VIDEO", "POLICY"])
  type!: string;
}

/**
 * 导入URL响应 DTO
 */
export class ImportUrlResponseDto {
  @ApiProperty({ description: "是否成功" })
  success!: boolean;

  @ApiProperty({ description: "消息" })
  message!: string;

  @ApiProperty({ description: "资源信息", required: false })
  resource?: Record<string, unknown>;
}
