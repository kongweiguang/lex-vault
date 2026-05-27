package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 用量流水视图对象。
 *
 * @author kongweiguang
 */
@Data
public class AiUsageRecordVo {

    /**
     * 流水主键。
     */
    private Long id;

    /**
     * 请求标识。
     */
    private String requestId;

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
     * 套餐名称。
     */
    private String packageName;

    /**
     * 上游主键。
     */
    private Long upstreamId;

    /**
     * 上游名称。
     */
    private String upstreamName;

    /**
     * 是否流式。
     */
    private Boolean streaming;

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

    /**
     * 用量来源。
     */
    private String usageSource;

    /**
     * 请求状态。
     */
    private String requestStatus;

    /**
     * 原因。
     */
    private String rejectReason;

    /**
     * 发生时间。
     */
    private String occurredAt;

}
