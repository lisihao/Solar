import { IsString } from "class-validator";

/**
 * 更新评论DTO
 */
export class UpdateCommentDto {
  @IsString()
  content!: string;
}
