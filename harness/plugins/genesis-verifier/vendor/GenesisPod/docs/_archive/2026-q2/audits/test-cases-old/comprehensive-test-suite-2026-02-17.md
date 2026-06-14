# GenesisPod 系统综合测试套件 v2.0

**创建日期**: 2026-02-17
**测试环境**: https://genesis-ai.up.railway.app
**基准版本**: commit 64311445
**版本**: 2.0（扩展覆盖全系统14个模块）

---

## 测试策略概述

### 覆盖维度

| 维度           | 描述                          | 测试用例数 |
| -------------- | ----------------------------- | ---------- |
| 单功能测试     | 每个功能点的基础验证          | ~400       |
| 功能组合测试   | 同模块内功能的排列组合        | ~100       |
| 跨模块集成测试 | 模块间的数据流和交互          | ~50        |
| 端到端场景测试 | 真实用户完整流程              | ~20        |
| 性能基准测试   | 响应时间、并发、大数据量      | ~40        |
| DFX 测试       | 可用性/可靠性/安全性/响应式等 | ~60        |
| 边界条件测试   | 极端情况和异常处理            | ~50        |
| 数据完整性测试 | CRUD/级联/一致性              | ~15        |
| **总计**       |                               | **~735**   |

### 测试优先级

| 级别 | 说明                     | 占比 |
| ---- | ------------------------ | ---- |
| P0   | 必须通过，阻断发布       | ~25% |
| P1   | 重要功能，影响用户体验   | ~35% |
| P2   | 一般功能，可接受临时缺陷 | ~30% |
| P3   | 增强体验，低优先级       | ~10% |

---

## Part 1: 功能测试用例

### 1.1 AI Ask（智能问答）

#### 1.1.1 会话管理

| 测试ID      | 场景         | 前置条件               | 操作步骤                                  | 预期结果                 | 优先级 |
| ----------- | ------------ | ---------------------- | ----------------------------------------- | ------------------------ | ------ |
| ASK-SES-001 | 创建新会话   | 用户已登录             | POST /ask/sessions，标题为"测试会话"      | 返回201，会话ID和标题    | P0     |
| ASK-SES-002 | 获取会话列表 | 已有3+会话             | GET /ask/sessions?limit=10                | 返回分页列表，按时间倒序 | P0     |
| ASK-SES-003 | 搜索会话     | 已有含"量子计算"的会话 | GET /ask/sessions/search?q=量子计算       | 返回匹配结果             | P1     |
| ASK-SES-004 | 更新会话标题 | 已有会话               | PATCH /ask/sessions/:id {title: "新标题"} | 标题更新成功             | P1     |
| ASK-SES-005 | 删除会话     | 已有会话               | DELETE /ask/sessions/:id                  | 会话被删除，列表中消失   | P1     |

#### 1.1.2 单模型对话

| 测试ID      | 场景            | 前置条件   | 操作步骤                     | 预期结果       | 优先级 |
| ----------- | --------------- | ---------- | ---------------------------- | -------------- | ------ |
| ASK-MSG-001 | Grok 纯对话     | 已创建会话 | 发送消息，modelType=Grok     | 流式返回AI回复 | P0     |
| ASK-MSG-002 | Claude 纯对话   | 已创建会话 | 发送消息，modelType=Claude   | 流式返回AI回复 | P0     |
| ASK-MSG-003 | GPT-4o 纯对话   | 已创建会话 | 发送消息，modelType=GPT-4o   | 流式返回AI回复 | P0     |
| ASK-MSG-004 | Gemini 纯对话   | 已创建会话 | 发送消息，modelType=Gemini   | 流式返回AI回复 | P1     |
| ASK-MSG-005 | DeepSeek 纯对话 | 已创建会话 | 发送消息，modelType=DeepSeek | 流式返回AI回复 | P1     |
| ASK-MSG-006 | Qwen 纯对话     | 已创建会话 | 发送消息，modelType=Qwen     | 流式返回AI回复 | P1     |

#### 1.1.3 Mixture 多模型

| 测试ID      | 场景               | 前置条件           | 操作步骤                  | 预期结果             | 优先级 |
| ----------- | ------------------ | ------------------ | ------------------------- | -------------------- | ------ |
| ASK-MIX-001 | Mixture 基础对话   | 已创建会话         | 开启Mixture模式，发送问题 | 4个模型并行返回      | P0     |
| ASK-MIX-002 | Mixture + 联网搜索 | Mixture模式        | 开启联网搜索，问当前时事  | 各模型引用实时信息   | P0     |
| ASK-MIX-003 | Mixture + 知识库   | Mixture模式+知识库 | 选择知识库，发送问题      | 各模型基于知识库回答 | P1     |

#### 1.1.4 联网搜索

| 测试ID      | 场景            | 前置条件        | 操作步骤                     | 预期结果                | 优先级 |
| ----------- | --------------- | --------------- | ---------------------------- | ----------------------- | ------ |
| ASK-SCH-001 | 单模型联网搜索  | 搜索API已配置   | 开启联网搜索，问"今天的新闻" | 返回实时搜索结果+AI分析 | P0     |
| ASK-SCH-002 | 搜索结果引用    | 联网搜索开启    | 发送需要引用的问题           | 回复中包含来源链接      | P1     |
| ASK-SCH-003 | 搜索+知识库组合 | 联网搜索+知识库 | 同时开启，发送问题           | 综合网络+知识库内容     | P1     |

#### 1.1.5 RAG 知识库集成

| 测试ID      | 场景            | 前置条件             | 操作步骤                    | 预期结果                     | 优先级 |
| ----------- | --------------- | -------------------- | --------------------------- | ---------------------------- | ------ |
| ASK-RAG-001 | 单知识库问答    | 已创建含文档的知识库 | 选择1个知识库，发送相关问题 | 基于知识库内容回答，显示来源 | P0     |
| ASK-RAG-002 | 多知识库问答    | 多个知识库           | 选择3个知识库               | 跨知识库综合回答             | P1     |
| ASK-RAG-003 | 知识库+联网组合 | 知识库+搜索          | 同时开启                    | 综合知识库和网络信息         | P1     |

#### 1.1.6 文件上传

| 测试ID      | 场景               | 前置条件      | 操作步骤             | 预期结果                | 优先级 |
| ----------- | ------------------ | ------------- | -------------------- | ----------------------- | ------ |
| ASK-FIL-001 | 上传文本文件       | 已创建会话    | 上传.txt文件+提问    | 基于文件内容回答        | P1     |
| ASK-FIL-002 | 上传Markdown       | 已创建会话    | 上传.md文件+提问     | 正确解析MD内容          | P1     |
| ASK-FIL-003 | 上传PDF            | 已创建会话    | 上传.pdf文件+提问    | PDF内容被解析并用于回答 | P1     |
| ASK-FIL-004 | 上传图片(视觉模型) | GPT-4o/Gemini | 上传.png/.jpg+提问   | 识别图片内容            | P1     |
| ASK-FIL-005 | 多文件上传         | 已创建会话    | 同时上传3个文件+提问 | 综合多文件内容回答      | P2     |

#### 1.1.7 消息操作

| 测试ID      | 场景               | 前置条件   | 操作步骤                 | 预期结果     | 优先级 |
| ----------- | ------------------ | ---------- | ------------------------ | ------------ | ------ |
| ASK-REG-001 | 重新生成回复       | 已有AI回复 | POST regenerate          | 生成新的回复 | P1     |
| ASK-CTX-001 | 模型切换保持上下文 | 多轮对话   | Grok问→切换Claude→继续问 | 上下文连贯   | P1     |
| ASK-CTX-002 | 功能切换保持上下文 | 多轮对话   | 纯对话→开联网→继续问     | 上下文连贯   | P1     |
| ASK-CTX-003 | 多轮深度对话       | 已有会话   | 连续10+轮对话            | 上下文不丢失 | P1     |

### 1.2 AI Research（深度研究 - AI Studio）

#### 1.2.1 研究项目管理

| 测试ID      | 场景         | 前置条件   | 操作步骤                                     | 预期结果     | 优先级 |
| ----------- | ------------ | ---------- | -------------------------------------------- | ------------ | ------ |
| RES-PRJ-001 | 创建研究项目 | 用户已登录 | POST /ai-studio/projects {name, description} | 项目创建成功 | P0     |
| RES-PRJ-002 | 获取项目列表 | 已有项目   | GET /ai-studio/projects                      | 返回分页列表 | P0     |
| RES-PRJ-003 | 获取项目详情 | 已有项目   | GET /ai-studio/projects/:id                  | 返回完整详情 | P0     |
| RES-PRJ-004 | 更新项目     | 已有项目   | PATCH /ai-studio/projects/:id                | 更新成功     | P1     |
| RES-PRJ-005 | 删除项目     | 已有项目   | DELETE /ai-studio/projects/:id               | 项目被删除   | P1     |
| RES-PRJ-006 | 归档和恢复   | 已有项目   | 归档→验证不在活跃列表→恢复                   | 归档恢复正常 | P2     |

#### 1.2.2 资料来源管理

| 测试ID      | 场景         | 前置条件 | 操作步骤                               | 预期结果        | 优先级 |
| ----------- | ------------ | -------- | -------------------------------------- | --------------- | ------ |
| RES-SRC-001 | 添加URL来源  | 已有项目 | POST sources {type: 'URL', url: '...'} | URL被解析并添加 | P0     |
| RES-SRC-002 | 上传PDF文件  | 已有项目 | POST sources/upload 上传PDF            | 文件解析成功    | P0     |
| RES-SRC-003 | 批量添加来源 | 已有项目 | POST sources/batch [3个URL]            | 批量添加成功    | P1     |
| RES-SRC-004 | 搜索资料     | 已有资料 | POST search {query: "关键词"}          | 返回匹配结果    | P1     |
| RES-SRC-005 | 删除来源     | 已有来源 | DELETE sources/:sourceId               | 来源被删除      | P1     |

#### 1.2.3 项目Chat & 笔记

| 测试ID      | 场景         | 前置条件       | 操作步骤                     | 预期结果             | 优先级 |
| ----------- | ------------ | -------------- | ---------------------------- | -------------------- | ------ |
| RES-CHT-001 | 项目内对话   | 已有资料的项目 | POST chat/messages {content} | 基于资料回答         | P0     |
| RES-CHT-002 | 新建对话会话 | 已有对话历史   | POST chat/new                | 清空上下文开始新对话 | P1     |
| RES-CHT-003 | 获取对话历史 | 已有对话       | GET chat/history             | 返回历史消息         | P1     |
| RES-NTE-001 | 创建笔记     | 已有项目       | POST notes {content}         | 笔记创建成功         | P1     |
| RES-NTE-002 | 更新笔记     | 已有笔记       | PATCH notes/:noteId          | 更新成功             | P2     |
| RES-NTE-003 | 删除笔记     | 已有笔记       | DELETE notes/:noteId         | 删除成功             | P2     |

#### 1.2.4 输出报告

| 测试ID      | 场景                 | 前置条件   | 操作步骤                             | 预期结果        | 优先级 |
| ----------- | -------------------- | ---------- | ------------------------------------ | --------------- | ------ |
| RES-OUT-001 | 生成研究报告         | 有充足资料 | POST outputs {type: RESEARCH_REPORT} | SSE流式生成报告 | P0     |
| RES-OUT-002 | 生成摘要             | 有充足资料 | POST outputs {type: SUMMARY}         | 生成简洁摘要    | P1     |
| RES-OUT-003 | 生成问答             | 有充足资料 | POST outputs {type: QUESTION_ANSWER} | 生成Q&A格式     | P1     |
| RES-OUT-004 | 重新生成输出         | 已有输出   | POST outputs/:id/regenerate          | 重新生成成功    | P1     |
| RES-OUT-005 | 删除输出             | 已有输出   | DELETE outputs/:id                   | 删除成功        | P2     |
| RES-TTS-001 | 生成音频(ElevenLabs) | TTS已配置  | POST outputs/:id/audio               | 生成音频文件    | P2     |
| RES-TTS-002 | TTS可用性检查        | 无         | GET tts/status                       | 返回可用状态    | P2     |

### 1.3 AI Teams（多Agent协作）

#### 1.3.1 话题/团队管理

