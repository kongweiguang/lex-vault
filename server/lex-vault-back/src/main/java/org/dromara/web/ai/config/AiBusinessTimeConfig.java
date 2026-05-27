package org.dromara.web.ai.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;
import java.time.ZoneId;

/**
 * AI 套餐业务时间配置。
 *
 * <p>统一固定为东八区，避免部署机时区与业务时区不一致时，
 * 出现“绑定成功但当前查询为空”的问题。</p>
 *
 * @author kongweiguang
 */
@Configuration
public class AiBusinessTimeConfig {

    /**
     * AI 套餐业务时区。
     */
    public static final ZoneId AI_BUSINESS_ZONE_ID = ZoneId.of("Asia/Shanghai");

    /**
     * AI 套餐业务时钟。
     *
     * @return 固定东八区时钟
     */
    @Bean
    public Clock aiBusinessClock() {
        return Clock.system(AI_BUSINESS_ZONE_ID);
    }
}
