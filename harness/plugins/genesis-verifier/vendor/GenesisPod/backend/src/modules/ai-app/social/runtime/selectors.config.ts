/**
 * 页面选择器配置
 *
 * 将选择器配置化，便于维护和快速修复 UI 变化
 */

import type { Page } from "puppeteer";

// ==================== 微信公众号选择器 ====================

export const WECHAT_SELECTORS = {
  // 登录页面
  login: {
    qrCode: [
      ".login__type__container__scan__qrcode",
      ".qrcode img",
      '[class*="qrcode"]',
    ],
    nickname: [
      ".weui-desktop-account__nickname",
      ".nickname",
      '[class*="account-name"]',
    ],
    loginForm: [".login__type__container", ".login-box"],
  },

  // 后台首页
  home: {
    // 新建文章按钮 - 多种选择器备选
    newArticleButton: [
      '.new-creation__menu-content:has-text("图文")',
      'button:has-text("写新文章")',
      '.weui-desktop-btn:has-text("新的创作")',
      '.menu-item:has-text("图文消息")',
      '[class*="new-creation"]',
    ],
    // 账号信息
    accountInfo: [".weui-desktop-account", '[class*="account-info"]'],
  },

  // 编辑器页面
  editor: {
    // 标题输入
    titleInput: [
      "#title",
      'input[placeholder*="标题"]',
      ".title-input",
      '[class*="title"] input',
      'input[name="title"]',
    ],
    // 正文编辑器
    contentEditor: [
      ".ProseMirror",
      "#edui_editor_0",
      ".edui-editor",
      '[contenteditable="true"]',
      ".ql-editor",
    ],
    // 摘要输入
    digestInput: [
      "#js_description",
      'textarea[placeholder*="摘要"]',
      ".digest-input",
      '[class*="digest"] textarea',
    ],
    // 封面图
    coverUpload: [".cover-upload", '[class*="cover"]', ".thumb-upload"],
    // 保存按钮
    saveButton: [
      'button:has-text("保存")',
      '.weui-desktop-btn_primary:has-text("保存")',
      "#js_save",
      '[class*="save-btn"]',
    ],
    // 群发按钮
    publishButton: [
      'button:has-text("群发")',
      '.weui-desktop-btn_primary:has-text("群发")',
      ".mass-send-btn",
      '#js_send:has-text("群发")',
      '[class*="publish-btn"]',
    ],
    // 预览按钮
    previewButton: [
      'button:has-text("预览")',
      ".preview-btn",
      '[class*="preview"]',
    ],
  },

  // 群发确认弹窗
  massPublish: {
    confirmDialog: [
      ".weui-desktop-dialog",
      ".modal-dialog",
      '[class*="confirm-dialog"]',
    ],
    sendToAllRadio: [
      'input[value="all"]',
      'input[name="masssend_type"][value="0"]',
      '.send-all input[type="radio"]',
    ],
    confirmButton: [
      '.weui-desktop-dialog button:has-text("确定")',
      '.modal-footer button:has-text("确认")',
      'button:has-text("确认发送")',
    ],
    cancelButton: [
      '.weui-desktop-dialog button:has-text("取消")',
      '.modal-footer button:has-text("取消")',
    ],
  },

  // 成功/错误提示
  feedback: {
    successToast: [
      '.weui-desktop-toast:has-text("成功")',
      ".toast-success",
      '[class*="success-toast"]',
    ],
    errorToast: [
      '.weui-desktop-toast:has-text("失败")',
      ".toast-error",
      '[class*="error-toast"]',
    ],
    errorDialog: [".weui-desktop-dialog__bd", ".error-message"],
  },
};

// ==================== 小红书选择器 ====================

