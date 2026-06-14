/**
 * WeChat saveDraft helper —— 在浏览器 page context 执行的纯函数。
 *
 * 拆分自 wechat.adapter.ts（god-class size guard：>2500 行单次 +50 行硬拒）。
 * 保留为 browser-side function 以便 puppeteer page.evaluate 序列化传过去。
 *
 * 职责：
 * 1. 从多个来源解析 fingerprint（sniffed → window.wx → cgiData → inline script → outerHTML）
 * 2. 依次尝试 3 个 saveDraft schema 变体，首个 ret=0+appMsgId 即胜
 * 3. 把每次尝试的 ret / err_msg / body 切片聚合返回
 */

export interface SaveDraftApiParams {
  token: string;
  title: string;
  author: string;
  digest: string;
  content: string;
  sniffedFingerprint: string;
  /**
   * 2026-05-16 PR #111: HAR 真鼠标实证的 cover schema —— 新版编辑器不用
   * thumb_media_id / cdn_url_1_1，而是 6 个 cdn_url 字段 + 1 个 crop_list0 JSON。
   * 所有 cover* 字段为空字符串表示无封面（草稿仍可保存，feed 缩略图缺失）。
   */
  /** upload_material 返回的原图 cdn_url，作 cdn_url_back0 */
  coverBackCdnUrl: string;
  /** crop_multi result[0] (2.35:1) cdnurl，作 cdn_url0 / cdn_235_1_url0 / cdn_3_4_url0 */
  coverCrop235CdnUrl: string;
  /** crop_multi result[0] (2.35:1) file_id，作 crop_list0 内 ratio:"2.35_1" 的 file_id */
  coverCrop235FileId: string;
  /** crop_multi result[1] (1:1) cdnurl，作 cdn_1_1_url0 */
  coverCrop1_1CdnUrl: string;
  /** crop_multi result[1] (1:1) file_id，作 crop_list0 内 ratio:"1_1" 的 file_id */
  coverCrop1_1FileId: string;
}

export interface SaveDraftApiResult {
  status: number;
  fingerprint: string;
  fpSource: string;
  bodyPreview: string;
  json: {
    base_resp?: { ret?: number; err_msg?: string };
    ret?: number;
    appMsgId?: number | string;
  } | null;
}

/**
 * 由 page.evaluate 调用。注意：函数体被 puppeteer 序列化后在 browser context
 * 执行，禁止依赖任何 import / closure / TypeScript helper 类型。所有内嵌类型
 * 必须用 inline `as unknown as ...`。
 */
