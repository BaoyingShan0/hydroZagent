# Hydro Control Server 单节点部署

本目录是 P0 Linux 部署基线。它不会提供模型直连回退：migration、生产配置、TLS、数据库、catalog、上游、加密密钥或备份密钥清单任一门禁失败时，HCS 保持不可用。

上线前还必须填写并签署 `docs/ai-native-sdlc/internal-multiuser-usage-records/production-approval-template.md`；示例配置和本目录脚本输出本身不等于生产批准。

## 安装与权限

1. 将本目录安装到 `/opt/hydro-hcs/deploy`，所有脚本设为 `0755 root:root`。
2. 创建系统组 `hydro-hcs` 与管理组 `hydro-admin`。把实际运维人员加入 `hydro-admin`，不要把普通用户加入 `docker` 组。
3. 从 `config/*.example` 创建 `/etc/hydro-hcs/deploy.env`、`hcs.env`、`backup-key-manifest.json`、`postgres-password`、`backup-age-recipient` 和 `tls/{server.crt,server.key,ca.pem}`。配置目录为 `0750 root:hydro-hcs`，文件为 `0640` 或更严格；私钥和口令建议 `0600 root:root`。
4. 用已审查的 `name@sha256:<digest>` 填写 HCS、PostgreSQL、age 和 ACL 探针镜像。`age` 镜像必须提供兼容的 `age` 默认入口点；版本和 digest 写入部署审批记录。
5. 数据卷和备份目录必须位于 LUKS 或单位加密块存储。将证明材料写入 root 管理的证据文件并在 `HCS_STORAGE_ENCRYPTION_EVIDENCE_FILE` 指向它。
6. 安装 `sudoers/hydro-hcs`、`bin/hydro-hcs-admin` 与两个 systemd unit，运行 `visudo -cf` 后才能 enable。管理员口令只通过 stdin，例如 `printf '%s\n' "$PASSWORD" | sudo hydro-hcs-admin create-user --username alice --role user --password-stdin`。

## 启动与验证

运行 `scripts/verify-deployment.sh` 后启动 `hydro-hcs.service`。Compose 不映射 PostgreSQL 端口，HCS 使用内网 CA 证书直接监听 HTTPS；migration one-shot job 成功后业务容器才会启动。随后运行：

```bash
sudo /opt/hydro-hcs/deploy/scripts/verify-runtime.sh
sudo /opt/hydro-hcs/deploy/scripts/verify-model-acl.sh
```

第二项必须同时证明 HCS 容器可访问测试 endpoint、非 HCS 网络身份不可访问；实现 ACL 的防火墙或模型网关配置由单位网络责任人完成并留证。

## 备份与恢复

`backup.sh` 只产生 `pg_dump | age` 流，不落明文 dump，并原子更新仍有效备份所引用的正文 key ID 清单。`retention-budget.sh` 强制 `T_table + T_backup ≤ T_absolute`。HCS 主机只保存 age recipient 公钥；恢复 identity 必须从独立密钥设施临时提供。

`restore-smoke.sh <backup.age> <age-identity>` 恢复到隔离 volume，依次执行 checksum、流式解密、migration、到期清理和完整性检查。脚本不会自动切换生产；人工核对后才允许走受控切换流程。至少在首发前完成一次并保存终端输出、镜像 digest、时间与审批人。

日志由容器运行时和 journald 轮转；生产需对 `hydro-hcs.service`、磁盘空间和 HTTPS `/readyz` 配置告警。`OnFailure` unit 提供最小本机事件，单位监控系统负责接收 journald 事件并升级通知。
