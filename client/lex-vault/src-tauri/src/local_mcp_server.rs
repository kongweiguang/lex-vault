//! Lex Vault 本地能力 MCP server。
//!
//! @author kongweiguang

use std::{
    net::{SocketAddr, TcpListener as StdTcpListener},
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
};

use axum::Router;
use rmcp::{
    handler::server::wrapper::Parameters,
    schemars::JsonSchema,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData, ServerHandler,
};
use serde::Deserialize;
use serde_json::json;
use tokio_util::sync::CancellationToken;

use crate::commands::local_data::calendar::{
    apply_calendar_template, complete_calendar_event, create_calendar_event,
    create_recurring_calendar_rule, delete_calendar_event, initialize_calendar_store,
    list_calendar_agenda, list_calendar_events, list_calendar_templates,
    preview_recurring_calendar_rule, search_calendar_conflicts, update_calendar_event,
    ApplyCalendarTemplateInput, CompleteCalendarEventInput, CreateCalendarEventInput,
    CreateRecurringCalendarRuleInput, ListCalendarEventsQuery, PreviewRecurringCalendarRuleInput,
    SearchCalendarConflictsQuery, UpdateCalendarEventInput,
};

/// 本地 MCP server 仅监听回环地址，避免暴露到局域网。
const LOCAL_MCP_BIND_HOST: &str = "127.0.0.1";
/// 本地 MCP server 默认优先尝试的端口。
const LOCAL_MCP_PREFERRED_PORT: u16 = 3945;
/// 端口冲突时最多继续向后探测的端口数量。
const LOCAL_MCP_PORT_SCAN_LIMIT: u16 = 32;
/// Streamable HTTP MCP 挂载路径。
const LOCAL_MCP_ROUTE_PATH: &str = "/mcp";

/// 桌面端内嵌本地 MCP server 的运行状态。
#[derive(Default)]
pub struct LocalMcpRuntimeState {
    /// 已启动的 HTTP server 句柄；只允许启动一次。
    runtime: Mutex<Option<EmbeddedLocalMcpRuntime>>,
    /// 当前工作空间数据库路径；未配置工作空间时为空。
    database: Arc<RwLock<Option<PathBuf>>>,
    /// 当前已经绑定成功的 MCP URL，供 app-server 写入配置。
    server_url: Arc<RwLock<Option<String>>>,
}

/// 已启动的内嵌 MCP server 进程内句柄。
struct EmbeddedLocalMcpRuntime {
    /// 实际监听地址，便于排查端口占用问题。
    bind_address: SocketAddr,
    /// 优雅停止 token；当前主要在桌面进程退出时随进程释放。
    _shutdown_token: CancellationToken,
}

impl LocalMcpRuntimeState {
    /// 确保本地 MCP server 已启动，并同步当前工作空间数据库路径。
    pub fn ensure_started(&self, workspace_database: Option<PathBuf>) -> Result<String, String> {
        self.update_workspace_database(workspace_database)?;

        if let Some(url) = self.current_server_url() {
            return Ok(url);
        }

        let mut runtime_guard = self
            .runtime
            .lock()
            .map_err(|_| "读取本地 MCP server 状态失败".to_string())?;
        if runtime_guard.is_none() {
            let (listener, bind_address) = bind_available_local_mcp_std_listener_from(
                LOCAL_MCP_BIND_HOST,
                LOCAL_MCP_PREFERRED_PORT,
                LOCAL_MCP_PORT_SCAN_LIMIT,
            )?;
            let shutdown_token = CancellationToken::new();
            let database = self.database.clone();
            let service: StreamableHttpService<LocalMcpServer, LocalSessionManager> =
                StreamableHttpService::new(
                    move || Ok(LocalMcpServer::new(database.clone())),
                    Default::default(),
                    StreamableHttpServerConfig::default()
                        .with_sse_keep_alive(None)
                        .with_cancellation_token(shutdown_token.child_token()),
                );
            let router = Router::new().nest_service(LOCAL_MCP_ROUTE_PATH, service);
            tauri::async_runtime::spawn({
                let shutdown_token = shutdown_token.clone();
                async move {
                    let listener = match tokio::net::TcpListener::from_std(listener) {
                        Ok(listener) => listener,
                        Err(_) => return,
                    };
                    let _ = axum::serve(listener, router)
                        .with_graceful_shutdown(async move {
                            shutdown_token.cancelled_owned().await;
                        })
                        .await;
                }
            });
            let url = build_local_mcp_server_url(bind_address);
            *self
                .server_url
                .write()
                .map_err(|_| "写入本地 MCP server URL 失败".to_string())? = Some(url.clone());
            *runtime_guard = Some(EmbeddedLocalMcpRuntime {
                bind_address,
                _shutdown_token: shutdown_token,
            });
            return Ok(url);
        }

        let runtime = runtime_guard
            .as_ref()
            .ok_or_else(|| "本地 MCP server 未启动".to_string())?;
        let url = build_local_mcp_server_url(runtime.bind_address);
        *self
            .server_url
            .write()
            .map_err(|_| "写入本地 MCP server URL 失败".to_string())? = Some(url.clone());
        Ok(url)
    }

