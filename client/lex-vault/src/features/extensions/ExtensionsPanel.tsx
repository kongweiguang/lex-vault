import { useMemo, useState } from "react";
import {
  Blocks,
  LayoutGrid,
  LoaderCircle,
  Plus,
  PlugZap,
  Search,
  Sparkles,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { BillingPanel } from "@/features/billing/BillingPanel";
import {
  createToolsWorkspaceDetailView,
  createToolsWorkspaceHomeView,
  type ToolsWorkspaceView,
} from "@/features/billing/billing-helpers";
import { cn } from "@/lib/utils";
import { showPrompt } from "@/services/dialog-service";
import type { CodexPluginListResult } from "@/types/codex";
import type { CaseRecord } from "@/types/domain";
import {
  classifyPluginMarketplace,
  presentPluginSourceGroupLabel,
  type PluginSourceGroup,
  presentMarketplaceDescription,
  presentMarketplaceName,
  presentPluginCategory,
  presentPluginDescription,
  presentPluginName,
  shouldExposeMarketplaceInUi,
  shouldExposePluginInUi,
} from "@/utils/plugin-display";

type ExtensionCapability = {
  /** 能力名称。 */
  name: string;
  /** 能力说明。 */
  description: string;
  /** 当前状态标签。 */
  status: string;
};

type LawyerToolCapability = ExtensionCapability & {
  /** 律师场景下的能力分类。 */
  category: string;
  /** 卡片顶部强调的能力摘要。 */
  summary: string;
  /** 常见使用场景。 */
  useCases: string[];
  /** 搜索时命中的关键字。 */
  keywords: string[];
  /** 卡片图标。 */
  icon: typeof LayoutGrid;
  /** 是否已经接入可操作工作区。 */
  implemented: boolean;
  /** 已接入工具对应的详情页标识。 */
  toolKey?: "billing";
};

export type ExtensionPanelMode = "工具" | "插件";

type ExtensionGroup = {
  /** 分组标题。 */
  title: ExtensionPanelMode;
  /** 分组说明。 */
  description: string;
  /** 分组图标。 */
  icon: typeof Wrench;
  /** 当前分组的能力列表。 */
  items: ExtensionCapability[];
};

type MarketplacePluginGroup = {
  /** 当前 marketplace 名称。 */
  marketplaceName: string;
  /** marketplace 下命中的插件列表。 */
  plugins: NonNullable<CodexPluginListResult["plugins"]>;
};

type PluginSourceSection = {
  /** 插件来源分组。 */
  sourceGroup: PluginSourceGroup;
  /** 分组标题。 */
  title: string;
  /** 当前来源分组下的 marketplace 列表。 */
  groups: MarketplacePluginGroup[];
};

const lawyerToolCapabilities: LawyerToolCapability[] = [
  {
    name: "工时记录与计费",
    category: "运营",
    summary: "按案件记录工时、费用与默认费率，直接在本地工作区完成核算。",
    description: "首版已经接入可操作工作区，支持案件默认小时费率、工时记录、费用记录和案件汇总。",
    status: "已接入",
    useCases: ["记录可计费工时", "记录案件支出", "按案件查看汇总"],
    keywords: ["工时", "计费", "billing", "timekeeping", "费用", "账单", "小时费率"],
    icon: LayoutGrid,
    implemented: true,
    toolKey: "billing",
  },
];

const extensionGroups: Record<"工具", ExtensionGroup> = {
  工具: {
    title: "工具",
    description: "面向当前工作空间逐步落地的本地工具入口，后续会继续扩展新的可操作能力。",
    icon: Wrench,
    items: lawyerToolCapabilities,
  },
};

/**
 * @author kongweiguang
 * 扩展页面板，按模式展示当前工作台的工具能力或插件接入状态。
 */
export function ExtensionsPanel({
  mode,
  cases = [],
  pluginList,
  isPluginLoading = false,
  pluginNotice,
  onRefreshPlugins,
  onCreatePlugin,
}: {
  /** 当前扩展页模式。 */
  mode: ExtensionPanelMode;
  /** 当前工作空间下的案件列表，仅工具页详情模式使用。 */
  cases?: CaseRecord[];
  /** 插件列表结果。 */
  pluginList?: CodexPluginListResult | null;
  /** 插件数据是否仍在加载。 */
  isPluginLoading?: boolean;
  /** 插件页提示消息。 */
  pluginNotice?: string | null;
  /** 刷新插件列表。 */
  onRefreshPlugins?: () => Promise<void>;
  /** 发起创建插件任务。 */
  onCreatePlugin?: (request: string) => Promise<void>;
  /** 添加插件市场。 */
  onAddMarketplace?: (source: string) => Promise<void>;
  /** 移除插件市场。 */
  onRemoveMarketplace?: (name: string) => Promise<void>;
  /** 升级插件市场。 */
  onUpgradeMarketplace?: (marketplaceName?: string) => Promise<void>;
}) {
  const activeGroup = extensionGroups.工具;
  const Icon = activeGroup.icon;
  const [toolQuery, setToolQuery] = useState("");
  const [pluginQuery, setPluginQuery] = useState("");
  const [toolsWorkspaceView, setToolsWorkspaceView] = useState<ToolsWorkspaceView>(createToolsWorkspaceHomeView);

  /** 工具搜索统一按名称、分类、说明、场景和关键字做模糊过滤。 */
  const filteredLawyerTools = useMemo(() => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) {
      return lawyerToolCapabilities;
    }
    return lawyerToolCapabilities.filter((item) => {
      const haystack = [
        item.name,
        item.category,
        item.summary,
        item.description,
        ...item.useCases,
        ...item.keywords,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [toolQuery]);

  /** 插件搜索统一按名称、分类、市场和说明过滤。 */
  const filteredPlugins = useMemo(() => {
    const plugins = (pluginList?.plugins ?? []).filter((plugin) =>
      shouldExposePluginInUi(plugin.marketplaceName)
    );
    const query = pluginQuery.trim().toLowerCase();
    if (!query) {
      return plugins;
    }
    return plugins.filter((plugin) => [
      plugin.name,
      plugin.pluginName,
      plugin.marketplaceName,
      plugin.category,
      plugin.description,
    ].join(" ").toLowerCase().includes(query));
  }, [pluginList?.plugins, pluginQuery]);

  const installedPlugins = useMemo(
    () => (pluginList?.plugins ?? []).filter((plugin) =>
      shouldExposePluginInUi(plugin.marketplaceName) && plugin.installed
    ),
    [pluginList?.plugins],
  );
  const enabledPlugins = useMemo(
    () => (pluginList?.plugins ?? []).filter((plugin) =>
      shouldExposePluginInUi(plugin.marketplaceName) && plugin.enabled
    ),
    [pluginList?.plugins],
  );
  const visibleMarketplaces = useMemo(
    () => (pluginList?.marketplaces ?? []).filter((marketplace) =>
      shouldExposeMarketplaceInUi(marketplace.name)
    ),
    [pluginList?.marketplaces],
  );
  const marketplacePluginGroups = useMemo<MarketplacePluginGroup[]>(() => {
    const marketplaceOrder = new Map(visibleMarketplaces.map((marketplace, index) => [marketplace.name, index]));
    const groups = new Map<string, MarketplacePluginGroup>();
    for (const plugin of filteredPlugins) {
      const current = groups.get(plugin.marketplaceName);
      if (current) {
        current.plugins.push(plugin);
        continue;
      }
      groups.set(plugin.marketplaceName, {
        marketplaceName: plugin.marketplaceName,
        plugins: [plugin],
      });
    }
    return [...groups.values()].sort((left, right) => {
      const leftOrder = marketplaceOrder.get(left.marketplaceName) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = marketplaceOrder.get(right.marketplaceName) ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.marketplaceName.localeCompare(right.marketplaceName);
    });
  }, [filteredPlugins, visibleMarketplaces]);
  const pluginSections = useMemo<PluginSourceSection[]>(() => {
    const groupsBySource = new Map<PluginSourceGroup, MarketplacePluginGroup[]>();
    for (const sourceGroup of ["custom", "system"] as const) {
      groupsBySource.set(sourceGroup, []);
    }
    for (const group of marketplacePluginGroups) {
      const sourceGroup = classifyPluginMarketplace(group.marketplaceName);
      if (sourceGroup === "hidden") {
        continue;
      }
      groupsBySource.get(sourceGroup)?.push(group);
    }
    return (["custom", "system"] as const)
      .map((sourceGroup) => ({
        sourceGroup,
        title: presentPluginSourceGroupLabel(sourceGroup),
        groups: groupsBySource.get(sourceGroup) ?? [],
      }))
      .filter((section) => section.groups.length > 0);
  }, [marketplacePluginGroups]);
  const customPlugins = useMemo(
    () => filteredPlugins.filter((plugin) => classifyPluginMarketplace(plugin.marketplaceName) === "custom"),
    [filteredPlugins],
  );
  const systemPlugins = useMemo(
    () => filteredPlugins.filter((plugin) => classifyPluginMarketplace(plugin.marketplaceName) === "system"),
    [filteredPlugins],
  );

  async function handleCreatePlugin() {
    const request = (await showPrompt({
      title: "创建插件",
      message: "描述你要创建的插件名称和用途，小隐会跳转到对话页并调用 plugin-creator 帮你生成脚手架。",
      description: "默认会按 home-local 方式创建到 ~/plugins，并写入 ~/.agents/plugins/marketplace.json。",
      inputLabel: "插件需求",
      placeholder: "例如：创建一个用于案件材料批量归档的本地插件",
      confirmText: "开始创建",
      cancelText: "取消",
      intent: "primary",
    }))?.trim();
    if (!request) {
      return;
    }
    await onCreatePlugin?.(request);
  }

  if (mode === "工具" && toolsWorkspaceView.page === "detail" && toolsWorkspaceView.toolKey === "billing") {
    return <BillingPanel cases={cases} onBack={() => setToolsWorkspaceView(createToolsWorkspaceHomeView())} />;
  }

  return (
    <section className="flex min-w-0 flex-1 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] shadow-sm">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="border-b border-[color:var(--color-border)] px-6 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]">
              <Blocks className="size-6" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[0.18em] text-[color:var(--color-primary)] uppercase">
                {mode === "工具" ? "Tools" : "Plugins"}
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-[color:var(--color-card-foreground)]">
                {mode === "工具" ? "本地工具入口" : "插件列表"}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                {mode === "工具"
                  ? "这里逐步收口当前工作空间已经接入的本地工具能力；点击卡片即可进入对应操作区，后续还会继续补充更多工具。"
                  : "这里按自定义插件和系统预装插件分类展示当前助手能力，也支持直接发起创建插件任务。"}
              </p>
            </div>
            </div>
            {mode === "插件" ? (
              <div className="flex items-center gap-2">
                <Button disabled={isPluginLoading} onClick={() => void handleCreatePlugin()} type="button">
                  <Plus />
                  创建插件
                </Button>
              </div>
            ) : null}
          </div>
        </header>

        <div className="grid gap-5 px-6 py-6">
          <div className="grid gap-5">
            {mode === "工具" ? (
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-[color:var(--color-secondary)] text-[color:var(--color-primary)] shadow-sm">
                          <Icon className="size-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">{activeGroup.title}</h2>
                          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{activeGroup.description}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative min-w-0 lg:w-80">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
                        <input
                          className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] pl-9 pr-3 text-sm text-[color:var(--color-card-foreground)] outline-none transition placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-primary)] focus:bg-[color:var(--color-card)]"
                          onChange={(event) => setToolQuery(event.target.value)}
                          placeholder="搜索工具，如 工时、计费、费用"
                          type="text"
                          value={toolQuery}
                        />
                      </div>
                      <span className="shrink-0 rounded-full border border-[color:var(--color-primary)]/20 bg-[color:var(--color-secondary)] px-3 py-1 text-xs font-medium text-[color:var(--color-primary)]">
                        {filteredLawyerTools.length} 项
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {filteredLawyerTools.map((item) => {
                      const ToolIcon = item.icon;

                      return (
                        <button
                          className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[color:var(--color-primary)]/30 hover:shadow-md"
                          key={item.name}
                          onClick={() => {
                            if (item.implemented && item.toolKey) {
                              setToolsWorkspaceView(createToolsWorkspaceDetailView(item.toolKey));
                            }
                          }}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--color-card)] text-[color:var(--color-primary)] shadow-sm">
                              <ToolIcon className="size-5" />
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              <span className="rounded-full bg-[color:var(--color-card-foreground)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-card)]">
                                {item.category}
                              </span>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                                item.implemented
                                  ? "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]"
                                  : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]"
                              }`}>
                                {item.status}
                              </span>
                            </div>
                          </div>

                          <div className="mt-4">
                            <h3 className="text-base font-semibold text-[color:var(--color-card-foreground)]">{item.name}</h3>
                            <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--color-primary)]">{item.summary}</p>
                            <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">{item.description}</p>
                          </div>

                          <div className="mt-4 rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-3 py-3">
                            <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">
                              <Sparkles className="size-3.5" />
                              常见用法
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {item.useCases.map((useCase) => (
                                <span
                                  className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-xs text-[color:var(--color-muted-foreground)]"
                                  key={useCase}
                                >
                                  {useCase}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between text-sm">
                            <span className="text-[color:var(--color-muted-foreground)]">
                              {item.implemented ? "点击进入操作区" : "即将接入"}
                            </span>
                            {item.implemented ? (
                              <span className="font-medium text-[color:var(--color-primary)]">立即进入</span>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {filteredLawyerTools.length === 0 ? (
                    <div className="mt-5 rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)] px-5 py-10 text-center">
                      <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">没有找到匹配的常用工具</p>
                      <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">
                        试试搜索“工时”“计费”“费用”“小时费率”等关键词。
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : (
              <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-5">
                <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-5 shadow-sm">
                  <div className="flex flex-col gap-4 border-b border-[color:var(--color-border)] pb-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-[color:var(--color-secondary)] text-[color:var(--color-primary)] shadow-sm">
                          <PlugZap className="size-5" />
                        </div>
                        <div>
                          <h2 className="text-lg font-semibold text-[color:var(--color-card-foreground)]">插件能力中心</h2>
                          <p className="mt-1 text-sm leading-6 text-[color:var(--color-muted-foreground)]">查看系统预装插件与自定义插件，并可直接发起创建插件任务。</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button disabled={isPluginLoading} onClick={() => void onRefreshPlugins?.()} type="button" variant="outline">
                          {isPluginLoading ? <LoaderCircle className="animate-spin" /> : <Search />}
                          刷新插件
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--color-muted-foreground)]" />
                        <input
                          className="h-11 w-full rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] pl-9 pr-3 text-sm text-[color:var(--color-card-foreground)] outline-none transition placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-primary)] focus:bg-[color:var(--color-card)]"
                          onChange={(event) => setPluginQuery(event.target.value)}
                          placeholder="搜索插件名称、分组、分类"
                          type="text"
                          value={pluginQuery}
                        />
                      </div>
                      <span className="shrink-0 rounded-full border border-[color:var(--color-primary)]/20 bg-[color:var(--color-secondary)] px-3 py-1 text-xs font-medium text-[color:var(--color-primary)]">
                        {filteredPlugins.length} 项
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-3">
                        <p className="text-xs font-semibold tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">总插件数</p>
                        <p className="mt-2 text-lg font-semibold text-[color:var(--color-card-foreground)]">{filteredPlugins.length}</p>
                        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">当前可展示插件总数</p>
                      </div>
                      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-3">
                        <p className="text-xs font-semibold tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">自定义插件</p>
                        <p className="mt-2 text-lg font-semibold text-[color:var(--color-primary)]">{customPlugins.length}</p>
                        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">非系统 marketplace 的插件</p>
                      </div>
                      <div className="rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-4 py-3">
                        <p className="text-xs font-semibold tracking-[0.14em] text-[color:var(--color-muted-foreground)] uppercase">系统预装插件</p>
                        <p className="mt-2 text-lg font-semibold text-[color:var(--color-primary)]">{systemPlugins.length}</p>
                        <p className="mt-1 text-xs text-[color:var(--color-muted-foreground)]">由系统默认分发的插件</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
                      <span>已安装 {installedPlugins.length} 个</span>
                      <span className="text-[color:var(--color-border)]">|</span>
                      <span>已启用 {enabledPlugins.length} 个</span>
                      <span className="text-[color:var(--color-border)]">|</span>
                      <span>可见分组 {visibleMarketplaces.length} 个</span>
                    </div>
                    {pluginNotice ? (
                      <div className="rounded-xl border border-[color:var(--color-primary)]/20 bg-[color:var(--color-secondary)] px-4 py-3 text-sm text-[color:var(--color-primary)]">
                        {pluginNotice}
                      </div>
                    ) : null}
                    {pluginList?.marketplaceLoadErrors.length ? (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-500">
                        {pluginList.marketplaceLoadErrors.join("；")}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 grid gap-4">
                    {pluginSections.map((section) => (
                      <section className="grid gap-4" key={section.sourceGroup}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-[color:var(--color-card-foreground)]">{section.title}</h3>
                            <p className="mt-1 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                              {section.sourceGroup === "custom" ? "由非系统 marketplace 提供，适合按需扩展。" : "由系统默认分发，开箱即可使用。"}
                            </p>
                          </div>
                          <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-3 py-1 text-xs font-medium text-[color:var(--color-card-foreground)]">
                            {section.groups.reduce((count, group) => count + group.plugins.length, 0)} 个
                          </span>
                        </div>
                        {section.groups.map((group) => {
                          const installedCount = group.plugins.filter((plugin) => plugin.installed).length;
                          return (
                            <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-background)] p-4 shadow-sm" key={group.marketplaceName}>
                              <div className="flex flex-col gap-3 border-b border-[color:var(--color-border)] pb-4">
                                <div className="flex flex-wrap items-center gap-3">
                                  <h4 className="text-base font-semibold text-[color:var(--color-card-foreground)]">
                                    {presentMarketplaceName(group.marketplaceName)}
                                  </h4>
                                  <span className="rounded-full bg-[color:var(--color-card-foreground)] px-2.5 py-1 text-xs font-medium text-[color:var(--color-card)]">
                                    {installedCount}/{group.plugins.length} 已安装
                                  </span>
                                </div>
                                <p className="text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                                  {presentMarketplaceDescription(group.marketplaceName)}
                                </p>
                              </div>
                              <div className="mt-4 grid gap-3">
                                {group.plugins.map((plugin) => (
                                  <article
                                    className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-card)] p-4 shadow-sm transition hover:border-[color:var(--color-primary)]/30 hover:shadow-md"
                                    key={plugin.id}
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <h5 className="text-base font-semibold text-[color:var(--color-card-foreground)]">
                                          {presentPluginName(plugin.id, plugin.name)}
                                        </h5>
                                        <span className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-background)] px-2.5 py-1 text-xs text-[color:var(--color-card-foreground)]">
                                          {presentPluginCategory(plugin.id, plugin.category)}
                                        </span>
                                        <span className={cn(
                                          "rounded-full px-2.5 py-1 text-xs font-medium",
                                          plugin.installed
                                            ? "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]"
                                            : "bg-amber-500/10 text-amber-500",
                                        )}>
                                          {plugin.installed ? "已安装" : "未安装"}
                                        </span>
                                        <span className={cn(
                                          "rounded-full px-2.5 py-1 text-xs font-medium",
                                          plugin.enabled
                                            ? "bg-[color:var(--color-secondary)] text-[color:var(--color-primary)]"
                                            : "bg-[color:var(--color-muted)] text-[color:var(--color-muted-foreground)]",
                                        )}>
                                          {plugin.enabled ? "已启用" : "未启用"}
                                        </span>
                                      </div>
                                      <p className="mt-2 text-sm leading-6 text-[color:var(--color-muted-foreground)]">
                                        {presentPluginDescription(plugin.id, plugin.description)}
                                      </p>
                                      <p className="mt-2 text-xs leading-5 text-[color:var(--color-muted-foreground)]">
                                        状态：{plugin.availability || "AVAILABLE"}
                                      </p>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </section>
                          );
                        })}
                      </section>
                    ))}
                    {!isPluginLoading && filteredPlugins.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-background)] px-5 py-10 text-center">
                        <p className="text-sm font-medium text-[color:var(--color-card-foreground)]">当前没有可展示的插件</p>
                        <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">可先刷新当前助手的插件列表，确认系统能力已完成初始化。</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
