import type { LucideIcon } from "lucide-react";

import type { ThemeMode } from "@/types/domain";

/** 登录弹层表单状态。 */
export type LoginDialogState = {
  /** 登录用户名。 */
  username: string;
  /** 登录密码。 */
  password: string;
  /** 验证码文本。 */
  code: string;
  /** 验证码关联 UUID。 */
  uuid: string;
};

/** 当前验证码展示状态。 */
export type CaptchaState = {
  /** 当前后端是否要求验证码。 */
  enabled: boolean;
  /** 验证码图片 Base64。 */
  imageBase64: string;
};

/** 设置页主题模式选项。 */
export type ThemeOption = {
  /** 用户可见标签。 */
  label: string;
  /** 主题模式值。 */
  value: ThemeMode;
  /** 对应图标。 */
  icon: LucideIcon;
};