| 测试ID      | 场景         | 前置条件   | 操作步骤                          | 预期结果     | 优先级 |
| ----------- | ------------ | ---------- | --------------------------------- | ------------ | ------ |
| TMS-TOP-001 | 创建话题     | 用户已登录 | POST /topics {title, description} | 话题创建成功 | P0     |
| TMS-TOP-002 | 获取话题列表 | 已有话题   | GET /topics                       | 返回列表     | P0     |
| TMS-TOP-003 | 获取话题详情 | 已有话题   | GET /topics/:topicId              | 返回详情     | P0     |
| TMS-TOP-004 | 更新话题     | 话题所有者 | PATCH /topics/:topicId            | 更新成功     | P1     |
| TMS-TOP-005 | 归档和删除   | 话题所有者 | 归档→删除                         | 操作成功     | P1     |

#### 1.3.2 成员管理

| 测试ID      | 场景         | 前置条件   | 操作步骤                    | 预期结果     | 优先级 |
| ----------- | ------------ | ---------- | --------------------------- | ------------ | ------ |
| TMS-MBR-001 | 添加人类成员 | 话题所有者 | POST members {userId}       | 成员添加成功 | P1     |
| TMS-MBR-002 | 邀请成员     | 话题所有者 | POST members/invite {email} | 邀请发送成功 | P2     |
| TMS-MBR-003 | 更新成员角色 | 话题所有者 | PATCH members/:id {role}    | 角色更新     | P2     |
| TMS-MBR-004 | 移除成员     | 话题所有者 | DELETE members/:id          | 成员被移除   | P1     |
| TMS-MBR-005 | 离开话题     | 话题成员   | POST leave                  | 退出成功     | P2     |

#### 1.3.3 AI成员管理

| 测试ID      | 场景         | 前置条件   | 操作步骤                            | 预期结果         | 优先级 |
| ----------- | ------------ | ---------- | ----------------------------------- | ---------------- | ------ |
| TMS-AIM-001 | 添加AI成员   | 话题已创建 | POST ai-members {name, model, role} | AI成员添加       | P0     |
| TMS-AIM-002 | 配置AI成员   | 已有AI成员 | PATCH ai-members/:id {systemPrompt} | 配置更新         | P1     |
| TMS-AIM-003 | 设为Leader   | 已有AI成员 | POST ai-members/:id/set-leader      | Leader设置成功   | P1     |
| TMS-AIM-004 | 快速红蓝辩论 | 话题已创建 | POST ai-members/debate              | 自动创建正反两方 | P0     |
| TMS-AIM-005 | 删除AI成员   | 已有AI成员 | DELETE ai-members/:id               | 删除成功         | P1     |

#### 1.3.4 消息系统

| 测试ID      | 场景        | 前置条件   | 操作步骤                              | 预期结果             | 优先级 |
| ----------- | ----------- | ---------- | ------------------------------------- | -------------------- | ------ |
| TMS-MSG-001 | 发送消息    | 话题成员   | POST messages {content}               | 消息发送成功，触发AI | P0     |
| TMS-MSG-002 | 获取消息    | 已有消息   | GET messages?cursor=&limit=           | 游标分页返回         | P0     |
| TMS-MSG-003 | 删除消息    | 消息发送者 | DELETE messages/:id                   | 消息被删除           | P1     |
| TMS-MSG-004 | 表情反应    | 已有消息   | POST messages/:id/reactions {emoji}   | 反应添加成功         | P2     |
| TMS-MSG-005 | 收藏消息    | 已有消息   | POST messages/:id/bookmark            | 收藏成功             | P2     |
| TMS-MSG-006 | 转发消息    | 已有消息   | POST messages/forward {targetTopicId} | 转发成功             | P2     |
| TMS-MSG-007 | @AI触发响应 | AI成员在线 | 发送"@AI名称 你的看法？"              | AI生成响应           | P0     |
| TMS-MSG-008 | @Everyone   | 多AI成员   | 发送"@everyone 讨论一下"              | 所有AI轮流响应       | P1     |

#### 1.3.5 团队任务

| 测试ID      | 场景         | 前置条件     | 操作步骤                            | 预期结果           | 优先级 |
| ----------- | ------------ | ------------ | ----------------------------------- | ------------------ | ------ |
| TMS-MIS-001 | 创建团队任务 | 话题有AI成员 | POST missions {description}         | 任务创建并开始执行 | P0     |
| TMS-MIS-002 | 获取任务列表 | 已有任务     | GET missions                        | 返回列表含状态     | P0     |
| TMS-MIS-003 | 获取任务详情 | 任务运行中   | GET missions/:id                    | 返回进度详情       | P1     |
| TMS-MIS-004 | 暂停任务     | 任务运行中   | POST missions/:id/pause             | 任务暂停           | P1     |
| TMS-MIS-005 | 继续任务     | 任务已暂停   | POST missions/:id/resume            | 任务继续           | P1     |
| TMS-MIS-006 | 取消任务     | 任务运行中   | POST missions/:id/cancel            | 任务取消           | P1     |
| TMS-MIS-007 | 获取完整报告 | 任务完成     | GET missions/:id/full-report        | 返回完整报告       | P0     |
| TMS-MIS-008 | 重新生成报告 | 任务完成     | POST missions/:id/regenerate-report | 报告重新生成       | P2     |

#### 1.3.6 WebSocket实时通信

| 测试ID     | 场景          | 前置条件   | 操作步骤              | 预期结果                     | 优先级 |
| ---------- | ------------- | ---------- | --------------------- | ---------------------------- | ------ |
| TMS-WS-001 | WebSocket连接 | 进入话题页 | connectSocket(userId) | 连接建立                     | P0     |
| TMS-WS-002 | 实时消息推送  | WS已连接   | 另一用户发送消息      | 实时收到message:new事件      | P0     |
| TMS-WS-003 | 任务进度推送  | WS已连接   | 任务执行中            | 实时收到mission:progress事件 | P1     |

### 1.4 AI Writing（创意写作）

#### 1.4.1 项目管理

| 测试ID      | 场景         | 前置条件   | 操作步骤                                              | 预期结果           | 优先级 |
| ----------- | ------------ | ---------- | ----------------------------------------------------- | ------------------ | ------ |
| WRT-PRJ-001 | 创建写作项目 | 用户已登录 | POST /ai-writing/projects {title, genre, targetWords} | 项目创建成功       | P0     |
| WRT-PRJ-002 | 获取项目列表 | 已有项目   | GET /ai-writing/projects                              | 返回分页列表       | P0     |
| WRT-PRJ-003 | 获取项目详情 | 已有项目   | GET /ai-writing/projects/:id                          | 含卷章结构的详情   | P0     |
| WRT-PRJ-004 | 更新项目设置 | 已有项目   | PATCH /ai-writing/projects/:id                        | 设置更新成功       | P1     |
| WRT-PRJ-005 | 删除项目     | 已有项目   | DELETE /ai-writing/projects/:id                       | 项目及关联数据删除 | P1     |

#### 1.4.2 故事圣经与人物

| 测试ID      | 场景               | 前置条件       | 操作步骤                                  | 预期结果             | 优先级 |
| ----------- | ------------------ | -------------- | ----------------------------------------- | -------------------- | ------ |
| WRT-BIB-001 | 获取故事设定       | 已有项目       | GET projects/:id/bible                    | 返回世界观设定       | P1     |
| WRT-BIB-002 | 更新故事设定       | 已有项目       | PATCH projects/:id/bible                  | 设定更新成功         | P1     |
| WRT-BIB-003 | 故事设定AI自动维护 | 写作任务完成后 | 检查bible是否自动更新                     | Keeper自动更新世界观 | P2     |
| WRT-CHR-001 | 创建人物           | 已有项目       | POST characters {name, description, role} | 人物创建成功         | P1     |
| WRT-CHR-002 | 获取人物列表       | 已有人物       | GET characters                            | 返回人物列表         | P1     |
| WRT-CHR-003 | 更新人物信息       | 已有人物       | PATCH characters/:id                      | 更新成功             | P1     |
| WRT-CHR-004 | 添加人物关系       | 已有2+人物     | POST characters/:id/relationships         | 关系添加成功         | P2     |
| WRT-CHR-005 | 获取关系图         | 已有关系       | GET relationships/graph                   | 返回关系图数据       | P2     |

#### 1.4.3 卷章管理

| 测试ID      | 场景         | 前置条件     | 操作步骤                          | 预期结果       | 优先级 |
| ----------- | ------------ | ------------ | --------------------------------- | -------------- | ------ |
| WRT-VOL-001 | 创建卷       | 已有项目     | POST volumes {title, description} | 卷创建成功     | P0     |
| WRT-VOL-002 | 创建章节     | 已有卷       | POST volumes/:id/chapters {title} | 章节创建成功   | P0     |
| WRT-VOL-003 | 获取章节详情 | 已有章节     | GET chapters/:id                  | 含内容的详情   | P0     |
| WRT-VOL-004 | 更新章节内容 | 已有章节     | PATCH chapters/:id/content        | 人工编辑保存   | P1     |
| WRT-VOL-005 | 获取卷列表   | 已有卷和章节 | GET projects/:id/volumes          | 含章节的卷列表 | P0     |

#### 1.4.4 写作任务

| 测试ID      | 场景         | 前置条件   | 操作步骤                                 | 预期结果               | 优先级 |
| ----------- | ------------ | ---------- | ---------------------------------------- | ---------------------- | ------ |
| WRT-MIS-001 | 生成大纲     | 有故事设定 | POST missions {type: outline}            | 生成章节大纲           | P0     |
| WRT-MIS-002 | 写单章       | 有大纲     | POST missions {type: chapter, chapterId} | 生成章节内容           | P0     |
| WRT-MIS-003 | 写全文       | 有大纲     | POST missions {type: full_story}         | 全部章节顺序生成       | P0     |
| WRT-MIS-004 | 取消写作     | 任务运行中 | POST missions/:id/cancel                 | 任务取消，已写内容保留 | P1     |
| WRT-MIS-005 | 获取任务状态 | 任务运行中 | GET missions/:id                         | 返回进度和状态         | P1     |
| WRT-PAR-001 | 平行写作     | 有大纲+3章 | POST volumes/:id/write-parallel          | 3章同时写作            | P1     |
| WRT-PAR-002 | 平行写作完成 | 平行任务中 | 等待任务完成                             | 所有章节生成无冲突     | P1     |

#### 1.4.5 一致性检查

| 测试ID      | 场景           | 前置条件       | 操作步骤                            | 预期结果       | 优先级 |
| ----------- | -------------- | -------------- | ----------------------------------- | -------------- | ------ |
| WRT-CON-001 | 单章一致性检查 | 已有章节内容   | POST chapters/:id/check-consistency | 返回矛盾列表   | P1     |
| WRT-CON-002 | 项目一致性报告 | 已有多章内容   | GET projects/:id/consistency-report | 跨章一致性报告 | P1     |
| WRT-CON-003 | 时间线冲突检测 | 有时间相关内容 | GET projects/:id/timeline-conflicts | 时间线矛盾列表 | P2     |

#### 1.4.6 版本控制与编辑

| 测试ID      | 场景          | 前置条件     | 操作步骤                                  | 预期结果       | 优先级 |
| ----------- | ------------- | ------------ | ----------------------------------------- | -------------- | ------ |
| WRT-REV-001 | 获取修订历史  | 已有多次修改 | GET chapters/:id/revisions                | 修订版本列表   | P1     |
| WRT-REV-002 | 版本比较      | 已有多版本   | GET chapters/:id/revisions/diff           | 显示diff       | P2     |
| WRT-REV-003 | 回退到版本    | 已有多版本   | POST revisions/:id/rollback               | 内容回退       | P1     |
| WRT-REV-004 | AI编辑-改写   | 已有章节内容 | POST chapters/:id/ai-edit {type: rewrite} | 章节被改写     | P1     |
| WRT-EDT-001 | AI编辑-润色   | 已有章节内容 | POST ai-edit {type: polish}               | 润色后风格提升 | P1     |
| WRT-EDT-002 | AI编辑-扩写   | 已有章节内容 | POST ai-edit {type: expand}               | 内容扩充       | P1     |
| WRT-EDT-003 | AI编辑-缩短   | 已有章节内容 | POST ai-edit {type: condense}             | 内容精简       | P2     |
| WRT-EDT-004 | AI编辑-修风格 | 已有章节内容 | POST ai-edit {type: style_fix}            | 风格统一       | P2     |

