package org.dromara.web.ai.service.impl.support.gateway;

import jakarta.servlet.http.HttpServletRequest;
import okhttp3.Request;

/**
 * 固定兼容入口网关代理策略。
 *
 * @author kongweiguang
 */
public interface GatewayProxyStrategy {

    /**
     * 策略名称，用于异常提示。
     *
     * @return 兼容入口名称
     */
    String getName();

    /**
     * 构造具体协议的上游请求。
     *
     * @param body    原始请求体
     * @param request 原始 Servlet 请求
     * @return 上游请求
     */
    Request buildRequest(String body, HttpServletRequest request);
}
