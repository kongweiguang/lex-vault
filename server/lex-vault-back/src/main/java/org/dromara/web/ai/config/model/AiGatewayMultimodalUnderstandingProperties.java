package org.dromara.web.ai.config.model;

import lombok.Data;

/**
 * 多模态理解固定上游配置。
 *
 * @author kongweiguang
 */
@Data
public class AiGatewayMultimodalUnderstandingProperties {

    /**
     * 上游 Chat Completions 请求地址。
     */
    private String baseUrl;

    /**
     * 强制改写后的多模态理解模型。
     */
    private String defaultModel = "mimo-v2.5";

    /**
     * Xiaomi MiMo API Key。
     */
    private String apiKey;

    /**
     * 默认最大输出 token。
     */
    private Integer maxCompletionTokens = 1024;

    /**
     * 多模态理解系统提示词。
     */
    private String systemPrompt = "你是多模态内容理解助手，请基于输入的图片、音频或视频事实用中文回答。";

    /**
     * 默认视频抽帧帧率。
     */
    private Double defaultVideoFps = 2D;

    /**
     * 默认视频解析分辨率档位。
     */
    private String defaultMediaResolution = "default";

}
