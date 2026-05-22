package org.dromara.web.ai.domain.vo;

/**
 * AI 用量流水视图对象。
 *
 * @author kongweiguang
 */
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

    public String getUserName() {
        return userName;
    }

    public void setUserName(String userName) {
        this.userName = userName;
    }

    public Long getPackageId() {
        return packageId;
    }

    public void setPackageId(Long packageId) {
        this.packageId = packageId;
    }

    public String getPackageName() {
        return packageName;
    }

    public void setPackageName(String packageName) {
        this.packageName = packageName;
    }

    public Long getUpstreamId() {
        return upstreamId;
    }

    public void setUpstreamId(Long upstreamId) {
        this.upstreamId = upstreamId;
    }

    public String getUpstreamName() {
        return upstreamName;
    }

    public void setUpstreamName(String upstreamName) {
        this.upstreamName = upstreamName;
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

    public String getOccurredAt() {
        return occurredAt;
    }

    public void setOccurredAt(String occurredAt) {
        this.occurredAt = occurredAt;
    }
}
