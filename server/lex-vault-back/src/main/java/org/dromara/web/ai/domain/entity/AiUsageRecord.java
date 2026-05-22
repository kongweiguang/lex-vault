package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * AI 用量流水实体。
 *
 * @author kongweiguang
 */
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

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getRequestId() {
        return requestId;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getPackageId() {
        return packageId;
    }

    public void setPackageId(Long packageId) {
        this.packageId = packageId;
    }

    public Long getUpstreamId() {
        return upstreamId;
    }

    public void setUpstreamId(Long upstreamId) {
        this.upstreamId = upstreamId;
    }

    public Boolean getStreaming() {
        return streaming;
    }

    public void setStreaming(Boolean streaming) {
        this.streaming = streaming;
    }

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

    public String getUsageSource() {
        return usageSource;
    }

    public void setUsageSource(String usageSource) {
        this.usageSource = usageSource;
    }

    public String getRequestStatus() {
        return requestStatus;
    }

    public void setRequestStatus(String requestStatus) {
        this.requestStatus = requestStatus;
    }

    public String getRejectReason() {
        return rejectReason;
    }

    public void setRejectReason(String rejectReason) {
        this.rejectReason = rejectReason;
    }

    public LocalDateTime getOccurredAt() {
        return occurredAt;
    }

    public void setOccurredAt(LocalDateTime occurredAt) {
        this.occurredAt = occurredAt;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }
}
