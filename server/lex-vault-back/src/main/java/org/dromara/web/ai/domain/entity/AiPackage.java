package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI 套餐实体。
 *
 * @author kongweiguang
 */
@Data
@TableName("ai_package")
public class AiPackage {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 套餐编码，固定为 plus/pro/max。
     */
    private String packageCode;

    /**
     * 套餐名称。
     */
    private String packageName;

    /**
     * 状态，0 启用，1 停用。
     */
    private String status;

    /**
     * 5 小时滚动窗口 token 限额。
     */
    private Long fiveHourTokenLimit;

    /**
     * 7 天滚动窗口 token 限额。
     */
    private Long weeklyTokenLimit;

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
