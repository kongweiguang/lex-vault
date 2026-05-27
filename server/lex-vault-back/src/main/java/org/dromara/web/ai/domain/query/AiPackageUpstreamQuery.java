package org.dromara.web.ai.domain.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AI 套餐上游节点查询对象。
 *
 * @author kongweiguang
 */
@Data
@EqualsAndHashCode(callSuper = true)
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

}
