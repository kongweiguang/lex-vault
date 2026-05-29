package org.dromara.web.ai.config;

import lombok.Data;
import org.dromara.web.ai.config.model.AiGatewayFixedUpstreamProperties;
import org.dromara.web.ai.config.model.AiGatewayMultimodalUnderstandingProperties;
import org.dromara.web.ai.config.model.AiGatewayTimeoutProperties;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * AI 网关外部化配置。
 *
 * @author kongweiguang
 */
@Component
@Data
@ConfigurationProperties(prefix = "ai.gateway")
public class AiGatewayProperties {

    /**
     * OpenAI 兼容限流响应 HTTP 状态码。
     */
    private Integer rateLimitStatus = 429;

    /**
     * OpenAI 兼容限流响应错误类型。
     */
    private String rateLimitType = "rate_limit_exceeded";

    /**
     * 允许透传给调用方的上游响应头。
     */
    private List<String> responseHeaders = List.of("Content-Type", "Cache-Control", "Pragma", "Expires");

    /**
     * OkHttp 调用超时配置。
     */
    private AiGatewayTimeoutProperties timeout = new AiGatewayTimeoutProperties();

    /**
     * Chat Completions 固定兼容上游配置。
     */
    private AiGatewayFixedUpstreamProperties chatCompletions = new AiGatewayFixedUpstreamProperties();

    /**
     * Anthropic Messages 固定兼容上游配置。
     */
    private AiGatewayFixedUpstreamProperties anthropicMessages = new AiGatewayFixedUpstreamProperties();

    /**
     * 多模态理解固定上游配置。
     */
    private AiGatewayMultimodalUnderstandingProperties multimodalUnderstanding = new AiGatewayMultimodalUnderstandingProperties();
}
