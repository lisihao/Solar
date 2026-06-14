import { APP_CONFIG } from "./app.config";

/**
 * Socket.IO 网关统一 CORS origin 校验（函数式）。
 *
 * 修「`origin: "*"` + `credentials: true`」反模式——浏览器在 credentials 模式下
 * 拒绝 ACAO 通配 `*`（gens.team 等代理/自定义域名部署的 socket 握手会报：
 *   "Access-Control-Allow-Origin header ... must not be the wildcard '*'
 *    when the request's credentials mode is 'include'"）。
 *
 * 函数式回显具体 origin（而非 `*`）：允许 no-origin（同源/非浏览器）、dev localhost、
 * 以及 CORS_ORIGINS / FRONTEND_URL / RAILWAY_FRONTEND_URL / APP_CONFIG.railway.* 配置项。
 * 自定义域名部署：把前端域名加入 CORS_ORIGINS 或 FRONTEND_URL 即可。
 */
const buildWsAllowedOrigins = (): Set<string> => {
  const origins = new Set<string>();
  const add = (raw?: string | null): void => {
    if (!raw) return;
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((s) => origins.add(s));
  };
  add(process.env.CORS_ORIGINS);
  add(process.env.FRONTEND_URL);
  add(process.env.RAILWAY_FRONTEND_URL);
  add(APP_CONFIG.railway?.frontendUrl);
  add(APP_CONFIG.railway?.backendUrl);
  return origins;
};

const wsAllowedOrigins = buildWsAllowedOrigins();
const wsIsDev = process.env.NODE_ENV !== "production";

export const wsCorsOrigin = (
  origin: string,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin) {
    callback(null, true);
    return;
  }
  const isLocalhost =
    wsIsDev &&
    (/^http:\/\/localhost:\d+$/.test(origin) ||
      /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
  callback(null, isLocalhost || wsAllowedOrigins.has(origin));
};
