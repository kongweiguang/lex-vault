package org.dromara.web.ai.service;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * OpenAI Responses 网关服务接口。
 *
 * @author kongweiguang
 */
public interface IAiResponsesGatewayService {

    /**
     * 处理 `/v1/responses` 网关请求。
     *
     * @param body     请求体
     * @param request  原始请求
     * @param response 原始响应
     */
    void responses(String body, HttpServletRequest request, HttpServletResponse response);
}
