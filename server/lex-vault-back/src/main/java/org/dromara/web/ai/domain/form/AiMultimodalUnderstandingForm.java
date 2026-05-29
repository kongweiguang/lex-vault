package org.dromara.web.ai.domain.form;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 多模态理解请求表单。
 *
 * @author kongweiguang
 */
@Data
public class AiMultimodalUnderstandingForm {

    /**
     * 媒体负载。
     */
    @Valid
    @NotNull(message = "媒体不能为空")
    private MediaPayload media;

    /**
     * 用户指定的解析重点提示词。
     */
    @NotBlank(message = "多模态解析重点不能为空")
    private String prompt;

    /**
     * 最大输出 token；为空时使用 YAML 默认值。
     */
    private Integer maxCompletionTokens;

    /**
     * 视频抽帧帧率，仅视频有效。
     */
    private Double fps;

    /**
     * 视频解析分辨率档位，仅视频有效，支持 default 和 max。
     */
    private String mediaResolution;

    /**
     * 多模态媒体 Base64 负载。
     */
    @Data
    public static class MediaPayload {

        /**
         * 媒体类型，支持 image、audio、video。
         */
        @NotBlank(message = "媒体类型不能为空")
        @Pattern(regexp = "image|audio|video", message = "媒体类型仅支持 image、audio、video")
        private String kind;

        /**
         * 纯 Base64 媒体内容，不包含 data URL 前缀。
         */
        @NotBlank(message = "媒体 Base64 不能为空")
        private String dataBase64;

        /**
         * 媒体 MIME 类型。
         */
        @NotBlank(message = "媒体 MIME 类型不能为空")
        private String mimeType;

        /**
         * 原始文件名。
         */
        private String fileName;

    }

}
