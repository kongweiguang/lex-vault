package org.dromara.web.ai.domain.vo;

/**
 * AI 用户套餐绑定视图对象。
 *
 * @author kongweiguang
 */
public class AiUserPackageBindingVo {

    /**
     * 绑定主键。
     */
    private Long id;

    /**
     * 用户主键。
     */
    private Long userId;

    /**
     * 用户名称。
     */
    private String userName;

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

    /**
     * 状态。
     */
    private String status;

    /**
     * 生效开始时间。
     */
    private String effectiveFrom;

    /**
     * 生效结束时间。
     */
    private String effectiveTo;

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
