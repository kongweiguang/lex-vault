package org.dromara.web.ai.domain;

import lombok.Data;

import java.util.Collections;
import java.util.List;

/**
 * AI 管理端分页返回对象。
 *
 * @param <T> 列表元素类型
 * @author kongweiguang
 */
@Data
public class AiPageResult<T> {

    /**
     * 业务状态码，兼容现有管理端列表返回结构。
     */
    private Integer code = 200;

    /**
     * 提示消息。
     */
    private String msg = "查询成功";

    /**
     * 数据列表。
     */
    private List<T> rows = Collections.emptyList();

    /**
     * 总记录数。
     */
    private Long total = 0L;

}
