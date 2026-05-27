package org.dromara.web.ai.service.impl.admin.usage.summary;

import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiUsageRecord;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.service.support.admin.AiAdminServiceTestContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * AI 管理域服务当前用户套餐汇总测试。
 *
 * @author kongweiguang
 */
@Tag("ai.admin")
@Tag("ai.admin.summary")
@Tag("dev")
@DisplayName("AI 管理域服务当前用户套餐汇总测试")
class AiAdminServiceCurrentUserSummaryTest {

    @Test
    @DisplayName("当前用户套餐汇总应返回百分比字段")
    void shouldExposeQuotaPercentagesForCurrentUserSummary() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        AiUserPackageBinding binding = createCurrentBinding();
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = createPackage(200L, 400L);
        when(context.packageMapper.selectById(3L)).thenReturn(aiPackage);

        AiUsageRecord firstRecord = createUsageRecord(1L, 30L, LocalDateTime.of(2026, 1, 1, 1, 0, 0));
        when(context.usageRecordMapper.selectFirstSuccessRecordBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(firstRecord);
        when(context.usageRecordMapper.sumSuccessTokensBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class)))
            .thenReturn(50L)
            .thenReturn(100L);

        AiUsageSummaryVo summary = context.service.getCurrentUserPackageSummary(9L);

        assertNotNull(summary);
        assertEquals("pro", summary.getPackageCode());
        assertEquals("专业套餐", summary.getPackageName());
        assertEquals("2026-01-01 00:00:00", summary.getPackageEffectiveFrom());
        assertEquals(25D, summary.getFiveHourQuotaPercent());
        assertEquals(25D, summary.getWeeklyQuotaPercent());
    }

    @Test
    @DisplayName("当前用户套餐汇总应按首次成功用量计算 5 小时固定周期恢复时间")
    void shouldExposeFiveHourFixedCycleAvailableAtForExceededSummary() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        AiUserPackageBinding binding = createCurrentBinding();
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = createPackage(100L, 1000L);
        when(context.packageMapper.selectById(3L)).thenReturn(aiPackage);

        AiUsageRecord firstRecord = createUsageRecord(1L, 30L, LocalDateTime.of(2026, 1, 1, 1, 0, 0));
        when(context.usageRecordMapper.selectFirstSuccessRecordBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(firstRecord);
        when(context.usageRecordMapper.sumSuccessTokensBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class)))
            .thenReturn(120L)
            .thenReturn(300L);

        AiUsageSummaryVo summary = context.service.getCurrentUserPackageSummary(9L);
        String expectedAvailableAt = expectedFixedCycleEnd(firstRecord.getOccurredAt(), java.time.Duration.ofHours(5))
            .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

        assertNotNull(summary);
        assertEquals(expectedAvailableAt, summary.getFiveHourQuotaAvailableAt());
        assertEquals(expectedAvailableAt, summary.getFiveHourNextRefreshAt());
        assertEquals(expectedAvailableAt, summary.getQuotaAvailableAt());
    }

    @Test
    @DisplayName("当前用户套餐汇总应按套餐开始时间计算 7 天固定周期刷新时间")
    void shouldExposeWeeklyFixedCycleNextRefreshAtEvenWhenQuotaIsAvailable() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        AiUserPackageBinding binding = createCurrentBinding();
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = createPackage(300L, 1000L);
        when(context.packageMapper.selectById(3L)).thenReturn(aiPackage);

        AiUsageRecord firstRecord = createUsageRecord(1L, 30L, LocalDateTime.of(2026, 1, 1, 1, 0, 0));
        when(context.usageRecordMapper.selectFirstSuccessRecordBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(firstRecord);
        when(context.usageRecordMapper.sumSuccessTokensBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class)))
            .thenReturn(120L)
            .thenReturn(300L);

        AiUsageSummaryVo summary = context.service.getCurrentUserPackageSummary(9L);

        assertNotNull(summary);
        assertEquals(expectedFixedCycleEnd(firstRecord.getOccurredAt(), java.time.Duration.ofHours(5)).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), summary.getFiveHourNextRefreshAt());
        assertEquals(expectedFixedCycleEnd(binding.getEffectiveFrom(), java.time.Duration.ofDays(7)).format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")), summary.getWeeklyNextRefreshAt());
    }

    @Test
    @DisplayName("当前套餐存在生效截止时间时返回的刷新时间不应晚于截止时间")
    void shouldCapRefreshTimesWithinCurrentBindingWindow() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        AiUserPackageBinding binding = createCurrentBinding();
        binding.setEffectiveTo(LocalDateTime.of(2026, 1, 20, 0, 0, 0));
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = createPackage(300L, 1000L);
        when(context.packageMapper.selectById(3L)).thenReturn(aiPackage);

        AiUsageRecord firstRecord = createUsageRecord(1L, 30L, LocalDateTime.of(2026, 1, 1, 1, 0, 0));
        when(context.usageRecordMapper.selectFirstSuccessRecordBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class))).thenReturn(firstRecord);
        when(context.usageRecordMapper.sumSuccessTokensBetween(eq(9L), any(LocalDateTime.class), any(LocalDateTime.class)))
            .thenReturn(120L)
            .thenReturn(300L);

        AiUsageSummaryVo summary = context.service.getCurrentUserPackageSummary(9L);

        assertNotNull(summary);
        assertEquals("2026-01-20 00:00:00", summary.getPackageEffectiveTo());
        assertEquals("2026-01-20 00:00:00", summary.getWeeklyNextRefreshAt());
    }

    @Test
    @DisplayName("当前绑定对应的套餐停用时不应返回可用套餐汇总")
    void shouldNotExposeSummaryWhenCurrentPackageIsDisabled() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();

        AiUserPackageBinding binding = createCurrentBinding();
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiPackage aiPackage = createPackage(300L, 1000L);
        aiPackage.setStatus("1");
        when(context.packageMapper.selectById(3L)).thenReturn(aiPackage);

        assertNull(context.service.getCurrentUserPackageSummary(9L));
    }

    private AiUserPackageBinding createCurrentBinding() {
        AiUserPackageBinding binding = new AiUserPackageBinding();
        binding.setUserId(9L);
        binding.setPackageId(3L);
        binding.setEffectiveFrom(LocalDateTime.of(2026, 1, 1, 0, 0, 0));
        binding.setEffectiveTo(LocalDateTime.of(2027, 1, 1, 0, 0, 0));
        return binding;
    }

    private AiPackage createPackage(Long fiveHourLimit, Long weeklyLimit) {
        AiPackage aiPackage = new AiPackage();
        aiPackage.setId(3L);
        aiPackage.setPackageCode("pro");
        aiPackage.setPackageName("专业套餐");
        aiPackage.setStatus("0");
        aiPackage.setFiveHourTokenLimit(fiveHourLimit);
        aiPackage.setWeeklyTokenLimit(weeklyLimit);
        return aiPackage;
    }

    private AiUsageRecord createUsageRecord(Long id, Long totalTokens, LocalDateTime occurredAt) {
        AiUsageRecord record = new AiUsageRecord();
        record.setId(id);
        record.setTotalTokens(totalTokens);
        record.setOccurredAt(occurredAt);
        return record;
    }

    private LocalDateTime expectedFixedCycleEnd(LocalDateTime anchorAt, java.time.Duration cycle) {
        LocalDateTime now = LocalDateTime.now();
        long elapsedMillis = java.time.Duration.between(anchorAt, now).toMillis();
        long cycleIndex = Math.max(0L, elapsedMillis / cycle.toMillis());
        LocalDateTime cycleStart = anchorAt.plus(cycle.multipliedBy(cycleIndex));
        while (!cycleStart.plus(cycle).isAfter(now)) {
            cycleStart = cycleStart.plus(cycle);
        }
        return cycleStart.plus(cycle);
    }
}
