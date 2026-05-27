package org.dromara.web.ai.domain.query;

import lombok.Data;

/**
 * AI 管理端基础分页查询对象。
 *
 * @author kongweiguang
 */
@Data
public class AiBasePageQuery {

    /**
     * 当前页码。
     */
    private Long pageNum = 1L;

    /**
     * 每页条数。
     */
    private Long pageSize = 10L;

}
