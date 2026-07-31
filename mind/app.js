(() => {
  "use strict";

  const STORAGE_KEY = "mindflow-line-workspace-v2";
  const STAGE = { width: 3600, height: 2600 };
  const PALETTE = ["#d93472", "#b45cff", "#7a63ff", "#ff6f61", "#ef476f", "#4a7dff", "#ff9f43", "#607d8b"];
  const ICONS = ["", "🎯", "💡", "✅", "⭐", "📌", "🚀", "📊", "🧩", "📝", "⚡", "🔎"];
  const THEMES = {
    forest: {
      label: "示意图",
      root: "#b45cff",
      branches: ["#d93472", "#b45cff", "#7a63ff", "#ff6f61", "#ef476f", "#4a7dff"],
      rootText: "#111111"
    },
    studio: {
      label: "洋红",
      root: "#d93472",
      branches: ["#d93472", "#ff5f8f", "#ff7b54", "#b45cff", "#7a63ff", "#ff9f43"],
      rootText: "#111111"
    },
    daylight: {
      label: "蓝紫",
      root: "#7a63ff",
      branches: ["#7a63ff", "#4a7dff", "#b45cff", "#d93472", "#ff6f61", "#ef476f"],
      rootText: "#111111"
    },
    paper: {
      label: "极简",
      root: "#6d6bff",
      branches: ["#cf2f73", "#b45cff", "#6d6bff", "#ff6f61", "#f43f5e", "#f59e0b"],
      rootText: "#111111"
    }
  };

  const els = {};
  let saveTimer = null;
  let suppressClickUntil = 0;
  let pointerSession = null;
  let pendingSummaryTargets = [];

  const state = {
    title: "中断",
    nodes: [],
    relationships: [],
    summaries: [],
    selectedId: null,
    inspectorTab: "style",
    themeName: "forest",
    uiTheme: "light",
    viewport: { x: 0, y: 0, scale: 1 },
    history: [],
    future: [],
    leftCollapsed: false,
    rightCollapsed: true,
    gridVisible: false,
    minimapVisible: false,
    connectionSource: null,
    presentation: false
  };

  function uid(prefix = "node") {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID().slice(0, 8)}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function icon(name, className = "") {
    return `<svg${className ? ` class="${className}"` : ""} aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeXml(value = "") {
    return escapeHtml(value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function node(id, parentId, text, x, y, options = {}) {
    return {
      id,
      parentId,
      text,
      x,
      y,
      width: options.width || (parentId ? 228 : 168),
      height: options.height || (parentId ? 64 : 74),
      color: options.color || PALETTE[0],
      background: options.background || "",
      textColor: options.textColor || "",
      side: options.side || "right",
      shape: options.shape || "line",
      icon: options.icon || "",
      note: options.note || "",
      tags: options.tags || [],
      priority: options.priority || "",
      link: options.link || "",
      attachment: options.attachment || "",
      image: options.image || "",
      bold: Boolean(options.bold),
      italic: Boolean(options.italic),
      fontSize: options.fontSize || (parentId ? 16 : 22),
      collapsed: Boolean(options.collapsed),
      autoColor: options.autoColor !== false,
      summaryLabel: options.summaryLabel || "",
      summaryTargets: options.summaryTargets || []
    };
  }

  function makeDefaultMap() {
    return [
      node("root", null, "中断", 88, 300, { width: 170, height: 82, color: "#b45cff", textColor: "#111111", bold: true, fontSize: 28 }),
      node("inner", "root", "内部异常", 320, 210, { width: 230, height: 72, color: "#d93472", bold: false, fontSize: 18, summaryLabel: "软件中断", summaryTargets: ["fault", "trap"] }),
      node("fault", "inner", "故障（故障）", 548, 120, { width: 240, height: 66, color: "#d93472", fontSize: 18 }),
      node("trap", "inner", "自陷（Trap）", 548, 210, { width: 230, height: 66, color: "#d93472", fontSize: 18 }),
      node("abort", "inner", "终止（中止）", 548, 300, { width: 236, height: 66, color: "#d93472", fontSize: 18 }),
      node("outer", "root", "外部中断（硬件）", 320, 430, { width: 270, height: 76, color: "#b45cff", fontSize: 18, summaryLabel: "硬件中断", summaryTargets: ["intr", "nmi"] }),
      node("intr", "outer", "可屏蔽中断（INTR）", 610, 386, { width: 286, height: 66, color: "#b45cff", fontSize: 18 }),
      node("nmi", "outer", "不可屏蔽中断（NMI）", 610, 474, { width: 296, height: 66, color: "#b45cff", fontSize: 18 })
    ];
  }

  function makeBlankMap() {
    return [node("root", null, "中心主题", 88, 300, {
      width: 180,
      height: 82,
      color: THEMES[state.themeName].root,
      bold: true,
      fontSize: 28,
      textColor: "#111111"
    })];
  }

  function makeDefaultSummaries() {
    return [
      { id: "summary-software", label: "软件中断", targetIds: ["fault", "trap"] },
      { id: "summary-hardware", label: "硬件中断", targetIds: ["intr", "nmi"] }
    ];
  }

  function normalizeSummaries(rawSummaries, nodes = state.nodes) {
    if (!Array.isArray(rawSummaries)) return [];
    const ids = new Set(nodes.map((item) => item.id));
    return rawSummaries.map((summary) => ({
      id: String(summary?.id || uid("summary")),
      label: String(summary?.label || "概要"),
      targetIds: Array.isArray(summary?.targetIds) ? summary.targetIds.map(String).filter((id) => ids.has(id)) : []
    })).filter((summary) => summary.targetIds.length >= 2);
  }

  function cacheElements() {
    [
      "app-shell", "document-title", "save-state-text", "left-panel", "left-panel-content",
      "canvas-area", "canvas-viewport", "canvas-stage", "connections-layer", "nodes-layer",
      "relationship-layer", "node-action-bar", "breadcrumb-text", "zoom-value", "minimap", "minimap-canvas",
      "right-panel", "inspector-content", "node-count", "selected-label", "status-message",
      "menu-layer", "modal-layer", "toast-region", "file-input"
    ].forEach((id) => {
      els[id.replaceAll("-", "_")] = document.getElementById(id);
    });
    els.workspace = document.querySelector(".workspace");
    els.saveState = document.querySelector(".save-state");
  }

  function normalizeLoadedNode(raw) {
    const isRoot = !raw.parentId;
    return node(
      String(raw.id || uid()),
      raw.parentId ? String(raw.parentId) : null,
      String(raw.text || (isRoot ? "中心主题" : "新主题")),
      Number.isFinite(Number(raw.x)) ? Number(raw.x) : 1000,
      Number.isFinite(Number(raw.y)) ? Number(raw.y) : 500,
      {
        ...raw,
        width: Number(raw.width) || (isRoot ? 194 : 154),
        height: Number(raw.height) || (isRoot ? 64 : 46)
      }
    );
  }

  function loadWorkspace() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.nodes) || !parsed.nodes.length) return false;
      const normalized = parsed.nodes.map(normalizeLoadedNode);
      const ids = new Set(normalized.map((item) => item.id));
      if (!normalized.some((item) => item.parentId === null)) return false;
      state.nodes = normalized.filter((item) => item.parentId === null || ids.has(item.parentId));
      state.relationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];
      state.summaries = normalizeSummaries(parsed.summaries, state.nodes);
      state.title = String(parsed.title || state.nodes.find((item) => !item.parentId)?.text || "未命名导图");
      state.themeName = THEMES[parsed.themeName] ? parsed.themeName : "forest";
      state.uiTheme = parsed.uiTheme === "dark" ? "dark" : "light";
      state.selectedId = ids.has(parsed.selectedId) ? parsed.selectedId : state.nodes.find((item) => !item.parentId)?.id;
      state.nodes.forEach((item) => {
        item.side = "right";
        item.shape = "line";
      });
      return true;
    } catch (error) {
      console.warn("Unable to restore workspace", error);
      return false;
    }
  }

  function initState() {
    const restored = loadWorkspace();
    if (!restored) {
      state.nodes = makeDefaultMap();
      state.summaries = makeDefaultSummaries();
      state.selectedId = "root";
    }
    state.nodes.forEach((item) => {
      if (!item.parentId) item.color = THEMES[state.themeName].root;
    });
    if (!state.summaries.length && state.nodes.some((item) => item.id === "inner")) {
      state.summaries = makeDefaultSummaries();
    }
    if (!restored) layoutTree();
  }

  function snapshot() {
    return JSON.stringify({
      title: state.title,
      nodes: state.nodes,
      relationships: state.relationships,
      selectedId: state.selectedId,
      themeName: state.themeName,
      uiTheme: state.uiTheme,
      viewport: state.viewport,
      summaries: state.summaries,
      layoutMode: "line-tree"
    });
  }

  function restoreSnapshot(serialized) {
    const data = JSON.parse(serialized);
    state.title = data.title;
    state.nodes = data.nodes.map(normalizeLoadedNode);
    state.relationships = data.relationships || [];
    state.summaries = normalizeSummaries(data.summaries, state.nodes);
    state.selectedId = data.selectedId;
    state.themeName = THEMES[data.themeName] ? data.themeName : "forest";
    state.uiTheme = data.uiTheme === "dark" ? "dark" : "light";
    if (data.viewport) {
      state.viewport = {
        x: Number(data.viewport.x) || 0,
        y: Number(data.viewport.y) || 0,
        scale: clamp(Number(data.viewport.scale) || 1, 0.18, 2.2)
      };
    }
    applyUiTheme();
    renderAll();
    scheduleSave();
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 60) state.history.shift();
    state.future = [];
  }

  function mutate(mutator, options = {}) {
    pushHistory();
    mutator();
    if (!options.keepSelection && !getNode(state.selectedId)) {
      state.selectedId = getRoot()?.id || null;
    }
    renderAll();
    scheduleSave();
  }

  function undo() {
    if (!state.history.length) {
      toast("没有可撤销的操作", "undo");
      return;
    }
    state.future.push(snapshot());
    restoreSnapshot(state.history.pop());
    toast("已撤销", "undo");
  }

  function redo() {
    if (!state.future.length) {
      toast("没有可重做的操作", "redo");
      return;
    }
    state.history.push(snapshot());
    restoreSnapshot(state.future.pop());
    toast("已重做", "redo");
  }

  function scheduleSave() {
    els.saveState?.classList.add("saving");
    if (els.save_state_text) els.save_state_text.textContent = "正在保存…";
    if (els.status_message) els.status_message.textContent = "正在保存更改";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 380);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY, snapshot());
      els.saveState?.classList.remove("saving");
      if (els.save_state_text) els.save_state_text.textContent = "已保存到本地";
      if (els.status_message) els.status_message.textContent = "所有更改已保存";
    } catch (error) {
      console.warn("Unable to save workspace", error);
      if (els.save_state_text) els.save_state_text.textContent = "保存失败";
      if (els.status_message) els.status_message.textContent = "本地存储空间不足";
    }
  }

  function getNode(id) {
    return state.nodes.find((item) => item.id === id) || null;
  }

  function getRoot() {
    return state.nodes.find((item) => !item.parentId) || null;
  }

  function getChildren(id) {
    return state.nodes.filter((item) => item.parentId === id);
  }

  function getDescendantIds(id) {
    const result = [];
    const walk = (parentId) => {
      getChildren(parentId).forEach((child) => {
        result.push(child.id);
        walk(child.id);
      });
    };
    walk(id);
    return result;
  }

  function getDepth(id) {
    let depth = 0;
    let current = getNode(id);
    const visited = new Set();
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      depth += 1;
      current = getNode(current.parentId);
    }
    return depth;
  }

  function isNodeVisible(item) {
    let current = item;
    const visited = new Set();
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = getNode(current.parentId);
      if (!parent) return false;
      if (parent.collapsed) return false;
      current = parent;
    }
    return true;
  }

  function getVisibleNodes() {
    return state.nodes.filter(isNodeVisible);
  }

  function nodeMetrics(item) {
    const width = Number(item.width) || (item.parentId ? 228 : 168);
    const baseHeight = Number(item.height) || (item.parentId ? 64 : 74);
    const fontSize = Number(item.fontSize) || (item.parentId ? 16 : 22);
    const textWidth = Array.from(String(item.text || "")).reduce((total, character) => {
      if (/\s/.test(character)) return total + fontSize * 0.34;
      if (/[\u0020-\u007e]/.test(character)) return total + fontSize * 0.58;
      return total + fontSize;
    }, 0);
    const measuredWidth = item.parentId ? Math.max(width, Math.round(textWidth + 62)) : Math.max(width, Math.round(textWidth + 78));
    return { width: measuredWidth, height: baseHeight };
  }

  function nodeAnchor(item, metrics = nodeMetrics(item)) {
    return {
      x: item.x + metrics.width - 14,
      y: item.y + metrics.height - 18
    };
  }

  function getBounds(nodes = getVisibleNodes()) {
    if (!nodes.length) return { x: 0, y: 0, width: STAGE.width, height: STAGE.height };
    const boxes = nodes.map((item) => ({ ...nodeMetrics(item), x: item.x, y: item.y }));
    const root = getRoot();
    const minX = Math.min(...boxes.map((box) => box.x), root ? root.x - 90 : Infinity);
    let minY = Math.min(...boxes.map((box) => box.y));
    let maxX = Math.max(...boxes.map((box) => box.x + box.width));
    let maxY = Math.max(...boxes.map((box) => box.y + box.height));
    state.summaries.forEach((summary) => {
      const geometry = summaryGeometry(summary);
      if (!geometry) return;
      maxX = Math.max(maxX, geometry.labelX + 150);
      maxY = Math.max(maxY, geometry.bottom + 24);
      minY = Math.min(minY, geometry.top - 10);
    });
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  function connectionGeometry(parent, child, offset = { x: 0, y: 0 }) {
    const start = nodeAnchor(parent, nodeMetrics(parent));
    const end = nodeAnchor(child, nodeMetrics(child));
    const startX = start.x - offset.x;
    const startY = start.y - offset.y;
    const endX = end.x - offset.x;
    const endY = end.y - offset.y;
    const direction = endX >= startX ? 1 : -1;
    const desiredCurveEnd = child.x + 18 - offset.x;
    const curveEndX = direction > 0
      ? clamp(desiredCurveEnd, startX + 32, endX - 40)
      : clamp(desiredCurveEnd, endX + 40, startX - 32);
    const bend = Math.abs(curveEndX - startX);
    return {
      startX, startY, endX, endY,
      path: `M ${startX} ${startY} C ${startX + direction * bend * 0.36} ${startY}, ${startX + direction * bend * 0.56} ${endY}, ${curveEndX} ${endY} L ${endX} ${endY}`
    };
  }

  function summaryGeometry(summary, offset = { x: 0, y: 0 }) {
    const targets = summary.targetIds.map(getNode).filter((item) => item && isNodeVisible(item));
    if (!targets.length) return null;
    const anchors = targets.map((item) => nodeAnchor(item, nodeMetrics(item)));
    const minY = Math.min(...anchors.map((item) => item.y));
    const maxY = Math.max(...anchors.map((item) => item.y));
    const maxX = Math.max(...anchors.map((item) => item.x));
    const x = maxX + 70 - offset.x;
    const top = minY - 28 - offset.y;
    const bottom = maxY + 12 - offset.y;
    const mid = (top + bottom) / 2;
    const turn = clamp((bottom - top) * 0.15, 14, 22);
    const spineX = x + 16;
    const pointX = x + 32;
    return {
      path: `M ${x} ${top} C ${x + 11} ${top}, ${spineX} ${top + 7}, ${spineX} ${top + turn} L ${spineX} ${mid - turn} C ${spineX} ${mid - 8}, ${pointX - 8} ${mid - 4}, ${pointX} ${mid} C ${pointX - 8} ${mid + 4}, ${spineX} ${mid + 8}, ${spineX} ${mid + turn} L ${spineX} ${bottom - turn} C ${spineX} ${bottom - 7}, ${x + 11} ${bottom}, ${x} ${bottom}`,
      x,
      top,
      bottom,
      labelX: pointX + 12,
      labelY: mid + 7
    };
  }

  function layoutTree() {
    const root = getRoot();
    if (!root) return;
    const leafGap = 88;
    const topLevelGap = 48;
    const rootAnchorX = 300;
    let cursorY = 150;
    const anchorYs = new Map();

    const place = (item, depth) => {
      const children = getChildren(item.id);
      if (!children.length) {
        anchorYs.set(item.id, cursorY);
        cursorY += leafGap;
        return anchorYs.get(item.id);
      }
      const childYs = [];
      children.forEach((child, index) => {
        if (depth === 0 && index > 0) cursorY += topLevelGap;
        childYs.push(place(child, depth + 1));
      });
      const y = childYs.reduce((sum, value) => sum + value, 0) / childYs.length;
      anchorYs.set(item.id, y);
      return y;
    };

    place(root, 0);
    const depthWidths = new Map();
    let maxDepth = 0;
    state.nodes.forEach((item) => {
      const depth = getDepth(item.id);
      maxDepth = Math.max(maxDepth, depth);
      depthWidths.set(depth, Math.max(depthWidths.get(depth) || 0, nodeMetrics(item).width));
    });
    const anchorXs = [rootAnchorX];
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      anchorXs[depth] = anchorXs[depth - 1] + Math.max(250, (depthWidths.get(depth) || 228) + 36);
    }
    state.nodes.forEach((item) => {
      const depth = getDepth(item.id);
      const metrics = nodeMetrics(item);
      const anchorX = anchorXs[depth] || rootAnchorX;
      const anchorY = anchorYs.get(item.id) ?? 360;
      item.x = clamp(anchorX - metrics.width + 14, 24, STAGE.width - metrics.width - 24);
      item.y = clamp(anchorY - metrics.height + 18, 24, STAGE.height - metrics.height - 24);
      item.side = "right";
      item.shape = "line";
    });
  }

  function renderConnections() {
    const visibleIds = new Set(getVisibleNodes().map((item) => item.id));
    const paths = [];
    const root = getRoot();
    if (root && visibleIds.has(root.id)) {
      const rootMetrics = nodeMetrics(root);
      const rootPoint = nodeAnchor(root, rootMetrics);
      paths.push(`<path class="connection-path lead" d="M ${root.x - 76} ${rootPoint.y} L ${rootPoint.x} ${rootPoint.y}" style="--connection-color:${escapeHtml(root.color)};--connection-width:4px"/>`);
    }
    state.nodes.forEach((child) => {
      if (!child.parentId || !visibleIds.has(child.id) || !visibleIds.has(child.parentId)) return;
      const parent = getNode(child.parentId);
      if (!parent) return;
      const geometry = connectionGeometry(parent, child);
      const depth = getDepth(child.id);
      paths.push(`<path class="connection-path${depth === 1 ? " trunk" : ""}" d="${geometry.path}" style="--connection-color:${escapeHtml(child.color)};--connection-width:${depth === 1 ? 4 : 4}px"/>`);
    });

    const relationshipPaths = state.relationships.map((relation) => {
      const from = getNode(relation.from);
      const to = getNode(relation.to);
      if (!from || !to || !visibleIds.has(from.id) || !visibleIds.has(to.id)) return "";
      const fm = nodeMetrics(from);
      const tm = nodeMetrics(to);
      const x1 = from.x + fm.width / 2;
      const y1 = from.y + fm.height / 2;
      const x2 = to.x + tm.width / 2;
      const y2 = to.y + tm.height / 2;
      const midY = Math.min(y1, y2) - 75;
      const path = `M ${x1} ${y1} Q ${(x1 + x2) / 2} ${midY}, ${x2} ${y2}`;
      const labelX = (x1 + x2) / 2;
      const labelY = midY + 8;
      return `<path class="relationship-path" d="${path}" marker-end="url(#relationship-arrow)"/><text class="relationship-label" x="${labelX}" y="${labelY}" text-anchor="middle">${escapeXml(relation.label || "联系")}</text>`;
    }).join("");

    const summaryMarkup = state.summaries.map((summary) => {
      const geometry = summaryGeometry(summary);
      if (!geometry) return "";
      return `<path class="summary-brace" d="${geometry.path}"/><text class="summary-label" x="${geometry.labelX}" y="${geometry.labelY}">${escapeXml(summary.label)}</text>`;
    }).join("");

    els.connections_layer.innerHTML = `
      <defs>
        <marker id="relationship-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="var(--coral)"/></marker>
      </defs>
      ${paths.join("")}${relationshipPaths}${summaryMarkup}`;
  }

  function renderNodes() {
    const visible = getVisibleNodes();
    els.nodes_layer.innerHTML = visible.map((item) => {
      const depth = getDepth(item.id);
      const metrics = nodeMetrics(item);
      const children = getChildren(item.id);
      const type = !item.parentId ? "root" : depth === 1 ? "branch" : "leaf";
      const selected = item.id === state.selectedId ? "selected" : "";
      const textClasses = `${item.bold ? "bold" : ""} ${item.italic ? "italic" : ""}`;
      const collapse = children.length
        ? `<button class="collapse-control side-right${item.collapsed ? " has-hidden" : ""}" data-collapse-id="${item.id}" title="${item.collapsed ? "展开分支" : "收起分支"}" aria-label="${item.collapsed ? "展开分支" : "收起分支"}">${icon(item.collapsed ? "plus" : "minus")}</button>`
        : "";
      const textColor = item.textColor || "var(--text)";
      const labelClass = item.parentId ? "node-label line-label" : "node-label root-label";
      return `<div class="mind-node ${type} line-node ${selected}" data-node-id="${item.id}" tabindex="0" role="treeitem" aria-selected="${item.id === state.selectedId}" style="left:${item.x}px;top:${item.y}px;--node-width:${metrics.width}px;--node-height:${metrics.height}px;--node-color:${item.color};--node-text:${textColor};font-size:${item.fontSize}px">
        <div class="node-content">
          <span class="${labelClass} ${textClasses}">${escapeHtml(item.text)}</span>
          <button class="node-junction${item.parentId ? "" : " root-junction"}" data-action="add-child" data-parent-id="${item.id}" title="为“${escapeHtml(item.text)}”添加子节点" aria-label="为“${escapeHtml(item.text)}”添加子节点">+</button>
        </div>
        ${collapse}
      </div>`;
    }).join("");
  }

  function renderMap() {
    renderConnections();
    renderNodes();
    applyTransform();
    renderMinimap();
  }

  function renderSidebar() {
    const root = getRoot();
    const rows = root ? outlineRows(root, 0) : "";
    els.left_panel_content.innerHTML = `<div class="sidebar-section">
      <div class="sidebar-heading"><div><span class="eyebrow">结构导航</span><h2>文字大纲</h2></div><button class="icon-button subtle" data-action="collapse-all" title="全部收起" aria-label="全部收起">${icon("collapse")}</button></div>
      <div class="search-field">${icon("search")}<input id="outline-search" type="search" placeholder="搜索主题" autocomplete="off" /></div>
      <div class="outline-tree" id="outline-tree">${rows}</div>
      <div class="sidebar-action-row">
        <button class="sidebar-footer-action" data-action="add-child">${icon("plus")}添加节点</button>
        <button class="sidebar-footer-action danger" data-action="delete-node">${icon("trash")}删除</button>
      </div>
    </div>`;
  }

  function outlineRows(item, depth) {
    const children = getChildren(item.id);
    const row = `<button class="outline-row${item.id === state.selectedId ? " active" : ""}${item.collapsed ? " collapsed" : ""}" data-outline-id="${item.id}" data-search-text="${escapeHtml(item.text.toLowerCase())}" style="--outline-indent:${4 + depth * 13}px;--node-color:${item.color}">
      <span class="outline-toggle${children.length ? "" : " empty"}" data-outline-toggle="${item.id}">${icon("arrow-down")}</span>
      <span class="outline-label">${escapeHtml(item.text)}</span><span class="outline-meta"></span>
    </button>`;
    if (!children.length || item.collapsed) return row;
    return row + children.map((child) => outlineRows(child, depth + 1)).join("");
  }

  function renderInspector() {
    const selected = getNode(state.selectedId);
    if (!selected) {
      els.inspector_content.innerHTML = `<div class="inspector-empty">${icon("cursor")}<p>选择一个节点以查看属性</p></div>`;
      return;
    }

    const tabs = `<div class="inspector-tabs" role="tablist">
      <button class="inspector-tab${state.inspectorTab === "style" ? " active" : ""}" data-inspector-tab="style">样式</button>
      <button class="inspector-tab${state.inspectorTab === "icon" ? " active" : ""}" data-inspector-tab="icon">图标</button>
      <button class="inspector-tab${state.inspectorTab === "note" ? " active" : ""}" data-inspector-tab="note">备注</button>
    </div>`;

    if (state.inspectorTab === "icon") {
      els.inspector_content.innerHTML = tabs + renderIconInspector(selected);
      return;
    }
    if (state.inspectorTab === "note") {
      els.inspector_content.innerHTML = tabs + renderNoteInspector(selected);
      return;
    }
    els.inspector_content.innerHTML = tabs + renderStyleInspector(selected);
  }

  function renderStyleInspector(selected) {
    return `<div class="inspector-section">
      <div class="section-title"><h3>主题文字</h3><span>${Array.from(selected.text).length} 字</span></div>
      <label class="field-label" for="node-text-field">内容</label>
      <input class="text-field" id="node-text-field" data-node-field="text" value="${escapeHtml(selected.text)}" />
      <div class="format-row" style="margin-top:9px">
        <button class="segmented-button${selected.bold ? " active" : ""}" data-action="toggle-bold" title="粗体"><strong>B</strong></button>
        <button class="segmented-button${selected.italic ? " active" : ""}" data-action="toggle-italic" title="斜体"><em>I</em></button>
        <button class="segmented-button" data-action="decrease-font" title="减小字号">A−</button>
        <button class="segmented-button" data-action="increase-font" title="增大字号">A+</button>
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>分支颜色</h3><span>${escapeHtml(selected.color.toUpperCase())}</span></div>
      <div class="color-grid">${PALETTE.map((color) => `<button class="color-swatch${color.toLowerCase() === selected.color.toLowerCase() ? " active" : ""}" data-node-color="${color}" style="--swatch:${color}" title="${color}" aria-label="设置颜色 ${color}"></button>`).join("")}</div>
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>线条与文字</h3><span>${selected.width}px</span></div>
      <label class="field-label" for="node-width-range">线段长度</label>
      <input class="range-field" id="node-width-range" data-node-range="width" type="range" min="120" max="420" step="2" value="${selected.width}" />
      <label class="field-label" for="node-font-range" style="margin-top:10px">字号</label>
      <input class="range-field" id="node-font-range" data-node-range="fontSize" type="range" min="11" max="22" step="1" value="${selected.fontSize}" />
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>整图主题</h3><span>${escapeHtml(THEMES[state.themeName].label)}</span></div>
      <div class="theme-grid">${Object.entries(THEMES).map(([key, theme]) => themeMarkup(key, theme)).join("")}</div>
    </div>`;
  }

  function themeMarkup(key, theme) {
    return `<button class="theme-tile${state.themeName === key ? " active" : ""}" data-map-theme="${key}" title="${escapeHtml(theme.label)}" style="--theme-root:${theme.root};--theme-branch:${theme.branches[0]};--theme-branch-2:${theme.branches[1]};--theme-branch-3:${theme.branches[2]}">
      <span class="theme-map-root"></span><span class="theme-map-branch b1"></span><span class="theme-map-branch b2"></span><span class="theme-map-branch b3"></span>
    </button>`;
  }

  function renderIconInspector(selected) {
    return `<div class="inspector-section">
      <div class="section-title"><h3>节点图标</h3><span>${selected.icon ? "已添加" : "无"}</span></div>
      <div class="icon-grid">${ICONS.map((item) => `<button class="icon-choice${item === selected.icon ? " active" : ""}" data-node-icon="${escapeHtml(item)}" title="${item ? `使用 ${item}` : "清除图标"}">${item || "×"}</button>`).join("")}</div>
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>优先级</h3></div>
      <div class="format-row">
        ${["", "P0", "P1", "P2"].map((value) => `<button class="segmented-button${selected.priority === value ? " active" : ""}" data-node-priority="${value}">${value || "无"}</button>`).join("")}
      </div>
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>标记</h3><button class="status-link" data-action="add-tag">添加</button></div>
      <div class="tag-list">${selected.tags?.length ? selected.tags.map((tag, index) => `<span class="tag-chip">${escapeHtml(tag)}<button data-remove-tag="${index}" aria-label="移除标记">×</button></span>`).join("") : `<span style="color:var(--text-faint);font-size:10px">暂无标记</span>`}</div>
    </div>`;
  }

  function renderNoteInspector(selected) {
    return `<div class="inspector-section">
      <div class="section-title"><h3>节点备注</h3><span>自动保存</span></div>
      <textarea class="note-field" data-node-field="note" placeholder="记录补充信息、结论或待办…">${escapeHtml(selected.note)}</textarea>
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>链接</h3><button class="status-link" data-action="open-node-link">${selected.link ? "编辑" : "添加"}</button></div>
      ${selected.link ? `<a href="${escapeHtml(selected.link)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;color:var(--accent);font-size:11px;overflow-wrap:anywhere">${icon("external")}${escapeHtml(selected.link)}</a>` : `<span style="color:var(--text-faint);font-size:10px">暂无链接</span>`}
    </div>
    <div class="inspector-section">
      <div class="section-title"><h3>附件</h3><button class="status-link" data-action="add-attachment">${selected.attachment ? "替换" : "添加"}</button></div>
      ${selected.attachment ? `<div class="tag-chip">${icon("paperclip")}${escapeHtml(selected.attachment)}</div>` : `<span style="color:var(--text-faint);font-size:10px">暂无附件</span>`}
    </div>`;
  }

  function renderStatus() {
    const selected = getNode(state.selectedId);
    if (els.node_count) els.node_count.textContent = `${state.nodes.length} 个节点`;
    if (els.selected_label) els.selected_label.textContent = selected ? `已选择：${selected.text}` : "未选择节点";
    if (els.breadcrumb_text) els.breadcrumb_text.textContent = state.title;
    if (els.document_title && els.document_title !== document.activeElement) els.document_title.value = state.title;
    if (els.zoom_value) els.zoom_value.textContent = `${Math.round(state.viewport.scale * 100)}%`;
    renderNodeActionBar();
    updateActionAvailability();
  }

  function renderAll() {
    applyUiState();
    renderMap();
    renderSidebar();
    renderInspector();
    renderStatus();
  }

  function updateActionAvailability() {
    document.querySelectorAll('[data-action="undo"]').forEach((button) => { button.disabled = state.history.length === 0; });
    document.querySelectorAll('[data-action="redo"]').forEach((button) => { button.disabled = state.future.length === 0; });
    document.querySelectorAll('[data-action="delete-node"]').forEach((button) => { button.disabled = state.selectedId === getRoot()?.id; });
  }

  function applyUiTheme() {
    document.body.dataset.theme = state.uiTheme;
    const themeButton = document.querySelector('[data-action="toggle-theme"]');
    if (themeButton) {
      const svg = themeButton.querySelector("use");
      if (svg) svg.setAttribute("href", state.uiTheme === "dark" ? "#i-moon" : "#i-sun");
    }
  }

  function applyUiState() {
    applyUiTheme();
    els.workspace.classList.toggle("left-collapsed", state.leftCollapsed);
    els.workspace.classList.toggle("right-collapsed", state.rightCollapsed);
    els.canvas_viewport.classList.toggle("grid-hidden", !state.gridVisible);
    els.minimap.hidden = !state.minimapVisible;
  }

  function applyTransform() {
    const { x, y, scale } = state.viewport;
    els.canvas_stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    const gridSize = Math.max(8, 22 * scale);
    els.canvas_viewport.style.backgroundPosition = `${x % gridSize}px ${y % gridSize}px`;
    els.canvas_viewport.style.backgroundSize = `${gridSize}px ${gridSize}px`;
    if (els.zoom_value) els.zoom_value.textContent = `${Math.round(scale * 100)}%`;
    renderNodeActionBar();
  }

  function fitView(animate = true) {
    const viewportRect = els.canvas_viewport.getBoundingClientRect();
    if (!viewportRect.width || !viewportRect.height) return;
    const bounds = getBounds();
    const paddingX = viewportRect.width < 600 ? 66 : 120;
    const paddingY = viewportRect.height < 500 ? 66 : 110;
    const scale = clamp(Math.min(
      (viewportRect.width - paddingX) / bounds.width,
      (viewportRect.height - paddingY) / bounds.height
    ), viewportRect.width < 600 ? 0.18 : 0.3, 1.08);
    state.viewport.scale = scale;
    state.viewport.x = (viewportRect.width - bounds.width * scale) / 2 - bounds.x * scale;
    state.viewport.y = (viewportRect.height - bounds.height * scale) / 2 - bounds.y * scale;
    if (animate) {
      els.canvas_stage.style.transition = "transform 220ms ease";
      setTimeout(() => { els.canvas_stage.style.transition = ""; }, 240);
    }
    applyTransform();
    renderMinimap();
  }

  function centerNode(id = state.selectedId) {
    const selected = getNode(id);
    if (!selected) return;
    const rect = els.canvas_viewport.getBoundingClientRect();
    const metrics = nodeMetrics(selected);
    state.viewport.x = rect.width / 2 - (selected.x + metrics.width / 2) * state.viewport.scale;
    state.viewport.y = rect.height / 2 - (selected.y + metrics.height / 2) * state.viewport.scale;
    els.canvas_stage.style.transition = "transform 200ms ease";
    applyTransform();
    setTimeout(() => { els.canvas_stage.style.transition = ""; }, 220);
  }

  function frameMobileView() {
    const root = getRoot();
    const rect = els.canvas_viewport.getBoundingClientRect();
    if (!root || !rect.width || !rect.height) return;
    const scale = 0.52;
    const anchor = nodeAnchor(root, nodeMetrics(root));
    state.viewport.scale = scale;
    state.viewport.x = rect.width * 0.36 - anchor.x * scale;
    state.viewport.y = rect.height * 0.5 - anchor.y * scale;
    applyTransform();
    renderMinimap();
  }

  function zoomAt(nextScale, clientX, clientY) {
    const rect = els.canvas_viewport.getBoundingClientRect();
    const oldScale = state.viewport.scale;
    const scale = clamp(nextScale, 0.28, 2.2);
    const pointX = clientX == null ? rect.width / 2 : clientX - rect.left;
    const pointY = clientY == null ? rect.height / 2 : clientY - rect.top;
    const stageX = (pointX - state.viewport.x) / oldScale;
    const stageY = (pointY - state.viewport.y) / oldScale;
    state.viewport.scale = scale;
    state.viewport.x = pointX - stageX * scale;
    state.viewport.y = pointY - stageY * scale;
    applyTransform();
  }

  function renderMinimap() {
    if (!state.minimapVisible || !els.minimap_canvas) return;
    const visible = getVisibleNodes();
    const bounds = getBounds(visible);
    const width = 190;
    const height = 98;
    const scale = Math.min((width - 18) / bounds.width, (height - 16) / bounds.height);
    const offsetX = (width - bounds.width * scale) / 2 - bounds.x * scale;
    const offsetY = (height - bounds.height * scale) / 2 - bounds.y * scale;
    els.minimap_canvas.innerHTML = visible.map((item) => {
      const metrics = nodeMetrics(item);
      return `<span class="mini-node-dot" style="left:${item.x * scale + offsetX}px;top:${item.y * scale + offsetY}px;width:${Math.max(4, metrics.width * scale)}px;height:${Math.max(3, metrics.height * scale)}px;--node-color:${item.color}"></span>`;
    }).join("");
  }

  function renderNodeActionBar() {
    const bar = els.node_action_bar;
    const selected = getNode(state.selectedId);
    if (!bar || !selected || state.presentation) {
      if (bar) bar.hidden = true;
      return;
    }

    const metrics = nodeMetrics(selected);
    const areaRect = els.canvas_area.getBoundingClientRect();
    const screenX = state.viewport.x + (selected.x + metrics.width / 2) * state.viewport.scale;
    const screenTop = state.viewport.y + selected.y * state.viewport.scale;
    const screenBottom = screenTop + metrics.height * state.viewport.scale;
    const placeBelow = screenTop < 72;
    const halfWidth = window.innerWidth <= 560 ? 132 : 154;
    bar.hidden = false;
    bar.classList.toggle("below", placeBelow);
    bar.style.left = `${clamp(screenX, halfWidth + 8, areaRect.width - halfWidth - 8)}px`;
    bar.style.top = `${placeBelow ? screenBottom : screenTop}px`;
    if (bar.dataset.nodeId !== selected.id) {
      bar.dataset.nodeId = selected.id;
      bar.innerHTML = `
        <button class="node-action-button add" data-action="add-child" title="添加子节点（Tab）">${icon("plus-circle")}<span>添加子节点</span></button>
        <button class="node-action-button" data-action="add-sibling" title="添加同级节点（Enter）">${icon("branch")}<span>同级</span></button>
        <span class="node-action-divider" aria-hidden="true"></span>
        <button class="node-action-button delete" data-action="delete-node" title="${selected.parentId ? "删除节点（Delete）" : "中心主题不能删除，请使用清空"}" ${selected.parentId ? "" : "disabled"}>${icon("trash")}<span>删除</span></button>`;
    }
  }

  function selectNode(id, options = {}) {
    const selected = getNode(id);
    if (!selected) return;

    if (state.connectionSource && state.connectionSource !== id) {
      const source = state.connectionSource;
      mutate(() => {
        const exists = state.relationships.some((item) => (item.from === source && item.to === id) || (item.from === id && item.to === source));
        if (!exists) state.relationships.push({ id: uid("rel"), from: source, to: id, label: "联系" });
        state.connectionSource = null;
        state.selectedId = id;
      }, { keepSelection: true });
      document.querySelector('[data-action="add-connection"]')?.classList.remove("active");
      toast("已建立节点联系", "connector");
      return;
    }

    state.selectedId = id;
    renderNodes();
    renderSidebar();
    renderInspector();
    renderStatus();
    if (options.center) centerNode(id);
  }

  function addChild(parentId = state.selectedId, text = "新主题", overrides = {}) {
    const parent = getNode(parentId) || getRoot();
    if (!parent) return;
    const siblings = getChildren(parent.id);
    const width = overrides.width || 228;
    const color = overrides.color || (parent.parentId ? parent.color : THEMES[state.themeName].branches[siblings.length % THEMES[state.themeName].branches.length]);
    const newId = uid();
    mutate(() => {
      parent.collapsed = false;
      state.nodes.push(node(newId, parent.id, text, 0, 0, { width, color, side: "right", shape: "line", ...overrides }));
      state.selectedId = newId;
      layoutTree();
    }, { keepSelection: true });
    requestAnimationFrame(() => centerNode(newId));
    setTimeout(() => startNodeEdit(newId), 240);
  }

  function addSibling(id = state.selectedId) {
    const selected = getNode(id);
    if (!selected) return;
    if (!selected.parentId) {
      addChild(selected.id);
      return;
    }
    const parent = getNode(selected.parentId);
    const newId = uid();
    mutate(() => {
      parent.collapsed = false;
      state.nodes.push(node(newId, parent.id, "新主题", 0, 0, {
        width: selected.width,
        height: selected.height,
        color: selected.color,
        side: "right",
        shape: "line"
      }));
      state.selectedId = newId;
      layoutTree();
    }, { keepSelection: true });
    requestAnimationFrame(() => centerNode(newId));
    setTimeout(() => startNodeEdit(newId), 240);
  }

  function deleteSelected() {
    const selected = getNode(state.selectedId);
    const root = getRoot();
    if (!selected || selected.id === root?.id) {
      toast("中心主题不能删除", "lock");
      return;
    }
    const parentId = selected.parentId;
    const ids = new Set([selected.id, ...getDescendantIds(selected.id)]);
    mutate(() => {
      state.nodes = state.nodes.filter((item) => !ids.has(item.id));
      state.relationships = state.relationships.filter((item) => !ids.has(item.from) && !ids.has(item.to));
      state.summaries = state.summaries
        .map((summary) => ({ ...summary, targetIds: summary.targetIds.filter((id) => !ids.has(id)) }))
        .filter((summary) => summary.targetIds.length >= 2);
      if (state.connectionSource && ids.has(state.connectionSource)) state.connectionSource = null;
      state.selectedId = parentId;
      layoutTree();
    }, { keepSelection: true });
    toast(`已删除 ${ids.size} 个节点，可撤销恢复`, "trash");
  }

  function showClearDialog() {
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>清空导图</h2><p>当前共有 ${state.nodes.length} 个节点</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body">
        <div class="clear-warning">${icon("trash")}<div><strong>删除全部分支与联系线</strong><span>清空后会保留一个可编辑的“中心主题”。此操作可以通过撤销恢复。</span></div></div>
      </div>
      <div class="modal-footer"><button class="outline-button" data-close-modal>取消</button><button class="primary-button danger-primary" data-action="confirm-clear">${icon("trash")}清空导图</button></div>
    </div>`);
  }

  function performClear() {
    mutate(() => {
      state.nodes = makeBlankMap();
      state.relationships = [];
      state.summaries = [];
      state.selectedId = "root";
      state.title = "中心主题";
      state.connectionSource = null;
      layoutTree();
    }, { keepSelection: true });
    closeModal();
    requestAnimationFrame(() => fitView(false));
    setTimeout(() => startNodeEdit("root"), 180);
    toast("导图已清空，可撤销恢复", "trash");
  }

  function duplicateSelected() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    if (!selected.parentId) {
      toast("中心主题不能复制为同级", "copy");
      return;
    }
    const subtree = [selected.id, ...getDescendantIds(selected.id)].map(getNode).filter(Boolean);
    const idMap = new Map(subtree.map((item) => [item.id, uid()]));
    mutate(() => {
      subtree.forEach((item) => {
        const clone = normalizeLoadedNode({
          ...item,
          id: idMap.get(item.id),
          parentId: item.id === selected.id ? item.parentId : idMap.get(item.parentId),
          x: item.x,
          y: item.y + 84,
          text: item.id === selected.id ? `${item.text} 副本` : item.text
        });
        state.nodes.push(clone);
      });
      state.selectedId = idMap.get(selected.id);
      layoutTree();
    }, { keepSelection: true });
    centerNode(state.selectedId);
    toast("已复制分支", "copy");
  }

  function toggleCollapse(id) {
    const selected = getNode(id);
    if (!selected || !getChildren(id).length) return;
    mutate(() => { selected.collapsed = !selected.collapsed; }, { keepSelection: true });
  }

  function collapseAll() {
    const root = getRoot();
    const anyExpanded = state.nodes.some((item) => item.id !== root?.id && getChildren(item.id).length && !item.collapsed);
    mutate(() => {
      state.nodes.forEach((item) => {
        if (item.id !== root?.id && getChildren(item.id).length) item.collapsed = anyExpanded;
      });
    }, { keepSelection: true });
    fitView();
  }

  function startNodeEdit(id = state.selectedId) {
    const item = getNode(id);
    const element = els.nodes_layer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!item || !element) return;
    const content = element.querySelector(".node-content");
    if (!content || content.querySelector("input")) return;
    content.innerHTML = `<input class="node-editor" value="${escapeHtml(item.text)}" aria-label="编辑主题文字" />`;
    const input = content.querySelector("input");
    input.focus();
    input.select();
    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const value = input.value.trim() || "未命名主题";
      if (value !== item.text) {
        pushHistory();
        item.text = value;
        if (!item.parentId) {
          state.title = value;
          els.document_title.value = value;
        }
        layoutTree();
        scheduleSave();
      }
      renderAll();
    };
    input.addEventListener("blur", commit, { once: true });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        committed = true;
        renderNodes();
      }
    });
  }

  function setNodeField(field, value, rerender = true) {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    pushHistory();
    selected[field] = value;
    if (field === "text" && !selected.parentId) {
      state.title = value;
      els.document_title.value = value;
    }
    if (field === "text" || field === "width" || field === "fontSize") layoutTree();
    if (rerender) renderAll();
    scheduleSave();
  }

  function applyMapTheme(themeName) {
    if (!THEMES[themeName]) return;
    mutate(() => {
      state.themeName = themeName;
      const theme = THEMES[themeName];
      const root = getRoot();
      if (root) root.color = theme.root;
      const branches = root ? getChildren(root.id) : [];
      branches.forEach((branch, index) => {
        const color = theme.branches[index % theme.branches.length];
        const ids = [branch.id, ...getDescendantIds(branch.id)];
        ids.forEach((id) => {
          const item = getNode(id);
          if (item?.autoColor) item.color = color;
        });
      });
    }, { keepSelection: true });
    toast(`已应用「${THEMES[themeName].label}」主题`, "palette");
  }

  function showExportDialog() {
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>导出导图</h2><p>导出内容仅在当前浏览器中生成</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><div class="export-grid">
        <button class="export-option" data-action="export-png">${icon("image")}<strong>PNG 图片</strong><span>适合分享与插入文档</span></button>
        <button class="export-option" data-action="export-svg">${icon("layout")}<strong>SVG 矢量图</strong><span>无限缩放，方便排版</span></button>
        <button class="export-option" data-action="export-json">${icon("download")}<strong>MindFlow 文件</strong><span>可再次导入继续编辑</span></button>
      </div></div>
    </div>`);
  }

  function showShortcuts() {
    const shortcuts = [
      ["添加节点", ["Tab"]], ["添加同级节点", ["Enter"]],
      ["编辑文字", ["F2"]], ["删除节点", ["Delete"]],
      ["撤销", ["Ctrl", "Z"]], ["重做", ["Ctrl", "Y"]],
      ["复制分支", ["Ctrl", "D"]], ["适应画布", ["Ctrl", "0"]],
      ["保存到本地", ["Ctrl", "S"]]
    ];
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>快捷键</h2><p>画布聚焦时可直接使用</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><div class="shortcut-grid">${shortcuts.map(([label, keys]) => `<div class="shortcut-row"><span>${label}</span><span class="keys">${keys.map((key) => `<span class="key">${key}</span>`).join("")}</span></div>`).join("")}</div></div>
    </div>`);
  }

  function showShareDialog() {
    const shareUrl = location.protocol === "file:" ? "本地文件模式：导出 MindFlow 文件后发送给协作者" : location.href;
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>分享导图</h2><p>当前版本使用纯前端本地存储</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body">
        <label class="field-label" for="share-url">当前页面</label>
        <div class="share-box"><input id="share-url" value="${escapeHtml(shareUrl)}" readonly /><button class="primary-button" data-action="copy-share">${icon("copy")}复制</button></div>
        <div class="share-note">${icon("lock")}<span>导图数据只保存在你的浏览器中。要分享完整内容，请导出 MindFlow 文件或 PNG 图片。</span></div>
      </div>
      <div class="modal-footer"><button class="outline-button" data-action="export-json">${icon("download")}导出文件</button><button class="primary-button" data-action="export-png">${icon("image")}导出图片</button></div>
    </div>`);
  }

  function showHelp() {
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>MindFlow 帮助</h2><p>纯前端思维导图工作台</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body">
        <div class="ai-intro"><strong style="display:block;margin-bottom:6px;color:var(--text)">当前工作区</strong>所有编辑会自动保存在本机浏览器。你可以拖动节点重新排布，在大纲中快速定位，也可以导出 PNG、SVG 或 MindFlow 文件。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
          <button class="outline-button" data-action="shortcuts">${icon("type")}快捷键</button>
          <button class="outline-button" data-action="clear-map">${icon("plus")}新建空白导图</button>
        </div>
      </div>
    </div>`);
  }

  function showAccount() {
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>本地工作区</h2><p>无需登录，数据留在当前设备</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:7px">
          <div class="avatar-button" style="display:grid;place-items:center;flex:0 0 42px;width:42px;height:42px">L</div>
          <div><strong style="display:block;font-size:13px">Local Creator</strong><span style="display:block;margin-top:4px;color:var(--text-faint);font-size:10px">浏览器本地空间 · 自动保存已开启</span></div>
        </div>
      </div>
      <div class="modal-footer"><button class="outline-button" data-action="export-json">${icon("download")}备份工作区</button></div>
    </div>`);
  }

  function showLinkDialog() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>节点链接</h2><p>${escapeHtml(selected.text)}</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><label class="field-label" for="node-link-input">网址</label><input class="text-field" id="node-link-input" type="url" value="${escapeHtml(selected.link)}" placeholder="https://example.com" /></div>
      <div class="modal-footer"><button class="outline-button" data-action="clear-link">清除</button><button class="primary-button" data-action="save-link">${icon("check")}保存链接</button></div>
    </div>`);
    requestAnimationFrame(() => document.getElementById("node-link-input")?.focus());
  }

  function showTagDialog() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>添加标记</h2><p>${escapeHtml(selected.text)}</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><label class="field-label" for="node-tag-input">标记名称</label><input class="text-field" id="node-tag-input" maxlength="12" placeholder="例如：重点、待确认、灵感" /></div>
      <div class="modal-footer"><button class="primary-button" data-action="save-tag">${icon("check")}添加标记</button></div>
    </div>`);
    requestAnimationFrame(() => document.getElementById("node-tag-input")?.focus());
  }

  function showImageDialog() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>添加图片引用</h2><p>${escapeHtml(selected.text)}</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><label class="field-label" for="node-image-input">图片网址</label><input class="text-field" id="node-image-input" type="url" value="${escapeHtml(selected.image)}" placeholder="https://example.com/image.jpg" /></div>
      <div class="modal-footer"><button class="primary-button" data-action="save-image">${icon("check")}添加引用</button></div>
    </div>`);
  }

  function showSummaryDialog() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    const children = getChildren(selected.id);
    const siblings = selected.parentId ? getChildren(selected.parentId) : [];
    const targets = children.length >= 2 ? children : siblings;
    if (targets.length < 2) {
      toast("概要至少需要两个同级节点", "braces");
      return;
    }
    pendingSummaryTargets = targets.map((item) => item.id);
    showModal(`<div class="modal small">
      <div class="modal-header"><div class="modal-title"><h2>添加概要</h2><p>将概括 ${targets.length} 个同级节点</p></div><button class="icon-button subtle" data-close-modal title="关闭" aria-label="关闭">${icon("close")}</button></div>
      <div class="modal-body"><label class="field-label" for="summary-label-input">概要名称</label><input class="text-field" id="summary-label-input" maxlength="24" value="概要" /></div>
      <div class="modal-footer"><button class="outline-button" data-close-modal>取消</button><button class="primary-button" data-action="save-summary">${icon("braces")}添加概要</button></div>
    </div>`);
    requestAnimationFrame(() => {
      const input = document.getElementById("summary-label-input");
      input?.focus();
      input?.select();
    });
  }

  function saveSummary() {
    const targetIds = pendingSummaryTargets.filter((id) => getNode(id));
    if (targetIds.length < 2) {
      closeModal();
      return;
    }
    const label = document.getElementById("summary-label-input")?.value.trim() || "概要";
    mutate(() => {
      state.summaries.push({ id: uid("summary"), label, targetIds });
    }, { keepSelection: true });
    pendingSummaryTargets = [];
    closeModal();
    toast("概要已添加", "braces");
  }

  function showModal(markup) {
    closeMenu();
    els.modal_layer.hidden = false;
    els.modal_layer.innerHTML = markup;
  }

  function closeModal() {
    els.modal_layer.hidden = true;
    els.modal_layer.innerHTML = "";
    pendingSummaryTargets = [];
  }

  const menus = {
    file: [
      ["plus", "新建空白导图", "clear-map", "Ctrl + N"],
      ["upload", "打开文件…", "open-file", "Ctrl + O"],
      "separator",
      ["cloud", "保存到本地", "save-browser", "Ctrl + S"],
      ["download", "导出…", "export-dialog", "Ctrl + Shift + E"],
      ["file", "导出 MindFlow 文件", "export-json", ""],
      "separator",
      ["trash", "清空导图…", "clear-map", "", "danger"],
      "separator",
      ["eye", "打印", "print", "Ctrl + P"]
    ],
    edit: [
      ["undo", "撤销", "undo", "Ctrl + Z"],
      ["redo", "重做", "redo", "Ctrl + Y"],
      "separator",
      ["copy", "复制分支", "duplicate-node", "Ctrl + D"],
      ["trash", "删除节点", "delete-node", "Delete", "danger"],
      ["collapse", "收起 / 展开", "toggle-collapse", ""],
      "separator",
      ["type", "编辑节点文字", "edit-node", "F2"]
    ],
    view: [
      ["maximize", "适应画布", "fit-view", "Ctrl + 0"],
      ["zoom-in", "放大", "zoom-in", "+"],
      ["zoom-out", "缩小", "zoom-out", "−"],
      "separator",
      ["grid", "显示网格", "toggle-grid", ""],
      ["panel", "小地图", "toggle-minimap", ""],
      ["sun", "明暗主题", "toggle-theme", ""],
      "separator",
      ["play", "演示模式", "present", ""]
    ],
    insert: [
      ["plus-circle", "子主题", "add-child", "Tab"],
      ["branch", "同级主题", "add-sibling", "Enter"],
      ["connector", "节点联系", "add-connection", ""],
      ["braces", "概要", "add-summary", ""],
      "separator",
      ["note", "备注", "add-note", ""],
      ["flag", "标记", "add-tag", ""],
      ["link", "链接", "add-link", ""],
      ["image", "图片引用", "add-image", ""]
    ]
  };

  function openMenu(name, button) {
    if (!menus[name]) return;
    const existing = button.classList.contains("open");
    closeMenu();
    if (existing) return;
    button.classList.add("open");
    const rect = button.getBoundingClientRect();
    els.menu_layer.hidden = false;
    els.menu_layer.innerHTML = `<div class="dropdown-menu" style="top:${rect.bottom + 5}px;left:${Math.min(rect.left, window.innerWidth - 236)}px">${menus[name].map((item) => {
      if (item === "separator") return `<div class="dropdown-separator"></div>`;
      const [iconName, label, action, shortcut, extra] = item;
      return `<button class="dropdown-item${extra ? ` ${extra}` : ""}" data-action="${action}">${icon(iconName)}<span>${label}</span><span class="shortcut">${shortcut}</span></button>`;
    }).join("")}</div>`;
  }

  function closeMenu() {
    document.querySelectorAll(".menu-button.open").forEach((button) => button.classList.remove("open"));
    els.menu_layer.hidden = true;
    els.menu_layer.innerHTML = "";
  }

  function toast(message, iconName = "check") {
    const element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
    els.toast_region.appendChild(element);
    setTimeout(() => {
      element.style.opacity = "0";
      element.style.transform = "translateY(-5px)";
      setTimeout(() => element.remove(), 180);
    }, 2200);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename() {
    return (state.title || "mindflow").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
  }

  function exportJson() {
    const payload = JSON.stringify({
      format: "mindflow",
      version: 1,
      exportedAt: new Date().toISOString(),
      title: state.title,
      themeName: state.themeName,
      nodes: state.nodes,
      relationships: state.relationships,
      summaries: state.summaries
    }, null, 2);
    downloadBlob(new Blob([payload], { type: "application/json;charset=utf-8" }), `${safeFilename()}.mindflow`);
    closeModal();
    toast("MindFlow 文件已导出", "download");
  }

  function buildExportSvg() {
    const visible = getVisibleNodes();
    const bounds = getBounds(visible);
    const padding = 76;
    const offset = { x: bounds.x - padding, y: bounds.y - padding };
    const width = Math.ceil(bounds.width + padding * 2);
    const height = Math.ceil(bounds.height + padding * 2);
    const visibleIds = new Set(visible.map((item) => item.id));
    const root = getRoot();
    const rootLead = root && visibleIds.has(root.id)
      ? (() => {
          const anchor = nodeAnchor(root, nodeMetrics(root));
          return `<path d="M ${root.x - 82 - offset.x} ${anchor.y - offset.y} L ${anchor.x - offset.x} ${anchor.y - offset.y}" fill="none" stroke="${escapeXml(root.color)}" stroke-width="4" stroke-linecap="round"/>`;
        })()
      : "";
    const pathMarkup = visible.map((child) => {
      if (!child.parentId || !visibleIds.has(child.parentId)) return "";
      const parent = getNode(child.parentId);
      const geometry = connectionGeometry(parent, child, offset);
      return `<path d="${geometry.path}" fill="none" stroke="${escapeXml(child.color)}" stroke-width="4" stroke-linecap="round"/>`;
    }).join("");
    const relationshipMarkup = state.relationships.map((relation) => {
      const from = getNode(relation.from);
      const to = getNode(relation.to);
      if (!from || !to || !visibleIds.has(from.id) || !visibleIds.has(to.id)) return "";
      const fromAnchor = nodeAnchor(from, nodeMetrics(from));
      const toAnchor = nodeAnchor(to, nodeMetrics(to));
      const x1 = fromAnchor.x - offset.x;
      const y1 = fromAnchor.y - offset.y;
      const x2 = toAnchor.x - offset.x;
      const y2 = toAnchor.y - offset.y;
      const controlY = Math.min(y1, y2) - 72;
      return `<path d="M ${x1} ${y1} Q ${(x1 + x2) / 2} ${controlY}, ${x2} ${y2}" fill="none" stroke="#e46f61" stroke-width="2" stroke-dasharray="7 6"/>`;
    }).join("");
    const summaryMarkup = state.summaries.map((summary) => {
      const geometry = summaryGeometry(summary, offset);
      if (!geometry) return "";
      return `<path d="${geometry.path}" fill="none" stroke="#ef2020" stroke-width="3" stroke-linecap="round"/><text x="${geometry.labelX}" y="${geometry.labelY}" font-family="Arial, Microsoft YaHei, sans-serif" font-size="18" font-weight="500" fill="#ef2020">${escapeXml(summary.label)}</text>`;
    }).join("");
    const nodeMarkup = visible.map((item) => {
      const metrics = nodeMetrics(item);
      const anchor = nodeAnchor(item, metrics);
      const anchorX = anchor.x - offset.x;
      const anchorY = anchor.y - offset.y;
      const isRoot = !item.parentId;
      const textX = item.x - offset.x + (metrics.width - 28) / 2;
      const textY = anchorY - 27;
      return `<g><text x="${textX}" y="${textY}" text-anchor="middle" font-family="Arial, Microsoft YaHei, sans-serif" font-size="${item.fontSize || 16}" font-weight="${item.bold || isRoot ? 700 : 500}" font-style="${item.italic ? "italic" : "normal"}" fill="#111111">${escapeXml(item.text)}</text><circle cx="${anchorX}" cy="${anchorY}" r="12" fill="#4b7df3"/><path d="M ${anchorX - 5} ${anchorY} H ${anchorX + 5} M ${anchorX} ${anchorY - 5} V ${anchorY + 5}" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round"/></g>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ffffff"/>${rootLead}${pathMarkup}${relationshipMarkup}${summaryMarkup}${nodeMarkup}</svg>`;
  }

  function exportSvg() {
    const svg = buildExportSvg();
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename()}.svg`);
    closeModal();
    toast("SVG 已导出", "download");
  }

  function exportPng() {
    const svg = buildExportSvg();
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const maxDimension = 3200;
      const scale = Math.min(2, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((pngBlob) => {
        if (pngBlob) downloadBlob(pngBlob, `${safeFilename()}.png`);
        URL.revokeObjectURL(url);
        closeModal();
        toast("PNG 图片已导出", "image");
      }, "image/png", 0.95);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      toast("图片导出失败，请改用 SVG", "image");
    };
    image.src = url;
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const rawNodes = Array.isArray(parsed) ? parsed : parsed.nodes;
        if (!Array.isArray(rawNodes) || !rawNodes.length) throw new Error("Invalid nodes");
        const normalized = rawNodes.map(normalizeLoadedNode);
        if (!normalized.some((item) => !item.parentId)) throw new Error("Missing root");
        mutate(() => {
          state.nodes = normalized;
          state.relationships = Array.isArray(parsed.relationships) ? parsed.relationships : [];
          state.summaries = normalizeSummaries(parsed.summaries, normalized);
          state.title = String(parsed.title || normalized.find((item) => !item.parentId).text || file.name.replace(/\.[^.]+$/, ""));
          state.themeName = THEMES[parsed.themeName] ? parsed.themeName : state.themeName;
          state.selectedId = normalized.find((item) => !item.parentId).id;
          state.nodes.forEach((item) => {
            item.side = "right";
            item.shape = "line";
          });
          layoutTree();
        }, { keepSelection: true });
        requestAnimationFrame(() => fitView(false));
        toast("导图文件已打开", "upload");
      } catch (error) {
        console.warn("Invalid mind map file", error);
        toast("无法识别这个导图文件", "file");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function enterPresentation() {
    if (state.presentation) return;
    state.presentation = true;
    els.app_shell.classList.add("presentation-mode");
    const exitButton = document.createElement("button");
    exitButton.className = "presentation-exit";
    exitButton.id = "presentation-exit";
    exitButton.innerHTML = `${icon("close")}退出演示`;
    exitButton.addEventListener("click", exitPresentation);
    document.body.appendChild(exitButton);
    requestAnimationFrame(() => fitView(false));
  }

  function exitPresentation() {
    if (!state.presentation) return;
    state.presentation = false;
    els.app_shell.classList.remove("presentation-mode");
    document.getElementById("presentation-exit")?.remove();
    requestAnimationFrame(() => fitView(false));
  }

  function toggleTheme() {
    state.uiTheme = state.uiTheme === "dark" ? "light" : "dark";
    applyUiTheme();
    renderMap();
    scheduleSave();
    toast(state.uiTheme === "dark" ? "已切换深色主题" : "已切换浅色主题", state.uiTheme === "dark" ? "moon" : "sun");
  }

  function addAttachment() {
    const selected = getNode(state.selectedId);
    if (!selected) return;
    const input = document.createElement("input");
    input.type = "file";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      mutate(() => {
        selected.attachment = file.name;
        selected.icon ||= "📎";
      }, { keepSelection: true });
      toast("已记录附件名称", "paperclip");
    }, { once: true });
    input.click();
  }

  function handleAction(action, source) {
    closeMenu();
    switch (action) {
      case "undo": undo(); break;
      case "redo": redo(); break;
      case "add-child": addChild(source?.dataset.parentId || state.selectedId); break;
      case "add-sibling": addSibling(); break;
      case "delete-node": deleteSelected(); break;
      case "clear-map": showClearDialog(); break;
      case "confirm-clear": performClear(); break;
      case "duplicate-node": duplicateSelected(); break;
      case "edit-node": startNodeEdit(); break;
      case "toggle-collapse": toggleCollapse(state.selectedId); break;
      case "collapse-all": collapseAll(); break;
      case "fit-view": fitView(); break;
      case "center-selected": centerNode(); break;
      case "center-root": centerNode(getRoot()?.id); break;
      case "zoom-in": zoomAt(state.viewport.scale * 1.14); break;
      case "zoom-out": zoomAt(state.viewport.scale / 1.14); break;
      case "toggle-grid":
        state.gridVisible = !state.gridVisible;
        applyUiState();
        toast(state.gridVisible ? "网格已显示" : "网格已隐藏", "grid");
        break;
      case "toggle-minimap":
        state.minimapVisible = !state.minimapVisible;
        applyUiState();
        renderMinimap();
        break;
      case "toggle-outline":
        if (window.innerWidth <= 840) {
          els.workspace.classList.toggle("mobile-sidebar-open");
        } else {
          state.leftCollapsed = !state.leftCollapsed;
          applyUiState();
          requestAnimationFrame(() => fitView(false));
        }
        break;
      case "toggle-mobile-sidebar":
        els.workspace.classList.toggle("mobile-sidebar-open");
        break;
      case "toggle-inspector":
        if (window.innerWidth <= 840) {
          els.workspace.classList.toggle("mobile-inspector-open");
        } else {
          state.rightCollapsed = !state.rightCollapsed;
          applyUiState();
          requestAnimationFrame(() => fitView(false));
        }
        break;
      case "export-dialog": showExportDialog(); break;
      case "export-json": exportJson(); break;
      case "export-svg": exportSvg(); break;
      case "export-png": exportPng(); break;
      case "open-file": els.file_input.click(); break;
      case "save-browser": saveNow(); toast("已保存到本地", "cloud"); break;
      case "share": showShareDialog(); break;
      case "shortcuts": showShortcuts(); break;
      case "help": showHelp(); break;
      case "account": showAccount(); break;
      case "toggle-theme": toggleTheme(); break;
      case "present": enterPresentation(); break;
      case "print": window.print(); break;
      case "select-mode":
        state.connectionSource = null;
        document.querySelector('[data-action="add-connection"]')?.classList.remove("active");
        source?.classList.add("active");
        break;
      case "add-connection":
        if (!state.selectedId) return;
        state.connectionSource = state.selectedId;
        source?.classList.add("active");
        toast("请选择另一个节点", "connector");
        break;
      case "add-summary": showSummaryDialog(); break;
      case "save-summary": saveSummary(); break;
      case "add-note":
        state.inspectorTab = "note";
        state.rightCollapsed = false;
        renderInspector();
        applyUiState();
        if (window.innerWidth <= 840) els.workspace.classList.add("mobile-inspector-open");
        requestAnimationFrame(() => els.inspector_content.querySelector("textarea")?.focus());
        break;
      case "add-tag": showTagDialog(); break;
      case "add-link":
      case "open-node-link": showLinkDialog(); break;
      case "add-image": showImageDialog(); break;
      case "add-attachment": addAttachment(); break;
      case "toggle-bold":
        mutate(() => { const selected = getNode(state.selectedId); if (selected) selected.bold = !selected.bold; }, { keepSelection: true });
        break;
      case "toggle-italic":
        mutate(() => { const selected = getNode(state.selectedId); if (selected) selected.italic = !selected.italic; }, { keepSelection: true });
        break;
      case "decrease-font":
        mutate(() => { const selected = getNode(state.selectedId); if (selected) { selected.fontSize = clamp(selected.fontSize - 1, 10, 28); layoutTree(); } }, { keepSelection: true });
        break;
      case "increase-font":
        mutate(() => { const selected = getNode(state.selectedId); if (selected) { selected.fontSize = clamp(selected.fontSize + 1, 10, 28); layoutTree(); } }, { keepSelection: true });
        break;
      case "copy-share": {
        const input = document.getElementById("share-url");
        if (navigator.clipboard && location.protocol !== "file:") {
          navigator.clipboard.writeText(input?.value || location.href).then(() => toast("链接已复制", "copy"));
        } else {
          input?.select();
          document.execCommand("copy");
          toast("内容已复制", "copy");
        }
        break;
      }
      case "save-link": {
        const value = document.getElementById("node-link-input")?.value.trim() || "";
        const normalized = value && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
        setNodeField("link", normalized);
        closeModal();
        toast("链接已保存", "link");
        break;
      }
      case "clear-link": setNodeField("link", ""); closeModal(); break;
      case "save-tag": {
        const value = document.getElementById("node-tag-input")?.value.trim();
        if (!value) return;
        mutate(() => {
          const selected = getNode(state.selectedId);
          if (selected && !selected.tags.includes(value)) selected.tags.push(value);
        }, { keepSelection: true });
        closeModal();
        toast("标记已添加", "flag");
        break;
      }
      case "save-image": {
        const value = document.getElementById("node-image-input")?.value.trim() || "";
        mutate(() => {
          const selected = getNode(state.selectedId);
          if (selected) {
            selected.image = value;
            if (value) selected.icon = "🖼";
          }
        }, { keepSelection: true });
        closeModal();
        toast("图片引用已添加", "image");
        break;
      }
      case "rename-document": els.document_title.focus(); els.document_title.select(); break;
      default: break;
    }
  }

  function handleGlobalClick(event) {
    const menuButton = event.target.closest("[data-menu]");
    if (menuButton) {
      event.stopPropagation();
      openMenu(menuButton.dataset.menu, menuButton);
      return;
    }
    if (!event.target.closest(".dropdown-menu")) closeMenu();

    const close = event.target.closest("[data-close-modal]");
    if (close) {
      closeModal();
      return;
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      handleAction(actionButton.dataset.action, actionButton);
      return;
    }

    const outlineToggle = event.target.closest("[data-outline-toggle]");
    if (outlineToggle) {
      event.stopPropagation();
      toggleCollapse(outlineToggle.dataset.outlineToggle);
      return;
    }

    const outlineRow = event.target.closest("[data-outline-id]");
    if (outlineRow) {
      selectNode(outlineRow.dataset.outlineId, { center: true });
      if (window.innerWidth <= 840) els.workspace.classList.remove("mobile-sidebar-open");
      return;
    }

    const inspectorTab = event.target.closest("[data-inspector-tab]");
    if (inspectorTab) {
      state.inspectorTab = inspectorTab.dataset.inspectorTab;
      renderInspector();
      return;
    }

    const color = event.target.closest("[data-node-color]");
    if (color) {
      mutate(() => {
        const selected = getNode(state.selectedId);
        if (selected) {
          selected.color = color.dataset.nodeColor;
          selected.autoColor = false;
        }
      }, { keepSelection: true });
      return;
    }

    const mapTheme = event.target.closest("[data-map-theme]");
    if (mapTheme) {
      applyMapTheme(mapTheme.dataset.mapTheme);
      return;
    }

    const nodeIcon = event.target.closest("[data-node-icon]");
    if (nodeIcon) {
      setNodeField("icon", nodeIcon.dataset.nodeIcon);
      return;
    }

    const priority = event.target.closest("[data-node-priority]");
    if (priority) {
      setNodeField("priority", priority.dataset.nodePriority);
      return;
    }

    const removeTag = event.target.closest("[data-remove-tag]");
    if (removeTag) {
      const index = Number(removeTag.dataset.removeTag);
      mutate(() => {
        const selected = getNode(state.selectedId);
        if (selected) selected.tags.splice(index, 1);
      }, { keepSelection: true });
      return;
    }

    const collapse = event.target.closest("[data-collapse-id]");
    if (collapse) {
      event.stopPropagation();
      toggleCollapse(collapse.dataset.collapseId);
      return;
    }

    const nodeElement = event.target.closest("[data-node-id]");
    if (nodeElement && Date.now() > suppressClickUntil) {
      selectNode(nodeElement.dataset.nodeId);
    }
  }

  function handleInput(event) {
    const field = event.target.closest("[data-node-field]");
    if (field) {
      const selected = getNode(state.selectedId);
      if (!selected) return;
      const key = field.dataset.nodeField;
      selected[key] = field.value;
      if (key === "text" && !selected.parentId) {
        state.title = field.value || "未命名导图";
        els.document_title.value = state.title;
      }
      if (key === "text") layoutTree();
      renderNodes();
      renderSidebar();
      renderStatus();
      scheduleSave();
      return;
    }

    const range = event.target.closest("[data-node-range]");
    if (range) {
      const selected = getNode(state.selectedId);
      if (!selected) return;
      selected[range.dataset.nodeRange] = Number(range.value);
      layoutTree();
      renderMap();
      renderStatus();
      scheduleSave();
      return;
    }

    if (event.target.id === "outline-search") {
      const query = event.target.value.trim().toLowerCase();
      els.left_panel_content.querySelectorAll("[data-search-text]").forEach((row) => {
        row.hidden = Boolean(query) && !row.dataset.searchText.includes(query);
      });
    }
  }

  function handleDoubleClick(event) {
    const nodeElement = event.target.closest("[data-node-id]");
    if (nodeElement) startNodeEdit(nodeElement.dataset.nodeId);
  }

  function handleNodePointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea")) return;
    const element = event.target.closest("[data-node-id]");
    if (!element) return;
    const item = getNode(element.dataset.nodeId);
    if (!item) return;
    if (state.connectionSource) return;
    if (state.selectedId !== item.id) {
      state.selectedId = item.id;
      els.nodes_layer.querySelectorAll(".mind-node.selected").forEach((nodeElement) => {
        nodeElement.classList.remove("selected");
        nodeElement.setAttribute("aria-selected", "false");
      });
      element.classList.add("selected");
      element.setAttribute("aria-selected", "true");
      renderSidebar();
      renderInspector();
      renderStatus();
    }
    event.preventDefault();
    event.stopPropagation();
    const stageX = (event.clientX - state.viewport.x) / state.viewport.scale;
    const stageY = (event.clientY - state.viewport.y) / state.viewport.scale;
    pointerSession = {
      type: "node",
      id: item.id,
      element,
      pointerId: event.pointerId,
      offsetX: stageX - item.x,
      offsetY: stageY - item.y,
      startX: event.clientX,
      startY: event.clientY,
      snapshot: snapshot(),
      moved: false,
      historyPushed: false
    };
    try {
      element.setPointerCapture?.(event.pointerId);
    } catch (error) {
      console.debug("Pointer capture is not available for this event", error);
    }
  }

  function handleCanvasPointerDown(event) {
    if (event.target.closest("[data-node-id]")) return;
    if (event.button !== 0 && event.button !== 1) return;
    closeMenu();
    pointerSession = {
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: state.viewport.x,
      originY: state.viewport.y
    };
    els.canvas_viewport.classList.add("panning");
    els.canvas_viewport.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    if (pointerSession.type === "pan") {
      state.viewport.x = pointerSession.originX + event.clientX - pointerSession.startX;
      state.viewport.y = pointerSession.originY + event.clientY - pointerSession.startY;
      applyTransform();
      return;
    }

    const item = getNode(pointerSession.id);
    if (!item) return;
    const distance = Math.hypot(event.clientX - pointerSession.startX, event.clientY - pointerSession.startY);
    if (!pointerSession.moved && distance < 3) return;
    pointerSession.moved = true;
    if (!pointerSession.historyPushed) {
      state.history.push(pointerSession.snapshot);
      if (state.history.length > 60) state.history.shift();
      state.future = [];
      pointerSession.historyPushed = true;
    }
    const stageX = (event.clientX - state.viewport.x) / state.viewport.scale;
    const stageY = (event.clientY - state.viewport.y) / state.viewport.scale;
    item.x = clamp(stageX - pointerSession.offsetX, 20, STAGE.width - item.width - 20);
    item.y = clamp(stageY - pointerSession.offsetY, 20, STAGE.height - item.height - 20);
    pointerSession.element.classList.add("dragging");
    els.canvas_viewport.classList.add("dragging-node");
    renderConnections();
    pointerSession.element.style.left = `${item.x}px`;
    pointerSession.element.style.top = `${item.y}px`;
    renderMinimap();
  }

  function handlePointerUp(event) {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    if (pointerSession.type === "node" && pointerSession.moved) {
      suppressClickUntil = Date.now() + 120;
      pointerSession.element.classList.remove("dragging");
      els.canvas_viewport.classList.remove("dragging-node");
      renderSidebar();
      renderInspector();
      renderStatus();
      scheduleSave();
    }
    els.canvas_viewport.classList.remove("panning");
    pointerSession = null;
  }

  function handleWheel(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0023);
      zoomAt(state.viewport.scale * factor, event.clientX, event.clientY);
      return;
    }
    if (event.shiftKey) {
      state.viewport.x -= event.deltaY;
    } else {
      state.viewport.x -= event.deltaX;
      state.viewport.y -= event.deltaY;
    }
    applyTransform();
  }

  function handleKeyboard(event) {
    const target = event.target;
    const editing = target.matches("input, textarea, select") || target.isContentEditable;
    if (event.key === "Escape") {
      if (!els.modal_layer.hidden) {
        closeModal();
        return;
      }
      if (state.presentation) {
        exitPresentation();
        return;
      }
      if (state.connectionSource) {
        state.connectionSource = null;
        document.querySelector('[data-action="add-connection"]')?.classList.remove("active");
        toast("已取消联系模式", "close");
        return;
      }
      closeMenu();
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveNow();
      toast("已保存到本地", "cloud");
      return;
    }
    if (modifier && event.key.toLowerCase() === "o") {
      event.preventDefault();
      els.file_input.click();
      return;
    }
    if (modifier && event.key.toLowerCase() === "n") {
      event.preventDefault();
      showClearDialog();
      return;
    }
    if (modifier && event.key.toLowerCase() === "d" && !editing) {
      event.preventDefault();
      duplicateSelected();
      return;
    }
    if (modifier && event.key === "0") {
      event.preventDefault();
      fitView();
      return;
    }
    if (modifier && event.shiftKey && event.key.toLowerCase() === "e") {
      event.preventDefault();
      showExportDialog();
      return;
    }
    if (editing) return;
    if (event.key === "Tab") {
      event.preventDefault();
      addChild();
    } else if (event.key === "Enter") {
      event.preventDefault();
      addSibling();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
    } else if (event.key === "F2") {
      event.preventDefault();
      startNodeEdit();
    } else if (event.key === "+" || event.key === "=") {
      zoomAt(state.viewport.scale * 1.12);
    } else if (event.key === "-") {
      zoomAt(state.viewport.scale / 1.12);
    }
  }

  function bindEvents() {
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("input", handleInput);
    document.addEventListener("dblclick", handleDoubleClick);
    document.addEventListener("keydown", handleKeyboard);
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);

    els.nodes_layer.addEventListener("pointerdown", handleNodePointerDown);
    els.canvas_viewport.addEventListener("pointerdown", handleCanvasPointerDown);
    els.canvas_viewport.addEventListener("wheel", handleWheel, { passive: false });

    els.document_title.addEventListener("input", () => {
      state.title = els.document_title.value || "未命名导图";
      const root = getRoot();
      if (root) root.text = state.title;
      layoutTree();
      renderMap();
      renderSidebar();
      renderStatus();
      scheduleSave();
    });
    els.document_title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        els.document_title.blur();
      }
    });

    els.file_input.addEventListener("change", () => {
      importFile(els.file_input.files?.[0]);
      els.file_input.value = "";
    });

    els.modal_layer.addEventListener("click", (event) => {
      if (event.target === els.modal_layer) closeModal();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 840) {
        els.workspace.classList.remove("mobile-sidebar-open", "mobile-inspector-open");
      }
      requestAnimationFrame(() => {
        if (window.innerWidth <= 560) {
          frameMobileView();
        } else {
          fitView(false);
        }
      });
    });
  }

  function addSupplementalStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .relationship-path{fill:none;stroke:var(--coral);stroke-width:1.8;stroke-dasharray:6 5;opacity:.8}
      .relationship-label{fill:var(--coral);font-family:var(--font);font-size:11px;paint-order:stroke;stroke:var(--canvas);stroke-width:5px;stroke-linejoin:round}
      .node-badge svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:2}
      a{text-decoration:none}
    `;
    document.head.appendChild(style);
  }

  function init() {
    cacheElements();
    initState();
    addSupplementalStyles();
    bindEvents();
    renderAll();
    requestAnimationFrame(() => {
      if (window.innerWidth <= 560) {
        frameMobileView();
      } else {
        fitView(false);
      }
      saveNow();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
