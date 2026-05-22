import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CircleHelp,
  FilePlus2,
  FileText,
  Gavel,
  Home,
  MessageSquare,
  PanelLeft,
  PlugZap,
  Scale,
  Settings,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavKey } from "@/types/domain";
import weixinContactImage from "@/assets/weixin.jpg";

const navItems = [
  { label: "对话", icon: Home },
  { label: "案件", icon: BriefcaseBusiness },
  { label: "日历", icon: CalendarDays },
  { label: "模板", icon: FileText },
  { label: "法规", icon: Gavel },
  { label: "案例", icon: BookOpenCheck },
  { label: "工具", icon: PlugZap },
  { label: "插件", icon: PlugZap },
] satisfies Array<{ label: NavKey; icon: typeof Home }>;

const navSections = [
  { title: "工作区", items: navItems.slice(0, 3) },
  { title: "知识库", items: navItems.slice(3, 6) },
  { title: "扩展", items: navItems.slice(6, 8) },
];

const navQuickActions = [
  {
    label: "新建对话",
    description: "普通咨询",
    icon: MessageSquare,
    action: "chat",
  },
  {
    label: "案件会话",
    description: "带材料上下文",
    icon: FilePlus2,
    action: "case",
  },
] satisfies Array<{
  label: string;
  description: string;
  icon: typeof MessageSquare;
  action: "chat" | "case";
}>;

/** 帮助反馈悬浮卡片文案，统一维护避免按钮结构里散落用户可见文本。 */
const helpFeedbackTitle = "遇到问题或有使用建议，欢迎联系开发者协助处理。";

/** 产品标识图块，作为侧栏品牌入口复用。 */
function IconTile() {
  return (
    <div className="flex size-9 items-center justify-center rounded-lg bg-[#1d4ed8] text-white shadow-sm">
      <Scale className="size-5" />
    </div>
  );
}