    /// 根据当前配置更新工作空间数据库路径。
    pub fn update_workspace_database(
        &self,
        workspace_database: Option<PathBuf>,
    ) -> Result<(), String> {
        let normalized = workspace_database.and_then(|path| {
            if path.as_os_str().is_empty() {
                None
            } else {
                Some(path)
            }
        });
        if let Some(path) = normalized.as_ref() {
            initialize_calendar_store(path)?;
        }
        *self
            .database
            .write()
            .map_err(|_| "更新本地 MCP 工作空间数据库失败".to_string())? = normalized;
        Ok(())
    }

    /// 返回当前本地 MCP server URL；若尚未启动则返回空。
    pub fn current_server_url(&self) -> Option<String> {
        self.server_url.read().ok().and_then(|value| value.clone())
    }
}

/// 基于 rmcp 暴露本地能力工具的服务实例。
#[derive(Debug, Clone)]
struct LocalMcpServer {
    /// 当前工作空间级 SQLite 数据库路径；允许在设置变更后动态切换。
    database: Arc<RwLock<Option<PathBuf>>>,
}

/// 查询日历事项的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarListEventsArgs {
    /// 起始时间下界。
    start_at_from: Option<String>,
    /// 起始时间上界。
    start_at_to: Option<String>,
    /// 关联案件 ID。
    case_id: Option<String>,
    /// 事件类型过滤。
    event_types: Option<Vec<String>>,
    /// 状态过滤。
    statuses: Option<Vec<String>>,
    /// 关键字。
    keyword: Option<String>,
}

/// 查询未来日程概览的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarAgendaArgs {
    /// 关联案件 ID；为空时返回全部事项。
    case_id: Option<String>,
}

/// 创建事项的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarCreateEventArgs {
    /// 事件标题。建议直接写用户想看到的事项名，例如“去洪山法院”“提交答辩状”“回访当事人”。
    title: String,
    /// 事件补充说明。可为空；适合补充地点、材料、案号、联系人或备注。
    description: Option<String>,
    /// 事件类型。可省略，默认 `FOLLOW_UP`。支持 `COURT_HEARING`、`DEADLINE`、`MEETING`、`FOLLOW_UP`、`TASK_DUE`。
    #[serde(default = "default_calendar_event_type_arg")]
    event_type: CalendarEventTypeArg,
    /// 开始时间。支持 RFC3339，或 `YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss` 本地时间格式。
    start_at: String,
    /// 结束时间。可省略；省略时默认等于 `startAt`。
    end_at: Option<String>,
    /// 是否为全天事项。可省略，默认 `false`。
    #[serde(default)]
    all_day: bool,
    /// 时区标识。可省略，默认 `Asia/Shanghai`。
    #[serde(default = "default_calendar_timezone")]
    timezone: String,
    /// 当前状态。可省略，默认 `SCHEDULED`。
    #[serde(default = "default_calendar_status_arg")]
    status: CalendarEventStatusArg,
    /// 优先级。可省略，默认 `0`；越大表示越重要。普通跟进建议 `0`，临近开庭或硬截止日可用更高值。
    #[serde(default)]
    priority: i32,
    /// 关联案件 ID。通常可省略；如果来自案件会话，系统会优先结合案件目录快照自动归档到当前案件。
    case_id: Option<String>,
    /// 案件目录快照。来自案件会话时建议携带；通常是当前案件目录绝对路径。
    case_path_snapshot: Option<String>,
    /// 负责人展示标签。可为空；例如“我”“张律师”。
    owner_user_label: Option<String>,
    /// 参与人展示标签集合。可为空；例如 `["当事人","助理"]`。
    participant_labels: Option<Vec<String>>,
    /// 原始文本快照。可为空；通常直接写用户原话，便于后续审计回看。
    source_text_snapshot: Option<String>,
    /// 外部提供方标识。当前本地日历通常不需要传。
    external_provider: Option<String>,
    /// 外部事件 ID。当前本地日历通常不需要传。
    external_event_id: Option<String>,
    /// 提醒规则列表。可省略。推荐传 `[{ "offsetMinutes": 30 }]`；也兼容 `[30]`。未特殊说明渠道时，会自动同时写入桌面通知和微信自提醒。
    reminders: Option<Vec<CalendarReminderArg>>,
    /// 来源类型；为空时自动标记为 AI_CREATED。
    source_type: Option<String>,
}