#### 1.4.7 批注系统

| 测试ID      | 场景         | 前置条件 | 操作步骤                                  | 预期结果   | 优先级 |
| ----------- | ------------ | -------- | ----------------------------------------- | ---------- | ------ |
| WRT-ANN-001 | 创建批注     | 已有章节 | POST annotations {type: COMMENT, content} | 批注创建   | P1     |
| WRT-ANN-002 | 获取批注列表 | 已有批注 | GET annotations?status=open               | 按状态过滤 | P1     |
| WRT-ANN-003 | 解决批注     | 已有批注 | POST annotations/resolve                  | 批量解决   | P2     |
| WRT-ANN-004 | 删除批注     | 已有批注 | DELETE annotations/:id                    | 删除成功   | P2     |

#### 1.4.8 导入

| 测试ID      | 场景         | 前置条件 | 操作步骤                    | 预期结果         | 优先级 |
| ----------- | ------------ | -------- | --------------------------- | ---------------- | ------ |
| WRT-IMP-001 | 解析导入内容 | 已有项目 | POST import/parse {content} | 返回解析结果预览 | P1     |
| WRT-IMP-002 | 确认导入     | 已解析   | POST import/:id/confirm     | 内容导入到章节   | P1     |
| WRT-IMP-003 | 取消导入     | 已解析   | DELETE import/:id           | 导入取消         | P2     |

### 1.5 AI Office（办公生成）

| 测试ID      | 场景           | 前置条件   | 操作步骤               | 预期结果         | 优先级 |
| ----------- | -------------- | ---------- | ---------------------- | ---------------- | ------ |
| OFC-SLD-001 | 快速生成幻灯片 | 用户已登录 | 输入主题，选择快速生成 | 生成10页PPT      | P0     |
| OFC-SLD-002 | 从文档生成     | 有研究报告 | 上传文档，生成幻灯片   | 基于文档内容生成 | P1     |
| OFC-SLD-003 | 编辑单页       | 已有PPT    | 修改文本/布局          | 保存成功         | P1     |
| OFC-SLD-004 | AI助手建议     | 已有PPT    | 请求AI优化建议         | 返回设计建议     | P1     |
| OFC-SLD-005 | 主题切换       | 已有PPT    | 选择新主题             | 全局主题应用     | P2     |
| OFC-THM-001 | 自定义主题     | 已有PPT    | 修改颜色/字体          | 主题自定义保存   | P2     |
| OFC-THM-002 | 主题预览       | 主题列表   | 悬停预览               | 实时预览效果     | P2     |
| OFC-EXP-001 | 导出PDF        | 已有PPT    | 导出为PDF              | PDF文件下载      | P0     |
| OFC-EXP-002 | 导出PPTX       | 已有PPT    | 导出为PPTX             | PPTX文件下载     | P1     |

### 1.6 AI Image（图像生成）

| 测试ID      | 场景         | 前置条件     | 操作步骤                               | 预期结果        | 优先级 |
| ----------- | ------------ | ------------ | -------------------------------------- | --------------- | ------ |
| IMG-GEN-001 | 文本提示生成 | 用户已登录   | 输入提示词，点击生成                   | SSE流式返回图像 | P0     |
| IMG-GEN-002 | URL参考生成  | 有参考URL    | 输入URL+提示词                         | 基于参考生成    | P1     |
| IMG-GEN-003 | 参考图片生成 | 有参考图片   | 上传参考图+提示词                      | 基于参考图生成  | P1     |
| IMG-GEN-004 | 风格选择     | 用户已登录   | 选择特定风格(如油画)                   | 指定风格输出    | P1     |
| IMG-GEN-005 | 宽高比设置   | 用户已登录   | 选择16:9/1:1/9:16                      | 对应比例输出    | P1     |
| IMG-GEN-006 | 反向提示     | 用户已登录   | 设置negativePrompt                     | 排除指定元素    | P2     |
| IMG-STR-001 | SSE流式进度  | 生成中       | 观察SSE事件                            | 进度实时更新    | P0     |
| IMG-STR-002 | 取消生成     | 生成中       | 点击取消                               | 生成停止        | P1     |
| IMG-HIS-001 | 查看历史     | 已有生成记录 | GET /ai-image/history                  | 按时间倒序列表  | P1     |
| IMG-HIS-002 | 删除图像     | 已有图像     | DELETE /ai-image/:id                   | 删除成功        | P1     |
| IMG-HIS-003 | 收藏图像     | 已有图像     | POST /ai-image/:id/bookmark            | 收藏成功        | P2     |
| IMG-HIS-004 | 公开分享     | 已有图像     | POST /ai-image/:id/visibility {PUBLIC} | 生成公开链接    | P2     |
| IMG-TAG-001 | AI自动标签   | 已有图像     | POST ai/auto-tag                       | 标签生成成功    | P2     |
| IMG-TAG-002 | 主题聚类     | 多张图像     | POST ai/cluster-themes                 | 按主题分组      | P3     |

### 1.7 AI Social（社交内容）

| 测试ID      | 场景           | 前置条件   | 操作步骤                                       | 预期结果       | 优先级 |
| ----------- | -------------- | ---------- | ---------------------------------------------- | -------------- | ------ |
| SOC-CON-001 | 初始化平台连接 | 用户已登录 | POST connections/:type/init                    | 返回授权URL    | P0     |
| SOC-CON-002 | 验证连接       | 已初始化   | POST connections/:type/verify                  | 连接验证成功   | P0     |
| SOC-CON-003 | 获取连接列表   | 已有连接   | GET connections                                | 返回已连接平台 | P0     |
| SOC-CON-004 | 测试连接       | 已有连接   | POST connections/:id/test                      | 连接状态正常   | P1     |
| SOC-CON-005 | 删除连接       | 已有连接   | DELETE connections/:type                       | 连接删除       | P1     |
| SOC-CNT-001 | 创建内容       | 用户已登录 | POST contents {title, content}                 | 内容创建成功   | P0     |
| SOC-CNT-002 | 获取内容列表   | 已有内容   | GET contents?status=draft                      | 按状态过滤     | P0     |
| SOC-CNT-003 | 更新内容       | 已有内容   | PATCH contents/:id                             | 更新成功       | P1     |
| SOC-CNT-004 | 删除内容       | 已有内容   | DELETE contents/:id                            | 删除成功       | P1     |
| SOC-CNT-005 | 批量删除       | 多条内容   | POST contents/batch-delete                     | 批量删除成功   | P2     |
| SOC-CNT-006 | AI从URL生成    | 有源URL    | POST ai/process-url {url}                      | AI生成社交内容 | P0     |
| SOC-VER-001 | 生成平台版本   | 已有内容   | POST contents/:id/versions/generate {platform} | 为特定平台生成 | P0     |
| SOC-VER-002 | 生成全平台版本 | 已有内容   | POST versions/generate-all                     | 所有平台版本   | P1     |
| SOC-VER-003 | 编辑版本       | 已有版本   | PATCH versions/:platform                       | 版本更新       | P1     |
| SOC-PUB-001 | 合规性检查     | 已有内容   | POST contents/:id/check                        | 返回合规结果   | P1     |
| SOC-PUB-002 | 直接发布       | 合规通过   | POST contents/:id/publish                      | 发布成功       | P0     |
| SOC-PUB-003 | 定时发布       | 合规通过   | POST contents/:id/schedule {publishAt}         | 调度成功       | P1     |
| SOC-PUB-004 | 取消发布       | 已调度     | POST contents/:id/cancel                       | 取消成功       | P1     |
| SOC-PUB-005 | 批量发布       | 多条内容   | POST contents/batch-publish                    | 批量发布       | P2     |
| SOC-REV-001 | 批准内容       | 待审核     | POST contents/:id/approve                      | 状态变为已批准 | P1     |
| SOC-REV-002 | 拒绝内容       | 待审核     | POST contents/:id/reject                       | 状态变为已拒绝 | P1     |
| SOC-REV-003 | 重新提交       | 已拒绝     | POST contents/:id/resubmit                     | 重新进入审核   | P2     |
| SOC-XHS-001 | 小红书登录状态 | MCP连接    | GET xhs/login-status                           | 返回登录状态   | P1     |
| SOC-XHS-002 | 搜索小红书     | 已登录     | GET xhs/search?keyword=...                     | 返回搜索结果   | P1     |
| SOC-XHS-003 | 获取动态详情   | 已登录     | GET xhs/feeds/:feedId                          | 返回内容详情   | P2     |
| SOC-XHS-004 | 发表评论       | 已登录     | POST xhs/feeds/:id/comment                     | 评论发表成功   | P2     |

### 1.8 Library/Content（资源库）

| 测试ID      | 场景         | 前置条件   | 操作步骤                                  | 预期结果       | 优先级 |
| ----------- | ------------ | ---------- | ----------------------------------------- | -------------- | ------ |
| LIB-RES-001 | 获取资源列表 | 已有资源   | GET /resources?skip=0&take=20             | 分页列表       | P0     |
| LIB-RES-002 | 搜索资源     | 已有资源   | GET /resources?search=关键词              | 匹配结果       | P0     |
| LIB-RES-003 | 从URL导入    | 有效URL    | POST /resources/import-url {url}          | 资源导入成功   | P0     |
| LIB-RES-004 | 上传文件     | 有PDF文件  | POST /resources/upload-file               | 文件上传成功   | P0     |
| LIB-RES-005 | 更新资源     | 已有资源   | PATCH /resources/:id                      | 更新成功       | P1     |
| LIB-RES-006 | 删除资源     | 已有资源   | DELETE /resources/:id                     | 删除成功       | P1     |
| LIB-SCH-001 | 搜索建议     | 输入关键词 | GET search/suggestions?q=...              | 即时建议       | P2     |
| LIB-SCH-002 | 按类型过滤   | 已有多类型 | GET /resources?type=PAPER                 | 只显示论文     | P1     |
| LIB-SCH-003 | 排序         | 已有资源   | GET /resources?sortBy=qualityScore        | 按质量排序     | P2     |
| LIB-AI-001  | AI增强摘要   | 已有资源   | POST /resources/:id/enrich                | 生成摘要和标签 | P1     |
| LIB-AI-002  | AI翻译       | 已有资源   | POST /resources/:id/translate?language=zh | 翻译成功       | P2     |
| LIB-AI-003  | 结构化增强   | 已有资源   | POST /resources/:id/enrich-structured     | 结构化摘要     | P2     |
| LIB-THB-001 | 提取缩略图   | 有URL      | GET thumbnail/extract?url=...             | 返回缩略图     | P2     |
| LIB-THB-002 | 上传缩略图   | 已有资源   | POST /resources/:id/thumbnail             | 缩略图更新     | P2     |

### 1.9 RAG 知识库

