import { SetMetadata } from "@nestjs/common";
import { SKIP_TRANSFORM_KEY } from "../response-transform.interceptor";

/**
 * 跳过响应转换装饰器
 * 用于 SSE 流式响应等不需要标准化格式的接口
 *
 * @example
 * @SkipTransform()
 * @Get('stream')
 * async stream() {
 *   // 返回原始数据
 * }
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