/// 更新事项的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarUpdateEventArgs {
    /// 事件 ID。
    event_id: String,
    /// 事件标题。只在需要改标题时传。
    title: Option<String>,
    /// 事件补充说明。只在需要改说明时传。
    description: Option<String>,
    /// 事件类型。支持 `COURT_HEARING`、`DEADLINE`、`MEETING`、`FOLLOW_UP`、`TASK_DUE`。
    event_type: Option<CalendarEventTypeArg>,
    /// 开始时间。支持 RFC3339，或 `YYYY-MM-DD HH:mm`、`YYYY-MM-DD HH:mm:ss`。
    start_at: Option<String>,
    /// 结束时间。省略表示保持原值。
    end_at: Option<String>,
    /// 是否为全天事项。
    all_day: Option<bool>,
    /// 时区标识；建议继续使用 `Asia/Shanghai`。
    timezone: Option<String>,
    /// 当前状态。支持 `SCHEDULED`、`DONE`、`CANCELLED`。
    status: Option<CalendarEventStatusArg>,
    /// 优先级。只在需要改紧急程度时传。
    priority: Option<i32>,
    /// 关联案件 ID。
    case_id: Option<String>,
    /// 案件目录快照。
    case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    owner_user_label: Option<String>,
    /// 参与人展示标签集合。
    participant_labels: Option<Vec<String>>,
    /// 原始文本快照。
    source_text_snapshot: Option<String>,
    /// 外部提供方标识。
    external_provider: Option<String>,
    /// 外部事件 ID。
    external_event_id: Option<String>,
    /// 提醒规则列表。
    reminders: Option<Vec<CalendarReminderArg>>,
    /// 来源类型；为空时自动标记为 AI_UPDATED。
    source_type: Option<String>,
}

/// 预览周期日程规则的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarPreviewRecurringRuleArgs {
    /// 5 字段 cron 表达式：minute hour day-of-month month day-of-week。
    cron: String,
    /// 时区标识。可省略，默认 `Asia/Shanghai`。
    #[serde(default = "default_calendar_timezone")]
    timezone: String,
    /// 从哪个时间之后开始预览。
    from_at: Option<String>,
    /// 最多返回几次。可省略，默认 `5`。
    #[serde(default = "default_preview_limit")]
    limit: usize,
}

/// 创建周期日程规则的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarCreateRecurringRuleArgs {
    /// 规则标题。建议直接写最终在日历上展示的名字，例如“每周案件进度回顾”“每月账单复核”。
    title: String,
    /// 用户原始自然语言描述。
    original_text: Option<String>,
    /// 5 字段 cron 表达式：minute hour day-of-month month day-of-week。
    cron: String,
    /// 时区标识。可省略，默认 `Asia/Shanghai`。
    #[serde(default = "default_calendar_timezone")]
    timezone: String,
    /// 展示到日历上的事项类型。可省略，默认 `FOLLOW_UP`。
    #[serde(default = "default_calendar_event_type_arg")]
    event_type: CalendarEventTypeArg,
    /// 到点后发送的提醒正文。可省略；省略时系统会回退到标题语义。
    message: Option<String>,
    /// 提醒渠道。可省略，默认同时使用 `DESKTOP` 和 `WECHAT_SELF`，符合律师常见“桌面+微信双提醒”习惯。
    #[serde(default = "default_recurring_channels")]
    channels: Vec<CalendarReminderChannelArg>,
    /// 规则状态。可省略，默认 `ACTIVE`。
    #[serde(default = "default_recurring_status_arg")]
    status: RecurringRuleStatusArg,
    /// 规则生效起点。
    start_at: Option<String>,
    /// 规则生效终点。
    end_at: Option<String>,
    /// 关联案件 ID。
    case_id: Option<String>,
    /// 案件目录快照。
    case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    owner_user_label: Option<String>,
    /// 来源类型；为空时自动标记为 AI_CREATED。
    source_type: Option<String>,
}

/// 仅需要事件 ID 的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarEventIdArgs {
    /// 事件 ID。
    event_id: String,
}

/// 套用模板的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarApplyTemplateArgs {
    /// 模板 ID。
    template_id: String,
    /// 锚点时间。
    anchor_at: String,
    /// 标题覆盖。
    title_override: Option<String>,
    /// 说明覆盖。
    description_override: Option<String>,
    /// 关联案件 ID。
    case_id: Option<String>,
    /// 案件目录快照。
    case_path_snapshot: Option<String>,
    /// 负责人展示标签。
    owner_user_label: Option<String>,
    /// 参与人展示标签集合。
    participant_labels: Option<Vec<String>>,
}

/// 冲突查询的工具参数。
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarFindConflictsArgs {
    /// 开始时间。
    start_at: String,
    /// 结束时间。
    end_at: Option<String>,
    /// 关联案件 ID。
    case_id: Option<String>,
    /// 需要排除的事件 ID。
    exclude_event_id: Option<String>,
}

/// MCP 工具中的提醒规则参数。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(untagged)]
enum CalendarReminderArg {
    /// 结构化提醒对象，推荐格式。
    Structured(CalendarReminderOffsetArg),
    /// 兼容直接传分钟数。
    OffsetMinutes(i64),
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct CalendarReminderOffsetArg {
    /// 提前提醒的分钟数。`30` 表示提前 30 分钟提醒；`1440` 表示提前 1 天提醒。
    offset_minutes: i64,
}

impl CalendarReminderArg {
    fn offset_minutes(&self) -> i64 {
        match self {
            Self::Structured(value) => value.offset_minutes,
            Self::OffsetMinutes(value) => *value,
        }
    }
}

/// 普通日历事项类型。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CalendarEventTypeArg {
    /// 开庭、庭审、出庭。
    CourtHearing,
    /// 硬截止日，例如举证、答辩、上诉、提交材料。
    Deadline,
    /// 会见、会议、沟通安排。
    Meeting,
    /// 常规回访、催办、跟进。
    FollowUp,
    /// 待办任务。
    TaskDue,
}

