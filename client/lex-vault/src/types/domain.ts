import type { PluginSourceGroup } from "@/utils/plugin-display";

/** 文件树节点，描述本机 casePath 或文件库中的目录与文件。 */
export type FileNode = {
  /** 文件或文件夹展示名称。 */
  name: string;
  /** 相对业务根目录的路径，用于接口读写和前端选中态。 */
  path: string;
  /** 节点类型，folder 表示目录，file 表示普通文件。 */
  type: "folder" | "file";
  /** 文件扩展名，目录节点通常为空。 */
  extension?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
  /** 后端返回的最后修改时间。 */
  modifiedAt?: string;
  /** 子节点列表，仅目录节点可能存在。 */
  children?: FileNode[];
};

/** 远程法规库分类，来自 Nginx 静态镜像 index.json。 */
export type RemoteLawCategory = {
  /** 分类展示名称，例如民法典、司法解释。 */
  name: string;
  /** 分类在远程镜像中的相对路径。 */
  path: string;
  /** 分类下的法规条目数量。 */
  count?: number;
};

/** 远程法规库目录节点，用于按服务器镜像中的真实文件夹层级浏览。 */
export type RemoteLawDirectory = {
  /** 文件夹展示名称。 */
  name: string;
  /** 文件夹在远程镜像中的相对路径，根层目录不带前导斜杠。 */
  path: string;
  /** 该文件夹及其子文件夹下的法规条目数量。 */
  count: number;
  /** 子文件夹列表。 */
  children?: RemoteLawDirectory[];
};

/** 远程法规库条目，描述可浏览和下载的单个法规文件。 */
export type RemoteLawEntry = {
  /** 法规展示名称。 */
  name: string;
  /** 法规所在分类名称。 */
  category: string;
  /** 法规文件在远程镜像和本地法规目录中的相对路径。 */
  path: string;
  /** 法规文件类型，通常来自扩展名。 */
  fileType?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
  /** 可直接下载法规正文的绝对地址。 */
  downloadUrl: string;
};

/** 远程法规库索引，前端只读取该索引，不递归扫描远程目录。 */
export type RemoteLawIndex = {
  /** 索引版本，用于后续兼容服务端生成格式。 */
  version?: string;
  /** 索引生成时间。 */
  generatedAt?: string;
  /** 法规镜像基地址。 */
  baseUrl?: string;
  /** 远程法规分类列表。 */
  categories: RemoteLawCategory[];
  /** 远程法规目录树，用于避免分类下文件过多时平铺展示。 */
  directoryTree?: RemoteLawDirectory[];
  /** 可下载法规条目列表。 */
  entries: RemoteLawEntry[];
  /** 本次索引是否来自本机缓存。 */
  cached?: boolean;
  /** 本机缓存写入时间，毫秒时间戳字符串。 */
  cachedAt?: string;
};

/** 远程法规下载结果，返回最终写入本地法规目录的相对路径。 */
export type RemoteLawDownloadResult = {
  /** 下载后实际落盘的相对路径，重名时可能自动追加序号。 */
  path: string;
};

/** 远程法规索引读取结果，由 Tauri 命令返回 JSON 原文。 */
export type RemoteLawIndexPayload = {
  /** 远程 index.json 原始内容。 */
  content: string;
  /** 本次返回是否直接来自本机缓存。 */
  cached: boolean;
  /** 本机缓存写入时间，毫秒时间戳字符串。 */
  cachedAt?: string;
};
/** 一级导航键，直接对应左侧工作区入口。 */
export type NavKey = "对话" | "案件" | "日历" | "模板" | "法规" | "案例" | "工具" | "插件" | "设置";

/** 律师日历事件类型。 */
export type CalendarEventType = "COURT_HEARING" | "DEADLINE" | "MEETING" | "FOLLOW_UP" | "TASK_DUE";