export function Sidebar({
  activeNav,
  isCollapsed,
  onCreateCaseConversation,
  onCreateConversation,
  onNavigate,
}: {
  activeNav: NavKey;
  isCollapsed: boolean;
  onCreateCaseConversation: () => void;
  onCreateConversation: () => void;
  onNavigate: (nav: NavKey) => void;
}) {
  return (
    <aside
      className={cn(
        "flex w-full shrink-0 flex-col rounded-xl border bg-white p-px shadow-sm transition-[width] duration-200 lg:h-full",
        isCollapsed ? "lg:w-16" : "lg:w-72",
      )}
    >
      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4 lg:justify-between">
        <div className="min-w-0">
          <div
            className={cn(
              "mb-3 flex items-center gap-3 px-2 sm:mb-4 lg:mb-6",
              isCollapsed && "lg:justify-center lg:px-0",
            )}
          >
            <IconTile />
            <div className={cn("min-w-0", isCollapsed && "lg:hidden")}>
              <span className="block truncate text-base font-semibold text-[#1d4ed8] sm:text-lg">
                律隐台·AI办案助手
              </span>
              <span className="block truncate text-xs font-medium text-slate-500">
                本机工作台
              </span>
            </div>
          </div>

          <div
            className={cn(
              "mb-3 hidden grid-cols-2 gap-2 lg:grid",
              isCollapsed && "lg:hidden",
            )}
          >
            {navQuickActions.map((item) => {
              const Icon = item.icon;
              const handleClick =
                item.action === "case" ? onCreateCaseConversation : onCreateConversation;

              return (
                <button
                  className="min-w-0 rounded-lg border bg-slate-50 px-3 py-2 text-left transition hover:border-blue-200 hover:bg-blue-50"
                  key={item.label}
                  onClick={handleClick}
                  type="button"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Icon className="size-4 text-[#1d4ed8]" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {item.description}
                  </span>
                </button>
              );
            })}
          </div>

          <nav
            className={cn(
              "grid grid-cols-5 gap-1 lg:block lg:space-y-4",
              isCollapsed && "lg:mt-12 lg:space-y-2",
            )}
          >
            {navSections.map((section) => (
              <div className="contents lg:block" key={section.title}>
                <div
                  className={cn(
                    "mb-1 hidden items-center gap-2 px-3 text-xs font-semibold text-slate-400 lg:flex",
                    isCollapsed && "lg:hidden",
                  )}
                >
                  <PanelLeft className="size-3.5" />
                  {section.title}
                </div>
                <div
                  className={cn(
                    "contents lg:block lg:space-y-1",
                    isCollapsed && "lg:space-y-2",
                  )}
                >
                  {section.items.map((item) => {
                    const Icon = item.icon;

                    return (
                      <button
                        className={cn(
                          "flex h-11 w-full items-center justify-center gap-2 rounded-md px-2 text-sm font-medium text-slate-800 transition hover:bg-slate-100 sm:text-base lg:justify-start lg:gap-3 lg:px-3 lg:text-left",
                          activeNav === item.label &&
                            "bg-blue-50 text-[#1d4ed8] lg:border-l-4 lg:border-[#1d4ed8] lg:pl-4",
                          isCollapsed &&
                            "lg:justify-center lg:px-0 lg:text-center",
                          isCollapsed &&
                            activeNav === item.label &&
                            "lg:border-l-0 lg:pl-0",
                        )}
                        key={item.label}
                        onClick={() => onNavigate(item.label)}
                        title={item.label}
                        type="button"
                      >
                        <Icon className="size-4" />
                        <span className={cn(isCollapsed && "lg:hidden")}>
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div
            className={cn(
              "mt-4 hidden rounded-lg border bg-slate-50 p-3 lg:block",
              isCollapsed && "lg:hidden",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BookOpenCheck className="size-4 text-emerald-600" />
              引用能力
            </div>
            <div className="mt-3 grid gap-2 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-600" />
                法规检索与裁判观点
              </div>
              <div className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-600" />
                案件材料上下文
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-2 border-t pt-3">
          <div
            className={cn(
              "group/help relative hidden lg:block",
              isCollapsed && "lg:hidden",
            )}
          >
            <button
              aria-describedby="help-feedback-popover"
              className="flex h-10 w-full items-center justify-start gap-2 rounded-md px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:bg-slate-100 focus-visible:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1d4ed8]/30"
              type="button"
            >
              <CircleHelp className="size-4" />
              帮助与反馈
            </button>
            <div
              className="pointer-events-none absolute bottom-full left-0 z-30 mb-3 w-64 translate-y-1 rounded-lg border bg-white p-3 text-left opacity-0 shadow-xl transition group-hover/help:pointer-events-auto group-hover/help:translate-y-0 group-hover/help:opacity-100 group-focus-within/help:pointer-events-auto group-focus-within/help:translate-y-0 group-focus-within/help:opacity-100"
              id="help-feedback-popover"
              role="tooltip"
            >
              <p className="text-sm font-medium leading-6 text-slate-900">
                {helpFeedbackTitle}
              </p>
              <div className="mt-3 overflow-hidden rounded-md border bg-slate-50 p-2">
                <img
                  alt="开发者微信联系方式"
                  className="h-auto w-full rounded-sm object-contain"
                  src={weixinContactImage}
                />
              </div>
            </div>
          </div>
          <button
            className={cn(
              "flex h-11 w-full items-center justify-center gap-2 rounded-md px-3 text-sm font-medium text-slate-800 transition hover:bg-slate-100 sm:text-base lg:justify-start lg:gap-3 lg:text-left",
              activeNav === "设置" &&
                "bg-blue-50 text-[#1d4ed8] lg:border-l-4 lg:border-[#1d4ed8] lg:pl-4",
              isCollapsed && "lg:justify-center lg:px-0 lg:text-center",
              isCollapsed &&
                activeNav === "设置" &&
                "lg:border-l-0 lg:pl-0",
            )}
            onClick={() => onNavigate("设置")}
            title="设置"
            type="button"
          >
            <Settings className="size-4" />
            <span className={cn(isCollapsed && "lg:hidden")}>设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
