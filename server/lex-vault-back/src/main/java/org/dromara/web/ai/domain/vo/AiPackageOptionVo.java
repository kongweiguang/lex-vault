package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 套餐下拉选项。
 *
 * @author kongweiguang
 */
@Data
public class AiPackageOptionVo {

    /**
     * 套餐主键。
     */
    private Long id;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

}
