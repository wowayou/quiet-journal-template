# 固定上游、依赖处理与源码交付

核对日期：2026-10-29。**本次更新后运行依赖和管理端完整构建依赖审计均为 0 项；已按上游明确的 GPL-2.0 说明提供对应源码。** 这不是未来安全保证、上游元数据已修正的声明或法律意见。云端账户、函数打包、实际数据库与真机验收仍见 [README.md](README.md)。

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

2026-10-16 的精简使锁文件从 **520 降到 357 个包记录**，当时其余保留包的版本未变；原 request、protobufjs、lodash.set/unset 等依赖链真实不再安装。没有 `npm audit fix --force`、跨大版本降级、虚构修复版本或审计忽略名单。固定上游版本号仍为 1.43.4，分发身份另有显式标记，不能误认为这是上游发布的新版本。

### 2026-10-29：新增公告与兼容补丁

上线前复核发现运行树 4 个受影响包项（含 Waline 的连带评级，不等于 4 个独立漏洞），管理端源码的完整构建树另有 Vite 高危告警。未使用 `audit fix --force`、降级或审计忽略；只更新兼容补丁：

| 组件 | 修复前 → 当前固定版本 | 实际边界 |
|---|---|---|
| DOMPurify | 3.4.16 → **3.4.17** | Waline 只用 HTML 字符串输入/输出，未启用本次公告要求的 SAFE_FOR_TEMPLATES、IN_PLACE、DOM 返回或 XHTML 模式；仍更新净化器并验证公告的特殊模式 |
| markdown-it | 15.0.2 → **15.0.3** | Waline 强制 `html: true`，病理输入解析路径可达；原有 2,000 字符/12 KiB 边界保留，不用限长代替依赖修复 |
| Nodemailer | 10.1.1 → **10.1.4** | SMTP/通知配置仍被拒绝，不发信；同时修复嵌套注释、组分隔和引号内尖括号的收件人解析 |
| argparse | 3.0.2 → **3.0.4** | markdown-it 新最低版本约束所需，未顺带更新其他运行依赖 |
| Vite（仅管理端重建） | 8.2.2 → **8.2.4** | 不启动/部署开发服务器，但仍修复交付源码中的构建工具；管理端 JS 和 source map 与原版逐字节相同 |

前三项用服务根 `package.json` 的 **`@waline/vercel` 范围内 overrides** 固定，并由锁文件记录完整性；不是篡改上游包源码或全局覆盖其他组件。上游精简包及管理端分发包字节不变。更新对应源码归档中的 Vite 清单/锁文件、说明和再生成脚本，并重新生成 `vendor-lock.json`；更新必须连同服务根清单/锁文件一起交付，不能仅复制 vendor 包而丢掉 overrides。博客和读者面板的依赖/构建方式不变。

公告依据：[DOMPurify shadow root](https://github.com/advisories/GHSA-cg2g-xh64-v4q7)、[移除子树](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr)、[XHTML SMIL](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f)；[Markdown 内联 HTML](https://github.com/advisories/GHSA-vfgh-jcmw-g37q)、[多行引用](https://github.com/advisories/GHSA-gfr2-rv44-r23c)；[邮件嵌套注释](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8)、[组分隔](https://github.com/advisories/GHSA-m943-m63m-w62w)、[尖括号](https://github.com/advisories/GHSA-85x2-q946-cp5h)。公告正文可能早于新补丁发布；不能只据旧正文的“未修复”或审计的 `fixAvailable: false` 判断替代版本，须检查实际补丁和行为。

`npm test` 新增 17 项回归：实际 Waline 解析/净化、三个模板表达式、被 hook 移除的父/兄弟子树、XHTML、三类收件人解析、六类病理 Markdown。后者仅在隔离子进程使用合成大输入，单项 5 秒超时/256 MiB JS 堆上限，不代表生产吞吐或云端内存保证。旧依赖反证中 16 项失败（含版本断言）；三个表达式均逐字符拆分后再合并，避免片段自带结束符被旧版提前清除而产生无效反证。原本就安全的普通净化仍通过，没有要求所有旧版测试都失败。全部测试不发送真实邮件。

更新后实际运行树 `npm audit --omit=dev --json` 和源码解包后的完整构建树 `npm audit --json` 均为 0；不省略管理端开发依赖，因为它们参与前端分发。审计库会变化，每次升级/部署前仍人工复核；0 项不证明没有未知漏洞。

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

重建脚本 SHA-256 为 `1ec61f7b6bad65cb52ad803914754b54f967c382680d0c0083e39fd6811718c6`。它不是原 npm 脚本的哈希。应用源码未改；构建环境改为独立 npm 清单/锁文件，React 构建插件固定到可用的补丁版 6.1.2、Vite 8.2.4，并生成 hidden source map（仅放源码归档，不提供运行时 `.map` URL）。不靠伪造 npm 最新版响应隐藏差异。

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
