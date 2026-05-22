package org.dromara.web.ai.domain.vo;

/**
 * AI 上游 usage 解析结果。
 *
 * @author kongweiguang
 */
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

    public Long getInputTokens() {
        return inputTokens;
    }

    public void setInputTokens(Long inputTokens) {
        this.inputTokens = inputTokens;
    }

    public Long getOutputTokens() {
        return outputTokens;
    }

    public void setOutputTokens(Long outputTokens) {
        this.outputTokens = outputTokens;
    }

    public Long getTotalTokens() {
        return totalTokens;
    }

    public void setTotalTokens(Long totalTokens) {
        this.totalTokens = totalTokens;
    }
}
