type DialogIntent = "primary" | "danger" | "success" | "warning";

type DialogListener = () => void;

type DialogCommonOptions = {
  /** 弹框标题。 */
  title?: string;
  /** 弹框主文案。 */
  message: string;
  /** 补充说明。 */
  description?: string;
  /** 主按钮文案。 */
  confirmText?: string;
  /** 次按钮文案。 */
  cancelText?: string;
  /** 弹框视觉语义。 */
  intent?: DialogIntent;
  /** 是否允许点击遮罩或按 Esc 关闭。 */
  dismissible?: boolean;
};

export type AlertDialogOptions = DialogCommonOptions;

export type ConfirmDialogOptions = DialogCommonOptions;

export type PromptDialogOptions = DialogCommonOptions & {
  /** 输入框标签。 */
  inputLabel?: string;
  /** 输入框占位提示。 */
  placeholder?: string;
  /** 输入框默认值。 */
  defaultValue?: string;
};

type InternalDialogRequest =
  | {
    id: number;
    kind: "alert";
    options: Required<Pick<AlertDialogOptions, "confirmText" | "intent" | "dismissible">> & AlertDialogOptions;
    resolve: () => void;
  }
  | {
    id: number;
    kind: "confirm";
    options: Required<Pick<ConfirmDialogOptions, "confirmText" | "cancelText" | "intent" | "dismissible">> & ConfirmDialogOptions;
    resolve: (confirmed: boolean) => void;
  }
  | {
    id: number;
    kind: "prompt";
    options: Required<Pick<PromptDialogOptions, "confirmText" | "cancelText" | "intent" | "dismissible">> & PromptDialogOptions;
    resolve: (value: string | null) => void;
  };

export type AlertDialogState = Omit<Extract<InternalDialogRequest, { kind: "alert" }>, "resolve">;

export type ConfirmDialogState = Omit<Extract<InternalDialogRequest, { kind: "confirm" }>, "resolve">;

export type PromptDialogState = Omit<Extract<InternalDialogRequest, { kind: "prompt" }>, "resolve">;

export type ActiveDialogState = AlertDialogState | ConfirmDialogState | PromptDialogState;

let dialogSeed = 1;
let currentDialog: InternalDialogRequest | null = null;
let currentDialogSnapshot: ActiveDialogState | null = null;
const pendingDialogs: InternalDialogRequest[] = [];
const listeners = new Set<DialogListener>();

function notifyDialogListeners() {
  listeners.forEach((listener) => listener());
}

function syncCurrentDialogSnapshot() {
  if (!currentDialog) {
    currentDialogSnapshot = null;
    return;
  }
  const { resolve: _resolve, ...dialog } = currentDialog;
  currentDialogSnapshot = dialog;
}

function activateNextDialog() {
  if (currentDialog || pendingDialogs.length === 0) {
    return;
  }
  currentDialog = pendingDialogs.shift() ?? null;
  syncCurrentDialogSnapshot();
  notifyDialogListeners();
}

function enqueueDialog<T>(dialog: Omit<InternalDialogRequest, "id" | "resolve">, resolve: (value: T) => void) {
  pendingDialogs.push({
    ...dialog,
    id: dialogSeed++,
    resolve,
  } as InternalDialogRequest);
  activateNextDialog();
}

function normalizeAlertOptions(options: string | AlertDialogOptions) {
  if (typeof options === "string") {
    return {
      title: "提示",
      message: options,
      confirmText: "我知道了",
      intent: "primary" as const,
      dismissible: true,
    };
  }
  return {
    title: options.title ?? "提示",
    message: options.message,
    description: options.description,
    confirmText: options.confirmText ?? "我知道了",
    intent: options.intent ?? "primary",
    dismissible: options.dismissible ?? true,
  };
}

function normalizeConfirmOptions(options: string | ConfirmDialogOptions) {
  if (typeof options === "string") {
    return {
      title: "请确认",
      message: options,
      confirmText: "确认",
      cancelText: "取消",
      intent: "warning" as const,
      dismissible: false,
    };
  }
  return {
    title: options.title ?? "请确认",
    message: options.message,
    description: options.description,
    confirmText: options.confirmText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    intent: options.intent ?? "warning",
    dismissible: options.dismissible ?? false,
  };
}

function normalizePromptOptions(options: string | PromptDialogOptions) {
  if (typeof options === "string") {
    return {
      title: "请输入",
      message: options,
      inputLabel: "内容",
      placeholder: "请输入内容",
      defaultValue: "",
      confirmText: "确认",
      cancelText: "取消",
      intent: "primary" as const,
      dismissible: false,
    };
  }
  return {
    title: options.title ?? "请输入",
    message: options.message,
    description: options.description,
    inputLabel: options.inputLabel ?? "内容",
    placeholder: options.placeholder ?? "请输入内容",
    defaultValue: options.defaultValue ?? "",
    confirmText: options.confirmText ?? "确认",
    cancelText: options.cancelText ?? "取消",
    intent: options.intent ?? "primary",
    dismissible: options.dismissible ?? false,
  };
}

/**
 * @author kongweiguang
 * 订阅当前全局弹框状态，供宿主组件渲染自定义对话框。
 */
export function subscribeDialogState(listener: DialogListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * @author kongweiguang
 * 返回当前正在显示的全局弹框状态。
 */
export function getDialogStateSnapshot(): ActiveDialogState | null {
  return currentDialogSnapshot;
}

/**
 * @author kongweiguang
 * 以自定义弹框替代浏览器原生 alert。
 */
export function showAlert(options: string | AlertDialogOptions) {
  return new Promise<void>((resolve) => {
    enqueueDialog(
      {
        kind: "alert",
        options: normalizeAlertOptions(options),
      },
      resolve,
    );
  });
}

/**
 * @author kongweiguang
 * 以自定义弹框替代浏览器原生 confirm。
 */
export function showConfirm(options: string | ConfirmDialogOptions) {
  return new Promise<boolean>((resolve) => {
    enqueueDialog(
      {
        kind: "confirm",
        options: normalizeConfirmOptions(options),
      },
      resolve,
    );
  });
}

/**
 * @author kongweiguang
 * 以自定义弹框替代浏览器原生 prompt。
 */
export function showPrompt(options: string | PromptDialogOptions) {
  return new Promise<string | null>((resolve) => {
    enqueueDialog(
      {
        kind: "prompt",
        options: normalizePromptOptions(options),
      },
      resolve,
    );
  });
}

/**
 * @author kongweiguang
 * 关闭当前弹框并按类型回填结果，由宿主组件在用户点击按钮时调用。
 */
export function resolveActiveDialog(result?: boolean | string | null) {
  if (!currentDialog) {
    return;
  }
  const dialog = currentDialog;
  currentDialog = null;
  syncCurrentDialogSnapshot();
  if (dialog.kind === "alert") {
    dialog.resolve();
  } else if (dialog.kind === "confirm") {
    dialog.resolve(Boolean(result));
  } else {
    dialog.resolve(typeof result === "string" ? result : null);
  }
  notifyDialogListeners();
  queueMicrotask(activateNextDialog);
}

/**
 * @author kongweiguang
 * 测试辅助：重置弹框队列和当前状态，避免用例间串扰。
 */
export function resetDialogServiceForTest() {
  currentDialog = null;
  currentDialogSnapshot = null;
  pendingDialogs.length = 0;
  listeners.clear();
  dialogSeed = 1;
}
