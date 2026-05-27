package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI 用量流水实体。
 *
 * @author kongweiguang
 */
@Data
@TableName("ai_usage_record")
public class AiUsageRecord {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 请求唯一标识。
     */
    private String requestId;

    /**
     * 用户主键。
     */
    private Long userId;

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 上游主键。
     */
    private Long upstreamId;

    /**
     * 是否流式调用。
     */
    private Boolean streaming;

    /**
     * 输入 token 数。
     */
    private Long inputTokens;

    /**
     * 输出 token 数。
     */
    private Long outputTokens;

    /**
     * 总 token 数。
     */
    private Long totalTokens;

    /**
     * 用量来源，例如 upstream_usage。
     */
    private String usageSource;

    /**
     * 请求状态：success/failed/incomplete/rejected。
     */
    private String requestStatus;

    /**
     * 拒绝或失败原因。
     */
    private String rejectReason;

    /**
     * 发生时间，统一按 UTC 存储。
     */
    private LocalDateTime occurredAt;

    /**
     * 创建时间。
     */
    private LocalDateTime createTime;

    /**
     * 更新时间。
     */
    private LocalDateTime updateTime;

}
