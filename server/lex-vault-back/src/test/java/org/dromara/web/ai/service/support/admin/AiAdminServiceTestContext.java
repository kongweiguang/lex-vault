package org.dromara.web.ai.service.support.admin;

import org.dromara.system.mapper.SysUserMapper;
import org.dromara.web.ai.mapper.AiPackageMapper;
import org.dromara.web.ai.mapper.AiPackageUpstreamMapper;
import org.dromara.web.ai.mapper.AiUsageRecordMapper;
import org.dromara.web.ai.mapper.AiUserPackageBindingMapper;
import org.dromara.web.ai.service.impl.AiAdminServiceImpl;

import java.time.Clock;

import static org.mockito.Mockito.mock;

/**
 * AI 管理域服务测试上下文。
 *
 * <p>集中维护 mapper mock 与 service 实例，避免各个场景测试重复拼装。</p>
 *
 * @author kongweiguang
 */
public final class AiAdminServiceTestContext {

    public final AiPackageMapper packageMapper;
    public final AiPackageUpstreamMapper upstreamMapper;
    public final AiUserPackageBindingMapper bindingMapper;
    public final AiUsageRecordMapper usageRecordMapper;
    public final SysUserMapper userMapper;
    public final AiAdminServiceImpl service;

    private AiAdminServiceTestContext(Clock aiBusinessClock) {
        this.packageMapper = mock(AiPackageMapper.class);
        this.upstreamMapper = mock(AiPackageUpstreamMapper.class);
        this.bindingMapper = mock(AiUserPackageBindingMapper.class);
        this.usageRecordMapper = mock(AiUsageRecordMapper.class);
        this.userMapper = mock(SysUserMapper.class);
        this.service = new AiAdminServiceImpl(
            packageMapper,
            upstreamMapper,
            bindingMapper,
            usageRecordMapper,
            userMapper,
            aiBusinessClock
        );
    }

    public static AiAdminServiceTestContext create() {
        return new AiAdminServiceTestContext(Clock.systemDefaultZone());
    }

    public static AiAdminServiceTestContext create(Clock aiBusinessClock) {
        return new AiAdminServiceTestContext(aiBusinessClock);
    }
}
