package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * AI 套餐实体。
 *
 * @author kongweiguang
 */
@TableName("ai_package")
public class AiPackage {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 套餐编码，固定为 plus/pro/max。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

    /**
     * 状态，0 启用，1 停用。
     */
    private String status;

    /**
     * 5 小时滚动窗口 token 限额。
     */
    private Long fiveHourTokenLimit;

    /**
     * 7 天滚动窗口 token 限额。
     */
    private Long weeklyTokenLimit;

    /**
     * 自然月 token 限额。
     */
    private Long monthlyTokenLimit;

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

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
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
