#!/usr/bin/env sh
# 把博客仓库完整镜像到本地（含全部分支与历史）。用于防止令牌泄露后仓库被改写或删除。
# 用法：scripts/backup.sh <owner/repo> [备份目录]
# 首次运行会 clone --mirror，之后每次运行只拉取更新。可放进系统计划任务，每周一次即可。
set -eu
repo="${1:?用法：scripts/backup.sh <owner/repo> [备份目录]}"
dir="${2:-$HOME/backups/$(basename "$repo").git}"
if [ -d "$dir" ]; then
  git -C "$dir" remote update --prune
else
  mkdir -p "$(dirname "$dir")"
  git clone --mirror "https://github.com/$repo.git" "$dir"
fi
git -C "$dir" log -1 --format='最新提交：%h %cd %s' --date=iso
echo "备份位置：$dir"
