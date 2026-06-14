/**
 * SsrfGuard — 统一 SSRF / 出站请求防护（ai-engine 安全基元）
 *
 * 背景（platform-review wave1 rank2）：
 *   content-fetch 原 validateUrl 只对**字面 hostname**做黑名单正则 —— 攻击者用一个
 *   公网域名（DNS 解析到 169.254.169.254 / 内网）即可绕过（DNS rebinding）。webhook
 *   dispatcher 对 URL 只有 @IsUrl，零出站防护。二者同根：缺“解析后按真实 IP 复核 +
 *   出站不跟内网重定向”的统一闸门。
 *
 * 本模块提供项目唯一的 SSRF 闸门：
 *   - isBlockedIp(ip)：IPv4 + IPv6 私网 / 回环 / 链路本地 / 唯一本地 / 元数据 / 保留段判定
 *   - assertUrlSafe(url)：协议 / 端口 / 长度 / 字面黑名单 →（域名则）DNS 解析 → 对**所有**
 *       A/AAAA 解析结果复跑 isBlockedIp，任一命中即拒（堵 rebinding）
 *   - safeFetch(url, init)：assertUrlSafe + redirect:"manual"，对每一跳 Location 重新
 *       assertUrlSafe（堵“先返回 3xx 再跳内网”的重定向 rebinding），有界跳数
 *
 * 设计取舍（与用户确认）：
 *   不强行把连接 pin 到已解析 IP（那会破坏 TLS SNI / 虚拟主机），改用“解析后复核 +
 *   redirect:manual 逐跳复核”。残留 TOCTOU 窗口（复核与真实连接之间 DNS 再次翻转）
 *   是已知的窄窗口，需 custom undici dispatcher 才能彻底闭合，留作后续增强。
 */

import { BadRequestException } from "@nestjs/common";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const ALLOWED_PROTOCOLS = ["http:", "https:"];
const MAX_URL_LENGTH = 2048;
const DEFAULT_ALLOWED_PORTS = new Set(["", "80", "443"]);
const MAX_REDIRECT_HOPS = 5;
/**
 * ★ 2026-06-11 (#2 调用超时硬化): safeFetch 默认单跳超时（ms）。
 * 防工具/取数调用在连接挂起（server accept 后不回 body / 慢速 drip）时无限 hang——
 * 这类 hang 会让 mission 长时间无事件产出。120s 对正常网页/内容取数足够宽裕，远小于
 * mission 级 no-activity 回收阈值（15min）。caller 传 init.signal 时与本超时合并（任一触发即中止）。
 */
const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

/** 字面主机名黑名单（解析前的快速拦截）。 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "ip6-localhost",
  "metadata.google.internal",
  "metadata.azure.com",
  "metadata", // 常见内部别名
]);

/** 把点分 IPv4 转为 32 位无符号整数；非法返回 null。 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** IPv4 是否落在私网 / 回环 / 链路本地 / 元数据 / 保留 / CGNAT 等不可出站段。 */
function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // 解析不了 → fail closed
  const inRange = (cidrBase: string, bits: number): boolean => {
    const base = ipv4ToInt(cidrBase);
    if (base === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  };
  return (
    inRange("0.0.0.0", 8) || // 当前网络 / 0.0.0.0
    inRange("10.0.0.0", 8) || // 私网
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("127.0.0.0", 8) || // 回环
    inRange("169.254.0.0", 16) || // 链路本地（含 169.254.169.254 云元数据）
    inRange("172.16.0.0", 12) || // 私网
    inRange("192.0.0.0", 24) || // IETF 协议分配
    inRange("192.168.0.0", 16) || // 私网
    inRange("198.18.0.0", 15) || // 基准测试
    inRange("224.0.0.0", 4) || // 多播
    inRange("240.0.0.0", 4) // 保留
  );
}

/** IPv6 是否落在回环 / 链路本地 / 唯一本地 / 未指定等不可出站段（含 v4-mapped 回落到 v4 判定）。 */
function isBlockedIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (addr === "::1" || addr === "::") return true; // 回环 / 未指定
  // v4-mapped (::ffff:a.b.c.d) / v4-compat → 按 IPv4 判定
  const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const first = addr.split(":")[0];
  const hextet = parseInt(first || "0", 16);
  if (Number.isNaN(hextet)) return true; // fail closed
  // fe80::/10 链路本地
  if ((hextet & 0xffc0) === 0xfe80) return true;
  // fc00::/7 唯一本地 (fc00–fdff)
  if ((hextet & 0xfe00) === 0xfc00) return true;
  return false;
}

