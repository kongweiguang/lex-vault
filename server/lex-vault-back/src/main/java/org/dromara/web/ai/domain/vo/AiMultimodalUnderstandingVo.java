package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * 多模态理解响应。
 *
 * @author kongweiguang
 */
@Data
public class AiMultimodalUnderstandingVo {

    /**
     * 模型返回的理解文本。
     */
    private String text;

    /**
     * 实际使用的模型。
     */
    private String model;

    /**
     * 媒体类型。
     */
    private String mediaKind;

    /**
     * 上游结束原因。
     */
    private String finishReason;

    /**
     * 上游 usage。
     */
    private AiUsageStat usage;

}
