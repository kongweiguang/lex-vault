package org.dromara.web.ai.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.domain.R;
import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.query.AiUsageQuery;
import org.dromara.web.ai.domain.vo.AiUsageRecordVo;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.domain.vo.AiUsageTotalVo;
import org.dromara.web.ai.service.IAiAdminService;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI 用量查询控制器。
 *
 * @author kongweiguang
 */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/system/ai/usage")
public class AiUsageController {

    private final IAiAdminService aiAdminService;

    /**
     * 分页查询用量流水。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    @SaCheckPermission("system:aiUsage:list")
    @GetMapping("/list")
    public AiPageResult<AiUsageRecordVo> list(AiUsageQuery query) {
        return aiAdminService.listUsageRecords(query);
    }

    /**
     * 按查询条件汇总用量总计。
     *
     * @param query 查询条件
     * @return 汇总结果
     */
    @SaCheckPermission("system:aiUsage:query")
    @GetMapping("/totals")
    public R<AiUsageTotalVo> totals(AiUsageQuery query) {
        return R.ok(aiAdminService.getUsageTotals(query));
    }

    /**
     * 按用户 ID 或用户名查询单用户当前窗口汇总。
     *
     * @param query 查询条件
     * @return 汇总结果
     */
    @SaCheckPermission("system:aiUsage:query")
    @GetMapping("/summary")
    public R<AiUsageSummaryVo> summary(AiUsageQuery query) {
        return R.ok(aiAdminService.getUsageSummary(query));
    }

    /**
     * 查询单用户当前窗口汇总。
     *
     * @param userId 用户主键
     * @return 汇总结果
     */
    @SaCheckPermission("system:aiUsage:query")
    @GetMapping("/summary/{userId}")
    public R<AiUsageSummaryVo> summary(@PathVariable Long userId) {
        return R.ok(aiAdminService.getUsageSummary(userId));
    }
}
