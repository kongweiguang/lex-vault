package org.dromara.web.ai.domain.vo;

/**
 * AI 套餐下拉选项。
 *
 * @author kongweiguang
 */
public class AiPackageOptionVo {

    /**
     * 套餐主键。
     */
    private Long id;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

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
}
