package org.dromara.web.ai.domain.query;

/**
 * AI 用量流水分页查询对象。
 *
 * @author kongweiguang
 */
public class AiUsageQuery extends AiBasePageQuery {

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
     * 请求状态。
     */
    private String requestStatus;

    /**
     * 开始时间，ISO 本地时间字符串。
     */
    private String occurredFrom;

    /**
     * 结束时间，ISO 本地时间字符串。
     */
    private String occurredTo;

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

    public String getRequestStatus() {
        return requestStatus;
    }

    public void setRequestStatus(String requestStatus) {
        this.requestStatus = requestStatus;
    }

    public String getOccurredFrom() {
        return occurredFrom;
    }

    public void setOccurredFrom(String occurredFrom) {
        this.occurredFrom = occurredFrom;
    }

    public String getOccurredTo() {
        return occurredTo;
    }

    public void setOccurredTo(String occurredTo) {
        this.occurredTo = occurredTo;
    }
}
