package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI 用户套餐绑定实体。
 *
 * @author kongweiguang
 */
@Data
@TableName("ai_user_package_binding")
public class AiUserPackageBinding {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 用户主键。
     */
    private Long userId;

    /**
     * 套餐主键。
     */
    private Long packageId;

    /**
     * 状态，0 启用，1 停用。
     */
    private String status;

    /**
     * 生效开始时间。
     */
    private LocalDateTime effectiveFrom;

    /**
     * 生效结束时间。
     */
    private LocalDateTime effectiveTo;

    /**
     * 备注。
     */
    private String remark;

    /**
     * 创建时间。
     */
    private LocalDateTime createTime;

    /**
     * 更新时间。
     */
    private LocalDateTime updateTime;

}