export async function runSaveDraftAttempts(
  params: SaveDraftApiParams,
): Promise<SaveDraftApiResult> {
  // 1. fingerprint 来源优先级：
  //    a) sniffed (publish() 顶部 page.on('request') 真鼠标侧捕获)
  //    b) window.wx.commonData.fingerprint / .t
  //    c) window.cgiData.fingerprint / .t
  //    d) inline script 扫描
  //    e) outerHTML 全文兜底
  let fingerprint = params.sniffedFingerprint || "";
  let fpSource = fingerprint ? "sniffed" : "";

  if (!fingerprint) {
    const wx = (
      window as unknown as {
        wx?: {
          fp?: { t?: string } | string;
          commonData?: { fingerprint?: string; t?: string };
        };
      }
    ).wx;
    if (wx?.commonData?.fingerprint) {
      fingerprint = wx.commonData.fingerprint;
      fpSource = "window.wx.commonData.fingerprint";
    } else if (wx?.commonData?.t) {
      fingerprint = wx.commonData.t;
      fpSource = "window.wx.commonData.t";
    } else if (typeof wx?.fp === "string") {
      fingerprint = wx.fp;
      fpSource = "window.wx.fp(string)";
    } else if (typeof wx?.fp === "object" && wx.fp !== null && "t" in wx.fp) {
      fingerprint = wx.fp.t || "";
      fpSource = "window.wx.fp.t";
    }
  }

  if (!fingerprint) {
    const cgiData = (
      window as unknown as {
        cgiData?: { fingerprint?: string; t?: string };
      }
    ).cgiData;
    if (cgiData?.fingerprint) {
      fingerprint = cgiData.fingerprint;
      fpSource = "window.cgiData.fingerprint";
    } else if (cgiData?.t) {
      fingerprint = cgiData.t;
      fpSource = "window.cgiData.t";
    }
  }

  if (!fingerprint) {
    const scripts = Array.from(document.scripts);
    for (const s of scripts) {
      const m = s.textContent?.match(
        /(?:fingerprint|"t"|'t'|\bt)["':\s]+["']([a-f0-9]{32})["']/,
      );
      if (m) {
        fingerprint = m[1];
        fpSource = "inline-script";
        break;
      }
    }
  }

  if (!fingerprint) {
    const html = document.documentElement.outerHTML;
    const m = html.match(/["']([a-f0-9]{32})["']/);
    if (m) {
      fingerprint = m[1];
      fpSource = "outerHTML";
    }
  }

  // 2026-05-16 PR #111: HAR 15.6MB 真鼠标 saveDraft 完整字段还原。新版
  // 编辑器使用 multi-suffixed schema（count=1 + 索引 0 后缀），URL 带
  // sub=update&type=77（type=77 是新版编辑器统一 sub-type，跟图文类型无关）。
  // 封面通过 6 个 cdn_url 字段 + crop_list0 JSON 描述，不再依赖 thumb_media_id。
  const rand = () => Math.random().toString();
  const commonFields = {
    token: params.token,
    lang: "zh_CN",
    f: "json",
    ajax: "1",
    fingerprint,
  };
  const hasCover =
    !!params.coverBackCdnUrl &&
    !!params.coverCrop235CdnUrl &&
    !!params.coverCrop1_1CdnUrl;

  // crop_list0 几何描述：WeChat 服务端根据这个 JSON 确定 cover 比例与剪裁框。
  //   x1/y1/x2/y2 都是 0 表示让 WeChat 自动按 format 比例剪裁；具体几何由
  //   crop_list_percent 里的 0~1 浮点描述。我们生成的占位/AI 图是 1200x630
  //   或类似比例，直接全图标记 (0,0)→(1,1) 即可。
  const cropList0Json = hasCover
    ? JSON.stringify({
        crop_list: [
          {
            ratio: "2.35_1",
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            file_id:
              Number(params.coverCrop235FileId) || params.coverCrop235FileId,
          },
          {
            ratio: "1_1",
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            file_id:
              Number(params.coverCrop1_1FileId) || params.coverCrop1_1FileId,
          },
        ],
        crop_list_percent: [
          {
            ratio: "2.35_1",
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            file_id:
              Number(params.coverCrop235FileId) || params.coverCrop235FileId,
          },
          {
            ratio: "1_1",
            x1: 0,
            y1: 0,
            x2: 1,
            y2: 1,
            file_id:
              Number(params.coverCrop1_1FileId) || params.coverCrop1_1FileId,
          },
        ],
      })
    : "";

  // HAR 真鼠标 saveDraft 字段集合（核心 30 字段，全 multi-suffixed index 0）。
  const sharedArticleFields = {
    // 核心内容
    title0: params.title,
    author0: params.author,
    digest0: params.digest,
    content0: params.content,
    sourceurl0: "",
    fileid0: "",
    // 封面 6 字段（HAR 实证）—— 2.35:1 / 16:9 / 3:4 / 1:1 / 原图回链
    cdn_url0: hasCover ? params.coverCrop235CdnUrl : "",
    cdn_235_1_url0: hasCover ? params.coverCrop235CdnUrl : "",
    cdn_3_4_url0: hasCover ? params.coverCrop235CdnUrl : "",
    cdn_1_1_url0: hasCover ? params.coverCrop1_1CdnUrl : "",
    cdn_16_9_url0: "",
    cdn_url_back0: hasCover ? params.coverBackCdnUrl : "",
    crop_list0: cropList0Json,
    // 元信息（HAR 实证默认值）
    show_cover_pic0: "0",
    last_choose_cover_from0: "0",
    app_cover_auto0: "0",
    multi_picture_cover0: "0",
    new_pic_process0: "0",
    title_gen_type0: "0",
    auto_gen_digest0: "0",
    copyright_type0: "0",
    is_cartoon_copyright0: "0",
    need_open_comment0: "1",
    only_fans_can_comment0: "0",
    can_reward0: "0",
    can_open_reward0: "0",
    ad_type0: "0",
  };

  // 单 schema 主路径 + 多 schema fallback：
  //   主路径 v2-multi-suffixed (HAR 实证) → 失败回退 v1 / v3 兼容性兜底
  const schemas: Array<{
    name: string;
    endpoint: string;
    body: Record<string, string>;
  }> = [
    {
      name: "v2-multi-suffixed-count1-har",
      // URL 带 type=77 跟真鼠标对齐（新版编辑器统一 sub-type）
      endpoint: `/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${params.token}&lang=zh_CN`,
      body: {
        ...commonFields,
        random: rand(),
        AppMsgId: "",
        count: "1",
        // top-level type 双保险（部分 schema 服务端按 top-level 判，部分按 type0）
        type: "10",
        type0: "10",
        ...sharedArticleFields,
      },
    },
    {
      name: "v2-multi-suffixed-count1-sub-create",
      // 不带 type=77 的 sub=create 旁路（保险）
      endpoint: `/cgi-bin/operate_appmsg?t=ajax-response&sub=create&token=${params.token}&lang=zh_CN`,
      body: {
        ...commonFields,
        random: rand(),
        AppMsgId: "",
        count: "1",
        type: "10",
        type0: "10",
        ...sharedArticleFields,
      },
    },
    {
      name: "v3-appmsg-add",
      endpoint: `/cgi-bin/appmsg?action=add_appmsg&token=${params.token}&lang=zh_CN`,
      body: {
        ...commonFields,
        random: rand(),
        type: "10",
        title: params.title,
        author: params.author,
        digest: params.digest,
        content: params.content,
        sourceurl: "",
        cdn_url: hasCover ? params.coverCrop235CdnUrl : "",
        cdn_url_back: hasCover ? params.coverBackCdnUrl : "",
        show_cover_pic: "0",
        copyright_type: "0",
      },
    },
  ];

  const attempts: Array<{
    name: string;
    status: number;
    ret: number | string | undefined;
    err_msg: string | undefined;
    bodyPreview: string;
  }> = [];

  let winningJson: SaveDraftApiResult["json"] = null;
  let winningStatus = 0;

  for (const schema of schemas) {
    const body = new URLSearchParams(schema.body);
    const res = await fetch(schema.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: body.toString(),
      credentials: "include",
    });
    const text = await res.text();
    let json: SaveDraftApiResult["json"] = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON
    }
    const r = json?.base_resp?.ret ?? json?.ret;
    attempts.push({
      name: schema.name,
      status: res.status,
      ret: r,
      err_msg: json?.base_resp?.err_msg,
      bodyPreview: text.slice(0, 800),
    });
    if (r === 0 && json?.appMsgId) {
      winningJson = json;
      winningStatus = res.status;
      break;
    }
  }

  return {
    status: winningStatus || attempts[attempts.length - 1].status,
    fingerprint,
    fpSource,
    bodyPreview: JSON.stringify(attempts).slice(0, 2500),
    json: winningJson,
  };
}
