package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * AI 套餐表单。
 *
 * @author kongweiguang
 */
@Data
public class AiPackageForm {

    /**
     * 主键。
     */
    private Long id;

    /**
     * 套餐编码。
     */
    @NotBlank(message = "套餐编码不能为空")
    private String packageCode;

    /**
     * 套餐名称。
     */
    @NotBlank(message = "套餐名称不能为空")
    private String packageName;

    /**
     * 5 小时限额。
     */
    @NotNull(message = "5 小时限额不能为空")
    private Long fiveHourTokenLimit;

    /**
     * 7 天限额。
     */
    private Long weeklyTokenLimit;

    /**
     * 备注。
     */
    private String remark;

}
