package org.dromara.web.ai.service;

import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.form.AiPackageForm;
import org.dromara.web.ai.domain.form.AiPackageUpstreamForm;
import org.dromara.web.ai.domain.form.AiUserPackageBindingForm;
import org.dromara.web.ai.domain.query.AiPackageQuery;
import org.dromara.web.ai.domain.query.AiPackageUpstreamQuery;
import org.dromara.web.ai.domain.query.AiUsageQuery;
import org.dromara.web.ai.domain.vo.AiPackageOptionVo;
import org.dromara.web.ai.domain.vo.AiUsageRecordVo;
import org.dromara.web.ai.domain.vo.AiUsageSnapshot;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.domain.vo.AiUsageTotalVo;
import org.dromara.web.ai.domain.vo.AiUserPackageBindingVo;

import java.time.LocalDateTime;
import java.util.List;

/**
 * AI 管理域服务接口。
 *
 * @author kongweiguang
 */
public interface IAiAdminService {

    /**
     * 分页查询套餐。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    AiPageResult<AiPackage> listPackages(AiPackageQuery query);

    /**
     * 查询套餐详情。
     *
     * @param id 主键
     * @return 套餐详情
     */
    AiPackage getPackage(Long id);

    /**
     * 保存套餐。
     *
     * @param form 表单
     */
    void savePackage(AiPackageForm form);

    /**
     * 修改套餐状态。
     *
     * @param id     主键
     * @param status 状态
     */
    void changePackageStatus(Long id, String status);

    /**
     * 删除套餐。
     *
     * @param id 主键
     */
    void deletePackage(Long id);

    /**
     * 查询可选套餐列表。
     *
     * @return 下拉选项
     */
    List<AiPackageOptionVo> listEnabledPackageOptions();

    /**
     * 分页查询上游节点。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    AiPageResult<AiPackageUpstream> listUpstreams(AiPackageUpstreamQuery query);

    /**
     * 查询上游节点详情。
     *
     * @param id 主键
     * @return 上游节点
     */
    AiPackageUpstream getUpstream(Long id);

    /**
     * 保存上游节点。
     *
     * @param form 表单
     */
    void saveUpstream(AiPackageUpstreamForm form);

    /**
     * 修改上游节点状态。
     *
     * @param id     主键
     * @param status 状态
     */
    void changeUpstreamStatus(Long id, String status);

    /**
     * 删除上游节点。
     *
     * @param id 主键
     */
    void deleteUpstream(Long id);

    /**
     * 查询用户当前套餐绑定。
     *
     * @param userId 用户主键
     * @return 当前绑定
     */
    AiUserPackageBindingVo getCurrentBinding(Long userId);

    /**
     * 绑定用户套餐。
     *
     * @param form 表单
     */
    void bindUserPackage(AiUserPackageBindingForm form);

    /**
     * 解绑用户当前套餐。
     *
     * @param userId 用户主键
     */
    void unbindUserPackage(Long userId);

    /**
     * 分页查询用量流水。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    AiPageResult<AiUsageRecordVo> listUsageRecords(AiUsageQuery query);

    /**
     * 按查询条件汇总用量总计。
     *
     * @param query 查询条件
     * @return 汇总结果
     */
    AiUsageTotalVo getUsageTotals(AiUsageQuery query);

    /**
     * 按查询条件查询用户当前用量汇总。
     *
     * @param query 查询条件
     * @return 汇总结果
     */
    AiUsageSummaryVo getUsageSummary(AiUsageQuery query);

    /**
     * 查询用户当前用量汇总。
     *
     * @param userId 用户主键
     * @return 汇总结果
     */
    AiUsageSummaryVo getUsageSummary(Long userId);

    /**
     * 查询当前登录用户的套餐与用量汇总。
     *
     * @param userId 当前登录用户主键
     * @return 汇总结果
     */
    AiUsageSummaryVo getCurrentUserPackageSummary(Long userId);

    /**
     * 查询用户当前绑定实体。
     *
     * @param userId 用户主键
     * @param nowUtc 当前 UTC 时间
     * @return 当前绑定
     */
    org.dromara.web.ai.domain.entity.AiUserPackageBinding getCurrentBindingEntity(Long userId, LocalDateTime nowUtc);

    /**
     * 查询配额窗口快照。
     *
     * @param userId 用户主键
     * @param nowUtc 当前 UTC 时间
     * @return 用量快照
     */
    AiUsageSnapshot getUsageSnapshot(Long userId, LocalDateTime nowUtc);
}
