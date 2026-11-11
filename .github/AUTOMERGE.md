# Auto-merge 配置说明

`.github/workflows/auto-merge.yml` 用来把满足条件的 Pull Request 自动合并进 `main`。

## 触发方式

| 事件 | 说明 |
| --- | --- |
| `pull_request_target` (opened / reopened / synchronize / ready_for_review / converted_to_draft / edited) | PR 一有动静就尝试合并 |
| `workflow_dispatch` | 手动指定 PR 号，或留空全量扫描 |
| `schedule` (每 10 分钟) | 兜底扫描，防止事件漏触发 |

## 可调参数（仓库 Settings → Secrets and variables → Actions → Variables）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `AUTO_MERGE_ALLOWLIST` | `demacia1314` | 允许自动合并的作者，逗号分隔；`*` 表示所有作者 |
| `AUTO_MERGE_METHOD` | `merge` | 合并方式：`merge` / `squash` / `rebase` |

## 行为

1. 作者不在 allowlist → 跳过（`not-allowlisted`）
2. Draft PR → 跳过（`draft`）
3. 等待 GitHub 算出 `mergeable`；有冲突 → 记 warning 并跳过（`conflict`）
4. 直接调用 merge API 合并；如果被保护规则/必过检查挡住，退化为启用 GitHub 原生 auto-merge 排队
5. 每次运行的结论写在 Actions 运行页的 Job Summary 表格里

## 关闭方式

删掉 `.github/workflows/auto-merge.yml` 即可；或把 `AUTO_MERGE_ALLOWLIST` 设成一个不存在的用户名。
