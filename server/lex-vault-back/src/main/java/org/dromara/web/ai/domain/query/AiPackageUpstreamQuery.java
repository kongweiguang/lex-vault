package org.dromara.web.ai.domain.query;

/**
 * AI 套餐上游节点查询对象。
 *
 * @author kongweiguang
 */
public class AiPackageUpstreamQuery extends AiBasePageQuery {

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 上游名称关键字。
     */
    private String upstreamName;

    /**
     * 状态。
     */
    private String status;

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

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
