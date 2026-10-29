# Waline + Vercel Hobby + Neon Free：独立服务候选

**状态（2026-10-29）：本次新增依赖告警已用兼容补丁处理，管理端对应源码和离线重建已验证；独立云端服务与完整评论链路尚未验收。** 新增运行费目标仍为 0 元/月、不发邮件、不依赖 Oracle。测试和 0 项审计不等于正式上线许可；此目录不进入 Hugo 构建、静态评论面板或内容导出。

博客侧说明见 [COMMENTS.md](../../docs/COMMENTS.md)，读者面板仍是 [`../waline/`](../waline/README.md)。服务使用 Waline 1.43.4 的显式精简分发，管理端从 0.36.0 准确源码重建，`pg` 固定 8.23.1。两个本地安装包、源码归档及其哈希位于 `vendor/`；不是重写账号和数据库，也不再直接安装原始全功能包。

## 先看尚未完成的上线验收

1. **账户需逐站核验**：模板不包含 Vercel/Neon 登录凭据，也不能证明你的实际套餐、额度、地区或已有项目。数据库已创建或本机连接成功，不等于评论服务已部署；按实际操作者的验收记录区分进度。只选择个人非商业的 Vercel Hobby 与 Neon Free；不选 Pro 试用、Launch、付费附加服务，也不绑定自动升级。不把密码、数据库 URL 或访问令牌发到聊天、Git 或博客配置里。
2. **生产验收未完成**：Vercel 文件追踪/函数包体积与冷启动、Vercel 运行时连接 Neon 的实际证书链、平台代理 IP、额度耗尽、备份保管及 iPhone/Safari 都仍要验收。管理端 Chromium 注册/登录/审核/回复仅在本机合成数据库完成；下面是待执行云端流程，不是已经完成的线上操作。

2026-10-16 的原 16 项依赖告警通过移除不用的适配器/依赖链处理。2026-10-29 复核又发现运行树 4 个受影响包项及管理端构建工具 Vite 告警：现仅为 Waline 固定 DOMPurify 3.4.17、markdown-it 15.0.3、Nodemailer 10.1.4（含必要的 argparse 补丁），对应源码重建工具 Vite 固定 8.2.4；未降级，未放宽审核/限长/禁发信边界。运行树及管理端完整构建树本次审计均为 0。准确上游 README 和随包许可均为 GPL-2.0，因此按该许可交付组件源码，而不是沿用 MIT 元数据；管理端源码归档可离线重建出与实际服务完全相同的脚本。处理方法、维护代价及许可边界见 [UPSTREAM.md](UPSTREAM.md)，以后升级仍需重新审查。

## 免费范围与停止条件

2026-10-16 再次核对公开规则，不代表你的账户还有余额：

| 服务 | 免费档主要边界 |
|---|---|
| Vercel Hobby | 个人非商业；每月 100 万函数调用、4 小时活动 CPU、360 GB-hours 配置内存用量、100 GB Fast Data Transfer，另有其他配额 |
| Neon Free | 每项目每月 100 CU-hours（Compute Unit，计算单位小时）、1 GB 数据及 5 GB 公网传出；账户数据库存储总上限 20 GB |
| Neon 即时恢复 | Free 最多 6 小时或 1 GB 数据变更窗口，**不等于独立备份** |
| 邮件、Oracle | 不启用、不依赖，不创建相应资源 |

0 元是套餐和用量约束下的目标，不是永久在线保证。Hobby 超额通常要等待额度恢复；Neon Free 的 CU-hours/传出额度耗尽会暂停计算，存储超限会阻止写入，不是假设服务无限可用。Neon 的快照数量上限不等于免费备份承诺，本版不启用其付费/定时快照。遇到升级、收费、绑卡或扩大额度提示先停下，不代替用户接受。

