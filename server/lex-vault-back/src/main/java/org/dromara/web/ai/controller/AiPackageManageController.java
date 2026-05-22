package org.dromara.web.ai.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.domain.R;
import org.dromara.web.ai.domain.AiPageResult;
import org.dromara.web.ai.domain.entity.AiPackage;
import org.dromara.web.ai.domain.entity.AiPackageUpstream;
import org.dromara.web.ai.domain.form.AiPackageForm;
import org.dromara.web.ai.domain.form.AiPackageUpstreamForm;
import org.dromara.web.ai.domain.form.AiStatusChangeForm;
import org.dromara.web.ai.domain.query.AiPackageQuery;
import org.dromara.web.ai.domain.query.AiPackageUpstreamQuery;
import org.dromara.web.ai.domain.vo.AiPackageOptionVo;
import org.dromara.web.ai.service.IAiAdminService;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * AI 套餐管理控制器。
 *
 * @author kongweiguang
 */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/system/ai/package")
public class AiPackageManageController {

    private final IAiAdminService aiAdminService;

    /**
     * 分页查询套餐。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    @SaCheckPermission("system:aiPackage:list")
    @GetMapping("/list")
    public AiPageResult<AiPackage> list(AiPackageQuery query) {
        return aiAdminService.listPackages(query);
    }

    /**
     * 查询套餐详情。
     *
     * @param id 主键
     * @return 套餐详情
     */
    @SaCheckPermission("system:aiPackage:query")
    @GetMapping("/{id}")
    public R<AiPackage> getInfo(@PathVariable Long id) {
        return R.ok(aiAdminService.getPackage(id));
    }

    /**
     * 查询启用套餐下拉选项。
     *
     * @return 套餐选项
     */
    @SaCheckPermission("system:aiPackage:list")
    @GetMapping("/options")
    public R<List<AiPackageOptionVo>> options() {
        return R.ok(aiAdminService.listEnabledPackageOptions());
    }

    /**
     * 新增套餐。
     *
     * @param form 表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:add")
    @PostMapping
    public R<Void> add(@Valid @RequestBody AiPackageForm form) {
        aiAdminService.savePackage(form);
        return R.ok();
    }

    /**
     * 修改套餐。
     *
     * @param form 表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @PutMapping
    public R<Void> edit(@Valid @RequestBody AiPackageForm form) {
        aiAdminService.savePackage(form);
        return R.ok();
    }

    /**
     * 修改套餐状态。
     *
     * @param form 状态表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @PutMapping("/changeStatus")
    public R<Void> changeStatus(@Valid @RequestBody AiStatusChangeForm form) {
        aiAdminService.changePackageStatus(form.getId(), form.getStatus());
        return R.ok();
    }

    /**
     * 删除套餐。
     *
     * @param id 主键
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:remove")
    @DeleteMapping("/{id}")
    public R<Void> remove(@PathVariable Long id) {
        aiAdminService.deletePackage(id);
        return R.ok();
    }

    /**
     * 分页查询套餐下上游节点。
     *
     * @param query 查询条件
     * @return 分页结果
     */
    @SaCheckPermission("system:aiPackage:list")
    @GetMapping("/upstream/list")
    public AiPageResult<AiPackageUpstream> listUpstream(AiPackageUpstreamQuery query) {
        return aiAdminService.listUpstreams(query);
    }

    /**
     * 查询上游节点详情。
     *
     * @param id 主键
     * @return 详情
     */
    @SaCheckPermission("system:aiPackage:query")
    @GetMapping("/upstream/{id}")
    public R<AiPackageUpstream> getUpstream(@PathVariable Long id) {
        return R.ok(aiAdminService.getUpstream(id));
    }

    /**
     * 新增上游节点。
     *
     * @param form 表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @PostMapping("/upstream")
    public R<Void> addUpstream(@Valid @RequestBody AiPackageUpstreamForm form) {
        aiAdminService.saveUpstream(form);
        return R.ok();
    }

    /**
     * 修改上游节点。
     *
     * @param form 表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @PutMapping("/upstream")
    public R<Void> editUpstream(@Valid @RequestBody AiPackageUpstreamForm form) {
        aiAdminService.saveUpstream(form);
        return R.ok();
    }

    /**
     * 修改上游节点状态。
     *
     * @param form 状态表单
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @PutMapping("/upstream/changeStatus")
    public R<Void> changeUpstreamStatus(@Valid @RequestBody AiStatusChangeForm form) {
        aiAdminService.changeUpstreamStatus(form.getId(), form.getStatus());
        return R.ok();
    }

    /**
     * 删除上游节点。
     *
     * @param id 主键
     * @return 结果
     */
    @SaCheckPermission("system:aiPackage:edit")
    @DeleteMapping("/upstream/{id}")
    public R<Void> removeUpstream(@PathVariable Long id) {
        aiAdminService.deleteUpstream(id);
        return R.ok();
    }
}
