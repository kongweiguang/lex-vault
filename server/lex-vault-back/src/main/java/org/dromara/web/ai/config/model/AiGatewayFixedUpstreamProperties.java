package org.dromara.web.ai.config.model;

import lombok.Data;

/**
 * 固定兼容入口的上游配置。
 *
 * @author kongweiguang
 */
@Data
public class AiGatewayFixedUpstreamProperties {

    /**
     * 上游请求地址。
     */
    private String baseUrl;

    /**
     * 强制改写后的上游模型。
     */
    private String defaultModel;

    /**
     * 上游访问密钥。
     */
    private String apiKey;

    /**
     * Anthropic 兼容协议版本，非 Anthropic 入口可为空。
     */
    private String version;
}
