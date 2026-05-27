package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 配额检查结果。
 *
 * @author kongweiguang
 */
@Data
public class QuotaCheckResult {

    /**
     * 是否允许继续请求。
     */
    private Boolean allowed;

    /**
     * OpenAI 风格错误码。
     */
    private String errorCode;

    /**
     * 错误描述。
     */
    private String message;

}