impl CalendarEventTypeArg {
    fn as_str(&self) -> &'static str {
        match self {
            Self::CourtHearing => "COURT_HEARING",
            Self::Deadline => "DEADLINE",
            Self::Meeting => "MEETING",
            Self::FollowUp => "FOLLOW_UP",
            Self::TaskDue => "TASK_DUE",
        }
    }
}

/// 普通日历事项状态。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CalendarEventStatusArg {
    /// 已排期，待执行。
    Scheduled,
    /// 已完成。
    Done,
    /// 已取消。
    Cancelled,
}

impl CalendarEventStatusArg {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Scheduled => "SCHEDULED",
            Self::Done => "DONE",
            Self::Cancelled => "CANCELLED",
        }
    }
}

/// 周期规则状态。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum RecurringRuleStatusArg {
    /// 生效中。
    Active,
    /// 已暂停。
    Paused,
}

impl RecurringRuleStatusArg {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Active => "ACTIVE",
            Self::Paused => "PAUSED",
        }
    }
}

/// 提醒渠道。
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum CalendarReminderChannelArg {
    /// 桌面原生通知。
    Desktop,
    /// 微信给自己发提醒。
    WechatSelf,
}

impl CalendarReminderChannelArg {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Desktop => "DESKTOP",
            Self::WechatSelf => "WECHAT_SELF",
        }
    }
}

fn default_calendar_event_type_arg() -> CalendarEventTypeArg {
    CalendarEventTypeArg::FollowUp
}

fn default_calendar_status_arg() -> CalendarEventStatusArg {
    CalendarEventStatusArg::Scheduled
}

fn default_recurring_status_arg() -> RecurringRuleStatusArg {
    RecurringRuleStatusArg::Active
}

fn default_calendar_timezone() -> String {
    "Asia/Shanghai".to_string()
}

fn default_preview_limit() -> usize {
    5
}

fn default_recurring_channels() -> Vec<CalendarReminderChannelArg> {
    vec![
        CalendarReminderChannelArg::Desktop,
        CalendarReminderChannelArg::WechatSelf,
    ]
}

fn default_ai_event_reminders(
    reminders: Option<Vec<CalendarReminderArg>>,
) -> Option<Vec<crate::commands::local_data::calendar::CalendarReminderRule>> {
    let items = reminders.unwrap_or_else(|| {
        vec![
            CalendarReminderArg::Structured(CalendarReminderOffsetArg { offset_minutes: 10 }),
            CalendarReminderArg::Structured(CalendarReminderOffsetArg { offset_minutes: 0 }),
        ]
    });
    Some(
        items
            .into_iter()
            .flat_map(|item| {
                let offset_minutes = item.offset_minutes();
                [
                    crate::commands::local_data::calendar::CalendarReminderRule {
                        offset_minutes,
                        channel: "DESKTOP".to_string(),
                    },
                    crate::commands::local_data::calendar::CalendarReminderRule {
                        offset_minutes,
                        channel: "WECHAT_SELF".to_string(),
                    },
                ]
            })
            .collect(),
    )
}

fn normalize_ai_event_type(event_type: CalendarEventTypeArg) -> String {
    event_type.as_str().to_string()
}

fn normalize_ai_event_status(status: CalendarEventStatusArg) -> String {
    status.as_str().to_string()
}

fn normalize_recurring_status(status: RecurringRuleStatusArg) -> String {
    status.as_str().to_string()
}

fn normalize_recurring_channels(channels: Vec<CalendarReminderChannelArg>) -> Vec<String> {
    channels
        .into_iter()
        .map(|channel| channel.as_str().to_string())
        .collect()
}

impl LocalMcpServer {
    /// 创建 rmcp 本地能力服务实例。
    fn new(database: Arc<RwLock<Option<PathBuf>>>) -> Self {
        Self { database }
    }

    /// 读取当前已经配置好的工作空间数据库路径。
    fn database_path(&self) -> Result<PathBuf, ErrorData> {
        self.database
            .read()
            .map_err(|_| ErrorData::internal_error("读取本地工作空间状态失败", None))?
            .clone()
            .ok_or_else(|| {
                ErrorData::internal_error(
                    "当前尚未配置工作空间，无法调用本地日历工具",
                    Some(json!({ "detail": "workspaceDatabaseMissing" })),
                )
            })
    }

    /// 把序列化结果转成工具文本输出。
    fn to_tool_text<T: serde::Serialize>(&self, value: T) -> Result<String, ErrorData> {
        serde_json::to_string_pretty(&value).map_err(|err| {
            ErrorData::internal_error(
                "本地能力结果序列化失败",
                Some(json!({ "detail": err.to_string() })),
            )
        })
    }

    /// 构造统一的内部错误。
    fn internal_error(&self, message: &'static str, detail: impl ToString) -> ErrorData {
        ErrorData::internal_error(message, Some(json!({ "detail": detail.to_string() })))
    }

