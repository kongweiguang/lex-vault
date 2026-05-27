package org.dromara.web.ai.domain.vo.openai;

import lombok.Data;

/**
 * OpenAI 兼容错误对象。
 *
 * @author kongweiguang
 */
@Data
public class OpenAiErrorObject {

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

}
