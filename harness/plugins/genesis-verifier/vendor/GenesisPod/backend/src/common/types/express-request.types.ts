/**
 * Express Request Types
 * 定义扩展后的 Express Request 类型
 */

import { Request } from "express";

/**
 * JWT 认证后的用户信息
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * 带有认证用户信息的 Request
 */
export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}