| 测试ID      | 场景             | 前置条件     | 操作步骤                          | 预期结果           | 优先级 |
| ----------- | ---------------- | ------------ | --------------------------------- | ------------------ | ------ |
| RAG-KB-001  | 创建知识库       | 用户已登录   | POST knowledge-bases {name}       | 知识库创建成功     | P0     |
| RAG-KB-002  | 获取知识库列表   | 已有知识库   | GET knowledge-bases               | 返回列表           | P0     |
| RAG-KB-003  | 获取统计         | 已有文档     | GET knowledge-bases/:id/stats     | 文档数/向量数统计  | P1     |
| RAG-KB-004  | 更新知识库       | 已有知识库   | PATCH knowledge-bases/:id         | 更新成功           | P1     |
| RAG-KB-005  | 删除知识库       | 已有知识库   | DELETE knowledge-bases/:id        | 级联删除文档和向量 | P1     |
| RAG-DOC-001 | 添加文档         | 已有知识库   | POST documents {content, title}   | 文档添加并处理     | P0     |
| RAG-DOC-002 | 获取文档列表     | 已有文档     | GET documents                     | 含处理状态         | P0     |
| RAG-DOC-003 | 处理文档         | 有待处理文档 | POST process                      | 向量化处理         | P0     |
| RAG-DOC-004 | 删除文档         | 已有文档     | DELETE documents/:id              | 删除文档和向量     | P1     |
| RAG-IMP-001 | URL导入预览      | 已有知识库   | POST fetch-url {url}              | 返回预览内容       | P1     |
| RAG-IMP-002 | 批量URL导入      | 已有知识库   | POST import-urls [urls]           | 批量导入成功       | P1     |
| RAG-IMP-003 | 导入书签         | 已有书签     | POST import-bookmarks             | 书签导入成功       | P2     |
| RAG-IMP-004 | 导入笔记         | 已有笔记     | POST import-notes                 | 笔记导入成功       | P2     |
| RAG-IMP-005 | Google Drive同步 | GDrive已连接 | POST sync                         | 同步文件成功       | P2     |
| RAG-QRY-001 | 简单查询         | 已有向量文档 | POST simple-query {query, kbIds}  | 返回相关文档片段   | P0     |
| RAG-QRY-002 | 完整RAG查询      | 已有向量文档 | POST query {query, useHyde: true} | HyDE增强查询       | P0     |
| RAG-QRY-003 | Rerank查询       | 已有向量文档 | POST query {useRerank: true}      | Rerank重排序       | P1     |
| RAG-QRY-004 | 跨知识库查询     | 多个知识库   | POST query {kbIds: [id1, id2]}    | 跨库综合结果       | P1     |
| RAG-MBR-001 | 添加成员         | 知识库所有者 | POST members {userId, role}       | 成员添加           | P2     |
| RAG-MBR-002 | 更新角色         | 已有成员     | PATCH members/:id {role}          | 角色更新           | P2     |
| RAG-MBR-003 | 移除成员         | 已有成员     | DELETE members/:id                | 成员移除           | P2     |

### 1.10 Admin 管理后台

| 测试ID      | 场景           | 前置条件   | 操作步骤                                       | 预期结果       | 优先级 |
| ----------- | -------------- | ---------- | ---------------------------------------------- | -------------- | ------ |
| ADM-USR-001 | 获取用户列表   | 管理员登录 | GET /admin/users                               | 分页用户列表   | P0     |
| ADM-USR-002 | 创建用户       | 管理员     | POST /admin/users                              | 用户创建       | P1     |
| ADM-USR-003 | 更新用户角色   | 管理员     | PATCH /admin/users/:id/role                    | 角色更新       | P1     |
| ADM-USR-004 | 禁用用户       | 管理员     | PATCH /admin/users/:id/status {enabled: false} | 用户被禁用     | P1     |
| ADM-USR-005 | 查看登录历史   | 管理员     | GET /admin/users/:id/login-history             | 返回历史       | P2     |
| ADM-MDL-001 | 获取AI模型列表 | 管理员     | GET /admin/ai-models                           | 模型列表       | P0     |
| ADM-MDL-002 | 创建AI模型     | 管理员     | POST /admin/ai-models {name, provider, apiKey} | 模型创建       | P0     |
| ADM-MDL-003 | 测试模型连接   | 已有模型   | POST /admin/ai-models/:id/test                 | 连接测试结果   | P0     |
| ADM-MDL-004 | 设为默认模型   | 已有模型   | POST /admin/ai-models/:id/set-default          | 默认设置       | P1     |
| ADM-MDL-005 | 获取可用模型   | 有API Key  | POST /admin/ai-models/fetch-available          | 提供商模型列表 | P1     |
| ADM-MDL-006 | 删除模型       | 非默认模型 | DELETE /admin/ai-models/:id                    | 模型删除       | P1     |
| ADM-SET-001 | 获取站点设置   | 管理员     | GET /admin/settings/site                       | 站点配置       | P1     |
| ADM-SET-002 | 更新AI设置     | 管理员     | PUT /admin/settings/ai                         | AI配置更新     | P1     |
| ADM-SET-003 | 更新安全设置   | 管理员     | PUT /admin/settings/security                   | 安全配置更新   | P1     |
| ADM-SET-004 | 测试SMTP       | 管理员     | POST /admin/settings/smtp/test                 | SMTP测试结果   | P2     |
| ADM-SET-005 | 测试搜索API    | 管理员     | POST /admin/search-config/test                 | 搜索API测试    | P1     |
| ADM-CRD-001 | 查看积分账户   | 管理员     | GET /admin/credits/accounts                    | 积分账户列表   | P1     |
| ADM-CRD-002 | 发放积分       | 管理员     | POST /admin/users/:id/credits/grant {amount}   | 积分发放       | P1     |
| ADM-CRD-003 | 冻结积分       | 管理员     | POST /admin/users/:id/credits/freeze           | 积分冻结       | P2     |
| ADM-CRD-004 | 积分统计       | 管理员     | GET /admin/credits/stats                       | 统计数据       | P2     |
| ADM-SVC-001 | 搜索API配置    | 管理员     | PATCH /admin/search-config                     | 配置更新       | P1     |
| ADM-SVC-002 | 内容提取配置   | 管理员     | PATCH /admin/extraction-config                 | 配置更新       | P1     |
| ADM-SVC-003 | YouTube配置    | 管理员     | PATCH /admin/youtube-config                    | 配置更新       | P2     |
| ADM-SVC-004 | TTS配置        | 管理员     | PATCH /admin/tts-config                        | 配置更新       | P2     |
| ADM-SVC-005 | 存储配置       | 管理员     | PATCH /admin/storage-config                    | 配置更新       | P2     |

### 1.11 Auth 认证

| 测试ID      | 场景              | 前置条件         | 操作步骤                                    | 预期结果                 | 优先级 |
| ----------- | ----------------- | ---------------- | ------------------------------------------- | ------------------------ | ------ |
| AUT-REG-001 | 用户注册          | 无               | POST /auth/register {email, password, name} | 注册成功返回token        | P0     |
| AUT-REG-002 | 重复注册          | 已有同邮箱       | POST /auth/register {同邮箱}                | 409 冲突                 | P0     |
| AUT-REG-003 | 弱密码注册        | 无               | POST /auth/register {password: "123"}       | 400 密码强度不够         | P1     |
| AUT-LGN-001 | 用户登录          | 已注册           | POST /auth/login {email, password}          | 返回access+refresh token | P0     |
| AUT-LGN-002 | 错误密码          | 已注册           | POST /auth/login {错误密码}                 | 401 认证失败             | P0     |
| AUT-OAT-001 | Google OAuth 发起 | 无               | GET /auth/google                            | 重定向到Google           | P0     |
| AUT-OAT-002 | OAuth 回调        | Google授权后     | GET /auth/google/callback                   | 返回授权码               | P0     |
| AUT-TKN-001 | 令牌刷新          | 有refresh token  | POST /auth/refresh {refreshToken}           | 返回新access token       | P0     |
| AUT-TKN-002 | 过期令牌          | access token过期 | 使用过期token请求                           | 401->自动刷新            | P0     |
| AUT-PRF-001 | 获取个人资料      | 已登录           | GET /auth/me                                | 返回用户信息             | P0     |
| AUT-PRF-002 | 更新资料          | 已登录           | PATCH /auth/profile {name}                  | 更新成功                 | P1     |

### 1.12 导出系统

| 测试ID      | 场景         | 前置条件     | 操作步骤                           | 预期结果                  | 优先级 |
| ----------- | ------------ | ------------ | ---------------------------------- | ------------------------- | ------ |
| EXP-FMT-001 | 导出PDF      | 有可导出内容 | POST /export {format: PDF}         | 异步生成PDF               | P0     |
| EXP-FMT-002 | 导出DOCX     | 有可导出内容 | POST /export {format: DOCX}        | 异步生成DOCX              | P0     |
| EXP-FMT-003 | 导出PPTX     | 有幻灯片内容 | POST /export {format: PPTX}        | 异步生成PPTX              | P1     |
| EXP-FMT-004 | 导出Markdown | 有可导出内容 | POST /export {format: MARKDOWN}    | 异步生成MD                | P1     |
| EXP-FMT-005 | 导出HTML     | 有可导出内容 | POST /export {format: HTML}        | 异步生成HTML              | P2     |
| EXP-FMT-006 | 导出XLSX     | 有表格数据   | POST /export {format: XLSX}        | 异步生成XLSX              | P2     |
| EXP-ASY-001 | 轮询导出状态 | 已提交导出   | GET /export/{jobId} (每1秒)        | 返回PROCESSING->COMPLETED | P0     |
| EXP-ASY-002 | 下载导出文件 | 导出完成     | GET /export/{jobId}/download       | 流式下载文件              | P0     |
| EXP-ASY-003 | 导出超时     | 大文件导出   | 轮询超过2分钟                      | 超时提示                  | P1     |
| EXP-TPL-001 | 获取模板列表 | 无           | GET /export/templates?category=... | 返回模板                  | P2     |
| EXP-TPL-002 | 使用模板导出 | 有模板       | POST /export {templateId}          | 按模板格式导出            | P2     |

### 1.13 集成模块

| 测试ID      | 场景             | 前置条件     | 操作步骤                  | 预期结果     | 优先级 |
| ----------- | ---------------- | ------------ | ------------------------- | ------------ | ------ |
| ITG-NTN-001 | Notion连接       | 有Notion账号 | 配置Notion集成            | 连接成功     | P2     |
| ITG-NTN-002 | 导入Notion页面   | 已连接       | 选择页面导入              | 内容导入成功 | P2     |
| ITG-GDR-001 | Google Drive连接 | 有Google账号 | 配置GDrive集成            | 连接成功     | P2     |
| ITG-GDR-002 | 浏览Drive文件夹  | 已连接       | GET /google-drive/folders | 文件夹列表   | P2     |
| ITG-FSH-001 | 飞书连接         | 有飞书账号   | 配置飞书集成              | 连接成功     | P2     |
| ITG-FSH-002 | 导入飞书文档     | 已连接       | 选择文档导入              | 内容导入成功 | P2     |

---

## Part 2: 功能组合测试

### 2.1 模块内组合

#### AI Ask 组合矩阵

| 测试ID      | 模型    | 联网搜索 | 知识库 | 文件上传 | 引用 | 预期结果       | 优先级 |
| ----------- | ------- | -------- | ------ | -------- | ---- | -------------- | ------ |
| CMB-ASK-001 | Grok    | 是       | 否     | 否       | 否   | 搜索+对话      | P0     |
| CMB-ASK-002 | Grok    | 否       | 是     | 否       | 否   | 知识库对话     | P0     |
| CMB-ASK-003 | Grok    | 是       | 是     | 否       | 否   | 搜索+知识库    | P0     |
| CMB-ASK-004 | Grok    | 是       | 是     | 是       | 否   | 全功能组合     | P1     |
| CMB-ASK-005 | Grok    | 是       | 是     | 是       | 是   | 完整组合       | P1     |
| CMB-ASK-006 | Claude  | 是       | 是     | 是       | 是   | 完整组合       | P1     |
| CMB-ASK-007 | GPT-4o  | 是       | 是     | 是       | 是   | 完整组合       | P1     |
| CMB-ASK-008 | Mixture | 是       | 否     | 否       | 否   | 多模型+搜索    | P0     |
| CMB-ASK-009 | Mixture | 否       | 是     | 否       | 否   | 多模型+知识库  | P0     |
| CMB-ASK-010 | Mixture | 是       | 是     | 是       | 是   | 多模型完整组合 | P1     |

#### AI Teams 组合矩阵

| 测试ID      | Agent数量 | 角色配置      | 协作模式 | 模型混合 | 预期结果 | 优先级 |
| ----------- | --------- | ------------- | -------- | -------- | -------- | ------ |
| CMB-TMS-001 | 2         | 1Leader+1成员 | 顺序     | 单模型   | 正常协作 | P0     |
| CMB-TMS-002 | 4         | 1Leader+3成员 | 顺序     | 混合模型 | 多样观点 | P1     |
| CMB-TMS-003 | 2         | 双方对立      | 辩论     | 不同模型 | 正反观点 | P0     |
| CMB-TMS-004 | 4         | 2v2对立       | 辩论     | 混合     | 双方论证 | P1     |
| CMB-TMS-005 | 3         | 无Leader      | 自由     | 混合     | 随机发言 | P2     |

#### AI Writing 组合矩阵

