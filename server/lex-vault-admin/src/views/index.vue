<template>
  <div class="app-container home">
    <el-row :gutter="20">
      <el-col :sm="24" :lg="12" style="padding-left: 20px">
        <h2>lex-vault 管理后台</h2>
        <p>
          lex-vault 管理后台用于支撑当前系统的日常运维与业务配置，统一承载租户、权限、AI 套餐和网关相关管理能力。
          <br />
          * 前端开发框架 Vue3、TS、Element Plus<br />
          * 后端开发框架 Spring Boot<br />
          * 权限认证与租户隔离配置<br />
          * AI 套餐、额度窗口与上游节点管理<br />
          * 用户、角色、菜单和系统参数维护<br />
          * 文件存储、任务调度和服务监控入口<br />
          * 面向运营后台的统一管理工作台<br />
        </p>
        <p><b>当前品牌:</b> <span>lex-vault</span></p>
        <p>
          <el-tag type="primary">管理后台</el-tag>
        </p>
        <p>
          <el-button type="primary" icon="Cloudy" plain @click="goTarget('https://github.com/dromara/RuoYi-Vue-Plus')">基础框架来源</el-button>
        </p>
      </el-col>

      <el-col :sm="24" :lg="12" style="padding-left: 20px">
        <h2>核心能力概览</h2>
        <p>
          当前后台围绕 lex-vault 业务进行了定制，重点覆盖 AI 网关、套餐运营和系统管理等场景。
          <br />
          * 登录、租户和验证码流程管理<br />
          * AI 套餐绑定、额度统计与使用流水查询<br />
          * 上游模型节点配置与状态切换<br />
          * 菜单、角色、用户和字典配置<br />
          * OSS、日志、在线用户和缓存运维工具<br />
        </p>
        <p><b>当前定位:</b> <span>lex-vault server console</span></p>
        <p>
          <el-tag type="success">已品牌化</el-tag>
        </p>
        <p>
          <el-button type="primary" icon="Document" plain @click="goTarget('https://github.com/dromara/RuoYi-Vue-Plus')">查看底层框架</el-button>
        </p>
      </el-col>
    </el-row>
    <el-divider />
  </div>
</template>

<script setup name="Index" lang="ts">
const goTarget = (url: string) => {
  window.open(url, '__blank');
};
</script>

<style lang="scss" scoped>
.home {
  blockquote {
    padding: 10px 20px;
    margin: 0 0 20px;
    font-size: 17.5px;
    border-left: 5px solid #eee;
  }
  hr {
    margin-top: 20px;
    margin-bottom: 20px;
    border: 0;
    border-top: 1px solid #eee;
  }
  .col-item {
    margin-bottom: 20px;
  }

  ul {
    padding: 0;
    margin: 0;
  }

  font-family: 'open sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 13px;
  color: #676a6c;
  overflow-x: hidden;

  ul {
    list-style-type: none;
  }

  h4 {
    margin-top: 0px;
  }

  h2 {
    margin-top: 10px;
    font-size: 26px;
    font-weight: 100;
  }

  p {
    margin-top: 10px;

    b {
      font-weight: 700;
    }
  }

  .update-log {
    ol {
      display: block;
      list-style-type: decimal;
      margin-block-start: 1em;
      margin-block-end: 1em;
      margin-inline-start: 0;
      margin-inline-end: 0;
      padding-inline-start: 40px;
    }
  }
}
</style>
