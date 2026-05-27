package org.dromara.web.ai.domain.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AI 用量流水分页查询对象。
 *
 * @author kongweiguang
 */
@Data
@EqualsAndHashCode(callSuper = true)
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

}
