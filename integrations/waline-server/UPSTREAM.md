# 固定上游、依赖处理与源码交付

核对日期：2026-10-16。**本地运行依赖和管理端构建依赖审计均为 0 项；已按上游明确的 GPL-2.0 说明提供对应源码。** 这不是未来安全保证、上游元数据已修正的声明或法律意见。云端账户、函数打包、实际数据库与真机验收仍见 [README.md](README.md)。

## 当前安装的是什么

| 组件 | 当前方式 |
|---|---|
| Waline 服务 1.43.4 | `vendor/waline-vercel-1.43.4-qj.1.tgz`，显式 `postgres-no-external-v1` 分发配置 |
| Waline 管理端 0.36.0 | `vendor/waline-admin-0.36.0-qj.1.tgz`，从准确上游源码提交重建，不冒称原 npm 分发字节 |
| PostgreSQL 驱动 | npm `pg` 8.23.1，版本未变 |
| 完整性来源 | 本目录 `package-lock.json` 及 `vendor/vendor-lock.json`；后者还锁定两个源码归档和实际管理脚本 |

安装不再直接拉取原始全功能 Waline 包。服务启动核对版本、分发配置和管理脚本哈希，缺失或篡改的包/源码归档会停止启动；不能只把依赖改回同版本的官方包。博客根依赖不变。

## 依赖告警怎样处理

原锁文件有 16 个受影响包项（5 中危、8 高危、3 严重），来源为 CloudBase、LeanCloud 和 Akismet 的传递依赖；最新上游服务仍是 1.43.4，不能通过简单升级解决。LeanCloud 的当前分发仍使用 protobufjs 5，Akismet 仍依赖已停止维护的 request，逐项跨大版本覆盖不是低风险的兼容修复。

本项目本来就只允许 PostgreSQL、先审后显、不开外部反垃圾服务，现把不用的代码和依赖一起移除，而不是只隐藏 npm 报告：

- 移除 `src/service/storage/cloudbase.js`、`leancloud.js` 及对应依赖。
- Akismet 换为**明确禁用**的适配器；不含 SDK、不外发留言，试图启用时拒绝；普通留言仍由审核状态控制。
- 另外发现 `ua-parser-js` 2.x 采用 AGPL-3.0-or-later，而本部署已关闭设备展示。现移除该依赖及两处导入，使用明确的禁用适配器，不再解析设备信息；若试图打开该功能会失败。上游在展示关闭时仍会调用序列化，故保留必要的空 `browser/os/device/engine/cpu` 结构，不能用抛错代替正常序列化。
- 账号、权限、评论、审核与 PostgreSQL 存储未重写。`QJ-PROFILE.json` 记录原包所有文件哈希及精确改动清单；测试逐个比较未修改文件，并确认核心服务两处变更仅是依赖选择。

实际锁文件从 **520 降到 357 个包记录**，其余保留包的版本未变；原 request、protobufjs、lodash.set/unset 等依赖链真实不再安装。没有 `npm audit fix --force`、跨大版本降级、虚构修复版本或审计忽略名单。固定上游版本号仍为 1.43.4，分发身份另有显式标记，不能误认为这是上游发布的新版本。

对实际安装树运行 `npm audit --omit=dev --json` 返回 0；管理端独立构建树运行不省略开发依赖的 `npm audit --json` 也返回 0，因为这些“开发依赖”会进入前端分发。审计库会变化，每次升级/部署前仍人工复核；0 项不证明没有未知漏洞。

## 许可证结论与边界

原 npm `package.json` 写 MIT，但两包的实际 LICENSE 是 GPL v2。进一步核对**准确源码提交的 README**，其中也明确写了 **GPL-2.0**，因此本项目不再按 npm 的 MIT 字段解释 Waline 服务/管理端。

