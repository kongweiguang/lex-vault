package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * AI 用户套餐绑定表单。
 *
 * @author kongweiguang
 */
@Data
public class AiUserPackageBindingForm {

    /**
     * 用户主键。
     */
    @NotNull(message = "用户主键不能为空")
    private Long userId;

    /**
     * 套餐主键。
     */
    @NotNull(message = "套餐主键不能为空")
    private Long packageId;

    /**
     * 生效开始时间，ISO 本地时间字符串。
     */
    @NotBlank(message = "生效开始时间不能为空")
    private String effectiveFrom;

    /**
     * 生效结束时间，ISO 本地时间字符串。
     */
    @NotBlank(message = "生效结束时间不能为空")
    private String effectiveTo;

    /**
     * 备注。
     */
    private String remark;

}