- 此项目关闭所有 Git 自动部署（`git.deploymentEnabled: false`），无 Cron、定时保活、自动重发、预览分支部署或新 Actions。评论写入不会提交博客 Git 或触发整站构建。
- 不用监控每分钟请求数据库来“防休眠”。即使评论很少，持续查询也会让 Neon 一直运行，耗尽计算额度。保留读者点击后才加载、主动翻页的设计。
- `pg` 每个进程连接池最多 1 个连接、空闲 10 秒释放；连接等待 5 秒、语句 5 秒、客户端查询 7 秒；Vercel 单请求最多 15 秒。这些不是全账户并发/费用上限。
- 源码归档只在主动下载时传输，不由面板或管理端自动拉取。管理端归档约 3.62 MB、服务端约 0.30 MB，均受本项目 4 MiB 上限约束，低于官方当前 4.5 MB 函数响应限制；仍计入 Vercel 调用/传出用量，异常下载量也需停用/保护服务，不能假设开源附件免费无限。
- 配额接近上限或发生滥用时先停止公开服务，不自动升级。关闭博客入口不等于关掉 API；也不能只重部署 `locked` 就假设旧部署 URL 已停止写入。须保护/暂停相关部署，必要时撤销运行角色口令，再检查旧部署。

官方依据：[Vercel Hobby](https://vercel.com/docs/plans/hobby)、[关闭 Git 自动部署](https://vercel.com/docs/project-configuration/git-configuration#turning-off-all-automatic-deployments)、[Neon 价格](https://neon.com/pricing)。

## 已实现的服务边界

### 数据库 TLS 与日志

TLS（Transport Layer Security，传输层安全）同时校验受信证书链和主机名。连接 URL **只接受 `?sslmode=verify-full`**；Neon 复制出的默认 URL 如带 `sslmode=require&channel_binding=require`，应明确改成前述形式。

这不是仅给上游设置 `PG_SSL=true`：

- 上游该版本启用 SSL 时默认 `rejectUnauthorized: false`，连接日志还可能输出包含密码的 URL。
- 本封装通过官方 custom-model 工厂复用原 PostgreSQL 存储，用 `{ type: 'postgresql', postgresql: options }` 传入严格连接配置；**平铺 `{ type, host, ssl }` 会被其配置解析器忽略**。真实数据库回归覆盖这一反例。
- 显式 `ssl.rejectUnauthorized=true`、最低 TLS 1.2，关闭 `logSql` 和 `logConnect`。不把 URL 原样交给 `pg`，防止 URL 参数覆盖 `ssl` 对象。
- Node 驱动启用可用时的通道绑定，不把它冒称为强制 `channel_binding=require`；备份所用 libpq 则单独强制该模式。
- 拒绝全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。本地测试只给测试子进程加入临时测试 CA（Certificate Authority，证书颁发机构），从不跳过证书验证。
- 上游初始配置会写入临时目录。本封装只给其环境配置提供公开的数据库选择标记，真实凭据通过模型工厂/`jwtKey` 注入，不写入该初始配置文件。错误响应不含堆栈/SQL；日志只保留错误代码。

### 匿名留言、管理与外部请求

- `WALINE_MODE` 默认为 `locked`，返回 503，不启动数据库连接。只能显式选择 `bootstrap` 或 `public`。
- `bootstrap` 要求独立随机设置口令，HTTP Basic 用户名固定 `setup`；业务/管理请求先经过临时保护（合法 CORS 预检不返回业务数据）。它只是首次初始化保护，不是读者账号系统。应用检查加 `wl_users_single_account` 数据库唯一索引共同限制**一个作者账号**，并发首次注册也不能创建两个管理员。
- `public` 禁止注册，包括路由别名、方法覆盖和带令牌的查询；要求移除设置口令。作者再使用 Waline 自己的账号/令牌登录。**Basic 设置口令与 Waline 登录令牌不能混用；bootstrap 阶段只负责首次注册。**
- 首个管理员需要邮箱格式的登录标识，但不验证/发送邮件。读者仍不需要邮箱或账号。无邮件找回密码功能，不要通过清空用户表、重新公开抢注的方式恢复账号。
- 普通留言固定先审后显；同 IP 连续发布保留上游 60 秒限制。**此限制不是原子并发限流或全站硬预算**，平台转发 IP 和并发滥用仍待线上验收，不能宣称已具有全网抗攻击保障。
- 输入仅 JSON，最多 12 KiB；昵称 60 字符、正文 2,000 字符。匿名字段白名单、固定文章键、回复同篇/父子关系校验；拒绝传入邮箱、网址、设备详情及伪造身份。普通列表每页最多 10 个主评论；JSON API 总响应最多 1 MiB，独立源码附件另按 4 MiB 上限核验。
- 登录、审核和回复权限继续由 Waline 验证；匿名请求不能修改审核状态。统计、点赞、数据库 HTTP 导入导出、OAuth 和邮件找回入口关闭。
- 来源判断由自己的精确 origin 边界承担，不再叠加上游宽泛的域名/Referrer 检查：后者会误拒绝不带 Origin/Referrer 的正常同源 GET。允许无 Origin 的读取不代表授予管理权限；Cookie 不作为作者身份，管理修改仍须通过 Waline 令牌验证。
- `Cross-Origin-Opener-Policy: same-origin`（跨源打开者隔离策略，COOP）切断外站打开后台时的窗口关联；仅禁止 iframe 嵌入不足以阻止上游向 `window.opener` 发送令牌。后台 `redirect` 只接受三个站内管理路径，同时拒绝查询令牌，不允许登录后把令牌追加到外站地址。
- 原中间件会主动请求外部 OAuth 服务。本版加载前明确禁用它；也禁用默认管理页，改用固定、自托管管理文件与同源配置脚本。去掉会触发管理端自动查询 npm 最新版的可选版本响应头；版本由锁文件及人工审查维护，不伪造远端返回。中间件结构/版本不符合预期就拒绝初始化。
- 用非空的本地默认头像避免上游对空字符串的远程回退；外壳替换远程 Logo，隐藏未启用的邮件/数据库迁移入口和与 PostgreSQL 无关的 LeanCloud 横幅。服务器权限限制不依赖隐藏入口。小屏页头可换行，管理表格保持可读列宽、在表格内部横向滚动，不缩小整个页面。
- 显式关闭上游加载期遗留的请求 URL 日志，不依赖模块求值时尚未确定的运行环境；SQL/连接日志亦关闭。托管平台自己的访问日志仍须单独核对。
- 不配置 SMTP、通知、验证码或其他数据库凭据。模型与通知使用的旧式环境变量出现时拒绝启动；这里只接受下述专用设置，不让无关已有环境悄悄生效。
- `ua-parser-js` 已从分发和安装树移除，序列化只返回必要的空设备结构；尝试启用解析会失败。HTTP 平台日志的 User-Agent 不因此消失，不把这一改动说成零采集。
- API 仍可能保存 IP、HTTP 日志和账号信息；免登录不是零采集。浏览器来源限制不是认证，非浏览器客户端可以直接调用公开 API。
- 超时、响应失败可能发生在写入之后，不能自动重发；先核对数据库/管理端。

## 本地安装与检查

需要 Node.js 24。只能在本目录安装，博客根目录不增加这些依赖：

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
# 人工检查，不作为每次云端构建或定时任务：
npm run audit:dependencies
```

`npm test` 还直接调用实际的 `api/index.js` 入口文件：默认锁定时不加载 Waline、不需要数据库凭据；错误模式或配置在加载服务之前拒绝，错误响应/日志不暴露输入秘密。另检查分发差异、源码完整性及篡改拒绝；新增实际依赖解析、净化器、病理 Markdown 与收件人解析回归（合成输入、子进程有界超时），不发送邮件。这些入口与单元测试不创建数据库。管理端源码下载后的独立重建与分发再生成步骤见 [UPSTREAM.md](UPSTREAM.md#手动复核与更新)，仅该维护步骤需要 Python 3；常规安装/运行不需要编译器。

`--ignore-scripts` 不执行第三方安装脚本；本项目只用 PostgreSQL，不安装或使用 SQLite 原生绑定。固定依赖的版本并不等于安全告警已经解决。

可选真实 PostgreSQL 回归不自动下载镜像、数据库模式或浏览器。先单独准备：

- 官方 PostgreSQL 17.11 测试镜像：`postgres@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`。
- [固定上游 `waline.pgsql`](https://raw.githubusercontent.com/walinejs/waline/ce900fb655bcba8b734b954dc1bdeebc071d4cbe/assets/waline.pgsql)，SHA-256：`76320860ee6205465a5868b9a0a535fc6a8061257ab80a6521e009423db6c5f2`。不要用 `main` 的未来内容替换已验收模式。

```sh
QJ_WALINE_SCHEMA=/private/sources/waline.pgsql npm run test:postgres
```

该检查会创建临时的非特权、本机环回端口 PostgreSQL 容器：只读根文件系统、临时数据库、512 MiB 内存/1 CPU、合成账号与数据，结束删除容器及临时文件；已下载镜像仍留在本机缓存。它覆盖可信连接、不可信 CA/错误主机名拒绝、运行角色不能删表、并发初始化只生成一个管理员、匿名待审核、作者审核/回复、串行限速、内容清理、真实 `pg_dump`/空库恢复及已有表恢复拒绝。它不连接 Neon、Vercel 或真实邮箱。

可选管理端浏览器回归要在**完整模板/实例检出目录**中运行（复用仓库的本地浏览器工具；仅服务生产代码可单独复制部署）：

```sh
QJ_WALINE_SCHEMA=/private/sources/waline.pgsql \
QJ_CHROMIUM=/path/to/chrome npm run test:admin
```

它包含上述数据库回归，并在另一个临时空库实测固定管理端表单注册、登录、审核和回复；从另一本机 HTTPS 源打开真实弹窗，验证 COOP 切断 opener 且没有令牌消息外泄。检查 1280/390/320px 的真实视口与字大小、第三方请求、CSP 与未捕获异常。只放行本次临时证书的公钥指纹，不关闭全局证书校验、不自动下载浏览器。可用 `QJ_SCREENSHOTS` 保存合成数据截图；不是触屏手势、Safari/iPhone 或真实网络验收。

## 待授权的云端开通顺序

**先阅读固定分发的依赖/许可记录，并完成下面的账户与生产验收。不要直接点上游“一键部署”后再补首次管理员保护。**

### 1. 确认账户和新资源范围

作者本人登录 Vercel 与 Neon，确认个人非商业 Hobby/Free、剩余额度及拟使用的地区。建议先独立创建 Neon Free 项目，避免未经审查接受 Marketplace 计费或自动注入其他凭据。选择已有域名的空闲子域前先备份 DNS；没有确认域名就先不改解析。

将来需要一个独立 Vercel 项目（API/管理端），以及一个独立静态面板源。博客仍在现有 Cloudflare Worker，不搬写作后台、不把三个源合并。Vercel 函数和 Neon 数据库地区尽量接近，但读者网络可达性需实际测试后确定。

### 2. 数据库初始化与最小权限

只在新的专用数据库，用所有者身份执行固定上游模式；用事务和 `ON_ERROR_STOP=1`，不要覆盖已有库。然后通过 SQL 创建运行角色（不要误用附带高权限成员关系的角色）：

```sql
CREATE ROLE waline_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
```

先依次执行 [`sql/indexes.sql`](sql/indexes.sql) 和 [`sql/runtime-role.sql`](sql/runtime-role.sql)：添加查询索引和单账号唯一约束、仅授予三张表的读写和序列使用；运行角色不是表所有者，不能改表/创建数据库。**不能省略索引文件后只凭应用层 count 检查防止并发注册。** 本方案只允许一个作者账号；若已有多账号数据，应停止并另行设计迁移，不为通过约束而删除账号。

**Neon 首次密码设置的限制（2026-10-29 实测及官方文档复核）：** 无密码角色不能用控制台 Reset password 首次设置；`psql \password` 会在客户端生成 SCRAM（Salted Challenge Response Authentication Mechanism，加盐质询响应认证机制）校验值，Neon 不接受预先哈希的密码。不要反复重置、删除重建角色，或为兼容而改用所有者账号部署。

应使用可信的本地交互式客户端隐藏读取独立随机密码，在内存中构造 `ALTER ROLE waline_app PASSWORD ...`，通过验证证书和主机名的 TLS 连接提交原始密码；**不是明文网络传输**，但 Neon 必须接收原始值，本地工具不能保证云平台内部日志行为。事前确认此信任边界及目标，事后以 `waline_app` 核验实际最小权限和只读连接。设置密码的本地工具不将密码写入文件、环境变量、进程参数、聊天或 SQL Editor 历史；不得打印含密码的 SQL/驱动错误。服务运行所需凭据另存平台的秘密环境设置，不混入本地设置工具的日志或命令行。请求超时或断线后先只读核对实际状态，不自动重发。设置完成后，控制台 Reset password 才是可另行授权的轮换路径。依据：[Neon 角色管理](https://neon.com/docs/manage/roles)。

`openssl rand -hex 32` 生成 **32 字节（256 比特）随机数据，输出为 64 个十六进制字符**，不是 64 比特；每种凭据单独生成，妥善保存。

运行服务使用运行角色的 **pooled** URL；所有者/备份使用独立保存的 **direct** URL。所有者连接绝不放进 Vercel 或读者面板。不要假设 SQL 中的运行角色也能为你完成将来的模式迁移；升级需所有者另行授权。

### 3. 受保护的服务初始化

1. Vercel 项目根目录只能是本目录，不能上传私有博客、文章或读者面板。使用 `vercel.json` 中的安装方式；暂不连接自动 Git 部署。若用控制台导入 Git，应只选择不含私人内容的服务仓库或公开模板，将 Root Directory（构建根目录）设为 `integrations/waline-server`；平台会读取所选的整个仓库，不要选择存放私有文章的实例仓库。线上函数追踪及包大小还须验收。
2. 初始保持 `WALINE_MODE=locked`（锁定，不启动数据库连接）；此阶段不填数据库或作者初始化秘密。开启平台 [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication) 保护。选择 **All Deployments（所有部署）**，覆盖预览和正式域名，不能把 Standard Protection（正式域名除外）当作全保护。2026-10-29 官方复核：Hobby 的 Vercel Authentication 全保护不需付费附加服务；不要购买另一个名为 Password Protection 的密码保护功能。部署前在本人控制台核实设置，并使用与数据库相近的单一函数地区，不加付费多区/故障转移。不要给真实数据库设置公开预览环境变量。
3. 将 `.env.example` 中专用配置填入 Vercel 的秘密设置；真实 URL/口令不提交。JWT（JSON Web Token，JSON 格式的登录令牌）用于验证作者身份；`WALINE_JWT_TOKEN` 保存的是签名密钥，不是浏览器登录令牌。签名密钥与临时设置口令各自用密码管理器或 `openssl rand -hex 32` 生成，不复用数据库口令。`.env.local` 只用于必要本地操作，权限 600。
4. 经发布授权后，在保护仍有效时改成 `bootstrap`。浏览器使用临时 HTTP Basic `setup` + 设置口令，访问 `/ui/register` 创建作者账号。确认 `wl_users` 只有一个正确的 `administrator`，保存作者强密码。
5. 将模式改为 `public`、删除 `WALINE_SETUP_PASSWORD`，保留平台保护；先结束设置用的独立浏览器会话，避免残留 HTTP Basic 认证，再验证作者登录和管理端。随后再经过公开服务授权，按实际托管条件完成匿名请求测试；**不能把平台绕过令牌放入静态面板**。保护或删除旧 bootstrap 部署，避免遗留入口。
6. 逐项验收待审核不可见、作者审核/回复、未授权修改失败、限速/配额、没有意外第三方请求，以及错误/超时不重发。后台强密码恢复与双因素认证也须单独核验；无邮件恢复尚不能视为已完成。

### 4. 最后开放读者面板与博客

面板按 [原 README](../waline/README.md) 部署，并确认实际 CSP/跨源请求正确。只在完整验收后填入博客 `data/comments.yaml` 的面板源并开启。每个云端发布、DNS 修改和博客推送都需要实际操作者确认；本目录没有一条自动完成这些动作的脚本。

## 独立手动备份与恢复

这不是定时备份服务。正式开通前需确认备份负责人、频率、保留期及已有的受保护存储位置；默认不买存储、不加每日 CI 或保活任务。至少在模式升级前备份；留言发生后多久做下一份，决定了可能丢失多长时间的数据，不能假装 Neon 短期恢复窗口已经解决。

安装与实际 Neon PostgreSQL 主版本匹配的 `pg_dump`、`pg_restore`、`psql`。使用独立的私密环境文件（权限 600，不在仓库）保存 `WALINE_BACKUP_DATABASE_URL`：所有者 direct URL，后缀仅 `?sslmode=verify-full`；必要时另设 `WALINE_BACKUP_CA_FILE` 指向受信系统根证书文件，不从陌生网址取 CA。

```sh
mkdir -m 700 "$HOME/comment-backups"  # 已有目录先检查权限，不盲目覆盖
node --env-file=/private/waline-backup.env scripts/backup.cjs \
  --output "$HOME/comment-backups/comments-20261015.dump"
```

工具不覆盖已有文件、拒绝 Git 仓库及其符号链接别名；输出权限 600，凭据不放进进程参数。已有 `PG*` 环境变量不继承到备份进程，由专用连接信息明确设置。强制 `verify-full` 与 libpq 通道绑定，2 分钟超时、不自动重试；失败删除**本次新建**的不完整文件，并报告错误类别。若进程被杀、机器断电或清理报错，仍须人工检查残留，不把它当成成功备份。检查自定义格式标识只说明产物基本格式正确，**还必须恢复验证**。

备份包含账号密码散列、可能的双因素密钥、IP 与未公开留言，是私密数据。使用加密磁盘/受保护介质保存，副本不能只留在同一云项目，也不能仅放在不稳定的 Oracle 实例。文件权限不等于加密；没有确认保管方案之前不算备份工作闭环。

恢复仅针对**新建空库**，不指向生产库、不从已有生产数据的分支克隆后直接覆盖。用本机权限 600 的 `pg_service.conf` 保存恢复目标 direct 连接与 `sslmode=verify-full`、`sslrootcert`，避免在命令行暴露密码。确认目标后：

```sh
psql 'service=waline-restore' -X -v ON_ERROR_STOP=1 -At \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';"
# 必须为 0；另外核对服务配置确实指向新库，而不是只看数据库名。
pg_restore --dbname='service=waline-restore' --no-owner --no-privileges \
  --single-transaction --exit-on-error "$HOME/comment-backups/comments-20261015.dump"
```

**不加 `--clean`、`--if-exists` 或覆盖生产的重试。** 核对文章键、评论 ID、父子关系、时间、审核状态、账号及序列；确保待审核内容仍不公开。运行角色和权限不由 `--no-privileges` 的归档恢复，需在新库创建对应角色并执行 `sql/runtime-role.sql`（已恢复的索引不再执行 `sql/indexes.sql`）。需要切换时先明确旧库停写边界、再切连接，不能只换 URL 而漏掉切换期间的新留言。

官方依据：[Neon 安全连接](https://neon.com/docs/connect/connect-securely)、[pg 的 SSL 配置](https://node-postgres.com/features/ssl)、[Neon pg_dump/pg_restore](https://neon.com/docs/manage/backup-pg-dump)。

## 更新与回滚

保留私密配置与数据，同步代码、锁文件与配套 `vendor/`；不能漏掉源码归档或换入官方同版本包。升级时一起审阅上游中间件、custom-model 接口、驱动 TLS/日志行为、模式与管理界面许可，重跑本目录测试、两类依赖审计和源码重建；不能只改包号或改成 `latest`。0 项报告只代表本次核对，之后任何告警仍须报告，不能把测试通过代替安全审查。

数据库恢复和代码回滚是两件事；回滚代码不覆盖数据库，恢复备份也不保证与任意旧版本兼容。出现问题先保护服务和保存当前数据，不删除账户/评论来制造“重新初始化成功”。