| 测试ID      | 写作类型   | 风格   | 一致性检查 | 并行写作 | 预期结果        | 优先级 |
| ----------- | ---------- | ------ | ---------- | -------- | --------------- | ------ |
| CMB-WRT-001 | 大纲+单章  | 默认   | 否         | 否       | 大纲后逐章写    | P0     |
| CMB-WRT-002 | 全文       | 武侠   | 是         | 否       | 全文写作+一致性 | P1     |
| CMB-WRT-003 | 大纲+平行  | 科幻   | 是         | 是       | 平行写作+检查   | P1     |
| CMB-WRT-004 | 编辑(润色) | 原风格 | 否         | 否       | 润色不改风格    | P1     |

#### AI Image 组合矩阵

| 测试ID      | 输入类型    | 模型     | 风格 | 宽高比 | 预期结果     | 优先级 |
| ----------- | ----------- | -------- | ---- | ------ | ------------ | ------ |
| CMB-IMG-001 | 文本        | DALL-E 3 | 默认 | 1:1    | 标准生成     | P0     |
| CMB-IMG-002 | 文本+参考图 | DALL-E 3 | 油画 | 16:9   | 参考+风格    | P1     |
| CMB-IMG-003 | URL+文本    | Imagen   | 水彩 | 9:16   | URL参考+风格 | P1     |
| CMB-IMG-004 | 文件+文本   | Together | 赛博 | 4:3    | 上传+风格    | P2     |

### 2.2 跨模块集成

| 测试ID          | 数据流向          | 操作步骤                      | 预期结果       | 优先级 |
| --------------- | ----------------- | ----------------------------- | -------------- | ------ |
| INT-LIB-ASK-001 | Library->AI Ask   | 上传资源->创建知识库->Ask问答 | 资源内容可问答 | P0     |
| INT-LIB-ASK-002 | Library->AI Ask   | 删除知识库->Ask尝试使用       | 友好提示不存在 | P1     |
| INT-LIB-ASK-003 | Library->AI Ask   | 更新知识库->Ask立即可用       | 实时同步       | P1     |
| INT-EXP-LIB-001 | Explore->Library  | 收藏Explore资源->Library导入  | 成功导入       | P1     |
| INT-EXP-LIB-002 | Explore->Library  | YouTube视频->导入->Ask问答    | 字幕内容可问答 | P1     |
| INT-EXP-LIB-003 | Explore->Library  | 批量书签导入->知识库          | 批量导入成功   | P2     |
| INT-RES-LIB-001 | Research->Library | 研究报告->导出到Library       | 报告可存储     | P1     |
| INT-RES-LIB-002 | Library->Research | 选择知识库->发起研究          | 知识库作为来源 | P1     |
| INT-RES-LIB-003 | Research->Ask     | 研究来源->Ask深入问答         | 来源内容可问答 | P1     |
| INT-TMS-RES-001 | Teams->Research   | 团队讨论->生成研究报告        | 报告格式正确   | P1     |
| INT-TMS-RES-002 | Research->Teams   | 研究结果->Teams评审           | 可作为输入     | P2     |
| INT-WRT-LIB-001 | Writing->Library  | 写作导出到Library             | 文档可存储     | P2     |
| INT-WRT-LIB-002 | Library->Writing  | 知识库参考->AI写作            | 参考知识库内容 | P2     |
| INT-SOC-RES-001 | Research->Social  | 研究报告->生成社交内容        | 自动提取要点   | P1     |
| INT-SOC-WRT-001 | Writing->Social   | 写作内容->社交发布            | 适配各平台格式 | P2     |
| INT-SOC-LIB-001 | Library->Social   | 资源->社交分享                | 生成分享文案   | P2     |
| INT-RAG-ASK-001 | RAG->Ask          | 向量检索->AI回答              | 引用来源文档   | P0     |
| INT-RAG-ASK-002 | RAG->Ask          | 多知识库->组合查询            | 跨库综合       | P1     |
| INT-IMG-OFC-001 | Image->Office     | AI生成图片->插入幻灯片        | 图片引用正确   | P2     |
| INT-EXP-ALL-001 | Export<-各模块    | 研究/Teams/Writing->PDF       | 各模块导出正常 | P0     |
| INT-ADM-AI-001  | Admin->AI模块     | 配置新模型->用户可选择        | 模型立即可用   | P0     |
| INT-ADM-AI-002  | Admin->AI模块     | 禁用模型->用户不可选择        | 模型不再可用   | P1     |

### 2.3 端到端场景

| 测试ID  | 场景名称             | 完整步骤                                                               | 验收标准       | 优先级 |
| ------- | -------------------- | ---------------------------------------------------------------------- | -------------- | ------ |
| E2E-001 | 新主题深度研究       | 创建项目->添加来源->Chat调研->生成报告->导出PDF                        | 报告完整有引用 | P0     |
| E2E-002 | 知识库构建与问答     | Explore发现->收藏->Library导入->RAG知识库->Ask问答                     | 问答准确       | P0     |
| E2E-003 | 团队协作决策         | 创建团队->添加AI->发起辩论->查看结论->导出报告                         | 结论完整       | P0     |
| E2E-004 | AI辅助长篇创作       | 新建项目->设定圣经->创建角色->生成大纲->平行写作->一致性检查->导出Word | 文档完整一致   | P0     |
| E2E-005 | 多模型对比研究       | Mixture提问->对比回答->选最佳->深入追问                                | 各模型差异明显 | P1     |
| E2E-006 | 研究->社交发布       | Research报告->Social适配->多平台发布                                   | 各平台内容合规 | P1     |
| E2E-007 | 研究->幻灯片         | Research报告->Office生成PPT->导出PPTX                                  | PPT内容完整    | P1     |
| E2E-008 | 新用户首次体验       | 注册->登录->首次Ask对话->创建知识库                                    | 流程顺畅无障碍 | P0     |
| E2E-009 | 管理员配置->用户使用 | Admin配模型->配搜索API->用户Ask+联网                                   | 配置即时生效   | P0     |
| E2E-010 | 跨模块数据流         | Explore->Library->Research->Teams->Writing->Export                     | 数据全链路无损 | P1     |

---

---

## Part 3: 性能测试

### 3.1 响应时间基准

| 测试ID      | 场景                | 测试条件                | 操作步骤/测量方法                                             | 预期结果（基准值）       | 优先级 |
| ----------- | ------------------- | ----------------------- | ------------------------------------------------------------- | ------------------------ | ------ |
| PERF-RT-001 | AI Ask 首次响应     | 单模型短问题，网络正常  | 发送短问题，记录从发送到首个 token 到达的时间                 | 首 token 时间 < 3s       | P0     |
| PERF-RT-002 | AI Ask 流式完成     | 单模型，回复约 200 字   | 发送问题，记录从发送到末尾 token 到达的时间                   | 末 token 时间 < 15s      | P0     |
| PERF-RT-003 | Mixture 首次响应    | 4 模型并行请求          | 启用 Mixture 模式，记录第一个模型返回首 token 的时间          | 首模型首 token 时间 < 5s | P0     |
| PERF-RT-004 | 联网搜索响应        | 联网搜索开启，标准问题  | 发送需要联网搜索的问题，记录从发送到完整响应的时间            | 完整响应时间 < 8s        | P0     |
| PERF-RT-005 | 知识库检索响应      | 10 文档知识库，RAG 启用 | 发送问题，记录含 RAG 检索和 AI 回答的完整时间                 | 含 RAG 回答完成 < 5s     | P0     |
| PERF-RT-006 | 文件上传处理        | 1MB PDF 文件            | 上传文件，记录从上传开始到解析完成的时间                      | 解析完成 < 10s           | P1     |
| PERF-RT-007 | Teams 任务启动      | 4 Agent 团队，新任务    | 创建团队任务，记录从提交到首个 Agent 开始响应的时间           | 首 Agent 响应 < 5s       | P1     |
| PERF-RT-008 | Research 规划生成   | 新研究项目，标准主题    | 创建研究项目并触发规划，记录规划完成时间                      | 规划完成 < 10s           | P1     |
| PERF-RT-009 | Writing 章节生成    | 单章目标 3000 字        | 触发单章写作，记录从开始到写作完成的时间                      | 写作完成 < 60s           | P1     |
| PERF-RT-010 | Image 生成          | DALL-E 3 标准参数       | 提交图片生成请求，记录从提交到图片 URL 返回的时间             | 图片返回 < 30s           | P1     |
| PERF-RT-011 | 历史列表加载        | 100+ 条对话记录         | 进入历史列表页面，记录列表完全渲染的时间                      | 页面渲染 < 2s            | P1     |
| PERF-RT-012 | 页面初始加载        | 首次访问，无缓存        | 打开浏览器新标签页，访问首页，记录 FCP 时间                   | FCP < 3s                 | P0     |
| PERF-RT-013 | PDF 导出            | 10 页报告内容           | 触发 PDF 导出，记录从触发到文件可下载的时间                   | 文件就绪 < 30s           | P1     |
| PERF-RT-014 | DOCX 导出           | 50 页文档内容           | 触发 DOCX 导出，记录从触发到文件可下载的时间                  | 文件就绪 < 45s           | P2     |
| PERF-RT-015 | RAG 查询（HyDE）    | 复杂问题，含 Rerank     | 发送复杂问题，记录 HyDE 生成 + 检索 + Rerank + 回答的完整时间 | 含 Rerank 完成 < 8s      | P1     |
| PERF-RT-016 | 知识图谱加载        | 100+ 节点的图谱         | 打开知识图谱视图，记录从页面打开到图谱完整渲染的时间          | 图谱渲染 < 3s            | P2     |
| PERF-RT-017 | Admin 仪表板加载    | 首次加载，含统计数据    | 管理员登录后进入仪表板，记录数据就绪时间                      | 数据就绪 < 3s            | P2     |
| PERF-RT-018 | Social 平台版本生成 | 5 个平台同时适配        | 触发多平台适配生成，记录所有平台版本完成的时间                | 全部平台版本完成 < 20s   | P2     |
| PERF-RT-019 | WebSocket 连接建立  | 首次建立连接            | 刷新页面，记录 WebSocket 连接从发起到 open 事件触发的时间     | 连接建立 < 1s            | P0     |
| PERF-RT-020 | SSE 事件传输延迟    | 正常流式传输中          | 测量 SSE 事件从后端发出到前端 onmessage 回调触发的延迟        | 单事件到达延迟 < 500ms   | P0     |

### 3.2 并发能力

| 测试ID      | 场景                  | 测试条件               | 操作步骤/测量方法                                      | 预期结果                       | 优先级 |
| ----------- | --------------------- | ---------------------- | ------------------------------------------------------ | ------------------------------ | ------ |
| PERF-CC-001 | 同时发起多个 Ask 请求 | 同一用户，3 个并发请求 | 在 3 个标签页中同时发送 Ask 请求，观察各自响应情况     | 3 个请求各自正常响应，互不干扰 | P1     |
| PERF-CC-002 | Ask 与 Teams 同时运行 | 2 个模块并行使用       | 在 Ask 模块发送问题的同时启动 Teams 任务，观察两者响应 | 两个模块互不干扰，均正常完成   | P1     |
| PERF-CC-003 | 多标签页同时操作      | 3 个浏览器标签页       | 在 3 个标签页分别操作不同功能，观察是否互相影响        | 各标签页独立运行，状态互不污染 | P1     |
| PERF-CC-004 | Mixture 4 模型并行    | 4 个不同 LLM 并行调用  | 开启 Mixture 模式，发送问题，等待所有模型响应          | 4 个模型全部返回结果           | P1     |
| PERF-CC-005 | Writing 平行章节写作  | 3 章同时触发写作       | 在 Writing 模块同时触发 3 章并行写作，观察完成情况     | 3 章全部完成，内容无冲突无混淆 | P1     |
| PERF-CC-006 | Social 批量多平台发布 | 5 个目标平台           | 触发 5 个平台的内容生成，等待全部完成                  | 5 个平台全部成功生成内容       | P2     |
| PERF-CC-007 | 多用户同时操作        | 5 个不同用户账号       | 5 个用户同时登录并执行各自的 AI 任务，验证数据隔离     | 各用户数据完全隔离，互不可见   | P1     |

### 3.3 大数据量

