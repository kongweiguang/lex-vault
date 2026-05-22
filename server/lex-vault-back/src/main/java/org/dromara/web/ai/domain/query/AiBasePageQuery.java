package org.dromara.web.ai.domain.query;

/**
 * AI 管理端基础分页查询对象。
 *
 * @author kongweiguang
 */
public class AiBasePageQuery {

    /**
     * 当前页码。
     */
    private long pageNum = 1;

    /**
     * 每页条数。
     */
    private long pageSize = 10;

    public long getPageNum() {
        return pageNum;
    }

    public void setPageNum(long pageNum) {
        this.pageNum = pageNum;
    }

    public long getPageSize() {
        return pageSize;
    }

    public void setPageSize(long pageSize) {
        this.pageSize = pageSize;
    }
}
