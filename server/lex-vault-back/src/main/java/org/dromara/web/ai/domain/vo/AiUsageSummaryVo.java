package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 用户窗口用量汇总视图对象。
 *
 * @author kongweiguang
 */
@Data
public class AiUsageSummaryVo {

    /**
     * 用户主键。
     */
    private Long userId;

    /**
     * 用户名。
     */
    private String userName;

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

    /**
     * 当前套餐生效开始时间。
     */
    private String packageEffectiveFrom;

    /**
     * 当前套餐到期时间；长期有效时为空。
     */
    private String packageEffectiveTo;

    /**
     * 最近 5 小时已用 token。
     */
    private Long fiveHourUsedTokens;

    /**
     * 最近 5 小时限额。
     */
    private Long fiveHourTokenLimit;

    /**
     * 最近 7 天已用 token。
     */
    private Long weeklyUsedTokens;

    /**
     * 最近 7 天限额。
     */
    private Long weeklyTokenLimit;

    /**
     * 最近 5 小时额度百分比。
     */
    private Double fiveHourQuotaPercent;

    /**
     * 最近 5 小时额度恢复可用时间；未触发该窗口限额时为空。
     */
    private String fiveHourQuotaAvailableAt;

    /**
     * 最近 5 小时额度下次刷新时间点；当前窗口无成功用量时为空。
     */
    private String fiveHourNextRefreshAt;

    /**
     * 最近 7 天额度百分比。
     */
    private Double weeklyQuotaPercent;

    /**
     * 最近 7 天额度恢复可用时间；未触发该窗口限额时为空。
     */
    private String weeklyQuotaAvailableAt;

    /**
     * 最近 7 天额度下次刷新时间点；当前窗口无成功用量时为空。
     */
    private String weeklyNextRefreshAt;

    /**
     * 综合额度恢复可用时间；多个窗口同时超限时取最晚恢复时间，当前可用时为空。
     */
    private String quotaAvailableAt;

}