| 测试ID      | 场景               | 测试条件                 | 操作步骤/测量方法                                   | 预期结果                     | 优先级 |
| ----------- | ------------------ | ------------------------ | --------------------------------------------------- | ---------------------------- | ------ |
| PERF-BD-001 | 大知识库 RAG 查询  | 知识库含 100+ 文档       | 在含 100+ 文档的知识库中发起 RAG 查询，记录响应时间 | RAG 查询完成时间 < 10s       | P1     |
| PERF-BD-002 | 超长对话历史浏览   | 单会话 1000+ 条消息      | 打开含 1000+ 消息的历史会话，上下滚动，观察流畅度   | 滚动流畅无卡顿，消息正确渲染 | P2     |
| PERF-BD-003 | 大文件上传处理     | 50MB PDF 文件            | 上传 50MB 的 PDF 文件，等待处理完成                 | 文件正常处理，无超时崩溃     | P2     |
| PERF-BD-004 | 大量会话列表       | 账号下 500+ 个会话       | 进入 AI Ask 历史列表，观察列表加载速度和滚动性能    | 列表加载时间 < 3s，滚动流畅  | P1     |
| PERF-BD-005 | 大型研究项目搜索   | Research 项目含 50+ 来源 | 在含 50+ 来源的研究项目中进行内部搜索，记录响应时间 | 搜索响应 < 2s                | P2     |
| PERF-BD-006 | 长篇写作项目导航   | Writing 项目含 100+ 章节 | 在含 100+ 章节的写作项目中切换章节、展开/折叠目录   | 章节导航流畅，目录渲染正常   | P2     |
| PERF-BD-007 | 大量图像历史浏览   | 图像生成历史 500+ 张     | 进入 Image 历史页面，浏览并滚动图片列表             | 图片列表加载 < 3s，滚动流畅  | P2     |
| PERF-BD-008 | Teams 大量消息处理 | 单话题 5000+ 条消息      | 打开含 5000+ 消息的 Teams 话题，测试游标分页加载    | 游标分页正常，历史消息可加载 | P2     |

### 3.4 长时间运行

| 测试ID      | 场景                 | 测试条件                 | 操作步骤/测量方法                                    | 预期结果                                   | 优先级 |
| ----------- | -------------------- | ------------------------ | ---------------------------------------------------- | ------------------------------------------ | ------ |
| PERF-LR-001 | 长时间 AI 对话       | 持续对话 30 分钟         | 在 AI Ask 中持续进行对话约 30 分钟，监控内存占用变化 | 无内存泄漏，页面保持响应正常               | P1     |
| PERF-LR-002 | WebSocket 长连接保持 | 保持连接 1 小时          | 保持页面打开 1 小时不操作，观察 WebSocket 连接状态   | 连接通过心跳保持，1 小时后仍可正常收发消息 | P1     |
| PERF-LR-003 | Writing 超长写作任务 | 50+ 章节连续写作         | 启动包含 50+ 章节的写作任务，等待任务完成或超时      | 超时保护机制生效，任务状态正确记录         | P2     |
| PERF-LR-004 | Research 深度研究    | 研究任务持续 30 分钟以上 | 启动复杂深度研究任务，期间不干预，观察进度持久化情况 | 进度不丢失，任务状态正确持久化到数据库     | P1     |
| PERF-LR-005 | 页面长时间空闲后恢复 | 页面空闲 1 小时          | 打开功能页面后，1 小时内不进行任何操作，再次操作     | 重新激活后功能正常，连接自动恢复           | P2     |

---

## Part 4: DFX 测试

### 4.1 可用性（Usability）

| 测试ID      | 场景             | 前置条件               | 操作步骤                                               | 预期结果                                     | 优先级 |
| ----------- | ---------------- | ---------------------- | ------------------------------------------------------ | -------------------------------------------- | ------ |
| DFX-USE-001 | 首次使用引导     | 新注册用户，首次登录   | 以新用户身份登录，观察引导流程，尝试完成第一次 AI 对话 | 无需阅读文档即可快速上手，引导清晰           | P1     |
| DFX-USE-002 | 主导航清晰度     | 任意已登录用户         | 观察侧边栏导航结构，确认各模块入口是否清晰可辨         | 导航结构层次分明，模块入口易于识别           | P1     |
| DFX-USE-003 | 操作状态反馈     | 所有功能页面           | 分别触发加载、成功、错误三种状态，观察 UI 反馈         | Loading/Success/Error 状态均有明确的视觉反馈 | P0     |
| DFX-USE-004 | 任务失败后可重试 | AI 任务执行失败后      | 触发任务失败（如断网），观察是否提供重试入口           | 失败后提供明确的重试按钮或操作引导           | P1     |
| DFX-USE-005 | 编辑器快捷键     | 消息输入框或内容编辑器 | 分别按 Enter 发送消息、Esc 取消操作，验证快捷键生效    | Enter 正常发送，Esc 正常取消，快捷键符合惯例 | P1     |
| DFX-USE-006 | 全局搜索体验     | 全局搜索入口           | 在搜索框输入关键词，观察是否有即时建议和关键词高亮     | 即时显示搜索建议，搜索结果中关键词有高亮     | P2     |
| DFX-USE-007 | 列表页批量操作   | 含多条记录的列表页     | 测试全选、反选、批量删除功能是否正常工作               | 全选/反选正确，批量删除成功执行              | P2     |
| DFX-USE-008 | 文件拖放上传     | 支持文件上传的功能页   | 将文件直接拖放到上传区域，观察交互效果                 | 拖放区域有明确视觉指示，拖放后文件正常上传   | P1     |
| DFX-USE-009 | 编辑操作撤销重做 | 内容编辑器             | 在编辑器中输入内容后按 Ctrl+Z 撤销、Ctrl+Y 重做        | 撤销和重做均正确生效                         | P2     |
| DFX-USE-010 | 关键功能帮助说明 | 功能复杂的模块页面     | 观察 RAG 配置、Teams 设置等复杂功能是否提供说明引导    | 关键功能旁有说明文字、Tooltip 或引导链接     | P2     |

### 4.2 可靠性（Reliability）

| 测试ID      | 场景                 | 前置条件                     | 操作步骤                                              | 预期结果                                          | 优先级 |
| ----------- | -------------------- | ---------------------------- | ----------------------------------------------------- | ------------------------------------------------- | ------ |
| DFX-REL-001 | 页面刷新后状态保持   | 任意功能页面，有未保存内容   | 在页面有活动状态时按 F5 刷新，观察状态恢复情况        | 关键状态（如当前会话）不丢失，正确恢复            | P0     |
| DFX-REL-002 | 浏览器后退按钮       | 导航至多级页面               | 点击浏览器后退按钮，观察页面状态和数据是否正确恢复    | 返回上一页时，状态正确恢复，无数据错乱            | P1     |
| DFX-REL-003 | 网络中断不白屏       | 正常使用中断开网络           | 在功能页面正常使用时，突然断开网络连接                | 页面不白屏，显示友好的网络错误提示                | P0     |
| DFX-REL-004 | API 返回 500 错误    | 后端服务异常时               | 模拟后端返回 500 错误，观察前端处理方式               | 显示友好错误提示，提供重试选项，不白屏            | P0     |
| DFX-REL-005 | 长时间空闲会话保持   | 已登录用户                   | 登录后静置 1 小时不操作，再次进行 AI 对话             | 会话不过期，无需重新登录即可继续使用              | P1     |
| DFX-REL-006 | 数据持久化验证       | 已创建对话/文档数据          | 创建对话或文档后，关闭浏览器重新打开                  | 数据完整保存，重新打开后可查看所有历史数据        | P0     |
| DFX-REL-007 | WebSocket 自动重连   | WebSocket 连接因网络波动中断 | 模拟网络波动导致 WebSocket 断线，等待自动重连         | 自动重连成功，采用指数退避策略，重连后功能正常    | P0     |
| DFX-REL-008 | SSE 中断自动重连     | 流式传输过程中断             | 模拟 SSE 连接中断，观察自动重连行为                   | 自动发起重连（最多 3 次），重连成功后继续接收数据 | P0     |
| DFX-REL-009 | 长任务中断后可恢复   | Writing/Research 任务执行中  | 在 Writing 或 Research 任务进行中关闭浏览器，重新打开 | 任务状态已持久化，可查看进度，支持继续执行        | P1     |
| DFX-REL-010 | 多标签页并发编辑保护 | 同一内容在两个标签页打开     | 在两个标签页同时编辑同一文档，观察数据处理方式        | 不发生数据覆盖丢失，有冲突提示或采用合并策略      | P1     |

### 4.3 安全性（Security）— OWASP Top 10

| 测试ID      | 场景                    | 前置条件             | 操作步骤                                                             | 预期结果                                              | 优先级 |
| ----------- | ----------------------- | -------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- | ------ |
| DFX-SEC-001 | XSS 跨站脚本防护        | 任意文本输入框       | 在消息框、标题框等输入 `<script>alert(1)</script>`，提交后观察页面   | 脚本不被执行，内容以文本形式展示或被过滤              | P0     |
| DFX-SEC-002 | SQL 注入防护            | 任意文本输入框       | 输入 `'; DROP TABLE users; --` 等 SQL 注入语句并提交                 | 参数化查询阻止注入，数据库操作正常，无异常错误        | P0     |
| DFX-SEC-003 | CSRF 跨站请求伪造防护   | 已登录用户会话       | 构造跨域请求尝试执行敏感操作（如删除账号）                           | CSRF Token 验证失败，请求被拒绝，返回 403             | P0     |
| DFX-SEC-004 | JWT 令牌过期自动刷新    | 用户 JWT 即将过期    | 等待 Access Token 即将过期，继续进行 API 请求操作                    | 系统自动用 Refresh Token 更新 JWT，用户无感知         | P0     |
| DFX-SEC-005 | 水平权限越权防护        | 用户 A 已登录        | 用户 A 尝试访问用户 B 的私有项目或资源 URL                           | 返回 403 Forbidden，无法访问他人私有资源              | P0     |
| DFX-SEC-006 | API 请求限流            | 正常登录用户         | 在极短时间内发送大量 API 请求（超过速率限制）                        | 超出限制后返回 429 Too Many Requests，附带重试提示    | P0     |
| DFX-SEC-007 | 文件上传格式校验        | 文件上传功能页       | 尝试上传 .exe、.bat、.sh 等可执行文件                                | 上传被拒绝，返回明确的格式限制错误提示                | P0     |
| DFX-SEC-008 | Admin 模型 API Key 保护 | Admin 后台模型配置页 | 查看已配置的 API Key，观察显示方式                                   | API Key 以密文（`****`）显示，不暴露明文              | P0     |
| DFX-SEC-009 | 敏感密钥加密存储        | 系统数据库存储       | 检查数据库中 API Key 等敏感字段的存储形式                            | 敏感字段以加密形式存储，不以明文存储                  | P1     |
| DFX-SEC-010 | SSRF 服务端请求伪造防护 | URL 导入功能         | 提交指向内网 IP（如 `http://127.0.0.1`、`http://192.168.x.x`）的 URL | 内网访问请求被拦截，返回错误提示                      | P1     |
| DFX-SEC-011 | 水平越权修改防护        | 用户 A 已登录        | 用户 A 尝试修改或删除用户 B 拥有的资源                               | 返回 403 Forbidden，所有者校验拦截非法操作            | P0     |
| DFX-SEC-012 | 垂直越权防护            | 普通用户已登录       | 普通用户尝试访问 `/admin/*` 路由或调用管理员专属 API                 | 返回 403 Forbidden，角色权限校验拦截                  | P0     |
| DFX-SEC-013 | API 响应敏感信息过滤    | 任意 API 接口        | 检查 API 响应体，确认是否包含内部路径、数据库信息等                  | API 响应不暴露服务器内部信息、错误堆栈、数据库细节    | P1     |
| DFX-SEC-014 | 系统日志脱敏            | 后端日志输出         | 检查系统日志，确认是否记录了密码、Token 等敏感信息                   | 日志不记录密码、完整 JWT Token、API Key 等敏感信息    | P1     |
| DFX-SEC-015 | Puppeteer 渲染安全      | PDF/图片导出功能     | 触发含有用户内容的 Puppeteer 渲染任务                                | JS 在渲染环境中被禁用，在沙箱环境中执行，防止代码注入 | P1     |

### 4.4 响应式设计

