package org.dromara.web.ai.domain.form;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * AI 通用状态修改表单。
 *
 * @author kongweiguang
 */
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

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
