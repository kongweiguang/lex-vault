package org.dromara.web.ai.domain.vo;

/**
 * AI 配额窗口快照。
 *
 * @author kongweiguang
 */
public class AiUsageSnapshot {

    /**
     * 最近 5 小时已用 token。
     */
    private Long fiveHourUsedTokens;

    /**
     * 最近 7 天已用 token。
     */
    private Long weeklyUsedTokens;

    /**
     * 当前自然月已用 token。
     */
    private Long monthlyUsedTokens;

    public Long getFiveHourUsedTokens() {
        return fiveHourUsedTokens;
    }

    public void setFiveHourUsedTokens(Long fiveHourUsedTokens) {
        this.fiveHourUsedTokens = fiveHourUsedTokens;
    }

    public Long getWeeklyUsedTokens() {
        return weeklyUsedTokens;
    }

    public void setWeeklyUsedTokens(Long weeklyUsedTokens) {
        this.weeklyUsedTokens = weeklyUsedTokens;
    }

    public Long getMonthlyUsedTokens() {
        return monthlyUsedTokens;
    }

    public void setMonthlyUsedTokens(Long monthlyUsedTokens) {
        this.monthlyUsedTokens = monthlyUsedTokens;
    }
}
