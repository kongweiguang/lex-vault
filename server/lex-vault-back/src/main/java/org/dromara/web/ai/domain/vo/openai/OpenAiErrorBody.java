package org.dromara.web.ai.domain.vo.openai;

import lombok.Data;

/**
 * OpenAI 兼容错误响应体。
 *
 * @author kongweiguang
 */
@Data
public class OpenAiErrorBody {

    /**
     * 错误对象。
     */
    private OpenAiErrorObject error;

}
