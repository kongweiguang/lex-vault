package org.dromara.web.ai.service.impl;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.dromara.system.mapper.SysUserMapper;
import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.query.AiUsageQuery;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.mapper.AiPackageMapper;
import org.dromara.web.ai.mapper.AiPackageUpstreamMapper;
import org.dromara.web.ai.mapper.AiUsageRecordMapper;
import org.dromara.web.ai.mapper.AiUserPackageBindingMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 管理域服务测试。
 *
 * @author kongweiguang
 */
@Tag("ai.admin")
@DisplayName("AI 管理域服务测试")
class AiAdminServiceImplTest {

    @Test
    @DisplayName("用量列表为空时不应触发套餐与上游空 IN 查询")
    void shouldSkipBatchLookupWhenUsagePageIsEmpty() {
        AiPackageMapper packageMapper = mock(AiPackageMapper.class);
        AiPackageUpstreamMapper upstreamMapper = mock(AiPackageUpstreamMapper.class);
        AiUserPackageBindingMapper bindingMapper = mock(AiUserPackageBindingMapper.class);
        AiUsageRecordMapper usageRecordMapper = mock(AiUsageRecordMapper.class);
        SysUserMapper userMapper = mock(SysUserMapper.class);
        AiAdminServiceImpl service = new AiAdminServiceImpl(packageMapper, upstreamMapper, bindingMapper, usageRecordMapper, userMapper);

        Page<AiUsageRecord> page = new Page<>(1, 10);
        page.setRecords(Collections.emptyList());
        page.setTotal(0L);
        when(usageRecordMapper.selectPage(any(Page.class), any())).thenReturn(page);

        AiUsageQuery query = new AiUsageQuery();
        query.setPageNum(1L);
        query.setPageSize(10L);

        AiPageResult<?> result = service.listUsageRecords(query);

        assertNotNull(result);
        assertEquals(0L, result.getTotal());
        assertEquals(0, result.getRows().size());
        verify(packageMapper, never()).selectBatchIds(any());
        verify(upstreamMapper, never()).selectBatchIds(any());
    }

    @Test
    @Tag("ai.admin.summary")
    @DisplayName("当前用户套餐汇总应返回百分比字段")
    void shouldExposeQuotaPercentagesForCurrentUserSummary() {
        AiPackageMapper packageMapper = mock(AiPackageMapper.class);
        AiPackageUpstreamMapper upstreamMapper = mock(AiPackageUpstreamMapper.class);
        AiUserPackageBindingMapper bindingMapper = mock(AiUserPackageBindingMapper.class);
        AiUsageRecordMapper usageRecordMapper = mock(AiUsageRecordMapper.class);
        SysUserMapper userMapper = mock(SysUserMapper.class);
        AiAdminServiceImpl service = new AiAdminServiceImpl(packageMapper, upstreamMapper, bindingMapper, usageRecordMapper, userMapper);

        AiUserPackageBinding binding = new AiUserPackageBinding();
        binding.setUserId(9L);
        binding.setPackageId(3L);
        when(bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = new AiPackage();
        aiPackage.setId(3L);
        aiPackage.setPackageCode("pro");
        aiPackage.setPackageName("专业套餐");
        aiPackage.setFiveHourTokenLimit(200L);
        aiPackage.setWeeklyTokenLimit(400L);
        aiPackage.setMonthlyTokenLimit(800L);
        when(packageMapper.selectById(3L)).thenReturn(aiPackage);

        when(usageRecordMapper.sumSuccessTokensSince(eq(9L), any(LocalDateTime.class)))
            .thenReturn(50L)
            .thenReturn(100L)
            .thenReturn(200L);

        AiUsageSummaryVo summary = service.getCurrentUserPackageSummary(9L);

        assertNotNull(summary);
        assertEquals("pro", summary.getPackageCode());
        assertEquals("专业套餐", summary.getPackageName());
        assertEquals(25D, summary.getFiveHourQuotaPercent());
        assertEquals(25D, summary.getWeeklyQuotaPercent());
        assertEquals(25D, summary.getMonthlyQuotaPercent());
    }
}
