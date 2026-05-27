package org.dromara.web.ai.service.impl.admin.binding;

import org.dromara.common.core.exception.ServiceException;
import org.dromara.web.ai.domain.entity.AiUserPackageBinding;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.form.AiUserPackageBindingForm;
import org.dromara.web.ai.domain.vo.AiUserPackageBindingVo;
import org.dromara.web.ai.service.support.admin.AiAdminServiceTestContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * AI 用户套餐绑定测试。
 *
 * @author kongweiguang
 */
@Tag("ai.admin")
@Tag("ai.admin.binding")
@Tag("dev")
@DisplayName("AI 用户套餐绑定测试")
class AiAdminServiceUserPackageBindingTest {

    @Test
    @DisplayName("绑定用户套餐时必须传入结束时间")
    void shouldRequireEffectiveToWhenBindingUserPackage() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();
        when(context.packageMapper.selectById(3L)).thenReturn(createEnabledPackage());

        AiUserPackageBindingForm form = createBindingForm();
        form.setEffectiveTo("");

        assertThrows(ServiceException.class, () -> context.service.bindUserPackage(form));
    }

    @Test
    @DisplayName("绑定用户套餐时结束时间必须晚于开始时间")
    void shouldRequireEffectiveToAfterEffectiveFromWhenBindingUserPackage() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();
        when(context.packageMapper.selectById(3L)).thenReturn(createEnabledPackage());

        AiUserPackageBindingForm form = createBindingForm();
        form.setEffectiveFrom("2026-05-27T10:00:00");
        form.setEffectiveTo("2026-05-27T10:00:00");

        assertThrows(ServiceException.class, () -> context.service.bindUserPackage(form));
    }

    @Test
    @DisplayName("绑定用户套餐时应直接按服务器本地时间解析")
    void shouldParseLocalDateTimeWhenBindingUserPackage() throws Exception {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();
        Method method = context.service.getClass()
            .getDeclaredMethod("parseDateTimeRequired", String.class, String.class);
        method.setAccessible(true);

        LocalDateTime effectiveFrom = (LocalDateTime) method.invoke(context.service, "2026-05-27T10:00:00", "开始时间不能为空");
        LocalDateTime effectiveTo = (LocalDateTime) method.invoke(context.service, "2026-06-26T10:00:00", "结束时间不能为空");

        assertEquals(LocalDateTime.of(2026, 5, 27, 10, 0, 0), effectiveFrom);
        assertEquals(LocalDateTime.of(2026, 6, 26, 10, 0, 0), effectiveTo);
    }

    @Test
    @DisplayName("查询当前绑定时应直接回显服务器本地时间")
    void shouldFormatCurrentBindingWithServerLocalTime() {
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create();
        when(context.packageMapper.selectById(3L)).thenReturn(createEnabledPackage());

        AiUserPackageBinding binding = new AiUserPackageBinding();
        binding.setId(11L);
        binding.setUserId(9L);
        binding.setPackageId(3L);
        binding.setStatus("0");
        binding.setEffectiveFrom(LocalDateTime.of(2026, 5, 27, 2, 0, 0));
        binding.setEffectiveTo(LocalDateTime.of(2026, 6, 26, 2, 0, 0));
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(binding);

        AiUserPackageBindingVo currentBinding = context.service.getCurrentBinding(9L);

        assertNotNull(currentBinding);
        assertEquals("2026-05-27 02:00:00", currentBinding.getEffectiveFrom());
        assertEquals("2026-06-26 02:00:00", currentBinding.getEffectiveTo());
    }

    @Test
    @DisplayName("查询当前绑定时应使用固定东八区业务时钟")
    void shouldUseShanghaiBusinessClockWhenQueryingCurrentBinding() {
        Clock businessClock = Clock.fixed(Instant.parse("2026-05-27T02:05:06Z"), ZoneId.of("Asia/Shanghai"));
        AiAdminServiceTestContext context = AiAdminServiceTestContext.create(businessClock);
        when(context.bindingMapper.selectCurrentBinding(eq(9L), any(LocalDateTime.class))).thenReturn(null);

        context.service.getCurrentBinding(9L);

        ArgumentCaptor<LocalDateTime> nowCaptor = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(context.bindingMapper).selectCurrentBinding(eq(9L), nowCaptor.capture());
        assertEquals(LocalDateTime.of(2026, 5, 27, 10, 5, 6), nowCaptor.getValue());
    }

    private AiUserPackageBindingForm createBindingForm() {
        AiUserPackageBindingForm form = new AiUserPackageBindingForm();
        form.setUserId(9L);
        form.setPackageId(3L);
        form.setEffectiveFrom("2026-05-27T10:00:00");
        form.setEffectiveTo("2026-06-26T10:00:00");
        return form;
    }

    private AiPackage createEnabledPackage() {
        AiPackage aiPackage = new AiPackage();
        aiPackage.setId(3L);
        aiPackage.setPackageCode("pro");
        aiPackage.setPackageName("专业套餐");
        aiPackage.setStatus("0");
        aiPackage.setFiveHourTokenLimit(100L);
        aiPackage.setWeeklyTokenLimit(1000L);
        return aiPackage;
    }

}
