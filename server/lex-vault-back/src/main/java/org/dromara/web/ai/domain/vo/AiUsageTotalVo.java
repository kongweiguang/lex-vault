package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 用量汇总统计视图对象。
 *
 * @author kongweiguang
 */
@Data
public class AiUsageTotalVo {

    /**
     * 请求总数。
     */
    private Long requestCount;

    /**
     * 成功请求数。
     */
    private Long successCount;

    /**
     * 输入 token 总量。
     */
    private Long inputTokens;

    /**
     * 输出 token 总量。
     */
    private Long outputTokens;

    /**
     * 总 token 总量。
     */
    private Long totalTokens;
}
