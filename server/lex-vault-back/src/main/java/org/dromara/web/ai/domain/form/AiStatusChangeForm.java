package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * AI 通用状态修改表单。
 *
 * @author kongweiguang
 */
@Data
public class AiStatusChangeForm {

    /**
     * 主键。
     */
    @NotNull(message = "主键不能为空")
    private Long id;

    /**
     * 状态。
     */
    @NotBlank(message = "状态不能为空")
    private String status;

}