/** 日历事件状态。 */
export type CalendarEventStatus = "SCHEDULED" | "DONE" | "CANCELLED";

/** 日历事件来源类型。 */
export type CalendarEventSourceType = "MANUAL" | "AI_CREATED" | "AI_UPDATED" | "TEMPLATE";

/** 周期日程规则状态。 */
export type RecurringCalendarRuleStatus = "ACTIVE" | "PAUSED";

/** 周期日程提醒渠道。 */
export type RecurringCalendarChannel = "DESKTOP" | "WECHAT_SELF";

/** 日历提醒规则。 */
export type CalendarReminderRule = {
  /** 提前提醒的分钟数。 */
  offsetMinutes: number;
  /** 提醒渠道。 */
  channel: RecurringCalendarChannel;
};

/** 律师日历事件记录。 */
export type CalendarEventRecord = {
  /** 事件唯一标识。 */
  id: string;
  /** 事件标题。 */
  title: string;
  /** 事件补充说明。 */
  description: string;
  /** 事件类型。 */
  eventType: CalendarEventType;
  /** 开始时间，ISO-8601 字符串。 */
  startAt: string;
  /** 结束时间，ISO-8601 字符串。 */
  endAt: string;
  /** 是否为全天事项。 */
  allDay: boolean;
  /** 时区标识。 */
  timezone: string;
  /** 当前状态。 */
  status: CalendarEventStatus;
  /** 优先级，值越高越紧急。 */
  priority: number;
  /** 关联案件 ID。 */
  caseId: string;
  /** 创建时快照下来的案件目录。 */
  casePathSnapshot: string;
  /** 负责人展示标签。 */
  ownerUserLabel: string;
  /** 参与人展示标签。 */
  participantLabels: string[];
  /** 来源类型。 */
  sourceType: CalendarEventSourceType;
  /** 原始文本快照。 */
  sourceTextSnapshot: string;
  /** 外部提供方标识，首期预留。 */
  externalProvider: string;
  /** 外部事件 ID，首期预留。 */
  externalEventId: string;
  /** 提醒规则列表。 */
  reminders: CalendarReminderRule[];
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
  /** 是否已逾期。 */
  isOverdue: boolean;
  /** 是否今天到期。 */
  isDueToday: boolean;
  /** 是否未来七天内即将到期。 */
  isUpcoming: boolean;
};

/** 周期日程规则记录。 */
export type RecurringCalendarRule = {
  /** 规则唯一标识。 */
  id: string;
  /** 规则标题。 */
  title: string;
  /** 用户原始自然语言描述。 */
  originalText: string;
  /** 5 字段 cron 表达式。 */
  cron: string;
  /** 时区标识。 */
  timezone: string;
  /** 展示到日历上的事项类型。 */
  eventType: CalendarEventType;
  /** 到点后发送的提醒正文。 */
  message: string;
  /** 提醒渠道。 */
  channels: RecurringCalendarChannel[];
  /** 规则状态。 */
  status: RecurringCalendarRuleStatus;
  /** 生效起点。 */
  startAt: string;
  /** 生效终点；空字符串表示长期有效。 */
  endAt: string;
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 负责人展示标签。 */
  ownerUserLabel: string;
  /** 来源类型。 */
  sourceType: CalendarEventSourceType;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
};

/** 周期日程执行点，由规则按查询范围动态展开。 */
export type RecurringCalendarOccurrence = {
  /** 执行点稳定标识。 */
  id: string;
  /** 所属规则 ID。 */
  ruleId: string;
  /** 规则标题。 */
  title: string;
  /** 展示到日历上的事项类型。 */
  eventType: CalendarEventType;
  /** 执行时间。 */
  scheduledAt: string;
  /** 日历开始时间。 */
  startAt: string;
  /** 日历结束时间。 */
  endAt: string;
  /** 时区标识。 */
  timezone: string;
  /** 到点后发送的提醒正文。 */
  message: string;
  /** 提醒渠道。 */
  channels: RecurringCalendarChannel[];
  /** 已触发投递的渠道。 */
  deliveredChannels: RecurringCalendarChannel[];
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 负责人展示标签。 */
  ownerUserLabel: string;
  /** 来源类型。 */
  sourceType: CalendarEventSourceType;
  /** 所属规则快照。 */
  rule: RecurringCalendarRule;
};

