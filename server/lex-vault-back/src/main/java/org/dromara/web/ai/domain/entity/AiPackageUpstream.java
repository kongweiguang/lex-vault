package org.dromara.web.ai.domain.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * AI 套餐上游节点实体。
 *
 * @author kongweiguang
 */
@Data
@TableName("ai_package_upstream")
public class AiPackageUpstream {

    /**
     * 主键。
     */
    @TableId
    private Long id;

    /**
     * 所属套餐主键。
     */
    private Long packageId;

    /**
     * 上游名称。
     */
    private String upstreamName;

    /**
     * 上游基础地址。
     */
    private String baseUrl;

    /**
     * 上游 API Key。
     */
    private String apiKey;

    /**
     * 绑定模型。
     */
    private String model;

    /**
     * 扩展请求参数 JSON，会合并到上游请求体顶层。
     */
    private String extraParamsJson;

    /**
     * 同优先级内权重。
     */
    private Integer weight;

    /**
     * 优先级，数值越小越优先。
     */
    private Integer priority;

    /**
     * 状态，0 启用，1 停用。
     */
    private String status;

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
