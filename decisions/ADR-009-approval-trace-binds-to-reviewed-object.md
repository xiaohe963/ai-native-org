# ADR-009：批准留痕绑定被批准对象，工单布尔值只作镜像

```text
日期: 2026-11-12
状态: 提议
关联 run / case: runs/2026-11-12-JOB-0-run5.md；无 case（cases/ 为空）

决策:
对以 PR 为载体的变更（常规发布 C-1、紧急修复 C-6，以及任何走 PR 的发布），
负责人的发布批准记录为 PR review_threads 中的结构化评论，例如
`release-go ticket=<id> scope=<摘要>`；评论的 author 与 created_at 作为
「谁在何时批准」的证据。工单的 release_go 布尔值只作状态镜像，不作为批准证明。

当时的约束:
8 人团队、一个两周迭代；工单补登表只有 release_go / release_veto 布尔字段，
没有 release_go_by / release_go_at（G-14 未执行）；代码仓库的
comments / review_threads / approvals 可用，但补登表未写明子字段；
负责人目前是唯一批准人，不能把批准权拆给第二个人。

考虑过的其他选项:
- 用工单 release_go 布尔值：只能证明字段被置位，不能证明谁在何时批准；未选。
- 先补工单 release_go_by / release_go_at（G-14）：会先改场景契约再验证；
  本轮用户明确不执行 G-14；保留为后续候选，未选。
- 用聊天记录 / 口头确认：不是清单内系统来源，也不是可导出字段；未选。
- 让 agent 代写批准评论：违反 ADR-001（判定人不可是产出者）；未选。
- 用 approvals 点击记录：只证明有人点过同意，不证明独立，也不带批准语义；
  未选。

依据:
- JOB-0.md 使用边界 5：approvals 只证明有人点过同意；「非产出人复核」必须在
  comments / review_threads 里留痕。
- JOB-0.md 2026-11-12 工单补登表：release_go 是布尔值，无批准人 / 时间。
- JOB-0.md 六字段要求：命题必须带适用时点；没有时间点的「批准」不可判定。
- ADR-006：先写命题；ADR-007：业务命题与可证命题分开；ADR-008：闭合覆盖合取项。
- 本轮 R5-P3：C-1 的批准时点最初卡在工单字段缺失，改 PR 评论后成为可判定命题。
以上依据是任务契约与 ADR，不是 cases/ 的 L2 主张；因此本 ADR 标「提议」。

预期效果与验证方式:
- R5-P3 可判定：review_threads 中存在 author=负责人账号、body 匹配
  `release-go ticket=<id>`、created_at < deploy.deployed_at、ticket_id 与
  repo.linked_ticket / ticket.ticket_id 一致。
- 可观察行为：每个生产发布在部署前有一条负责人 `release-go` 评论；
  工单 release_go 只是镜像，报告不得用它单独证明批准。
- 验证：下一轮连续检查两个发布；两条都满足则决策被实现；任一不满足则未实现。

推翻条件:
- 连续两次发布出现 release_go=true 但无匹配评论，或评论时间晚于部署。
- repo 的评论可被编辑 / 删除且无审计，导致 author / created_at 不可信。
- 负责人账号不唯一或可共享，无法把评论绑定到具体决策人。
- 合规要求批准必须落在工单 / 审批系统，PR 评论不被接受。
- 发布不再以 PR 为载体（例如直接推送或纯配置发布）。

已知局限:
- 只适用于 PR 载体的变更；数据迁移、权限变更、纯配置发布不适用。
- 依赖 `comments` / `review_threads` 对象含 author、created_at、body；
  补登表未逐项登记子字段（G-R5-4），实际 schema 不符时降为待核。
- 结构化评论格式是新约定，需要团队执行；不执行则退回未闭合。
- 评论是自由文本，判定人需要按格式核对；格式漂移会产生歧义。
- 不替代法定双签、法务审查或合规审批。
- 无真实案例，L1 为空；不能证明该做法在真实组织中的效果。
```

## 同轮其他评论约定

`copy-ok`（R5-P17）和 `postmortem`（R5-P21）也是 run5 设计的 PR 评论约定，
但本条只对 `release-go` 做判断。`copy-ok` / `postmortem` 尚未写入 ADR，
按 JOB-0 的「假设可达」规则，P17 / P21 只能标「条件闭合」，不得计入
已登记可达。下一轮如果继续使用，需另立 ADR，或把这三类约定合并成一份
「结构化 PR 评论约定」。