/** 日历聚合项：普通事项或周期执行点。 */
export type CalendarScheduleItem =
  | {
      itemType: "EVENT";
      event: CalendarEventRecord;
      occurrence?: null;
    }
  | {
      itemType: "RECURRING_OCCURRENCE";
      event?: null;
      occurrence: RecurringCalendarOccurrence;
    };

/** 日历列表筛选条件。 */
export type CalendarEventQuery = {
  /** 起始时间下界。 */
  startAtFrom?: string;
  /** 起始时间上界。 */
  startAtTo?: string;
  /** 关联案件 ID。 */
  caseId?: string;
  /** 事件类型过滤。 */
  eventTypes?: CalendarEventType[];
  /** 状态过滤。 */
  statuses?: CalendarEventStatus[];
  /** 关键字。 */
  keyword?: string;
};

/** 日程视图按天分组的聚合结果。 */
export type CalendarAgendaDay = {
  /** 日期键，格式为 YYYY-MM-DD。 */
  day: string;
  /** 当天事件列表。 */
  events: CalendarEventRecord[];
};

/** 截止事项模板。 */
export type CalendarTemplateRecord = {
  /** 模板唯一标识。 */
  id: string;
  /** 模板名称。 */
  name: string;
  /** 模板说明。 */
  description: string;
  /** 模板生成的事件类型。 */
  eventType: CalendarEventType;
  /** 默认标题。 */
  defaultTitle: string;
  /** 相对 anchor 的天偏移。 */
  relativeDays: number;
  /** 相对 anchor 的分钟偏移。 */
  relativeMinutes: number;
  /** 是否默认全天。 */
  allDay: boolean;
  /** 默认优先级。 */
  priority: number;
  /** 默认提醒偏移分钟数。 */
  reminderOffsets: number[];
};

/** 冲突查询条件。 */
export type CalendarConflictQuery = {
  /** 事件开始时间。 */
  startAt: string;
  /** 事件结束时间。 */
  endAt?: string;
  /** 关联案件 ID。 */
  caseId?: string;
  /** 编辑时排除自身事件 ID。 */
  excludeEventId?: string;
};

/** 案件默认计费设置。 */
export type BillingCaseSetting = {
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 币种编码，首版固定为 CNY。 */
  currencyCode: string;
  /** 案件默认小时费率，单位元/小时。 */
  defaultHourlyRate: number;
  /** 最后更新时间。 */
  updatedAt: string;
};

/** 工时记录。 */
export type BillingTimeEntry = {
  /** 工时记录唯一标识。 */
  id: string;
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 工作日期，格式 YYYY-MM-DD。 */
  workDate: string;
  /** 事项说明。 */
  description: string;
  /** 时长，单位分钟。 */
  durationMinutes: number;
  /** 本条工时使用的小时费率。 */
  hourlyRate: number;
  /** 本条工时应收金额。 */
  amount: number;
  /** 经办人标签。 */
  ownerUserLabel: string;
  /** 是否可计费。 */
  billable: boolean;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
};

/** 费用记录。 */
export type BillingExpenseEntry = {
  /** 费用记录唯一标识。 */
  id: string;
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 费用日期，格式 YYYY-MM-DD。 */
  expenseDate: string;
  /** 费用分类。 */
  category: string;
  /** 金额。 */
  amount: number;
  /** 备注说明。 */
  note: string;
  /** 创建时间。 */
  createdAt: string;
  /** 更新时间。 */
  updatedAt: string;
};

