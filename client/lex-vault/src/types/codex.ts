/** Codex runtime 统一错误。 */
export type CodexAppError = {
  /** 稳定错误码，用于前端判断恢复方式。 */
  code: string;
  /** 面向用户的短标题。 */
  title: string;
  /** 详细错误信息。 */
  message: string;
  /** 是否允许用户重试。 */
  recoverable: boolean;
  /** 原始协议或系统错误上下文。 */
  details?: unknown;
};

/** Codex thread 摘要。 */
export type CodexThreadInfo = {
  /** Codex thread ID。 */
  id: string;
  /** thread 工作目录。 */
  cwd: string;
  /** 是否为临时内存会话。 */
  ephemeral: boolean;
};

/** Codex app-server 原生 thread 历史记录。 */
export type CodexThreadRecord = {
  /** Codex thread ID。 */
  id: string;
  /** thread 工作目录。 */
  cwd: string;
  /** 是否为临时内存 thread。 */
  ephemeral: boolean;
  /** 用户可见标题。 */
  title: string;
  /** thread 预览文本。 */
  preview: string;
  /** 创建时间 Unix 秒。 */
  createdAt?: number;
  /** 更新时间 Unix 秒。 */
  updatedAt?: number;
  /** app-server 原始状态。 */
  status?: unknown;
  /** app-server 原始 turn 历史。 */
  turns: unknown[];
};

/** Codex app-server 原生 thread 历史列表响应。 */
export type CodexThreadListResult = {
  /** 当前页 thread 列表。 */
  data: CodexThreadRecord[];
  /** 下一页游标。 */
  nextCursor?: string;
  /** 反向翻页游标。 */
  backwardsCursor?: string;
};

/** Codex turn 摘要。 */
export type CodexTurnInfo = {
  /** Codex turn ID。 */
  id: string;
  /** Codex thread ID。 */
  threadId: string;
  /** turn 状态。 */
  status?: string;
  /** app-server 返回的 token 用量结构。 */
  tokenUsage?: unknown;
};

/** 插件市场摘要。 */
export type CodexPluginMarketplace = {
  /** 市场名称。 */
  name: string;
  /** 市场根目录或标识路径。 */
  path: string;
  /** 市场来源地址。 */
  source: string;
  /** 当前市场中插件数量。 */
  pluginCount: number;
};

/** 插件摘要。 */
export type CodexPluginSummary = {
  /** 插件稳定 ID。 */
  id: string;
  /** UI 展示名称。 */
  name: string;
  /** 插件目录名。 */
  pluginName: string;
  /** 市场名称。 */
  marketplaceName: string;
  /** 市场路径。 */
  marketplacePath: string;
  /** 用于 turn/start 的 mention 路径。 */
  mentionPath: string;
  /** 插件说明。 */
  description: string;
  /** 插件分类。 */
  category: string;
  /** 可用性状态。 */
  availability: string;
  /** 是否已安装。 */
  installed: boolean;
  /** 是否启用。 */
  enabled: boolean;
};

/** 插件列表响应。 */
export type CodexPluginListResult = {
  /** 已发现的插件市场。 */
  marketplaces: CodexPluginMarketplace[];
  /** 当前可展示插件列表。 */
  plugins: CodexPluginSummary[];
  /** 市场加载错误。 */
  marketplaceLoadErrors: string[];
  /** 官方推荐插件 ID。 */
  featuredPluginIds: string[];
};

/** 插件 skill 摘要。 */
export type CodexPluginSkillSummary = {
  /** skill 名称。 */
  name: string;
  /** skill 说明。 */
  description: string;
  /** 当前是否启用。 */
  enabled: boolean;
};

/** 插件 app 摘要。 */
export type CodexPluginAppSummary = {
  /** app 名称。 */
  name: string;
  /** 当前是否仍需认证。 */
  needsAuth: boolean;
};

/** 单个插件详情。 */
export type CodexPluginDetails = {
  /** 插件稳定 ID。 */
  id: string;
  /** UI 展示名称。 */
  name: string;
  /** 插件目录名。 */
  pluginName: string;
  /** 市场名称。 */
  marketplaceName: string;
  /** 市场路径。 */
  marketplacePath: string;
  /** 用于 turn/start 的 mention 路径。 */
  mentionPath: string;
  /** 插件说明。 */
  description: string;
  /** 插件分类。 */
  category: string;
  /** 可用性状态。 */
  availability: string;
  /** 是否已安装。 */
  installed: boolean;
  /** 是否启用。 */
  enabled: boolean;
  /** 摘要要点。 */
  summary: string[];
  /** 自带 skills。 */
  skills: CodexPluginSkillSummary[];
  /** 自带 hooks。 */
  hooks: string[];
  /** 自带 apps。 */
  apps: CodexPluginAppSummary[];
  /** 自带 MCP servers。 */
  mcpServers: string[];
  /** 原始详情。 */
  raw?: unknown;
};

/** 插件或市场操作结果。 */
export type CodexOperationResult = {
  /** 操作结果摘要。 */
  message: string;
  /** 原始协议返回。 */
  raw: unknown;
};

/** 对话输入中的插件 mention。 */
export type CodexPluginMention = {
  /** UI 展示名称。 */
  name: string;
  /** app-server 需要的稳定插件路径。 */
  path: string;
};

/** 对话附件来源。 */
export type CodexTurnAttachmentSource = "composer" | "wechat";

/** 对话附件类型。 */
export type CodexTurnAttachmentKind = "image" | "document" | "file";

