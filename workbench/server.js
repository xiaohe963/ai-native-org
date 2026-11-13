#!/usr/bin/env node
"use strict";

/*
 * 变更卡工作台后端
 * - 零 npm 依赖：只用 Node 内置模块
 * - 只绑 127.0.0.1；不提供远端访问
 * - 卡的结构化源在 data/cards/*.json
 * - 提交时只写 runs/<date>-<slug>.md，并只 add / commit 这一个文件
 * - 门禁在服务端强制；前端校验只是即时反馈
 */

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { execFile } = require("child_process");

const ROOT = __dirname;
const CFG_LOCAL = path.join(ROOT, "config.json");
const CFG_EXAMPLE = path.join(ROOT, "config.example.json");
const CFG_PATH = fs.existsSync(CFG_LOCAL) ? CFG_LOCAL : CFG_EXAMPLE;
const CFG = JSON.parse(fs.readFileSync(CFG_PATH, "utf8"));
const HOST = process.env.WB_HOST || CFG.host || "127.0.0.1";
const PORT = Number(process.env.WB_PORT || CFG.port) || 8787;
const REPO = path.resolve(ROOT, process.env.WB_REPO || CFG.repoPath);
const CARDS = path.resolve(ROOT, process.env.WB_CARDS || CFG.cardsDir || "data/cards");
const RUNS = path.join(REPO, CFG.runsSubdir || "runs");
const MAX_BODY = 2 * 1024 * 1024;

/* ---------- 基础工具 ---------- */
function p2(n) { return String(n).padStart(2, "0"); }
function nowISO(d) {
  d = d || new Date();
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? "+" : "-";
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
    "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) +
    sign + p2(Math.floor(Math.abs(tz) / 60)) + ":" + p2(Math.abs(tz) % 60);
}
function httpError(status, message, extra) {
  const e = new Error(message);
  e.status = status;
  e.extra = extra || null;
  return e;
}
function send(res, status, obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  const type = typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (d) => {
      size += d.length;
      if (size > MAX_BODY) { reject(httpError(413, "请求体过大")); req.destroy(); return; }
      chunks.push(d);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function git(args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: REPO, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.gitStderr = String(stderr || "").trim();
        reject(err);
      } else {
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    });
  });
}
async function ensureDirs() {
  await fsp.mkdir(CARDS, { recursive: true });
  await fsp.mkdir(RUNS, { recursive: true });
}