/** 案件维度工时计费汇总。 */
export type BillingCaseSummary = {
  /** 关联案件 ID。 */
  caseId: string;
  /** 案件名称快照。 */
  caseNameSnapshot: string;
  /** 案件目录快照。 */
  casePathSnapshot: string;
  /** 币种编码。 */
  currencyCode: string;
  /** 默认小时费率。 */
  defaultHourlyRate: number;
  /** 累计工时，单位分钟。 */
  totalDurationMinutes: number;
  /** 工时应收合计。 */
  timeAmount: number;
  /** 费用合计。 */
  expenseAmount: number;
  /** 总额。 */
  totalAmount: number;
  /** 工时记录条数。 */
  timeEntryCount: number;
  /** 费用记录条数。 */
  expenseEntryCount: number;
};

/** 本机文件库类型，对应配置中的模板、法规和案例目录。 */
export type LibraryKey = "templates" | "laws" | "cases";

/** 会话列表摘要。 */
export type ChatSessionSummary = {
  /** 会话唯一标识。 */
  id: string;
  /** 会话标题。 */
  title: string;
  /** 会话预览文本。 */
  preview: string;
  /** 列表展示时间。 */
  time: string;
  /** Agent 类型，default 表示普通对话，case 表示案件对话。 */
  agentType?: "default" | "case";
  /** 会话绑定目录，案件对话为案件材料目录，普通对话为工作空间根目录。 */
  casePath?: string;
  /** Codex thread ID，用于后续恢复 thread。 */
  threadId?: string;
  /** 会话最新修改时间，历史列表默认按该时间倒序排列。 */
  updatedAt?: string;
  /** 会话创建时间，更新时间缺失时作为回退排序和展示时间。 */
  createdAt?: string;
};

/** 对话可选技能，前端用于展示并向 Codex turn 注入对应 skill。 */
export type ChatSkillOption = {
  /** Codex skill 目录名，也是发送给后端的稳定标识。 */
  name: string;
  /** 用户可见技能名称。 */
  label: string;
  /** 技能适用场景说明，用于下拉列表辅助识别。 */
  description: string;
};

/** 对话里可选的插件项，用于在发送时注入 Codex plugin mention。 */
export type ChatPluginOption = {
  /** 插件稳定 ID。 */
  id: string;
  /** 插件展示名称。 */
  name: string;
  /** `turn/start` 需要的 mention 路径。 */
  mentionPath: string;
  /** 插件简短说明。 */
  description: string;
  /** 插件所属市场名称。 */
  marketplaceName: string;
  /** 插件来源分组，供界面按“自定义 / 系统预装”分类展示。 */
  sourceGroup: PluginSourceGroup;
};

/** 对话响应中的工具调用过程。 */
export type ChatToolCall = {
  /** 工具调用在前端的稳定标识。 */
  id: string;
  /** 工具展示名称。 */
  name: string;
  /** 工具归一化类型，用于区分命令、文件变更、MCP 或动态工具。 */
  kind?: string;
  /** 工具当前状态，running 表示执行中，complete 表示完成，error 表示失败。 */
  status: "running" | "complete" | "error";
  /** 工具命令内容或主要输入。 */
  command?: string;
  /** 工具关联路径。 */
  path?: string;
  /** 工具完成后的输出预览。 */
  outputPreview?: string;
};

/** 同一条 assistant 回复中的有序处理过程项，用于按 Codex item 顺序复现历史和实时过程。 */
export type ChatProcessItem = {
  /** 过程项在前端的稳定标识。 */
  id: string;
  /** 过程项类型，text 表示模型过程说明，tool 表示工具或命令生命周期。 */
  type: "text" | "tool";
  /** 过程项排序序号，数值越小越靠前。 */
  order: number;
  /** 过程说明文本，主要来自 commentary 或非最终 agentMessage。 */
  text?: string;
  /** turn 完成时是否允许把这段过程文字提升为折叠框外的最终答案。 */
  promotableAnswer?: boolean;
  /** 工具过程详情。 */
  toolCall?: ChatToolCall;
};

