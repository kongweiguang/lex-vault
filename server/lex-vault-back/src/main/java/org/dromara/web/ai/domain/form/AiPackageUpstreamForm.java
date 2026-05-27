package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * AI 套餐上游节点表单。
 *
 * @author kongweiguang
 */
@Data
public class AiPackageUpstreamForm {

    /**
     * 主键。
     */
    private Long id;

    /**
     * 所属套餐主键。
     */
    @NotNull(message = "套餐主键不能为空")
    private Long packageId;

    /**
     * 上游名称。
     */
    @NotBlank(message = "上游名称不能为空")
    private String upstreamName;

    /**
     * 上游基础地址。
     */
    @NotBlank(message = "上游地址不能为空")
    private String baseUrl;

    /**
     * API Key。
     */
    private String apiKey;

    /**
     * 模型。
     */
    @NotBlank(message = "模型不能为空")
    private String model;

    /**
     * 扩展请求参数 JSON，会合并到上游请求体顶层。
     */
    private String extraParamsJson;

    /**
     * 权重。
     */
    @NotNull(message = "权重不能为空")
    private Integer weight;

    /**
     * 优先级。
     */
    @NotNull(message = "优先级不能为空")
    private Integer priority;

    /**
     * 备注。
     */
    private String remark;

}
