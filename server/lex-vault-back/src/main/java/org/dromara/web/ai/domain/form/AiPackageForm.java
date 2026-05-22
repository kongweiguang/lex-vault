package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * AI 套餐表单。
 *
 * @author kongweiguang
 */
public class AiPackageForm {

    /**
     * 主键。
     */
    private Long id;

    /**
     * 套餐编码。
     */
    @NotBlank(message = "套餐编码不能为空")
    private String packageCode;

    /**
     * 套餐名称。
     */
    @NotBlank(message = "套餐名称不能为空")
    private String packageName;

    /**
     * 5 小时限额。
     */
    @NotNull(message = "5 小时限额不能为空")
    private Long fiveHourTokenLimit;

    /**
     * 周限额。
     */
    @NotNull(message = "周限额不能为空")
    private Long weeklyTokenLimit;

    /**
     * 月限额。
     */
    @NotNull(message = "月限额不能为空")
    private Long monthlyTokenLimit;

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

    public String getPackageCode() {
        return packageCode;
    }

    public void setPackageCode(String packageCode) {
        this.packageCode = packageCode;
    }

    public String getPackageName() {
        return packageName;
    }

    public void setPackageName(String packageName) {
        this.packageName = packageName;
    }

    public Long getFiveHourTokenLimit() {
        return fiveHourTokenLimit;
    }

    public void setFiveHourTokenLimit(Long fiveHourTokenLimit) {
        this.fiveHourTokenLimit = fiveHourTokenLimit;
    }

    public Long getWeeklyTokenLimit() {
        return weeklyTokenLimit;
    }

    public void setWeeklyTokenLimit(Long weeklyTokenLimit) {
        this.weeklyTokenLimit = weeklyTokenLimit;
    }

    public Long getMonthlyTokenLimit() {
        return monthlyTokenLimit;
    }

    public void setMonthlyTokenLimit(Long monthlyTokenLimit) {
        this.monthlyTokenLimit = monthlyTokenLimit;
    }

    public String getRemark() {
        return remark;
    }

    public void setRemark(String remark) {
        this.remark = remark;
    }
}
