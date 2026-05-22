package org.dromara.web.ai.domain.vo;

/**
 * AI 配额检查结果。
 *
 * @author kongweiguang
 */
public class QuotaCheckResult {

    /**
     * 是否允许继续请求。
     */
    private boolean allowed;

    /**
     * OpenAI 风格错误码。
     */
    private String errorCode;

    /**
     * 错误描述。
     */
    private String message;

    public boolean isAllowed() {
        return allowed;
    }

    public void setAllowed(boolean allowed) {
        this.allowed = allowed;
    }

    public String getErrorCode() {
        return errorCode;
    }

    public void setErrorCode(String errorCode) {
        this.errorCode = errorCode;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }
}
