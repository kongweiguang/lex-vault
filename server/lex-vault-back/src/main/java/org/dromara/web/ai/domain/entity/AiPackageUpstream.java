package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * AI 套餐上游节点实体。
 *
 * @author kongweiguang
 */
@TableName("ai_package_upstream")
public class AiPackageUpstream {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 所属套餐主键。
     */
    private Long packageId;

    /**
     * 上游名称。
     */
    private String upstreamName;

    /**
     * 上游基础地址。
     */
    private String baseUrl;

    /**
     * 上游 API Key。
     */
    private String apiKey;

    /**
     * 绑定模型。
     */
    private String model;

    /**
     * 推理配置 JSON。
     */
    private String reasoningJson;

    /**
     * 同优先级内权重。
     */
    private Integer weight;

    /**
     * 优先级，数值越小越优先。
     */
    private Integer priority;

    /**
     * 状态，0 启用，1 停用。
     */
    private String status;

    /**
     * 备注。
     */
    private String remark;

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

    public Long getPackageId() {
        return packageId;
    }

    public void setPackageId(Long packageId) {
        this.packageId = packageId;
    }

    public String getUpstreamName() {
        return upstreamName;
    }

    public void setUpstreamName(String upstreamName) {
        this.upstreamName = upstreamName;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getReasoningJson() {
        return reasoningJson;
    }

    public void setReasoningJson(String reasoningJson) {
        this.reasoningJson = reasoningJson;
    }

    public Integer getWeight() {
        return weight;
    }

    public void setWeight(Integer weight) {
        this.weight = weight;
    }

    public Integer getPriority() {
        return priority;
    }

    public void setPriority(Integer priority) {
        this.priority = priority;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
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