export const XHS_SELECTORS = {
  // 登录页面
  login: {
    qrCode: [".qrcode-img", '[class*="qrcode"]', ".login-qrcode img"],
    loginButton: [
      'button:has-text("登录")',
      ".login-btn",
      '[class*="login-button"]',
    ],
    phoneInput: ['input[placeholder*="手机号"]', 'input[type="tel"]'],
  },

  // 创作中心
  creator: {
    publishButton: [
      'button:has-text("发布笔记")',
      ".publish-btn",
      '[class*="create-btn"]',
    ],
    noteTypeImage: [
      '.note-type:has-text("图文")',
      '[data-type="image"]',
      ".image-note-btn",
    ],
    noteTypeVideo: [
      '.note-type:has-text("视频")',
      '[data-type="video"]',
      ".video-note-btn",
    ],
  },

  // 发布页面
  publish: {
    // 图片上传
    imageUpload: [
      'input[type="file"]',
      ".upload-input",
      '[class*="image-upload"]',
    ],
    // 标题输入
    titleInput: [
      'input[placeholder*="标题"]',
      ".title-input",
      '[class*="note-title"] input',
    ],
    // 正文输入
    contentInput: [
      '[contenteditable="true"]',
      ".content-editor",
      '[class*="note-content"]',
      "textarea",
    ],
    // 话题标签
    topicInput: [
      'input[placeholder*="添加话题"]',
      ".topic-input",
      '[class*="topic"]',
    ],
    // 位置
    locationInput: [
      'input[placeholder*="添加地点"]',
      ".location-input",
      '[class*="location"]',
    ],
    // 发布按钮
    submitButton: [
      'button:has-text("发布")',
      ".submit-btn",
      '[class*="publish-submit"]',
    ],
    // 保存草稿
    saveDraftButton: [
      'button:has-text("存草稿")',
      ".save-draft",
      '[class*="draft"]',
    ],
  },

  // 反馈
  feedback: {
    successMessage: [
      ':has-text("发布成功")',
      ".success-message",
      '[class*="publish-success"]',
    ],
    errorMessage: [".error-message", '[class*="error"]', ".toast-error"],
  },
};

// ==================== 工具函数 ====================

/**
 * 尝试多个选择器，返回第一个匹配的元素
 */
export async function trySelectors(
  page: Page,
  selectors: string[],
  options: { timeout?: number } = {},
): Promise<{ success: boolean; selector?: string; element?: unknown }> {
  const { timeout = 5000 } = options;

  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, {
        visible: true,
        timeout,
      });
      if (element) {
        return { success: true, selector, element };
      }
    } catch {
      continue;
    }
  }
  return { success: false };
}

/**
 * 尝试多个选择器进行点击
 */
export async function tryClick(
  page: Page,
  selectors: string[],
  options: { timeout?: number; delay?: number } = {},
): Promise<boolean> {
  const { timeout = 5000, delay: clickDelay = 100 } = options;

  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, {
        visible: true,
        timeout,
      });
      if (element) {
        await element.click({ delay: clickDelay });
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * 尝试多个选择器进行填写
 */
export async function tryFill(
  page: Page,
  selectors: string[],
  value: string,
  options: { timeout?: number; clear?: boolean } = {},
): Promise<boolean> {
  const { timeout = 5000, clear = true } = options;

  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, {
        visible: true,
        timeout,
      });
      if (element) {
        if (clear) {
          await element.click({ clickCount: 3 });
        }
        await page.keyboard.type(value);
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * 等待任一选择器出现
 */
export async function waitForAny(
  page: Page,
  selectors: string[],
  timeout = 10000,
): Promise<{ found: boolean; selector?: string }> {
  const promises = selectors.map(async (selector) => {
    try {
      await page.waitForSelector(selector, { visible: true, timeout });
      return selector;
    } catch {
      return null;
    }
  });

  const result = await Promise.race(promises);
  return result ? { found: true, selector: result } : { found: false };
}

/**
 * 人性化延迟
 */
export function humanDelay(min = 500, max = 1500): Promise<void> {
  const ms = min + Math.random() * (max - min);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 人性化输入
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  options: { minDelay?: number; maxDelay?: number } = {},
): Promise<void> {
  const { minDelay = 30, maxDelay = 100 } = options;

  const element = await page.$(selector);
  if (element) {
    await element.click();
  }
  await humanDelay(200, 500);

  for (const char of text) {
    await page.keyboard.type(char);
    await new Promise((r) =>
      setTimeout(r, minDelay + Math.random() * (maxDelay - minDelay)),
    );
  }
}
