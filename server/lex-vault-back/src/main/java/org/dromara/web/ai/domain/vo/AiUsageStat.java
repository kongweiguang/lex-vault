package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 上游 usage 解析结果。
 *
 * @author kongweiguang
 */
@Data
public class AiUsageStat {

    /**
     * 输入 token。
     */
    private Long inputTokens;

    /**
     * 输出 token。
     */
    private Long outputTokens;

    /**
     * 总 token。
     */
    private Long totalTokens;

}