/** 同一条 assistant 回复的过程展示元数据。 */
export type ChatProcessMeta = {
  /** 本轮处理开始时间，用于计算耗时。 */
  startedAt?: string;
  /** 本轮处理完成时间，用于在折叠标题中展示已处理耗时。 */
  completedAt?: string;
  /** 本轮处理耗时，单位毫秒。 */
  durationMs?: number;
};

/** 用户随问题一起粘贴或选择的附件摘要，用于对话区展示和历史保存。 */
export type ChatAttachment = {
  /** 附件在前端运行时的稳定标识。 */
  id: string;
  /** 附件文件名。 */
  name: string;
  /** 附件类型，image 表示图片，document 表示文档或文本文件，file 表示其他文件。 */
  type: "image" | "document" | "file" | string;
  /** 浏览器识别到的 MIME 类型。 */
  contentType?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
  /** 本机绝对路径，用于把案件材料作为 Codex 可读取的上下文地址发送。 */
  path?: string;
  /** 远程图片等可直接访问的 URL。 */
  url?: string;
  /** 前端运行期生成的缩略图地址，仅用于当前界面预览，不作为模型输入正文持久化。 */
  thumbnailUrl?: string;
  /** 本机路径所属根目录，用于右侧预览和系统打开时复用文件命令边界校验。 */
  rootPath?: string;
  /** 相对案件目录的路径，用于界面展示和让模型理解材料在案件内的位置。 */
  relativePath?: string;
  /** 路径指向的节点类型，folder 表示目录，file 表示普通文件。 */
  nodeType?: "folder" | "file";
  /** 附件或引用来源标签，例如案件材料、模板、法规或案例。 */
  sourceLabel?: string;
};

/** 前端统一消息结构。 */
export type ChatMessage = {
  /** 前端消息标识。 */
  id: string;
  /** 前端归一化后的消息角色。 */
  role: "user" | "assistant" | "tool" | "error";
  /** 后端 Codex turn 标识，用于把同一次回答的流式增量合并到同一个响应块。 */
  turnId?: string;
  /** assistant 正文分段，按 Codex agentMessage itemId 维护，避免同一 turn 多段正文互相覆盖。 */
  assistantTextSegments?: ChatTextSegment[];
  /** 消息内容。 */
  content: string;
  /** 用户消息携带的附件摘要，只用于界面展示和历史回填。 */
  attachments?: ChatAttachment[];
  /** assistant 运行中的过程说明，完成后会折叠到处理过程内。 */
  processText?: string;
  /** assistant 同一响应框内的有序过程项，历史打开和实时对话共用该结构。 */
  processItems?: ChatProcessItem[];
  /** assistant 回复过程元数据，包含开始、完成和耗时。 */
  processMeta?: ChatProcessMeta;
  /** 消息创建时间。 */
  createdAt: string;
  /** 同一轮 assistant 回复中的工具执行过程，最终会在响应框顶部折叠展示。 */
  toolCalls?: ChatToolCall[];
  /** 工具展示名称。 */
  toolName?: string;
  /** 工具调用标识。 */
  toolId?: string;
  /** 工具归一化类型，用于区分命令、文件变更、MCP 或动态工具。 */
  toolKind?: string;
  /** 工具当前状态，running 表示执行中，complete 表示完成，error 表示失败。 */
  toolStatus?: "running" | "complete" | "error";
  /** 工具命令内容或主要输入。 */
  command?: string;
  /** 工具关联路径。 */
  path?: string;
  /** 工具完成后的输出预览。 */
  outputPreview?: string;
};