/* ---------- 卡存储 ---------- */
function safeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(id);
}
function cardPath(id) {
  if (!safeId(id)) throw httpError(400, "非法卡 ID");
  const p = path.resolve(CARDS, id + ".json");
  if (!p.startsWith(CARDS + path.sep)) throw httpError(400, "非法路径");
  return p;
}
async function listCards() {
  const names = (await fsp.readdir(CARDS)).filter((n) => n.endsWith(".json"));
  const out = [];
  for (const n of names) {
    try {
      const c = JSON.parse(await fsp.readFile(path.join(CARDS, n), "utf8"));
      out.push({
        id: c.id, title: c.title || "", status: c.status || "草稿",
        category: c.category || "", updatedAt: c.updatedAt || ""
      });
    } catch (e) { /* 跳过损坏文件 */ }
  }
  out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return out;
}
async function readCard(id) {
  const p = cardPath(id);
  try {
    return JSON.parse(await fsp.readFile(p, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") throw httpError(404, "卡不存在：" + id);
    throw e;
  }
}
async function writeCard(c) {
  c.updatedAt = nowISO();
  const p = cardPath(c.id);
  const tmp = p + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(c, null, 2), "utf8");
  await fsp.rename(tmp, p);
}
async function nextId() {
  const d = new Date();
  const base = "CHG-" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-";
  const cards = await listCards();
  let n = 1;
  while (cards.some((c) => c.id === base + p2(n))) n++;
  return base + p2(n);
}

/* ---------- 模型与校验 ---------- */
function blankCard(id) {
  return {
    id: id,
    fileSlug: "CHANGE-" + (Number(String(id).split("-").pop()) || 1),
    version: "v1",
    title: "",
    category: "D-2 判断资产变更",
    categoryReason: "",
    notIncluded: "",
    environment: "本地仓库",
    timeWindow: "",
    author: "",
    status: "草稿",
    adrBasis: "",
    impact: { objects: "", radius: "", latency: "", irreversible: "", sources: "", notClaimed: "" },
    rollback: {
      level: "可轻易回滚", action: "", executor: "", evidence: "",
      usesGit: true, baseCommit: "", preStatusClean: false,
      changeCommit: "", postStatusClean: false, branch: "main", verification: ""
    },
    owner: { name: "", why: "", notGranted: "", secondParty: "", absence: "" },
    executor: "",
    envelope: { scope: "", expiry: "", quota: "", audit: "", revoker: "", rollback: "", ownerNamed: "" },
    inputs: { registered: false, note: "" },
    assumptions: "",
    controls: [{
      id: "P1", proposition: "", evidence: "", collector: "", judge: "",
      status: "待核", closure: "未闭合", note: ""
    }],
    business: { id: "B-1", proposition: "", mapping: "", status: "未闭合" },
    epc: { collector: "", exportedAt: "", objectId: "", sha256: "", judge: "", checkedAt: "", conclusion: "" },
    judgment: { judge: "", time: "", conclusion: "" },
    residual: {
      unclosed: "", unacceptable: "", impact: "", whyNow: "", compensating: "",
      scope: "", reviewPoint: "", acceptor: "", acceptedAt: "", revocation: ""
    },
    external: { exportedPath: "", cardCommit: "", committedAt: "" },
    createdAt: nowISO(),
    updatedAt: nowISO()
  };
}

function gates(c) {
  const usesGit = !!(c.rollback && c.rollback.usesGit);
  const env6 = ["scope", "expiry", "quota", "audit", "revoker", "rollback"].every((k) =>
    String((c.envelope || {})[k] || "").trim() !== "");
  const ctrlOk = (c.controls || []).length > 0 && (c.controls || []).every((x) =>
    String(x.proposition || "").trim() && String(x.evidence || "").trim() &&
    String(x.collector || "").trim() && String(x.judge || "").trim() && x.status && x.closure);
  const gitOk = !usesGit || (
    String((c.rollback || {}).baseCommit || "").trim() && c.rollback.preStatusClean &&
    String(c.rollback.changeCommit || "").trim() && c.rollback.postStatusClean
  );
  const residualOk = (c.business || {}).status === "闭合" || (
    String((c.residual || {}).acceptor || "").trim() && String(c.residual.acceptedAt || "").trim()
  );
  return [
    { id: 1, label: "变更类别与后果性理由", pass: !!(String(c.category || "").trim() && String(c.categoryReason || "").trim()), detail: "类别已选 + 写明为什么是后果性" },
    { id: 2, label: "owner 指名到人", pass: !!String((c.owner || {}).name || "").trim(), detail: "必须是具体人，不是角色占位" },
    { id: 3, label: "授权包六项齐全", pass: env6, detail: "范围 / 时限 / 额度 / 审计 / 撤销人 / 回滚路径" },
    { id: 4, label: "回滚路径有证据来源", pass: !!String((c.rollback || {}).evidence || "").trim(), detail: "写系统字段 + 登记位置，不写「应该有」" },
    { id: 5, label: "控制命题六字段齐全", pass: ctrlOk, detail: "命题 / 证据 / 采集人 / 判定人 / 状态 / 闭合" },
    { id: 6, label: "输入集合已登记", pass: !!(c.inputs && c.inputs.registered), detail: "路径 / 清单 / 命名 / 解析 / 语义" },
    { id: 7, label: "业务未闭合时已签署残余风险", pass: !!residualOk, detail: "业务命题闭合，或 owner 已签署接受" },
    { id: 8, label: "git 前置检查（若使用）", pass: !!gitOk, na: !usesGit, detail: usesGit ? "base_commit + 变更前 status 为空 + change_commit + 变更后 status 为空" : "未使用 git" }
  ];
}
function canRegistered(c, ctrl) {
  if (!c.rollback || !c.rollback.usesGit) return false;
  const gitOk = String(c.rollback.baseCommit || "").trim() && c.rollback.preStatusClean &&
    String(c.rollback.changeCommit || "").trim() && c.rollback.postStatusClean;
  const epc = ["collector", "exportedAt", "objectId", "sha256", "judge"].every((k) =>
    String((c.epc || {})[k] || "").trim() !== "");
  const indep = String(ctrl.judge || "").trim() !== "" &&
    String(ctrl.judge).trim() !== String(c.epc.collector || "").trim();
  return !!(gitOk && epc && indep);
}
function counts(c) {
  const n = (f) => (c.controls || []).filter(f).length;
  return {
    reg: n((x) => x.status === "已登记可达"),
    asm: n((x) => x.status === "假设可达"),
    cl: n((x) => x.closure === "闭合"),
    cond: n((x) => x.closure === "条件闭合"),
    open: n((x) => x.closure === "未闭合"),
    total: (c.controls || []).length
  };
}
function validate(c) {
  const gs = gates(c);
  const blocking = [];
  const gated = ["已授权", "执行中", "待验收", "已验收"];
  if (gated.indexOf(c.status) >= 0) {
    gs.forEach((g) => { if (!g.pass && !g.na) blocking.push("门禁 " + g.id + " 未通过：" + g.label); });
  }
  if (c.status === "已验收" && (c.business || {}).status !== "闭合") {
    blocking.push("业务命题未闭合，不能标「已验收」");
  }
  (c.controls || []).forEach((x) => {
    if (x.status === "已登记可达" && !canRegistered(c, x)) {
      blocking.push("控制命题 " + x.id + " 标了「已登记可达」，但未满足 ADR-015 五项条件");
    }
  });
  return { gates: gs, blocking };
}

/* ---------- markdown 生成 ---------- */
function safeSlug(s) {
  return String(s || "card").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^\.+/, "").slice(0, 64) || "card";
}
function renderMarkdown(c) {
  const gs = gates(c);
  const passed = gs.filter((g) => g.pass || g.na).length;
  const failed = gs.filter((g) => !g.pass && !g.na);
  const ct = counts(c);
  const L = [];
  const push = (...xs) => L.push(...xs);
  const v = (x) => (x == null || x === "" ? "—" : String(x));

  push("# " + c.id + "：" + v(c.title || "（未命名变更）"), "");
  push("> 由「变更卡工作台」导出（" + nowISO() + "）。本文件是登记面，不是证据。", "");
  push("> 门禁：" + passed + " / 8 通过" + (failed.length ? "；未通过：" + failed.map((g) => g.id + " " + g.label).join("；") : ""), "");
  push("> 控制命题：已登记 " + ct.reg + " + 假设 " + ct.asm + "；闭合 " + ct.cl + " + 条件闭合 " + ct.cond + " + 未闭合 " + ct.open, "");
  push("> 业务命题：" + v((c.business || {}).status), "");

  push("## 1. 卡头", "", "```text",
    "卡 ID: " + c.id,
    "卡版本: " + v(c.version),
    "变更标题: " + v(c.title),
    "变更类别: " + v(c.category),
    "环境: " + v(c.environment),
    "时间窗: " + v(c.timeWindow),
    "填写人 / 填写时间: " + v(c.author) + " / " + v(c.createdAt),
    "卡状态: " + v(c.status),
    "依据的登记表 / ADR: " + v(c.adrBasis),
    "```", "");

  push("## 2. 变更类别与纳入理由", "",
    "为什么是后果性：" + v(c.categoryReason), "",
    "不纳入的相邻变更：" + v(c.notIncluded), "");

  push("## 3. 影响面", "",
    "| 项 | 内容 |", "| --- | --- |",
    "| 受影响对象 | " + v(c.impact.objects) + " |",
    "| 爆炸半径 | " + v(c.impact.radius) + " |",
    "| 检测延迟 | " + v(c.impact.latency) + " |",
    "| 不可逆点 | " + v(c.impact.irreversible) + " |",
    "| 关键事实与权威来源 | " + v(c.impact.sources) + " |",
    "| 明确不声称的影响面 | " + v(c.impact.notClaimed) + " |", "");

  push("## 4. 可逆性", "",
    "| 项 | 内容 |", "| --- | --- |",
    "| 可逆等级 | " + v(c.rollback.level) + " |",
    "| 回滚动作 | " + v(c.rollback.action) + " |",
    "| 回滚执行人 / 复核人 | " + v(c.rollback.executor) + " |",
    "| 回滚路径的证据来源 | " + v(c.rollback.evidence) + " |",
    "| 变更前基线 | base_commit = " + v(c.rollback.baseCommit) + "；变更前 status 为空 = " + (c.rollback.preStatusClean ? "是" : "否") + " |",
    "| 变更提交 | change_commit = " + v(c.rollback.changeCommit) + "；变更后 status 为空 = " + (c.rollback.postStatusClean ? "是" : "否") + " |",
    "| 回滚验证命题 | " + v(c.rollback.verification) + " |", "");

  push("## 5. 决策权 owner", "",
    "| 项 | 内容 |", "| --- | --- |",
    "| owner | " + v(c.owner.name) + " |",
    "| 为什么是这个角色 | " + v(c.owner.why) + " |",
    "| 明确不授予 | " + v(c.owner.notGranted) + " |",
    "| 第二方 | " + v(c.owner.secondParty) + " |",
    "| owner 缺席 | " + v(c.owner.absence) + " |", "");

  push("## 6. 执行者与授权包", "", "```text",
    "执行者: " + v(c.executor),
    "授权范围: " + v(c.envelope.scope),
    "有效期 / 触发失效条件: " + v(c.envelope.expiry),
    "额度或频次上限: " + v(c.envelope.quota),
    "审计记录位置: " + v(c.envelope.audit),
    "撤销人: " + v(c.envelope.revoker),
    "回滚路径与验证方式: " + v(c.envelope.rollback),
    "决策权 owner（指名到人）: " + v(c.envelope.ownerNamed),
    "```", "");

  push("## 7. 控制命题", "",
    "| ID | 命题 | 证据字段 | 采集人 | 判定人 | 状态 | 闭合 |",
    "| --- | --- | --- | --- | --- | --- | --- |");
  (c.controls || []).forEach((x) => {
    push("| " + v(x.id) + " | " + v(x.proposition) + " | " + v(x.evidence) + " | " +
      v(x.collector) + " | " + v(x.judge) + " | " + v(x.status) + " | " + v(x.closure) + " |");
  });
  push("", "**报告口径：已登记 " + ct.reg + " 条 + 假设 " + ct.asm + " 条；闭合 " + ct.cl +
    " + 条件闭合 " + ct.cond + " + 未闭合 " + ct.open + "。**", "");

  push("## 8. 业务命题", "",
    "| ID | 业务命题 | 映射控制命题 | 业务状态 |",
    "| --- | --- | --- | --- |",
    "| " + v(c.business.id) + " | " + v(c.business.proposition) + " | " + v(c.business.mapping) + " | " + v(c.business.status) + " |", "");

  push("## 9. 证据包封面（EPC）", "", "```text",
    "EPC ID: " + c.id + "-EPC-1",
    "契约 ID: " + ((c.controls || []).map((x) => x.id).join("–") || "—"),
    "证据系统: " + (c.rollback.usesGit ? "本地 git" : "（未声明）"),
    "导出账号: " + v(c.epc.collector),
    "导出时间: " + v(c.epc.exportedAt),
    "导出对象 ID: " + v(c.epc.objectId),
    "导出文件 SHA-256: " + v(c.epc.sha256),
    "采集人（角色 + 账号）: " + v(c.epc.collector),
    "判定人（角色 + 账号）: " + v(c.epc.judge),
    "核对时间: " + v(c.epc.checkedAt),
    "核对结论: " + v(c.epc.conclusion),
    "```", "");

  push("## 10. 判定记录", "", "```text",
    "判定人: " + v(c.judgment.judge),
    "判定时间: " + v(c.judgment.time),
    "判定结论: " + v(c.judgment.conclusion),
    "```", "");

  push("## 11. 残余风险接受（owner 签署）", "", "```text",
    "未闭合项: " + v(c.residual.unclosed),
    "不可接受项: " + v(c.residual.unacceptable),
    "业务影响: " + v(c.residual.impact),
    "为什么必须现在做 / 推迟的代价: " + v(c.residual.whyNow),
    "补偿控制: " + v(c.residual.compensating),
    "接受范围: " + v(c.residual.scope),
    "有效期 / 复审点: " + v(c.residual.reviewPoint),
    "接受人（姓名 + 账号）: " + v(c.residual.acceptor),
    "接受时间: " + v(c.residual.acceptedAt),
    "撤销条件: " + v(c.residual.revocation),
    "```", "");

  push("## 12. 输入集合与假设", "",
    "输入集合已登记：" + (c.inputs.registered ? "是" : "否"), "",
    "未登记的假设：" + v(c.inputs.note), "",
    "假设清单：" + v(c.assumptions), "");

  push("## 13. 导出时点门禁", "",
    "| # | 门禁 | 结果 |", "| --- | --- | --- |");
  gs.forEach((g) => {
    push("| " + g.id + " | " + g.label + " | " + (g.pass ? "通过" : (g.na ? "不适用" : "未通过")) + " |");
  });
  push("", "---", "本文件由变更卡工作台生成。工作台不产生证据；判定与签署须由人完成。");
  return L.join("\n");
}