/** 发给 Rust 桥接层的结构化附件输入。 */
export type CodexTurnAttachmentInput = {
  /** 附件运行时标识，用于日志和临时文件命名。 */
  id: string;
  /** 附件文件名。 */
  name: string;
  /** 附件归一化类型。 */
  kind: CodexTurnAttachmentKind;
  /** 附件来源入口。 */
  source: CodexTurnAttachmentSource;
  /** MIME 类型。 */
  mimeType?: string;
  /** 文件大小，单位字节。 */
  size?: number;
  /** 已存在的本机绝对路径。 */
  path?: string;
  /** 已存在的远程 URL，图片可直接作为 image input。 */
  url?: string;
  /** 浏览器上传文件的原始字节。 */
  bytes?: number[];
};

/** Codex 工具调用开始摘要。 */
export type CodexToolCallInfo = {
  /** Codex thread ID。 */
  threadId: string;
  /** Codex turn ID。 */
  turnId: string;
  /** item ID。 */
  itemId?: string;
  /** item 类型。 */
  kind: string;
  /** UI 展示标题。 */
  title: string;
  /** 命令内容。 */
  command?: string;
  /** 相关路径。 */
  path?: string;
};

/** Codex 工具调用完成摘要。 */
export type CodexToolCallResult = {
  /** Codex thread ID。 */
  threadId: string;
  /** Codex turn ID。 */
  turnId: string;
  /** item ID。 */
  itemId?: string;
  /** item 类型。 */
  kind: string;
  /** 完成状态。 */
  status?: string;
  /** 输出预览。 */
  outputPreview?: string;
};

/** Codex 工具调用运行中的输出增量。 */
export type CodexToolCallDelta = {
  /** Codex thread ID。 */
  threadId: string;
  /** Codex turn ID。 */
  turnId: string;
  /** item ID。 */
  itemId?: string;
  /** item 类型。 */
  kind: string;
  /** 本次输出增量。 */
  delta: string;
};

/** Codex 处理过程文本增量。 */
export type CodexProcessDelta = {
  /** Codex thread ID。 */
  threadId: string;
  /** Codex turn ID。 */
  turnId?: string;
  /** Codex item ID，用于把同一段过程的流式增量和完成快照合并到同一个展示块。 */
  itemId?: string;
  /** reasoning 分段键，来自 summaryIndex/contentIndex，避免不同分段被错误合并。 */
  segmentKey?: string;
  /** 过程来源类型。 */
  kind: "reasoning" | "commentary";
  /** 过程文本。 */
  text: string;
  /** 是否允许 turn 完成时把这段过程文本提升为最终回答。 */
  promotableAnswer?: boolean;
  /** 是否是 item/completed 返回的完整文本快照。 */
  snapshot?: boolean;
};

/** Codex 审批请求。 */
export type CodexApprovalRequest = {
  /** 审批请求 ID。 */
  id: string;
  /** Codex thread ID。 */
  threadId: string;
  /** 操作类型。 */
  operationType: string;
  /** UI 展示标题。 */
  title: string;
  /** 命令内容。 */
  command?: string;
  /** 工具名称。 */
  toolName?: string;
  /** 相关路径列表。 */
  paths: string[];
  /** 风险等级。 */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** app-server 给出的原因。 */
  reason?: string;
  /** 原始审批参数。 */
  raw: unknown;
};

/** Codex 审批决策。 */
export type CodexApprovalDecision = "allow_once" | "allow_for_turn" | "deny";

/** 前端消费的 Codex runtime 稳定事件。 */
export type CodexUiEvent =
  | { type: "runtime_started" }
  | { type: "runtime_stopped" }
  | { type: "runtime_failed"; error: CodexAppError }
  | { type: "thread_started"; thread: CodexThreadInfo }
  | { type: "thread_history_updated"; threadId: string; cwd: string }
  | { type: "turn_started"; turn: CodexTurnInfo }
  | { type: "assistant_delta"; threadId: string; turnId?: string; itemId?: string; text: string }
  | { type: "assistant_process_delta"; item: CodexProcessDelta }
  | { type: "assistant_message_completed"; threadId: string; turnId?: string; itemId?: string; text?: string }
  | { type: "tool_started"; item: CodexToolCallInfo }
  | { type: "tool_delta"; item: CodexToolCallDelta }
  | { type: "tool_completed"; item: CodexToolCallResult }
  | { type: "approval_required"; request: CodexApprovalRequest }
  | { type: "approval_completed"; requestId: string; decision: CodexApprovalDecision }
  | { type: "turn_completed"; turn: CodexTurnInfo }
  | { type: "turn_failed"; error: CodexAppError }
  | { type: "warning"; message: string };

/** 压缩单个 Codex thread 上下文的请求。 */
export type CompactCodexThreadInput = {
  /** Codex thread ID。 */
  threadId: string;
};

/** 单个 Codex thread 的记忆模式。 */
export type CodexThreadMemoryMode = "enabled" | "disabled";

/** 律师任务启动参数。 */
export type StartLegalTurnInput = {
  /** Codex thread ID。 */
  threadId: string;
  /** 本次任务工作目录。 */
  cwd: string;
  /** 用户原始任务。 */
  userPrompt: string;
  /** 结构化附件输入，统一交给 Rust 桥接层决定如何转成 app-server UserInput。 */
  attachments?: CodexTurnAttachmentInput[];
  /** 要注入的 skill 名称；为空时按不带专项 skill 的通用对话发送。 */
  skillName?: string;
  /** 要注入的插件 mentions。 */
  pluginMentions?: CodexPluginMention[];
};
