package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 配额窗口快照。
 *
 * @author kongweiguang
 */
@Data
public class AiUsageSnapshot {

    /**
     * 最近 5 小时已用 token。
     */
    private Long fiveHourUsedTokens;

    /**
     * 最近 7 天已用 token。
     */
    private Long weeklyUsedTokens;

}
