package org.dromara.web.ai.domain;

import java.util.Collections;
import java.util.List;

/**
 * AI 管理端分页返回对象。
 *
 * @param <T> 列表元素类型
 * @author kongweiguang
 */
public class AiPageResult<T> {

    /**
     * 业务状态码，兼容现有管理端列表返回结构。
     */
    private int code = 200;

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
    private long total;

    /**
     * 获取数据列表。
     *
     * @return 数据列表
     */
    public List<T> getRows() {
        return rows;
    }

    /**
     * 设置数据列表。
     *
     * @param rows 数据列表
     */
    public void setRows(List<T> rows) {
        this.rows = rows;
    }

    public int getCode() {
        return code;
    }

    public void setCode(int code) {
        this.code = code;
    }

    public String getMsg() {
        return msg;
    }

    public void setMsg(String msg) {
        this.msg = msg;
    }

    /**
     * 获取总记录数。
     *
     * @return 总记录数
     */
    public long getTotal() {
        return total;
    }

    /**
     * 设置总记录数。
     *
     * @param total 总记录数
     */
    public void setTotal(long total) {
        this.total = total;
    }
}