- 保留原 LICENSE；下游包元数据使用 `SEE LICENSE IN LICENSE`，没有把上游改成 MIT。Quiet Journal 原创包装仍遵循本目录 [LICENSE](LICENSE)，博客、文章和照片的归属不变。
- 管理端是 GPL-2.0 组件的公开分发；管理外壳可见地链接完整许可与**同一服务上的对应源码**，不只贴一个远端项目首页。
- 管理端源码归档含原应用源码、实际构建配置/npm 锁文件、全部构建映射源码，以及实际打入脚本的第三方模块的发布源码/许可。这些模块本次分别为 MIT/ISC/BSD，不被冒称重新许可为本项目 MIT。
- 服务端源码归档含精简后的准确包内容、上游 core 的首选 TypeScript 源码、原构建输入及可重复的分发生成脚本。
- 此处不提供把全部运行依赖合成一体的公共服务端镜像，也不对任意未来依赖组合做许可兼容性保证；改作镜像再分发、改变组件或重新授权时须另审查。未向上游提交 issue，亦未声称上游已经修正元数据。

客户端 3.16.1 的实际 MIT 许可独立保留，不受此变化影响。

## 源码与分发如何对应

npm 的公开构建来源记录给出的提交为：

- 管理端：[`c0a8f7c0ecf6dc24fab02845b1195753bdec0997`](https://github.com/walinejs/waline/tree/c0a8f7c0ecf6dc24fab02845b1195753bdec0997/packages/admin)。
- 服务端：[`c4b0f1ebb9a7970d36493d4c3580f3f43e098fa5`](https://github.com/walinejs/waline/tree/c4b0f1ebb9a7970d36493d4c3580f3f43e098fa5/packages/server)。

记录来自 npm registry 的 provenance（构建来源证明记录）；本轮核对其 subject 与包完整性值，但不冒称独立验证了整条签名信任链。更关键的交付验证是：**解开实际提供的管理端源码归档，在新目录按锁文件离线 `npm ci --ignore-scripts` 后构建，输出与本服务实际安装的 `admin.js` 逐字节相同。**

重建脚本 SHA-256 为 `1ec61f7b6bad65cb52ad803914754b54f967c382680d0c0083e39fd6811718c6`。它不是原 npm 脚本的哈希。应用源码未改；构建环境改为独立 npm 清单/锁文件，React 构建插件固定到可用的补丁版 6.1.2，并生成 hidden source map（仅放源码归档，不提供运行时 `.map` URL）。不靠伪造 npm 最新版响应隐藏差异。

## 手动复核与更新

通常部署只需已有的 `vendor/` 和本目录锁文件，不安装编译工具或 Python，不在云端重新编译管理端。

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run audit:dependencies
# 已准备好本机镜像/模式/浏览器后：
QJ_WALINE_SCHEMA=/private/waline.pgsql QJ_CHROMIUM=/path/to/chrome npm run test:admin
```

重建当前管理端：解开 `vendor/waline-admin-source-0.36.0.tar.gz`，在其中 `admin/` 执行 `npm ci --ignore-scripts --no-audit --no-fund`、`npm run build`，按归档 README 核对哈希，并运行包含开发依赖的 `npm audit`。原仓库的 release workflow 不是操作步骤，不执行发布。

重新生成当前分发需 Python 3 和**预先下载**的固定输入；[`scripts/prepare-vendor.py`](scripts/prepare-vendor.py) 校验完整性、源码和已审阅构建，不访问网络，也不覆盖已有目录：

```sh
python3 scripts/prepare-vendor.py \
  --server-npm /private/sources/vercel-1.43.4.tgz \
  --server-source /private/sources/waline-c4b0f1e.tar.gz \
  --admin-source /private/sources/waline-c0a8f7c.tar.gz \
  --admin-build /private/rebuilt-admin \
  --output /private/new-vendor
```

固定输入来源：
- [服务 npm 包](https://registry.npmjs.org/@waline/vercel/-/vercel-1.43.4.tgz)
- [服务源码归档](https://codeload.github.com/walinejs/waline/tar.gz/c4b0f1ebb9a7970d36493d4c3580f3f43e098fa5)
- [管理端源码归档](https://codeload.github.com/walinejs/waline/tar.gz/c0a8f7c0ecf6dc24fab02845b1195753bdec0997)

先生成到新目录，对比并完整回归后再替换，不直接编辑 `node_modules` 或忽略哈希失败。升级时一起重审源码差异、依赖、许可、构建工具和 HTTP 源码下载；不要沿用本次 0 项报告为未来版本背书。两个源码下载每项最多 4 MiB，只有主动点击才传输；其带宽/调用量属于独立服务用量，不加入保活、定时构建或自动升级。
