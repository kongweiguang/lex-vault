package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotNull;

/**
 * AI 用户套餐绑定表单。
 *
 * @author kongweiguang
 */
public class AiUserPackageBindingForm {

    /**
     * 用户主键。
     */
    @NotNull(message = "用户主键不能为空")
    private Long userId;

    /**
     * 套餐主键。
     */
    @NotNull(message = "套餐主键不能为空")
    private Long packageId;

    /**
     * 生效开始时间，ISO 本地时间字符串。
     */
    private String effectiveFrom;

    /**
     * 生效结束时间，ISO 本地时间字符串。
     */
    private String effectiveTo;

    /**
     * 备注。
     */
    private String remark;

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

    public String getEffectiveFrom() {
        return effectiveFrom;
    }

    public void setEffectiveFrom(String effectiveFrom) {
        this.effectiveFrom = effectiveFrom;
    }

    public String getEffectiveTo() {
        return effectiveTo;
    }

    public void setEffectiveTo(String effectiveTo) {
        this.effectiveTo = effectiveTo;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
    }
}
