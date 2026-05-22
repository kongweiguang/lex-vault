package org.dromara.web.ai.domain.vo;

/**
 * OpenAI 兼容错误响应体。
 *
 * @author kongweiguang
 */
public class OpenAiErrorBody {

    /**
     * 错误对象。
     */
    private ErrorObject error;

    public ErrorObject getError() {
        return error;
    }

    public void setError(ErrorObject error) {
        this.error = error;
    }

    /**
     * OpenAI 兼容错误对象。
     *
     * @author kongweiguang
     */
    public static class ErrorObject {

        /**
         * 错误消息。
         */
        private String message;

        /**
         * 错误类型。
         */
        private String type;

        /**
         * 错误码。
         */
        private String code;

        public String getMessage() {
            return message;
        }

        public void setMessage(String message) {
            this.message = message;
        }

        public String getType() {
            return type;
        }

        public void setType(String type) {
            this.type = type;
        }

        public String getCode() {
            return code;
        }

        public void setCode(String code) {
            this.code = code;
        }
    }
}