| 测试ID      | 场景             | 前置条件/分辨率             | 操作步骤                                      | 预期结果                                          | 优先级 |
| ----------- | ---------------- | --------------------------- | --------------------------------------------- | ------------------------------------------------- | ------ |
| DFX-RES-001 | 桌面宽屏显示     | 分辨率 1920×1080            | 以 1920×1080 分辨率访问所有主要页面，检查布局 | 所有页面布局正常，内容无溢出、无错位              | P0     |
| DFX-RES-002 | 桌面标准显示     | 分辨率 1366×768             | 以 1366×768 分辨率访问所有主要页面，检查布局  | 所有页面布局正常，无横向滚动条                    | P0     |
| DFX-RES-003 | 平板横向模式     | 分辨率 1024×768             | 以 1024×768 分辨率浏览各模块页面              | 页面自适应平板横向布局，功能可正常使用            | P1     |
| DFX-RES-004 | 平板竖向模式     | 分辨率 768×1024             | 以 768×1024 分辨率浏览各模块页面              | 页面自适应平板竖向布局，主要功能可用              | P1     |
| DFX-RES-005 | 手机小屏（标准） | 分辨率 375×667（iPhone SE） | 以手机分辨率访问 AI Ask 和 Explore 页面       | Ask 和 Explore 页面在手机上可正常使用，触控友好   | P2     |
| DFX-RES-006 | 手机大屏         | 分辨率 414×896（iPhone XR） | 以大屏手机分辨率访问 AI Ask 和 Explore 页面   | Ask 和 Explore 页面在大屏手机上布局正常，功能可用 | P2     |
| DFX-RES-007 | 超宽屏显示       | 分辨率 2560×1440            | 以 2560×1440 分辨率访问所有页面，检查布局     | 页面内容不过度拉伸，有最大宽度限制，布局美观      | P2     |

### 4.5 可访问性（Accessibility）

| 测试ID      | 场景             | 前置条件         | 操作步骤                                                | 预期结果                                         | 优先级 |
| ----------- | ---------------- | ---------------- | ------------------------------------------------------- | ------------------------------------------------ | ------ |
| DFX-ACC-001 | 键盘完全导航     | 不使用鼠标       | 仅使用 Tab、Enter、Space、方向键操作所有主要功能        | 所有核心功能可通过键盘完全操作                   | P2     |
| DFX-ACC-002 | 屏幕阅读器兼容性 | 配合屏幕阅读器   | 使用 VoiceOver 或 NVDA 浏览页面，检查 ARIA 属性读出情况 | 重要元素有正确的 ARIA 标签，屏幕阅读器可正确朗读 | P3     |
| DFX-ACC-003 | 颜色对比度合规   | WCAG 2.1 AA 标准 | 使用对比度检测工具检查所有文字与背景的对比度            | 正文文字对比度不低于 4.5:1，满足 WCAG 2.1 AA     | P2     |
| DFX-ACC-004 | 键盘焦点可见性   | 键盘导航状态     | 使用 Tab 键在页面间移动焦点，观察焦点指示器是否可见     | 当前焦点元素有清晰可见的高亮边框或焦点环         | P2     |
| DFX-ACC-005 | 图片替代文本     | 含图片的页面     | 检查页面中的图片元素，查看 alt 属性是否完整有意义       | 所有功能性图片有完整的 alt 属性描述              | P3     |

### 4.6 国际化（i18n）

| 测试ID      | 场景           | 前置条件              | 操作步骤                                           | 预期结果                                             | 优先级 |
| ----------- | -------------- | --------------------- | -------------------------------------------------- | ---------------------------------------------------- | ------ |
| DFX-I18-001 | 中文界面完整性 | 系统语言设置为 zh-CN  | 以中文语言设置访问所有功能页面，检查界面文字       | 所有界面文本显示为中文，无英文遗漏（技术术语除外）   | P1     |
| DFX-I18-002 | 英文界面完整性 | 系统语言设置为 en-US  | 以英文语言设置访问所有功能页面，检查界面文字       | 所有界面文本显示为英文，无中文遗漏                   | P1     |
| DFX-I18-003 | 动态语言切换   | 任意已登录用户        | 在设置中切换语言（中文↔英文），观察界面变化        | 语言即时切换生效，无需刷新页面，所有文本同步更新     | P1     |
| DFX-I18-004 | 日期格式本地化 | 中英文不同语言环境    | 在中文和英文模式下查看包含日期的内容               | 中文模式显示年月日格式，英文模式显示 MM/DD/YYYY 格式 | P2     |
| DFX-I18-005 | 多语言内容排版 | 含 CJK 和拉丁文的内容 | 在 AI 回复和内容展示中观察中文、英文、日文混排效果 | CJK 字符和拉丁字符混排时显示正常，字间距和排版美观   | P2     |

### 4.7 兼容性

| 测试ID      | 场景                  | 前置条件/浏览器版本  | 操作步骤                                             | 预期结果                                           | 优先级 |
| ----------- | --------------------- | -------------------- | ---------------------------------------------------- | -------------------------------------------------- | ------ |
| DFX-CMP-001 | Chrome 浏览器兼容     | Chrome 120+          | 在 Chrome 120+ 中测试所有主要功能                    | 全部功能正常运行，无兼容性报错                     | P0     |
| DFX-CMP-002 | Firefox 浏览器兼容    | Firefox 120+         | 在 Firefox 120+ 中测试所有主要功能                   | 全部功能正常运行，无兼容性报错                     | P1     |
| DFX-CMP-003 | Safari 浏览器兼容     | Safari 17+           | 在 Safari 17+ 中测试所有主要功能                     | 全部功能正常运行，尤其关注 SSE 和 WebSocket 兼容性 | P1     |
| DFX-CMP-004 | Edge 浏览器兼容       | Edge 120+            | 在 Edge 120+ 中测试所有主要功能                      | 全部功能正常运行，无兼容性报错                     | P1     |
| DFX-CMP-005 | iOS Safari 移动端兼容 | iOS Safari（最新版） | 在 iPhone 上使用 iOS Safari 访问 Ask 和 Explore 功能 | Ask 和 Explore 功能在 iOS Safari 上可正常使用      | P2     |

---

## Part 5: 边界条件与异常测试

### 5.1 输入边界

| 测试ID      | 场景              | 前置条件                  | 操作步骤                                                     | 预期结果                                 | 优先级 |
| ----------- | ----------------- | ------------------------- | ------------------------------------------------------------ | ---------------------------------------- | ------ |
| BND-INP-001 | 发送空消息        | AI Ask 输入框             | 不输入任何内容，直接点击发送按钮或按 Enter                   | 系统提示需要输入内容，消息不被发送       | P0     |
| BND-INP-002 | 发送超长消息      | AI Ask 输入框             | 输入 10000 字符的消息并发送                                  | 系统正常处理，或给出字符数限制提示并截断 | P1     |
| BND-INP-003 | 输入 XSS 脚本内容 | 任意文本输入框            | 输入 `<script>alert(1)</script>` 并提交/发送                 | XSS 脚本不被执行，内容以转义文本形式展示 | P0     |
| BND-INP-004 | 输入 Unicode 字符 | 任意文本输入框            | 输入 emoji、CJK 字符、阿拉伯语文字并提交                     | 所有 Unicode 字符正常保存、展示、处理    | P1     |
| BND-INP-005 | 发送纯空格消息    | AI Ask 输入框             | 输入若干空格，点击发送                                       | 系统识别为空消息，提示需要输入内容       | P0     |
| BND-INP-006 | Markdown 语法渲染 | AI 对话回复显示区         | 发送包含 `# 标题`、`**粗体**`、`` `代码` `` 的消息，观察渲染 | Markdown 语法被正确渲染，不发生注入      | P1     |
| BND-INP-007 | SQL 注入语句输入  | 任意文本输入框            | 输入 `'; DROP TABLE users; --` 并提交                        | SQL 注入无效，数据库操作正常，无数据损坏 | P0     |
| BND-INP-008 | 零宽字符输入      | 任意文本输入框            | 粘贴包含 `\u200B`（零宽空格）等零宽字符的文本并提交          | 零宽字符不影响功能正常运行，内容正常处理 | P2     |
| BND-INP-009 | 超长项目标题      | Research/Writing 项目创建 | 输入 500 字符的项目名称并保存                                | 标题被截断到限制长度，或给出字符限制提示 | P2     |
| BND-INP-010 | 重复提交（防抖）  | 任意提交按钮              | 快速连续双击发送或提交按钮                                   | 请求只被处理一次，不产生重复提交         | P1     |

### 5.2 文件边界

| 测试ID      | 场景             | 前置条件             | 操作步骤                                     | 预期结果                                   | 优先级 |
| ----------- | ---------------- | -------------------- | -------------------------------------------- | ------------------------------------------ | ------ |
| BND-FIL-001 | 上传空文件       | 文件上传功能         | 上传一个 0 字节的空文件                      | 返回友好提示，说明文件内容为空无法处理     | P1     |
| BND-FIL-002 | 上传超大文件     | 文件上传功能         | 上传大于 100MB 的文件                        | 返回文件大小超限提示，上传被拒绝           | P1     |
| BND-FIL-003 | 上传不支持格式   | 文件上传功能         | 上传 .exe、.bat 等可执行文件                 | 返回文件格式不支持的提示，上传被拒绝       | P0     |
| BND-FIL-004 | 上传损坏文件     | 文件上传功能         | 上传内容损坏的 PDF 文件（手动破坏文件头）    | 返回文件无法解析的错误提示，不导致服务崩溃 | P1     |
| BND-FIL-005 | 同时上传过多文件 | 支持多文件上传的功能 | 一次性选择 10 个以上文件同时上传             | 返回文件数量超限提示，或只处理前 N 个文件  | P2     |
| BND-FIL-006 | 重复上传同名文件 | 知识库或资源库       | 上传同一文件两次（文件名相同）               | 系统提示文件已存在，提供去重或重命名选项   | P2     |
| BND-FIL-007 | 特殊字符文件名   | 文件上传功能         | 上传文件名含中文、空格、括号等特殊字符的文件 | 文件正常上传，文件名正确保存和显示         | P1     |
| BND-FIL-008 | 超长文件名       | 文件上传功能         | 上传文件名超过 200 个字符的文件              | 文件名被截断处理，文件仍可正常上传和使用   | P2     |

### 5.3 并发与竞态

| 测试ID      | 场景                   | 前置条件                  | 操作步骤                                | 预期结果                                       | 优先级 |
| ----------- | ---------------------- | ------------------------- | --------------------------------------- | ---------------------------------------------- | ------ |
| BND-CCR-001 | 快速连续发送消息       | AI Ask 对话界面           | 在 1 秒内连续发送 3 条消息              | 消息按发送顺序依次处理，不乱序丢失             | P1     |
| BND-CCR-002 | 发送中途切换模型       | AI Ask 正在流式响应时     | 在 AI 正在流式输出时，切换到另一个模型  | 无错误或异常，当前响应妥善处理，新模型切换生效 | P1     |
| BND-CCR-003 | 取消后立即重发         | AI Ask 正在响应时         | 点击停止/取消按钮后，立即重新发送消息   | 取消操作完成，新请求正常发出并返回响应         | P1     |
| BND-CCR-004 | 多标签页同时操作       | 同一账号两个标签页        | 在两个标签页中同时向 AI Ask 发送消息    | 两个标签页各自独立处理，互不干扰               | P1     |
| BND-CCR-005 | 多用户并发编辑同一资源 | 两个用户账号              | 两个用户同时尝试编辑同一项目设置        | 采用最后写入胜出策略，或显示并发冲突提示       | P2     |
| BND-CCR-006 | 重复触发创建任务       | Research/Writing 任务创建 | 快速连续点击"开始"或"创建"按钮多次      | 任务只被创建/启动一次，重复操作被去重处理      | P1     |
| BND-CCR-007 | WebSocket 消息乱序     | WebSocket 实时通信        | 模拟网络延迟导致 WebSocket 消息乱序到达 | 消息按照消息序号正确排序后展示                 | P2     |

### 5.4 网络异常

