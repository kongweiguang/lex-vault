package org.dromara.web.ai.domain.vo;

import lombok.Getter;
import lombok.Setter;

/**
 * AI 用户窗口用量汇总视图对象。
 *
 * @author kongweiguang
 */
@Setter
@Getter
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
     * 当前自然月已用 token。
     */
    private Long monthlyUsedTokens;

    /**
     * 当前自然月限额。
     */
    private Long monthlyTokenLimit;

    /**
     * 最近 5 小时额度百分比。
     */
    private Double fiveHourQuotaPercent;

    /**
     * 最近 7 天额度百分比。
     */
    private Double weeklyQuotaPercent;

    /**
     * 当前自然月额度百分比。
     */
    private Double monthlyQuotaPercent;

}
