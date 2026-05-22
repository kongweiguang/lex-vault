package org.dromara.web.ai.controller;

import cn.dev33.satoken.annotation.SaCheckPermission;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.dromara.common.core.domain.R;
import org.dromara.common.satoken.utils.LoginHelper;
import org.dromara.web.ai.domain.form.AiUserPackageBindingForm;
import org.dromara.web.ai.domain.vo.AiUsageSummaryVo;
import org.dromara.web.ai.domain.vo.AiUserPackageBindingVo;
import org.dromara.web.ai.service.IAiAdminService;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/**
 * AI 用户套餐绑定控制器。
 *
 * @author kongweiguang
 */
@Validated
@RestController
@RequiredArgsConstructor
@RequestMapping("/system/ai/user-package")
public class AiUserPackageController {

    private final IAiAdminService aiAdminService;

    /**
     * 查询当前登录用户的套餐与额度摘要。
     *
     * @return 当前登录用户套餐摘要
     */
    @GetMapping("/current")
    public R<AiUsageSummaryVo> current() {
        return R.ok(aiAdminService.getCurrentUserPackageSummary(LoginHelper.getUserId()));
    }

    /**
     * 查询用户当前绑定。
     *
     * @param userId 用户主键
     * @return 当前绑定
     */
    @SaCheckPermission("system:aiUserPackage:query")
    @GetMapping("/current/{userId}")
    public R<AiUserPackageBindingVo> current(@PathVariable Long userId) {
        return R.ok(aiAdminService.getCurrentBinding(userId));
    }

    /**
     * 绑定用户套餐。
     *
     * @param form 表单
     * @return 结果
     */
    @SaCheckPermission("system:aiUserPackage:edit")
    @PostMapping("/bind")
    public R<Void> bind(@Valid @RequestBody AiUserPackageBindingForm form) {
        aiAdminService.bindUserPackage(form);
        return R.ok();
    }

    /**
     * 解绑用户当前套餐。
     *
     * @param userId 用户主键
     * @return 结果
     */
    @SaCheckPermission("system:aiUserPackage:edit")
    @DeleteMapping("/unbind/{userId}")
    public R<Void> unbind(@PathVariable Long userId) {
        aiAdminService.unbindUserPackage(userId);
        return R.ok();
    }
}