/** assistant 正文片段，用于在同一响应框内维护多个 agentMessage item 的稳定顺序。 */
export type ChatTextSegment = {
  /** 片段稳定标识，优先使用 Codex agentMessage itemId。 */
  id: string;
  /** 片段顺序，首次出现后保持稳定。 */
  order: number;
  /** 当前片段文本。 */
  text: string;
};

/** 案件索引记录。 */
export type CaseRecord = {
  /** 案件唯一标识。 */
  id: string;
  /** 案件名称。 */
  name: string;
  /** 案件材料目录绝对路径。 */
  casePath: string;
  /** 案件创建时间。 */
  createdAt?: string;
  /** 案件更新时间。 */
  updatedAt?: string;
};

/** 本机应用配置。 */
export type AppConfig = {
  /** 当前用户选择的业务工作空间根目录。 */
  workspaceRoot: string;
  /** 用户级配置 SQLite 数据库路径，保存应用配置和认证信息。 */
  userConfigDatabase: string;
  /** 当前工作空间级 SQLite 数据库路径，保存当前工作空间的数据索引和可修改目录配置。 */
  workspaceDatabase: string;
  /** 文书模板目录路径，默认是 workspaceRoot 下的 doc，可在设置页修改。 */
  docTemplate: string;
  /** 法规资料目录路径，默认是 workspaceRoot 下的 law，可在设置页修改。 */
  lawDirectory: string;
  /** 案例资料目录路径，默认是 workspaceRoot 下的 case，可在设置页修改。 */
  caseRef: string;
  /** 案件存储根目录路径，默认是 workspaceRoot 下的 master，可在设置页修改。 */
  caseMaster: string;
};

/** 本机保存的 law-admin 登录会话。 */
export type AuthInfo = {
  /** 登录用户名。 */
  username: string;
  /** law-admin 返回的 access_token，后续作为 API token 使用。 */
  accessToken: string;
};

/** law-admin 当前登录用户所属角色摘要。 */
export type UserRoleInfo = {
  /** 角色 ID。 */
  roleId?: string;
  /** 角色名称，用于设置页展示。 */
  roleName?: string;
  /** 角色权限标识。 */
  roleKey?: string;
};

/** law-admin 当前登录用户基础信息。 */
export type UserProfileInfo = {
  /** 用户 ID。 */
  userId?: string;
  /** 租户 ID。 */
  tenantId?: string;
  /** 部门 ID。 */
  deptId?: number;
  /** 登录用户名。 */
  userName?: string;
  /** 用户昵称。 */
  nickName?: string;
  /** 用户类型。 */
  userType?: string;
  /** 邮箱地址。 */
  email?: string;
  /** 脱敏手机号。 */
  phonenumber?: string;
  /** 性别编码，保持后端原始字典值。 */
  sex?: string;
  /** 头像地址。 */
  avatar?: string | null;
  /** 账号状态编码。 */
  status?: string;
  /** 最近登录 IP。 */
  loginIp?: string;
  /** 最近登录时间。 */
  loginDate?: string;
  /** 备注信息。 */
  remark?: string;
  /** 账号创建时间。 */
  createTime?: string;
  /** 部门名称。 */
  deptName?: string;
  /** 用户角色列表。 */
  roles?: UserRoleInfo[];
};

/** 当前登录用户的 AI 套餐与额度摘要。 */
export type UserPackageSummary = {
  /** 当前绑定套餐编码。 */
  packageCode?: string;
  /** 当前绑定套餐名称。 */
  packageName?: string;
  /** 最近 5 小时额度百分比，后端按百分比返回时优先使用。 */
  fiveHourQuotaPercent?: number | string;
  /** 最近 7 天额度百分比，后端按百分比返回时优先使用。 */
  weeklyQuotaPercent?: number | string;
  /** 当前自然月额度百分比，后端按百分比返回时优先使用。 */
  monthlyQuotaPercent?: number | string;
};

