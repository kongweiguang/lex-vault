package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * AI 套餐上游节点表单。
 *
 * @author kongweiguang
 */
public class AiPackageUpstreamForm {

    /**
     * 主键。
     */
    private Long id;

    /**
     * 所属套餐主键。
     */
    @NotNull(message = "套餐主键不能为空")
    private Long packageId;

    /**
     * 上游名称。
     */
    @NotBlank(message = "上游名称不能为空")
    private String upstreamName;

    /**
     * 上游基础地址。
     */
    @NotBlank(message = "上游地址不能为空")
    private String baseUrl;

    /**
     * API Key。
     */
    private String apiKey;

    /**
     * 模型。
     */
    @NotBlank(message = "模型不能为空")
    private String model;

    /**
     * 推理配置 JSON。
     */
    private String reasoningJson;

    /**
     * 权重。
     */
    @NotNull(message = "权重不能为空")
    private Integer weight;

    /**
     * 优先级。
     */
    @NotNull(message = "优先级不能为空")
    private Integer priority;

    /**
     * 备注。
     */
    private String remark;

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

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
    }
}