/* ---------- git 操作 ---------- */
async function repoStatus() {
  const porcelain = (await git(["status", "--porcelain"])).stdout;
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const short = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();
  const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const last = (await git(["log", "-1", "--pretty=format:%h%x09%cI%x09%s"])).stdout.trim();
  return {
    branch, head, short, last,
    clean: porcelain.trim() === "",
    porcelain: porcelain.split(/\r?\n/).filter(Boolean)
  };
}
async function baseline() {
  const st = await repoStatus();
  return {
    clean: st.clean, porcelain: st.porcelain,
    baseCommit: st.head, branch: st.branch, time: nowISO()
  };
}
async function commitCard(id) {
  const c = await readCard(id);
  const v = validate(c);
  if (v.blocking.length) {
    throw httpError(400, "卡未通过门禁，拒绝提交：" + v.blocking.join("；"), { gates: v.gates, blocking: v.blocking });
  }
  const md = renderMarkdown(c);
  const date = String(c.createdAt || nowISO()).slice(0, 10);
  const slug = safeSlug(c.fileSlug || c.id);
  const filename = date + "-" + slug + ".md";
  const abs = path.resolve(RUNS, filename);
  if (!abs.startsWith(RUNS + path.sep)) throw httpError(400, "非法文件名");
  await ensureDirs();
  await fsp.writeFile(abs, md, "utf8");
  const rel = path.relative(REPO, abs).replace(/\\/g, "/");
  await git(["add", "--", rel]);
  const msg = "记录 " + slug + "：" + String(c.title || "").replace(/\s+/g, " ").slice(0, 80);
  await git(["commit", "-m", msg, "--", rel]);
  const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const short = (await git(["rev-parse", "--short", "HEAD"])).stdout.trim();
  c.external = { exportedPath: rel, cardCommit: head, committedAt: nowISO() };
  await writeCard(c);
  return { commit: head, short, file: rel, markdown: md };
}
async function repoLog(n) {
  const count = Math.max(1, Math.min(50, Number(n) || 10));
  const out = (await git(["log", "-" + count, "--pretty=format:%H%x09%h%x09%cI%x09%s"])).stdout;
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const p = line.split("\t");
    return { sha: p[0], short: p[1], date: p[2], subject: p[3] || "" };
  });
}
async function repoDiff(base, change) {
  const okRef = (x) => typeof x === "string" && /^[A-Za-z0-9._~^\/-]{1,80}$/.test(x);
  if (!okRef(base) || !okRef(change)) throw httpError(400, "非法 commit 范围");
  const range = base + ".." + change;
  const files = (await git(["diff", "--name-only", range])).stdout.split(/\r?\n/).filter(Boolean);
  const stat = (await git(["diff", "--stat", range])).stdout;
  const patch = (await git(["diff", range])).stdout.slice(0, 200000);
  return { range, files, stat, patch };
}