/** 文件内容预览结构。 */
export type FileContent = {
  /** 文件名称。 */
  name: string;
  /** 文件相对路径。 */
  path: string;
  /** 文件扩展名。 */
  extension?: string;
  /** 文件大小，单位为字节。 */
  size?: number;
  /** 后端判定的预览类型，前端按该类型决定展示方式。 */
  previewKind: "text" | "markdown" | "image" | "pdf" | "audio" | "video" | "archive" | "docx" | "external";
  /** 是否为可直接预览的文本文件。 */
  text: boolean;
  /** 可通过 Tauri asset protocol 读取的真实文件路径。 */
  assetPath?: string;
  /** 文本文件内容。 */
  content?: string;
  /** 当前只能走系统默认程序打开时的原因说明。 */
  externalReason?: string;
  /** 本次预览实际使用的转换器类型。 */
  converter: "docx-preview" | "none";
};

/** 会话绑定的后端 Agent 上下文。 */
export type SessionContext = {
  /** Agent 类型，default 表示普通对话，case 表示案件对话。 */
  agentType: "default" | "case";
  /** 对话绑定的路径；普通对话为工作空间根目录，案件对话为案件材料目录。 */
  casePath: string;
};

/** UI 色调模式，system 表示跟随操作系统当前偏好。 */
export type ThemeMode = "light" | "dark" | "system";

/** 前端消费的更新状态枚举。 */
export type AppUpdaterStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "check-failed"
  | "download-failed"
  | "ready-to-restart";

/** 设置页展示的版本信息。 */
export type AppVersionInfo = {
  /** 当前应用版本号。 */
  currentVersion: string;
};

/** 前端统一消费的更新状态。 */
export type AppUpdaterState = {
  /** 当前更新状态。 */
  status: AppUpdaterStatus;
  /** 当前状态对应的中文文案。 */
  statusText: string;
  /** 当前应用版本号。 */
  currentVersion?: string;
  /** 检测到的新版本号。 */
  nextVersion?: string;
  /** 新版本发布日期。 */
  releaseDate?: string;
  /** 新版本说明。 */
  releaseNotes?: string;
  /** 当前已下载字节数。 */
  downloadedBytes?: number;
  /** 下载总字节数。 */
  totalBytes?: number;
  /** 最近一次更新失败原因。 */
  errorMessage?: string;
  /** 是否来自静默检查，用于避免重复打断用户。 */
  silent?: boolean;
};

/** 前端消费的 runtime 安装状态枚举。 */
export type AppRuntimeBundleStatus =
  | "idle"
  | "required"
  | "downloading"
  | "extracting"
  | "ready"
  | "failed";

/** 前端统一消费的 runtime 安装状态。 */
export type AppRuntimeBundleState = {
  /** 当前安装状态。 */
  status: AppRuntimeBundleStatus;
  /** 当前状态对应的中文文案。 */
  statusText: string;
  /** 当前步骤已完成进度。 */
  stepCurrent?: number;
  /** 当前步骤总进度。 */
  stepTotal?: number;
  /** 当前已下载字节数。 */
  downloadedBytes?: number;
  /** 需要下载的总字节数。 */
  totalBytes?: number;
  /** 最近一次失败原因。 */
  errorMessage?: string;
};

/** 文件管理导入进度状态。 */
export type AppFileImportState = {
  /** 当前是否正在展示导入进度弹框。 */
  visible: boolean;
  /** 当前导入状态。 */
  status: "running" | "success" | "failed";
  /** 当前导入来源标签，例如模板、法规、案例或案件材料。 */
  sourceLabel: string;
  /** 当前导入目标目录。 */
  targetLabel: string;
  /** 正在处理的外部路径。 */
  currentPath?: string;
  /** 已完成数量。 */
  completedCount: number;
  /** 总数量。 */
  totalCount: number;
  /** 已成功导入的目标相对路径。 */
  importedPaths: string[];
  /** 导入失败项。 */
  failedItems: Array<{
    sourcePath: string;
    reason: string;
  }>;
};

