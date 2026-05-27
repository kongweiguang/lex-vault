package org.dromara.web.ai.domain.vo;

import lombok.Data;

/**
 * AI 用户套餐绑定视图对象。
 *
 * @author kongweiguang
 */
@Data
public class AiUserPackageBindingVo {

    /**
     * 绑定主键。
     */
    private Long id;

    /**
     * 用户主键。
     */
    private Long userId;

    /**
     * 用户名称。
     */
    private String userName;

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 套餐编码。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

    /**
     * 状态。
     */
    private String status;

    /**
     * 生效开始时间。
     */
    private String effectiveFrom;

    /**
     * 生效结束时间。
     */
    private String effectiveTo;

    /**
     * 备注。
     */
    private String remark;

}
