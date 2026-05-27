package org.dromara.web.ai.service.impl.support.gateway;

import org.dromara.web.ai.domain.entity.AiPackage;

/**
 * 网关请求上下文。
 *
 * @param requestId        请求标识
 * @param userId           当前用户主键
 * @param aiPackage        当前命中的 AI 套餐
 * @param streamingRequest 是否流式请求
 * @author kongweiguang
 */
public record GatewayRequestContext(String requestId, Long userId, AiPackage aiPackage, boolean streamingRequest) {
}