    /// 校验并返回非空事件 ID。
    fn require_event_id(&self, value: &str, tool_name: &'static str) -> Result<String, ErrorData> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(ErrorData::invalid_params(
                format!("{tool_name} 缺少 eventId"),
                None,
            ));
        }
        Ok(trimmed.to_string())
    }
}

#[tool_router]
impl LocalMcpServer {
    /// 当前首批本地能力只包含日历工具，后续可继续扩展案件、资料和工作空间级操作。

    /// 查询当前工作空间中的日历事项，可按案件、事件类型、状态、关键字和时间范围筛选。
    #[tool(
        name = "calendar_list_events",
        description = "查询当前工作空间中的日历事项，可按案件、事件类型、状态、关键字和时间范围筛选。"
    )]
    fn calendar_list_events(
        &self,
        Parameters(args): Parameters<CalendarListEventsArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let query = ListCalendarEventsQuery {
            start_at_from: args.start_at_from,
            start_at_to: args.start_at_to,
            case_id: args.case_id,
            event_types: args.event_types,
            statuses: args.statuses,
            keyword: args.keyword,
        };
        let records = list_calendar_events(&database, query)
            .map_err(|err| self.internal_error("查询日历事项失败", err))?;
        self.to_tool_text(records)
    }

    /// 查询未来 30 天的日程概览，并按天分组返回。
    #[tool(
        name = "calendar_get_agenda",
        description = "查询未来 30 天的日程概览，并按天分组返回。"
    )]
    fn calendar_get_agenda(
        &self,
        Parameters(args): Parameters<CalendarAgendaArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let agenda = list_calendar_agenda(&database)
            .map_err(|err| self.internal_error("查询日程概览失败", err))?;
        let case_id = args.case_id.unwrap_or_default().trim().to_string();
        let filtered = if case_id.is_empty() {
            agenda
        } else {
            agenda
                .into_iter()
                .filter_map(|mut day| {
                    day.events.retain(|event| event.case_id == case_id);
                    (!day.events.is_empty()).then_some(day)
                })
                .collect()
        };
        self.to_tool_text(filtered)
    }

    /// 创建新的庭期、期限、会议、跟进或待办事项。
    #[tool(
        name = "calendar_create_event",
        description = "创建新的庭期、期限、会议、跟进或待办事项。用户明确要设置提醒/日程时，直接创建，不要再向用户二次确认。必填只保留 title 和 startAt；eventType 可选，默认 FOLLOW_UP；支持值为 COURT_HEARING、DEADLINE、MEETING、FOLLOW_UP、TASK_DUE。endAt 省略时默认等于 startAt，timezone 默认 Asia/Shanghai，status 默认 SCHEDULED，allDay 默认 false，priority 默认 0。reminders 可传 [{offsetMinutes:30}] 或 [30]，表示提前 30 分钟提醒；未特殊说明渠道时，系统会自动同时写入桌面和微信自提醒。"
    )]
    fn calendar_create_event(
        &self,
        Parameters(args): Parameters<CalendarCreateEventArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let payload = CreateCalendarEventInput {
            title: args.title,
            description: args.description,
            event_type: normalize_ai_event_type(args.event_type),
            start_at: args.start_at,
            end_at: args.end_at,
            all_day: Some(args.all_day),
            timezone: Some(args.timezone),
            status: Some(normalize_ai_event_status(args.status)),
            priority: Some(args.priority),
            case_id: args.case_id,
            case_path_snapshot: args.case_path_snapshot,
            owner_user_label: args.owner_user_label,
            participant_labels: args.participant_labels,
            source_type: Some(
                args.source_type
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "AI_CREATED".to_string()),
            ),
            source_text_snapshot: args.source_text_snapshot,
            external_provider: args.external_provider,
            external_event_id: args.external_event_id,
            reminders: default_ai_event_reminders(args.reminders),
        };
        let record = create_calendar_event(&database, payload)
            .map_err(|err| self.internal_error("创建日历事项失败", err))?;
        self.to_tool_text(record)
    }

    /// 更新已有日历事项，可用于改期、补充负责人或调整提醒。
    #[tool(
        name = "calendar_update_event",
        description = "更新已有日历事项，可用于改期、补充负责人或调整提醒。用户明确要求修改现有日历事项时，直接更新，不要再向用户二次确认。只传需要修改的字段即可；reminders 可传 [{offsetMinutes:30}] 或 [30]，未特殊说明渠道时会自动同时写入桌面和微信自提醒。"
    )]
    fn calendar_update_event(
        &self,
        Parameters(args): Parameters<CalendarUpdateEventArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let event_id = self.require_event_id(&args.event_id, "calendar_update_event")?;
        let payload = UpdateCalendarEventInput {
            title: args.title,
            description: args.description,
            event_type: args.event_type.map(normalize_ai_event_type),
            start_at: args.start_at,
            end_at: args.end_at,
            all_day: args.all_day,
            timezone: args.timezone,
            status: args.status.map(normalize_ai_event_status),
            priority: args.priority,
            case_id: args.case_id,
            case_path_snapshot: args.case_path_snapshot,
            owner_user_label: args.owner_user_label,
            participant_labels: args.participant_labels,
            source_type: Some(
                args.source_type
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "AI_UPDATED".to_string()),
            ),
            source_text_snapshot: args.source_text_snapshot,
            external_provider: args.external_provider,
            external_event_id: args.external_event_id,
            reminders: default_ai_event_reminders(args.reminders),
        };
        let record = update_calendar_event(&database, &event_id, payload)
            .map_err(|err| self.internal_error("更新日历事项失败", err))?;
        self.to_tool_text(record)
    }

    /// 预览周期日程未来执行时间。重复表达才使用该工具，一次性提醒继续使用 calendar_create_event。
    #[tool(
        name = "calendar_preview_recurring_rule",
        description = "预览周期日程未来执行时间。只用于“每天/每周/每月/工作日”等重复表达；一次性提醒应使用 calendar_create_event。cron 使用 5 字段 minute hour day-of-month month day-of-week，时区固定 Asia/Shanghai。"
    )]
    fn calendar_preview_recurring_rule(
        &self,
        Parameters(args): Parameters<CalendarPreviewRecurringRuleArgs>,
    ) -> Result<String, ErrorData> {
        let occurrences = preview_recurring_calendar_rule(PreviewRecurringCalendarRuleInput {
            cron: args.cron,
            timezone: Some(args.timezone),
            from_at: args.from_at,
            limit: Some(args.limit),
        })
        .map_err(|err| self.internal_error("预览周期日程失败", err))?;
        self.to_tool_text(occurrences)
    }

    /// 创建周期日程规则。重复表达才使用该工具，一次性提醒继续创建普通日历事项。
    #[tool(
        name = "calendar_create_recurring_rule",
        description = "创建周期日程规则。只用于“每天/每周/每月/工作日”等重复表达；一次性提醒应使用 calendar_create_event。必须传结构化字段 title、cron、timezone=Asia/Shanghai、eventType、message、channels、startAt/endAt。cron 使用 5 字段 minute hour day-of-month month day-of-week。"
    )]
    fn calendar_create_recurring_rule(
        &self,
        Parameters(args): Parameters<CalendarCreateRecurringRuleArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let payload = CreateRecurringCalendarRuleInput {
            title: args.title,
            original_text: args.original_text,
            cron: args.cron,
            timezone: Some(args.timezone),
            event_type: normalize_ai_event_type(args.event_type),
            message: args.message,
            channels: Some(normalize_recurring_channels(args.channels)),
            status: Some(normalize_recurring_status(args.status)),
            start_at: args.start_at,
            end_at: args.end_at,
            case_id: args.case_id,
            case_path_snapshot: args.case_path_snapshot,
            owner_user_label: args.owner_user_label,
            source_type: Some(
                args.source_type
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "AI_CREATED".to_string()),
            ),
        };
        let record = create_recurring_calendar_rule(&database, payload)
            .map_err(|err| self.internal_error("创建周期日程失败", err))?;
        self.to_tool_text(record)
    }

    /// 将事项标记为已取消。
    #[tool(name = "calendar_cancel_event", description = "将事项标记为已取消。")]
    fn calendar_cancel_event(
        &self,
        Parameters(args): Parameters<CalendarEventIdArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let event_id = self.require_event_id(&args.event_id, "calendar_cancel_event")?;
        let payload = UpdateCalendarEventInput {
            title: None,
            description: None,
            event_type: None,
            start_at: None,
            end_at: None,
            all_day: None,
            timezone: None,
            status: Some("CANCELLED".to_string()),
            priority: None,
            case_id: None,
            case_path_snapshot: None,
            owner_user_label: None,
            participant_labels: None,
            source_type: Some("AI_UPDATED".to_string()),
            source_text_snapshot: None,
            external_provider: None,
            external_event_id: None,
            reminders: None,
        };
        let record = update_calendar_event(&database, &event_id, payload)
            .map_err(|err| self.internal_error("取消日历事项失败", err))?;
        self.to_tool_text(record)
    }

    /// 将事项标记为已完成。
    #[tool(name = "calendar_mark_done", description = "将事项标记为已完成。")]
    fn calendar_mark_done(
        &self,
        Parameters(args): Parameters<CalendarEventIdArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let event_id = self.require_event_id(&args.event_id, "calendar_mark_done")?;
        let record = complete_calendar_event(
            &database,
            &event_id,
            CompleteCalendarEventInput {
                source_type: Some("AI_UPDATED".to_string()),
            },
        )
        .map_err(|err| self.internal_error("完成日历事项失败", err))?;
        self.to_tool_text(record)
    }

    /// 按内置期限模板生成事项，可用模板包括 deadline-defense、hearing-prep、evidence-deadline。
    #[tool(
        name = "calendar_apply_deadline_template",
        description = "按内置期限模板生成事项，可用模板包括 deadline-defense、hearing-prep、evidence-deadline。"
    )]
    fn calendar_apply_deadline_template(
        &self,
        Parameters(args): Parameters<CalendarApplyTemplateArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let payload = ApplyCalendarTemplateInput {
            template_id: args.template_id,
            anchor_at: args.anchor_at,
            title_override: args.title_override,
            description_override: args.description_override,
            case_id: args.case_id,
            case_path_snapshot: args.case_path_snapshot,
            owner_user_label: args.owner_user_label,
            participant_labels: args.participant_labels,
        };
        let records = apply_calendar_template(&database, payload)
            .map_err(|err| self.internal_error("套用日历模板失败", err))?;
        self.to_tool_text(records)
    }

    /// 查询指定时间段内的冲突事项。
    #[tool(
        name = "calendar_find_conflicts",
        description = "查询指定时间段内的冲突事项。"
    )]
    fn calendar_find_conflicts(
        &self,
        Parameters(args): Parameters<CalendarFindConflictsArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let query = SearchCalendarConflictsQuery {
            start_at: args.start_at,
            end_at: args.end_at,
            case_id: args.case_id,
            exclude_event_id: args.exclude_event_id,
        };
        let records = search_calendar_conflicts(&database, query)
            .map_err(|err| self.internal_error("查询日历冲突失败", err))?;
        self.to_tool_text(records)
    }

    /// 读取当前工作空间内置的期限模板列表。
    #[tool(
        name = "calendar_list_templates",
        description = "读取当前工作空间内置的期限模板列表。"
    )]
    fn calendar_list_templates(&self) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let templates = list_calendar_templates(&database)
            .map_err(|err| self.internal_error("读取日历模板失败", err))?;
        self.to_tool_text(templates)
    }

    /// 删除一个日历事项，仅在用户明确要求物理删除时使用。
    #[tool(
        name = "calendar_delete_event",
        description = "删除一个日历事项，仅在用户明确要求物理删除时使用。"
    )]
    fn calendar_delete_event(
        &self,
        Parameters(args): Parameters<CalendarEventIdArgs>,
    ) -> Result<String, ErrorData> {
        let database = self.database_path()?;
        let event_id = self.require_event_id(&args.event_id, "calendar_delete_event")?;
        delete_calendar_event(&database, &event_id)
            .map_err(|err| self.internal_error("删除日历事项失败", err))?;
        self.to_tool_text(json!({ "deleted": true, "eventId": event_id }))
    }
}

