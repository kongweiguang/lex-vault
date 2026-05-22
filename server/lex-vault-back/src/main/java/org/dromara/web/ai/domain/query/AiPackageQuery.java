package org.dromara.web.ai.domain.query;

/**
 * AI 套餐分页查询对象。
 *
 * @author kongweiguang
 */
public class AiPackageQuery extends AiBasePageQuery {

    /**
     * 套餐名称关键字。
     */
    private String packageName;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 状态。
     */
    private String status;

    public String getPackageName() {
        return packageName;
    }

    public void setPackageName(String packageName) {
        this.packageName = packageName;
    }

    public String getPackageCode() {
        return packageCode;
    }

    public void setPackageCode(String packageCode) {
        this.packageCode = packageCode;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
