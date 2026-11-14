#!/usr/bin/env node
"use strict";

/*
 * 变更卡工作台 MCP server（零依赖，stdio 传输）
 *
 * 薄壳：MCP 协议（JSON-RPC 2.0，换行分隔 JSON）<-> 本地 REST（server.js）。
 * 业务逻辑零复制：门禁、存储、提交全部仍由 server.js 执行。
 *
 * 启动时后端未运行会自动后台拉起（node server.js）。
 * 环境变量：WB_HOST（默认 127.0.0.1）、WB_PORT（默认 8787）。
 *
 * 工具集不含「判定」「签署」：那是人类在前端判定模式里的动作。
 * Agent 可代录，但须有 owner 明确指令（见 update_card 描述）。
 *
 * MCP 客户端配置示例：
 *   { "mcpServers": { "change-card-workbench": {
 *       "command": "node", "args": ["<本文件绝对路径>"] } } }
 */

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const HOST = process.env.WB_HOST || "127.0.0.1";
const PORT = Number(process.env.WB_PORT || 8787);
const SERVER = path.join(__dirname, "server.js");

/* ---------- REST 转发 ---------- */
function rest(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({
      host: HOST, port: PORT, path: p, method: method,
      headers: data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}
    }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* markdown 等纯文本 */ }
        if (res.statusCode >= 400) {
          reject(new Error((json && json.error) || ("HTTP " + res.statusCode)));
        } else {
          resolve(json == null ? text : json);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(new Error("REST 请求超时")); });
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- 后端自动拉起 ---------- */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
let ensurePromise = null;
function ensureServer() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    try { await rest("GET", "/api/health"); return; } catch (e) { /* 未运行，拉起 */ }
    const child = spawn(process.execPath, [SERVER], {
      detached: true, stdio: "ignore",
      env: Object.assign({}, process.env, { WB_HOST: HOST, WB_PORT: String(PORT) })
    });
    child.unref();
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try { await rest("GET", "/api/health"); return; } catch (e) { /* 等待就绪 */ }
    }
    throw new Error("workbench 后端拉起失败：请手动运行 node " + SERVER);
  })().catch((e) => { ensurePromise = null; throw e; });
  return ensurePromise;
}

/* ---------- 工具定义 ---------- */
const TOOLS = [
  {
    name: "list_cards",
    description: "列出所有变更卡（id、标题、状态、类别、更新时间），按更新时间倒序。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "get_card",
    description: "读取单张变更卡的完整 JSON。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "卡 ID，如 CHG-20261114-01" } },
      required: ["id"], additionalProperties: false
    }
  },
  {
    name: "create_card",
    description: "新建一张空白变更卡，返回卡 ID 与完整结构。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "update_card",
    description: "整体更新变更卡（先 get_card 读取、修改后传回完整卡）。服务端强制门禁，返回门禁结果与阻塞原因。注意：判定（judgment）与签署（residual）属于人类动作，Agent 代录须有 owner 明确指令。",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "卡 ID" },
        card: { type: "object", description: "完整卡 JSON（id 须一致）" }
      },
      required: ["id", "card"], additionalProperties: false
    }
  },
  {
    name: "commit_card",
    description: "将卡导出为 runs/<date>-<slug>.md 并 git commit（只提交该文件）。这是真实提交，执行前确认卡内容已完成。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "卡 ID" } },
      required: ["id"], additionalProperties: false
    }
  },
  {
    name: "export_markdown",
    description: "导出卡的 markdown 文本（含门禁与控制命题计数摘要），不写文件。",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "卡 ID" } },
      required: ["id"], additionalProperties: false
    }
  },
  {
    name: "repo_status",
    description: "证据仓库 git 状态（分支、HEAD、最近提交、工作区是否干净）。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "repo_diff",
    description: "查看 base..change 的 diff 统计与文件清单，用于控制命题的事实核对。",
    inputSchema: {
      type: "object",
      properties: {
        base: { type: "string", description: "变更前 commit" },
        change: { type: "string", description: "变更后 commit" }
      },
      required: ["base", "change"], additionalProperties: false
    }
  }
];

async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case "list_cards": return rest("GET", "/api/cards");
    case "get_card": return rest("GET", "/api/cards/" + encodeURIComponent(args.id));
    case "create_card": return rest("POST", "/api/cards");
    case "update_card": return rest("PUT", "/api/cards/" + encodeURIComponent(args.id), args.card);
    case "commit_card": return rest("POST", "/api/cards/" + encodeURIComponent(args.id) + "/commit");
    case "export_markdown": return rest("GET", "/api/cards/" + encodeURIComponent(args.id) + "/markdown");
    case "repo_status": return rest("GET", "/api/repo/status");
    case "repo_diff": return rest("GET", "/api/repo/diff?base=" + encodeURIComponent(args.base) + "&change=" + encodeURIComponent(args.change));
    default: throw new Error("未知工具：" + name);
  }
}

/* ---------- MCP stdio ---------- */
function sendMsg(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function reply(id, result) { sendMsg({ jsonrpc: "2.0", id: id, result: result }); }
function errorReply(id, code, message) { sendMsg({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }); }

async function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { return; }
  const id = msg.id;
  const method = msg.method;
  const params = msg.params || {};
  const isNotification = id === undefined || id === null;
  try {
    if (method === "initialize") {
      reply(id, {
        protocolVersion: params.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "change-card-workbench", version: "1.0.0" }
      });
    } else if (method === "notifications/initialized" || method === "initialized") {
      /* 通知，无需响应 */
    } else if (method === "tools/list") {
      reply(id, { tools: TOOLS });
    } else if (method === "tools/call") {
      await ensureServer();
      const out = await callTool(params.name, params.arguments);
      reply(id, { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }] });
    } else if (method === "ping") {
      reply(id, {});
    } else if (!isNotification) {
      errorReply(id, -32601, "Method not found: " + method);
    }
  } catch (e) {
    if (isNotification) return;
    if (method === "tools/call") {
      reply(id, { content: [{ type: "text", text: "错误：" + e.message }], isError: true });
    } else {
      errorReply(id, -32603, e.message);
    }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handleLine(line);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stderr.write("change-card-workbench MCP ready (REST " + HOST + ":" + PORT + ")\n");
