package org.dromara.web.ai.service.impl.admin.usage.list;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.query.AiUsageQuery;
import org.dromara.web.ai.service.support.admin.AiAdminServiceTestContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 管理域服务用量流水查询测试。
 *
 * @author kongweiguang
 */
@Tag("ai.admin")
@Tag("dev")
@DisplayName("AI 管理域服务用量流水查询测试")
class AiAdminServiceUsageRecordQueryTest {

    @Test
    @DisplayName("用量列表为空时不应触发套餐与上游空 IN 查询")
    void shouldSkipBatchLookupWhenUsagePageIsEmpty() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        Page<AiUsageRecord> page = new Page<>(1, 10);
        page.setRecords(Collections.emptyList());
        page.setTotal(0L);
        when(context.usageRecordMapper.selectPage(any(Page.class), any())).thenReturn(page);

        AiUsageQuery query = new AiUsageQuery();
        query.setPageNum(1L);
        query.setPageSize(10L);

        AiPageResult<?> result = context.service.listUsageRecords(query);

        assertNotNull(result);
        assertEquals(0L, result.getTotal());
        assertEquals(0, result.getRows().size());
        verify(context.packageMapper, never()).selectBatchIds(any());
        verify(context.upstreamMapper, never()).selectBatchIds(any());
    }
}