| 测试ID      | 场景               | 前置条件           | 操作步骤                             | 预期结果                                         | 优先级 |
| ----------- | ------------------ | ------------------ | ------------------------------------ | ------------------------------------------------ | ------ |
| BND-NET-001 | 操作中断网         | 正常使用功能中     | 在执行 AI 请求时，直接断开网络连接   | 显示友好的网络错误提示，不白屏，不崩溃           | P0     |
| BND-NET-002 | 慢网络请求超时     | 网络限速至极慢速   | 在慢网络环境下发起 AI 请求，等待超时 | 显示超时提示，提供重试选项                       | P1     |
| BND-NET-003 | API 返回 500 错误  | 后端服务出现异常   | 模拟后端 API 返回 500 错误           | 前端显示友好错误提示，不显示原始错误堆栈，不白屏 | P0     |
| BND-NET-004 | 网络恢复后自动重连 | 网络中断后恢复     | 断网后等待约 30 秒，重新连接网络     | WebSocket/SSE 自动重新连接，功能恢复正常         | P0     |
| BND-NET-005 | SSE 流式传输中断   | AI 流式输出进行中  | 在 SSE 流式传输中途断开网络          | 系统自动尝试重连，网络恢复后继续接收数据         | P0     |
| BND-NET-006 | WebSocket 断线重连 | WebSocket 活跃连接 | 模拟 WebSocket 连接意外断开          | 自动按指数退避策略重连，重连成功后恢复正常通信   | P0     |
| BND-NET-007 | DNS 解析失败       | 外部 DNS 不可用    | 访问系统时模拟 DNS 解析失败          | 显示友好的网络异常提示，不显示浏览器默认错误页   | P2     |
| BND-NET-008 | 2G 慢速网络        | 网络限速至 2G 速度 | 在 2G 模拟网络下操作基本功能         | 页面仍可加载和操作，有合理的加载状态提示         | P2     |

### 5.5 权限边界

| 测试ID      | 场景                 | 前置条件           | 操作步骤                                  | 预期结果                                        | 优先级 |
| ----------- | -------------------- | ------------------ | ----------------------------------------- | ----------------------------------------------- | ------ |
| BND-PRM-001 | 未登录访问受保护页面 | 未登录状态         | 直接访问需要登录的功能页面 URL            | 自动重定向到登录页，不显示受保护内容            | P0     |
| BND-PRM-002 | JWT 令牌过期处理     | 用户 JWT 已过期    | 使用已过期的 Access Token 请求 API        | 系统自动使用 Refresh Token 更新，用户操作无感知 | P0     |
| BND-PRM-003 | 普通用户访问 Admin   | 普通用户已登录     | 尝试访问 `/admin/*` 相关页面和 API        | 返回 403 Forbidden，无法访问管理员功能          | P0     |
| BND-PRM-004 | 访问他人私有项目     | 用户 A 已登录      | 用户 A 直接访问用户 B 私有项目的 URL      | 返回 403 Forbidden，无法查看他人私有内容        | P0     |
| BND-PRM-005 | 非成员访问团队内容   | 非团队成员已登录   | 尝试访问未加入团队的 Teams 话题消息       | 无法查看团队消息，返回权限不足提示              | P1     |
| BND-PRM-006 | 删除他人资源         | 用户 A 已登录      | 用户 A 尝试调用 API 删除用户 B 拥有的资源 | 返回 403 Forbidden，所有者校验阻止非法删除      | P0     |
| BND-PRM-007 | 非成员查询知识库     | 非知识库成员已登录 | 尝试查询未授权的知识库                    | 返回 403 Forbidden，知识库查询被拒绝            | P1     |

---

## Part 6: 数据完整性测试

### 6.1 CRUD 完整性

| 测试ID      | 场景             | 前置条件              | 操作步骤                                 | 预期结果                                       | 优先级 |
| ----------- | ---------------- | --------------------- | ---------------------------------------- | ---------------------------------------------- | ------ |
| DAT-CRD-001 | 创建后立即可查   | 任意资源/项目列表     | 创建新资源或项目后，立即返回列表查看     | 新创建的内容立即出现在列表中，无需刷新         | P0     |
| DAT-CRD-002 | 更新后刷新持久化 | 任意可编辑内容        | 修改标题或内容后保存，刷新浏览器页面     | 刷新后内容仍为修改后的新值，未回滚到旧值       | P0     |
| DAT-CRD-003 | 删除后不可查     | 任意可删除资源        | 删除一条资源后，在列表和详情页查找该资源 | 被删除的资源从列表中消失，详情页返回 404       | P0     |
| DAT-CRD-004 | 软删除后可恢复   | 支持归档/软删除的内容 | 将内容归档（软删除），再执行恢复操作     | 恢复后内容完整，所有数据（消息、设置等）均保留 | P1     |
| DAT-CRD-005 | 批量删除完整性   | 列表页含多条记录      | 勾选多条记录，执行批量删除操作           | 所有被选中的记录全部删除，未选中记录保持不变   | P1     |

### 6.2 级联操作

| 测试ID      | 场景                   | 前置条件                   | 操作步骤                             | 预期结果                                         | 优先级 |
| ----------- | ---------------------- | -------------------------- | ------------------------------------ | ------------------------------------------------ | ------ |
| DAT-CAS-001 | 删除 Research 项目级联 | 含资料/笔记/输出的研究项目 | 删除一个包含完整数据的 Research 项目 | 项目关联的资料、笔记、研究输出全部被删除         | P0     |
| DAT-CAS-002 | 删除知识库级联         | 含多文档的知识库           | 删除一个包含多个文档的知识库         | 知识库关联的所有文档、向量数据全部被清除         | P0     |
| DAT-CAS-003 | 删除 Teams 话题级联    | 含消息/成员/任务的话题     | 删除一个 Teams 话题                  | 话题关联的消息记录、成员关系、任务全部删除       | P0     |
| DAT-CAS-004 | 删除 Writing 项目级联  | 含卷/章节/批注的写作项目   | 删除一个 Writing 项目                | 项目下的卷、章节、段落批注全部被删除             | P0     |
| DAT-CAS-005 | 删除用户级联处理       | 管理员权限                 | 管理员删除一个用户账号               | 用户关联数据按照预定策略（删除或匿名化）正确处理 | P1     |

### 6.3 数据一致性

| 测试ID      | 场景                   | 前置条件                         | 操作步骤                                                    | 预期结果                                         | 优先级 |
| ----------- | ---------------------- | -------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ | ------ |
| DAT-CON-001 | 跨模块引用一致性       | Research 项目引用了 Library 资源 | 查看 Research 项目中的资源引用，并在 Library 中查看同一资源 | 两处数据一致，引用关系正确反映在双方模块中       | P1     |
| DAT-CON-002 | Writing 版本链完整性   | 有多个修订版本的文档             | 查看 Writing 项目的版本历史，检查版本链                     | 版本历史完整，版本之间差异记录正确，版本链无断裂 | P1     |
| DAT-CON-003 | Admin 仪表板统计准确性 | Admin 后台仪表板                 | 对比仪表板中的用户数、对话数等统计数字与实际数据库记录      | 仪表板中显示的统计数字与实际数据库记录一致       | P1     |
| DAT-CON-004 | AI 调用积分扣减准确性  | 用户有可用积分                   | 记录操作前积分余额，执行一次 AI 调用，再次查看余额          | 积分按照正确计费规则扣减，余额计算准确无误       | P0     |
| DAT-CON-005 | 创建后搜索索引同步     | 全局搜索功能                     | 创建新资源或内容后，立即在全局搜索中搜索该内容              | 新创建的内容立即可被搜索到，搜索索引实时同步     | P1     |

---

## 测试优先级与执行计划

### P0 — 必须通过（阻断发布）

以下测试用例必须全部通过，否则阻止版本发布：

- 所有认证和权限相关测试（AUT-_、BND-PRM-_）
- AI Ask 核心对话功能测试
- 安全测试（DFX-SEC-001 至 DFX-SEC-008，含 XSS/SQL 注入/权限越权）
- WebSocket 和 SSE 连接测试（PERF-RT-019、PERF-RT-020）
- 核心页面加载性能（PERF-RT-012）
- 数据操作基础 CRUD（DAT-CRD-001 至 DAT-CRD-003）
- 网络错误不白屏（BND-NET-001、BND-NET-003）
- 级联删除完整性（DAT-CAS-001 至 DAT-CAS-004）

### P1 — 重要（影响核心体验）

以下测试用例应在发布前通过，否则记录为已知缺陷并制定修复计划：

- 各 AI 模块核心功能测试
- 跨模块集成测试
- 性能基准测试（PERF-RT-006 至 PERF-RT-015）
- 导出系统测试（PERF-RT-013）
- 可靠性测试（DFX-REL-\*）
- 数据一致性测试（DAT-CON-\*）

### P2 — 一般（可接受缺陷）

以下测试用例在发布时可存在已知缺陷，但需在下一个版本修复：

- 边界条件测试（部分 BND-\*）
- DFX 响应式/可访问性/国际化测试
- 大数据量性能测试（PERF-BD-\*）
- 浏览器兼容性测试（DFX-CMP-002 至 DFX-CMP-005）

### P3 — 低优先级（增强体验）

以下测试用例可列入后续迭代计划：

- AI 标签/推荐功能测试
- 高级搜索功能测试
- 长时间运行稳定性测试（PERF-LR-\*）
- 屏幕阅读器兼容性测试（DFX-ACC-002、DFX-ACC-005）

---

## 附录

### A. 测试 ID 编码规则

| 前缀            | 含义                 | 示例            |
| --------------- | -------------------- | --------------- |
| ASK-xxx-nnn     | AI Ask 功能测试      | ASK-MSG-001     |
| RES-xxx-nnn     | AI Research 功能测试 | RES-PRJ-001     |
| TMS-xxx-nnn     | AI Teams 功能测试    | TMS-TOP-001     |
| WRT-xxx-nnn     | AI Writing 功能测试  | WRT-PRJ-001     |
| OFC-xxx-nnn     | AI Office 功能测试   | OFC-SLD-001     |
| IMG-xxx-nnn     | AI Image 功能测试    | IMG-GEN-001     |
| SOC-xxx-nnn     | AI Social 功能测试   | SOC-CON-001     |
| LIB-xxx-nnn     | Library 功能测试     | LIB-RES-001     |
| RAG-xxx-nnn     | RAG 知识库测试       | RAG-KB-001      |
| ADM-xxx-nnn     | Admin 管理测试       | ADM-USR-001     |
| AUT-xxx-nnn     | Auth 认证测试        | AUT-REG-001     |
| EXP-xxx-nnn     | 导出系统测试         | EXP-FMT-001     |
| ITG-xxx-nnn     | 集成模块测试         | ITG-NTN-001     |
| CMB-xxx-nnn     | 模块内组合测试       | CMB-ASK-001     |
| INT-xxx-xxx-nnn | 跨模块集成测试       | INT-LIB-ASK-001 |
| E2E-nnn         | 端到端场景测试       | E2E-001         |
| PERF-xx-nnn     | 性能测试             | PERF-RT-001     |
| DFX-xxx-nnn     | DFX 质量测试         | DFX-SEC-001     |
| BND-xxx-nnn     | 边界条件测试         | BND-INP-001     |
| DAT-xxx-nnn     | 数据完整性测试       | DAT-CRD-001     |

### B. 测试环境配置

| 项目           | 值                                           |
| -------------- | -------------------------------------------- |
| 测试环境 URL   | https://genesis-ai.up.railway.app            |
| 数据库         | PostgreSQL 16                                |
| 推荐浏览器     | Chrome 120+                                  |
| 网络环境       | 正常网络 / Chrome DevTools 模拟慢速网络      |
| 性能测试工具   | Chrome DevTools Performance 面板、Lighthouse |
| 安全测试工具   | OWASP ZAP、浏览器 DevTools                   |
| 响应式测试工具 | Chrome DevTools 设备模拟器                   |
| 可访问性检测   | axe DevTools、Lighthouse Accessibility 审计  |

### C. 测试数据准备要求

| 测试类型             | 所需数据                        | 准备方式                               |
| -------------------- | ------------------------------- | -------------------------------------- |
| 性能测试（大数据量） | 100+ 文档知识库、500+ 历史会话  | 使用数据生成脚本批量创建               |
| 并发测试             | 5 个独立测试账号                | 提前注册并配置好权限                   |
| 安全测试             | 普通用户账号 + 管理员账号各一个 | 使用专用测试账号，不使用生产数据       |
| 级联删除测试         | 含完整关联数据的项目            | 测试前手动创建包含各层级数据的测试项目 |
| 跨浏览器测试         | 各浏览器安装清单                | 确保测试机器上已安装所有目标浏览器     |