/* ---------- 静态文件 ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml"
};
async function serveFile(res, fp) {
  try {
    const buf = await fsp.readFile(fp);
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
    res.end(buf);
  } catch (e) {
    send(res, 404, { error: "文件不存在" });
  }
}
async function serveStatic(req, res, p) {
  if (p === "/" || p === "/workbench.html") {
    return serveFile(res, path.join(ROOT, "workbench.html"));
  }
  if (p.startsWith("/_shared/")) {
    const fp = path.resolve(ROOT, "." + p);
    if (!fp.startsWith(ROOT + path.sep)) return send(res, 403, { error: "禁止访问" });
    return serveFile(res, fp);
  }
  return send(res, 404, { error: "未找到 " + p });
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname;
  const parts = p.split("/").filter(Boolean); // ["api", ...]
  const method = req.method;

  if (p === "/api/health" && method === "GET") {
    return send(res, 200, {
      ok: true,
      repo: path.basename(REPO),
      repoPath: REPO,
      runs: path.relative(REPO, RUNS).replace(/\\/g, "/"),
      cardsDir: path.relative(ROOT, CARDS).replace(/\\/g, "/"),
      time: nowISO()
    });
  }

  if (p === "/api/cards" && method === "GET") {
    return send(res, 200, { cards: await listCards() });
  }
  if (p === "/api/cards" && method === "POST") {
    const id = await nextId();
    const c = blankCard(id);
    await writeCard(c);
    return send(res, 201, { card: c });
  }
  if (p === "/api/cards/export" && method === "GET") {
    const all = [];
    for (const s of await listCards()) all.push(await readCard(s.id));
    return send(res, 200, { version: 1, exportedAt: nowISO(), cards: all });
  }
  if (p === "/api/cards/import" && method === "POST") {
    const body = JSON.parse(await readBody(req) || "{}");
    const arr = Array.isArray(body.cards) ? body.cards : [];
    let n = 0;
    for (const c of arr) {
      if (c && safeId(c.id)) { await writeCard(c); n++; }
    }
    return send(res, 200, { imported: n });
  }

  if (parts[1] === "cards" && parts[2]) {
    const id = decodeURIComponent(parts[2]);
    if (parts[3] === "markdown" && method === "GET") {
      const c = await readCard(id);
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(renderMarkdown(c));
    }
    if (parts[3] === "baseline" && method === "POST") {
      return send(res, 200, await baseline());
    }
    if (parts[3] === "commit" && method === "POST") {
      try {
        return send(res, 200, await commitCard(id));
      } catch (e) {
        if (e.gitStderr) {
          return send(res, 409, { error: "git 提交失败：" + e.gitStderr, git: e.gitStderr });
        }
        throw e;
      }
    }
    if (!parts[3]) {
      if (method === "GET") return send(res, 200, { card: await readCard(id) });
      if (method === "PUT") {
        const c = JSON.parse(await readBody(req));
        if (c.id !== id) throw httpError(400, "卡 ID 不一致");
        const v = validate(c);
        if (v.blocking.length) {
          return send(res, 400, { error: v.blocking.join("；"), gates: v.gates, blocking: v.blocking });
        }
        await writeCard(c);
        return send(res, 200, { card: c, gates: v.gates });
      }
      if (method === "DELETE") {
        await fsp.unlink(cardPath(id));
        return send(res, 200, { ok: true });
      }
    }
  }

  if (p === "/api/repo/status" && method === "GET") {
    return send(res, 200, await repoStatus());
  }
  if (p === "/api/repo/log" && method === "GET") {
    return send(res, 200, { commits: await repoLog(url.searchParams.get("n")) });
  }
  if (p === "/api/repo/diff" && method === "GET") {
    return send(res, 200, await repoDiff(url.searchParams.get("base"), url.searchParams.get("change")));
  }

  return send(res, 404, { error: "未知接口 " + method + " " + p });
}

/* ---------- 启动 ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (e) {
    const status = e.status || 500;
    send(res, status, { error: e.message || "服务器错误", ...(e.extra || {}) });
  }
});

ensureDirs().then(() => {
  server.listen(PORT, HOST, () => {
    console.log("变更卡工作台: http://" + HOST + ":" + PORT);
    console.log("仓库: " + REPO);
    console.log("卡目录: " + CARDS);
    console.log("提交目标: " + RUNS);
  });
}).catch((e) => {
  console.error("启动失败：", e.message);
  process.exit(1);
});