#[tool_handler(
    name = "lex_vault_local",
    version = "0.1.2",
    instructions = "用于访问 Lex Vault 当前工作空间中的本地能力；提供律师日历事项查询、创建、改期、取消、完成，以及周期日程规则预览和创建工具。一次性提醒创建普通日历事项，重复提醒创建周期日程规则。"
)]
impl ServerHandler for LocalMcpServer {}

/// 组装当前本地 MCP server 的完整访问 URL。
fn build_local_mcp_server_url(bind_address: SocketAddr) -> String {
    format!(
        "http://{}:{}{}",
        bind_address.ip(),
        bind_address.port(),
        LOCAL_MCP_ROUTE_PATH
    )
}

/// 从指定端口起步寻找一个可用标准监听器，供运行时和测试共用。
fn bind_available_local_mcp_std_listener_from(
    host: &str,
    preferred_port: u16,
    scan_limit: u16,
) -> Result<(StdTcpListener, SocketAddr), String> {
    for offset in 0..scan_limit {
        let port = preferred_port.saturating_add(offset);
        let bind_address = format!("{host}:{port}");
        match StdTcpListener::bind(&bind_address) {
            Ok(listener) => {
                let local_addr = listener
                    .local_addr()
                    .map_err(|err| format!("读取本地 MCP 监听地址失败：{err}"))?;
                listener
                    .set_nonblocking(true)
                    .map_err(|err| format!("设置本地 MCP 监听器非阻塞失败：{err}"))?;
                return Ok((listener, local_addr));
            }
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                continue;
            }
            Err(err) => {
                return Err(format!("绑定本地 MCP 监听地址 {bind_address} 失败：{err}"));
            }
        }
    }
    Err(format!(
        "无法为本地 MCP server 找到可用端口，已尝试 {}:{}-{}",
        host,
        preferred_port,
        preferred_port.saturating_add(scan_limit.saturating_sub(1))
    ))
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener as StdTcpListener;

    use super::{
        bind_available_local_mcp_std_listener_from, build_local_mcp_server_url,
        default_ai_event_reminders, normalize_ai_event_type, CalendarCreateEventArgs,
        CalendarCreateRecurringRuleArgs, CalendarEventStatusArg, CalendarEventTypeArg,
        CalendarPreviewRecurringRuleArgs, CalendarReminderArg, CalendarReminderChannelArg,
        CalendarReminderOffsetArg, RecurringRuleStatusArg, LOCAL_MCP_BIND_HOST,
    };
    use serde_json::json;

    /// 验证 URL 组装逻辑会固定落到 `/mcp` 路径。
    #[test]
    fn build_local_mcp_server_url_appends_route_path() {
        let url = build_local_mcp_server_url(
            format!("{LOCAL_MCP_BIND_HOST}:4321")
                .parse()
                .expect("socket address should parse"),
        );
        assert_eq!(url, "http://127.0.0.1:4321/mcp");
    }

    /// 验证首选端口被占用时，会自动尝试后续端口。
    #[test]
    fn bind_available_local_mcp_listener_skips_occupied_port() {
        let occupied = StdTcpListener::bind((LOCAL_MCP_BIND_HOST, 0))
            .expect("should bind temporary occupied listener");
        let occupied_port = occupied
            .local_addr()
            .expect("occupied address should be readable")
            .port();

        let (_listener, bind_address) =
            bind_available_local_mcp_std_listener_from(LOCAL_MCP_BIND_HOST, occupied_port, 2)
                .expect("should find the next available port");

        assert_ne!(bind_address.port(), occupied_port);
    }

    /// 验证 AI 创建普通事项时，单条提醒会默认展开成桌面和微信两个渠道。
    #[test]
    fn default_ai_event_reminders_expand_to_desktop_and_wechat() {
        let reminders = default_ai_event_reminders(Some(vec![CalendarReminderArg::Structured(
            CalendarReminderOffsetArg { offset_minutes: 30 },
        )]))
        .expect("reminders should be present");

        assert_eq!(reminders.len(), 2);
        assert_eq!(reminders[0].offset_minutes, 30);
        assert_eq!(reminders[0].channel, "DESKTOP");
        assert_eq!(reminders[1].offset_minutes, 30);
        assert_eq!(reminders[1].channel, "WECHAT_SELF");
    }

    /// 验证未传提醒时，会默认生成提前 10 分钟和开始时的双渠道提醒。
    #[test]
    fn default_ai_event_reminders_fall_back_to_ten_minutes_and_at_start_dual_channel() {
        let reminders = default_ai_event_reminders(None).expect("reminders should be present");

        assert_eq!(reminders.len(), 4);
        assert_eq!(reminders[0].offset_minutes, 10);
        assert_eq!(reminders[0].channel, "DESKTOP");
        assert_eq!(reminders[1].offset_minutes, 10);
        assert_eq!(reminders[1].channel, "WECHAT_SELF");
        assert_eq!(reminders[2].offset_minutes, 0);
        assert_eq!(reminders[2].channel, "DESKTOP");
        assert_eq!(reminders[3].offset_minutes, 0);
        assert_eq!(reminders[3].channel, "WECHAT_SELF");
    }

    /// 验证提醒参数可直接兼容纯分钟数，减少模型试错重试。
    #[test]
    fn calendar_reminder_arg_accepts_numeric_minutes() {
        let reminders: Vec<CalendarReminderArg> =
            serde_json::from_value(json!([30])).expect("numeric reminder should deserialize");
        let expanded =
            default_ai_event_reminders(Some(reminders)).expect("reminders should be present");

        assert_eq!(expanded.len(), 2);
        assert_eq!(expanded[0].offset_minutes, 30);
        assert_eq!(expanded[1].offset_minutes, 30);
    }

    /// 验证 AI 创建普通事项时，未显式指定事件类型会默认跟进事项。
    #[test]
    fn normalize_ai_event_type_defaults_to_follow_up() {
        assert_eq!(
            normalize_ai_event_type(CalendarEventTypeArg::FollowUp),
            "FOLLOW_UP"
        );
        assert_eq!(
            normalize_ai_event_type(CalendarEventTypeArg::Meeting),
            "MEETING"
        );
    }

    /// 验证创建普通事项时，schema 级默认值可直接落到反序列化结果。
    #[test]
    fn calendar_create_event_args_apply_schema_defaults() {
        let args: CalendarCreateEventArgs = serde_json::from_value(json!({
            "title": "去法院",
            "startAt": "2026-05-22 09:00"
        }))
        .expect("create args should deserialize");

        assert!(matches!(args.event_type, CalendarEventTypeArg::FollowUp));
        assert_eq!(args.timezone, "Asia/Shanghai");
        assert!(matches!(args.status, CalendarEventStatusArg::Scheduled));
        assert!(!args.all_day);
        assert_eq!(args.priority, 0);
    }

    /// 验证周期规则默认符合律师工作习惯：时区上海、状态激活、双通道提醒。
    #[test]
    fn calendar_create_recurring_rule_args_apply_lawyer_defaults() {
        let args: CalendarCreateRecurringRuleArgs = serde_json::from_value(json!({
            "title": "每周案件进度回顾",
            "cron": "0 18 * * 5"
        }))
        .expect("recurring args should deserialize");

        assert_eq!(args.timezone, "Asia/Shanghai");
        assert!(matches!(args.event_type, CalendarEventTypeArg::FollowUp));
        assert!(matches!(args.status, RecurringRuleStatusArg::Active));
        assert_eq!(args.channels.len(), 2);
        assert!(matches!(
            args.channels[0],
            CalendarReminderChannelArg::Desktop
        ));
        assert!(matches!(
            args.channels[1],
            CalendarReminderChannelArg::WechatSelf
        ));
    }

    /// 验证周期预览默认只返回 5 个执行点，减少模型额外补参。
    #[test]
    fn calendar_preview_recurring_rule_args_apply_defaults() {
        let args: CalendarPreviewRecurringRuleArgs = serde_json::from_value(json!({
            "cron": "0 9 * * 1"
        }))
        .expect("preview args should deserialize");

        assert_eq!(args.timezone, "Asia/Shanghai");
        assert_eq!(args.limit, 5);
    }
}
