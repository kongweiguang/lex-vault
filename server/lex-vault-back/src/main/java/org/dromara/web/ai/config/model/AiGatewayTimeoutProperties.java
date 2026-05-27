package org.dromara.web.ai.config.model;

import lombok.Data;

/**
 * HTTP 超时配置，单位为秒。
 *
 * @author kongweiguang
 */
@Data
public class AiGatewayTimeoutProperties {

    /**
     * 建立连接超时时间。
     */
    private Long connectSeconds = 30L;

    /**
     * 写入请求体超时时间。
     */
    private Long writeSeconds = 300L;

    /**
     * 读取响应超时时间。
     */
    private Long readSeconds = 300L;

    /**
     * 整次调用最大耗时。
     */
    private Long callSeconds = 300L;
}