/** 给定一个**字面 IP**，判断是否为不可出站地址。无法识别的一律 fail closed（true）。 */
export function isBlockedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isBlockedIpv4(ip);
  if (fam === 6) return isBlockedIpv6(ip);
  return true;
}

export interface AssertUrlSafeOptions {
  /** 额外允许的端口（默认仅 80/443/空）。 */
  allowedPorts?: Iterable<string>;
}

/**
 * 校验 URL 出站安全（SSRF 闸门）。通过返回解析后的 URL，违规抛 BadRequestException。
 * 与 content-fetch 原 validateUrl 行为兼容（同样抛 BadRequestException → HTTP 400）。
 */
export async function assertUrlSafe(
  rawUrl: string,
  opts: AssertUrlSafeOptions = {},
): Promise<URL> {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    throw new BadRequestException(
      `URL 过长或为空（最大 ${MAX_URL_LENGTH} 字符）`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BadRequestException("无效的 URL 格式");
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new BadRequestException(
      `不支持的协议: ${parsed.protocol}（仅支持 HTTP/HTTPS）`,
    );
  }

  const allowedPorts = opts.allowedPorts
    ? new Set(opts.allowedPorts)
    : DEFAULT_ALLOWED_PORTS;
  if (!allowedPorts.has(parsed.port)) {
    throw new BadRequestException(`不允许访问端口: ${parsed.port || "(默认)"}`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new BadRequestException("不允许访问内部服务地址");
  }

  // 字面 IP：直接判定，不必 DNS。
  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) {
      throw new BadRequestException("不允许访问内网 / 保留 IP 地址");
    }
    return parsed;
  }

  // 域名：DNS 解析后对**所有**解析结果复核（堵 rebinding）。
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    // 解析失败 → 无法证明安全，fail closed。
    throw new BadRequestException("无法解析目标主机");
  }
  if (addresses.length === 0) {
    throw new BadRequestException("无法解析目标主机");
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new BadRequestException(
        "目标主机解析到内网 / 保留地址，已拒绝（SSRF 防护）",
      );
    }
  }
  return parsed;
}

/**
 * 安全 fetch：先 assertUrlSafe，再以 redirect:"manual" 发起；遇 3xx 取 Location 复跑
 * assertUrlSafe 后手动跟随（有界跳数），堵“先 3xx 再跳内网”的重定向 rebinding。
 *
 * 注意：调用方若本就不希望跟随重定向（如 webhook 投递），直接用 assertUrlSafe +
 * 自己的 fetch(redirect:"manual") 即可；本 helper 用于确实需要跟随的取数场景。
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: AssertUrlSafeOptions = {},
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    await assertUrlSafe(currentUrl, opts);
    // ★ 2026-06-11 (#2): 每跳带默认超时 + 合并 caller signal，杜绝连接挂起无限 hang。
    const res = await fetchWithTimeout(
      currentUrl,
      init,
      DEFAULT_FETCH_TIMEOUT_MS,
    );
    if (res.status < 300 || res.status >= 400) {
      return res;
    }
    const location = res.headers.get("location");
    if (!location) return res;
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new BadRequestException(
    `重定向跳数超过上限 ${MAX_REDIRECT_HOPS}（疑似重定向环 / SSRF）`,
  );
}

/**
 * 带默认超时的 fetch（#2 调用超时硬化）。timeoutMs 后中止；若 caller 在 init.signal
 * 传了自己的 AbortSignal，则与超时合并——任一触发即中止本次请求（不静默吞 caller 的取消）。
 * 用手动 AbortController 合并，避免依赖 AbortSignal.any（Node 20+ 才有）。
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const onTimeout = (): void =>
    controller.abort(
      new DOMException(
        `safeFetch timeout after ${timeoutMs}ms`,
        "TimeoutError",
      ),
    );
  const timer = setTimeout(onTimeout, timeoutMs);
  const callerSignal = init.signal ?? undefined;
  const forwardAbort = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) forwardAbort();
    else callerSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener("abort", forwardAbort);
  }
}
