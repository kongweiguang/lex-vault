package org.dromara.web.ai.domain.query;

import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * AI 套餐分页查询对象。
 *
 * @author kongweiguang
 */
@Data
@EqualsAndHashCode(callSuper = true)
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

}
