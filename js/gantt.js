var t = window.TrelloPowerUp.iframe();

var PALETTE = [
  "#0079bf","#61bd4f","#eb5a46","#ff9f1a","#c377e0",
  "#00c2e0","#51e898","#ff78cb","#344563","#f2d600",
];

var allCards = [];
var allMembers = {};
var allLists = {};
var groupBy = "member";
var dateFrom = null;
var dateTo = null;
var hiddenMembers = {};
var hideWeekends = false;

t.render(function () {
  var ctx = t.getContext();
  if (ctx && ctx.theme === "dark") document.body.classList.add("dark-mode");
  loadData();
});

function loadData() {
  showLoading(true, "Loading cards…");
  Promise.all([
    t.cards("id", "name", "idList", "members", "dueComplete"),
    t.lists("id", "name"),
  ]).then(function (results) {
    var cards = results[0];
    var lists = results[1];
    lists.forEach(function (l) { allLists[l.id] = l; });
    cards.forEach(function (card) {
      (card.members || []).forEach(function (m) {
        if (!allMembers[m.id]) allMembers[m.id] = m;
      });
    });
    showLoading(true, "Loading time logs… (0 / " + cards.length + ")");
    fetchAllPowerUpData(cards.map(function (c) { return c.id; }), cards.length)
      .then(function (puMap) {
        allCards = cards.map(function (card) {
          var pu = puMap[card.id] || {};
          return {
            id: card.id,
            name: card.name,
            listName: (allLists[card.idList] || {}).name || "?",
            members: card.members || [],
            dueComplete: card.dueComplete || false,
            timeLog: pu.timeLog || [],
            isRunning: pu.isRunning || false,
            startTime: pu.startTime || 0,
          };
        });
        showLoading(false);
        initDateDefaults();
        wireControls();
        render();
      });
  }).catch(function (err) {
    console.error("Gantt load error:", err);
    showLoading(false);
  });
}

function fetchAllPowerUpData(cardIds, total) {
  var result = {};
  var BATCH = 20;
  var done = 0;
  var batches = [];
  for (var i = 0; i < cardIds.length; i += BATCH)
    batches.push(cardIds.slice(i, i + BATCH));
  return batches.reduce(function (chain, batch) {
    return chain.then(function () {
      return Promise.all(batch.map(function (id) {
        return t.get(id, "shared")
          .then(function (data) { result[id] = data || {}; })
          .catch(function () { result[id] = {}; })
          .then(function () {
            done++;
            showLoading(true, "Loading time logs… (" + done + " / " + total + ")");
          });
      }));
    });
  }, Promise.resolve()).then(function () { return result; });
}

function toInputDate(d) { return d.toISOString().slice(0, 10); }
function setPickerDate(id, date) { document.getElementById("date-" + id).value = toInputDate(date); }
function getPickerDate(id) {
  var val = document.getElementById("date-" + id).value;
  if (!val) return null;
  var p = val.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
function initDateDefaults() {
  var now = new Date();
  var from = new Date(now);
  from.setDate(from.getDate() - 8);
  setPickerDate("from", from);
  setPickerDate("to", now);
  dateFrom = from;
  dateTo = now;
}

// ── Weekend compression ──
function isWeekendMs(ts) {
  var day = new Date(ts).getDay();
  return day === 0 || day === 6;
}
function dayStart(ts) {
  var d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function getWeekendBlocks(minT, maxT) {
  var blocks = [];
  var cursor = dayStart(minT);
  while (cursor <= maxT) {
    var day = new Date(cursor).getDay();
    if (day === 6) {
      var blockEnd = cursor + 2 * 86400000;
      blocks.push({ start: cursor, end: blockEnd });
      cursor = blockEnd;
    } else {
      cursor += 86400000;
    }
  }
  return blocks;
}
function buildTimeMapper(minT, maxT) {
  if (!hideWeekends) {
    return {
      toDisplay: function (ts) { return ts - minT; },
      displaySpan: maxT - minT,
      weekendBlocks: [],
    };
  }
  var blocks = getWeekendBlocks(minT, maxT);
  var clampedBlocks = blocks.map(function (b) {
    return { start: Math.max(b.start, minT), end: Math.min(b.end, maxT) };
  }).filter(function (b) { return b.end > b.start; });
  var totalWeekend = clampedBlocks.reduce(function (acc, b) { return acc + (b.end - b.start); }, 0);
  var displaySpan = maxT - minT - totalWeekend;
  if (displaySpan <= 0) displaySpan = maxT - minT;
  function toDisplay(ts) {
    var skipped = 0;
    for (var i = 0; i < clampedBlocks.length; i++) {
      var b = clampedBlocks[i];
      if (ts <= b.start) break;
      if (ts >= b.end) skipped += b.end - b.start;
      else skipped += ts - b.start;
    }
    return ts - minT - skipped;
  }
  return { toDisplay: toDisplay, displaySpan: displaySpan, weekendBlocks: clampedBlocks };
}

// ── Filter ──
function filteredSessions() {
  var from = dateFrom ? dateFrom.getTime() : null;
  var to = dateTo
    ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999).getTime()
    : null;
  var sessions = [];
  allCards.forEach(function (card) {
    card.timeLog.forEach(function (entry) {
      var s = new Date(entry.start).getTime();
      var e = new Date(entry.end).getTime();
      if (from && e < from) return;
      if (to && s > to) return;
      sessions.push({
        card: card, start: s, end: e,
        clampedStart: from ? Math.max(s, from) : s,
        clampedEnd: to ? Math.min(e, to) : e,
        type: entry.type || "timer", isRunning: false,
      });
    });
    if (card.isRunning && card.startTime) {
      var s = card.startTime, e = Date.now();
      if (!(from && e < from) && !(to && s > to)) {
        sessions.push({
          card: card, start: s, end: e,
          clampedStart: from ? Math.max(s, from) : s,
          clampedEnd: to ? Math.min(e, to) : e,
          type: "timer", isRunning: true,
        });
      }
    }
  });
  return sessions;
}

// ── Render ──
function render() {
  var sessions = filteredSessions();
  if (sessions.length === 0) {
    document.getElementById("gantt-inner").innerHTML = "";
    document.getElementById("legend").innerHTML = "";
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }
  document.getElementById("empty-state").classList.add("hidden");

  var minT = Math.min.apply(null, sessions.map(function (s) { return s.clampedStart; }));
  var maxT = Math.max.apply(null, sessions.map(function (s) { return s.clampedEnd; }));
  var pad = (maxT - minT) * 0.02 || 3600000;
  minT -= pad; maxT += pad;

  var mapper = buildTimeMapper(minT, maxT);
  var colorMap = buildColorMap(sessions);
  renderLegend(colorMap);
  var groups = buildGroups(sessions);

  var inner = document.getElementById("gantt-inner");
  inner.innerHTML = "";
  inner.appendChild(buildHeader(minT, maxT, mapper));

  groups.forEach(function (group) {
    var section = document.createElement("div");
    section.className = "gantt-group-section";
    var gh = document.createElement("div");
    gh.className = "gantt-group-header";
    var avatarColor = colorMap[group.colorKey] || PALETTE[0];
    gh.innerHTML = '<span class="group-avatar" style="background:' + avatarColor + '">' + initials(group.label) + "</span>" + esc(group.label);
    section.appendChild(gh);
    group.rows.forEach(function (row) { section.appendChild(buildRow(row, minT, mapper, colorMap)); });
    inner.appendChild(section);
  });

  applyMemberFilter();
  wireTooltip();
}

function cardColorKey(card) {
  if (groupBy === "card") return card.id;
  if (!card.members.length) return "__unassigned__";
  return card.members.map(function (m) { return m.id; }).sort().join("+");
}
function buildColorMap(sessions) {
  var keys = [];
  sessions.forEach(function (s) {
    var key = cardColorKey(s.card);
    if (keys.indexOf(key) === -1) keys.push(key);
  });
  var map = {};
  keys.forEach(function (k, i) { map[k] = PALETTE[i % PALETTE.length]; });
  return map;
}
function sessionColorKey(session) { return cardColorKey(session.card); }

function renderLegend(colorMap) {
  var legend = document.getElementById("legend");
  legend.innerHTML = "";
  Object.keys(colorMap).forEach(function (key) {
    var label;
    if (groupBy === "member") {
      if (key === "__unassigned__") {
        label = "Unassigned";
      } else {
        label = key.split("+").map(function (id) {
          var m = allMembers[id];
          return m ? m.fullName || m.username : "?";
        }).join(" & ");
      }
    } else {
      var card = allCards.find(function (c) { return c.id === key; });
      label = card ? card.name : key;
    }
    var item = document.createElement("div");
    item.className = "legend-item" + (hiddenMembers[key] ? " is-off" : "");
    item.title = hiddenMembers[key] ? "Click to show" : "Click to hide";
    item.dataset.key = key;
    item.innerHTML = '<span class="legend-dot" style="background:' + colorMap[key] + '"></span><span>' + esc(label) + "</span>";
    item.addEventListener("click", function () {
      var k = this.dataset.key;
      if (hiddenMembers[k]) { delete hiddenMembers[k]; } else { hiddenMembers[k] = true; }
      applyMemberFilter();
      this.classList.toggle("is-off", !!hiddenMembers[k]);
      this.title = hiddenMembers[k] ? "Click to show" : "Click to hide";
    });
    legend.appendChild(item);
  });
}

function applyMemberFilter() {
  document.querySelectorAll(".gantt-bar").forEach(function (bar) {
    bar.style.display = bar.dataset.filterKey && hiddenMembers[bar.dataset.filterKey] ? "none" : "";
  });
  document.querySelectorAll(".gantt-group-section").forEach(function (section) {
    var anyVisible = false;
    section.querySelectorAll(".gantt-bar").forEach(function (bar) {
      if (bar.style.display !== "none") anyVisible = true;
    });
    section.style.display = anyVisible ? "" : "none";
  });
}

function buildGroups(sessions) {
  var groupMap = {}, groupOrder = [];
  function memberKey(card) {
    if (!card.members.length) return "__unassigned__";
    return card.members.map(function (m) { return m.id; }).sort().join("+");
  }
  function memberLabel(card) {
    if (!card.members.length) return "Unassigned";
    return card.members.map(function (m) { return m.fullName || m.username; }).join(" & ");
  }
  if (groupBy === "member") {
    sessions.forEach(function (session) {
      var memberList = session.card.members.length
        ? session.card.members
        : [{ id: "__unassigned__", fullName: "Unassigned" }];
      memberList.forEach(function (member) {
        var gKey = member.id, gLabel = member.fullName || member.username || "Unassigned";
        if (!groupMap[gKey]) { groupMap[gKey] = { key: gKey, label: gLabel, colorKey: gKey, rowMap: {} }; groupOrder.push(gKey); }
        var rowKey = session.card.id;
        if (!groupMap[gKey].rowMap[rowKey]) {
          groupMap[gKey].rowMap[rowKey] = { key: rowKey, label: session.card.name, listName: session.card.listName, colorKey: memberKey(session.card), sessions: [] };
        }
        var already = groupMap[gKey].rowMap[rowKey].sessions.some(function (s) { return s.start === session.start && s.end === session.end; });
        if (!already) groupMap[gKey].rowMap[rowKey].sessions.push(session);
      });
    });
  } else {
    sessions.forEach(function (session) {
      var gKey = session.card.id;
      if (!groupMap[gKey]) { groupMap[gKey] = { key: gKey, label: session.card.name, colorKey: memberKey(session.card), rowMap: {} }; groupOrder.push(gKey); }
      if (!groupMap[gKey].rowMap[gKey]) { groupMap[gKey].rowMap[gKey] = { key: gKey, label: memberLabel(session.card), listName: session.card.listName, colorKey: memberKey(session.card), sessions: [] }; }
      groupMap[gKey].rowMap[gKey].sessions.push(session);
    });
  }
  return groupOrder.map(function (gk) {
    var g = groupMap[gk];
    return { key: g.key, label: g.label, colorKey: g.colorKey, rows: Object.keys(g.rowMap).map(function (rk) { return g.rowMap[rk]; }) };
  });
}

// ── Header ──
function buildHeader(minT, maxT, mapper) {
  var header = document.createElement("div");
  header.className = "gantt-header";
  var labelCol = document.createElement("div");
  labelCol.className = "gantt-label-col";
  labelCol.textContent = groupBy === "member" ? "Card" : "Member";
  header.appendChild(labelCol);

  var tl = document.createElement("div");
  tl.className = "gantt-timeline-header";
  var displaySpan = mapper.displaySpan;

  // Weekend shading in header
  if (!hideWeekends) {
    getWeekendBlocks(minT, maxT).forEach(function (b) {
      var bs = Math.max(b.start, minT), be = Math.min(b.end, maxT);
      if (be <= bs) return;
      var shade = document.createElement("div");
      shade.className = "gantt-weekend-shade";
      shade.style.left = (mapper.toDisplay(bs) / displaySpan) * 100 + "%";
      shade.style.width = ((mapper.toDisplay(be) - mapper.toDisplay(bs)) / displaySpan) * 100 + "%";
      tl.appendChild(shade);
    });
  }

  // ── Tick labels ──
  // ≤8 days: every 2h. ≤2 weeks: every 6h. Wider: daily.
  var realSpan = maxT - minT;
  var tickInterval = realSpan <= 8 * 86400000  ? 2 * 3600000
                   : realSpan <= 14 * 86400000 ? 6 * 3600000
                   : 86400000;

  // Snap first tick to a clean boundary
  var firstTick = Math.ceil(minT / tickInterval) * tickInterval;

  for (var ts = firstTick; ts <= maxT; ts += tickInterval) {
    if (hideWeekends && isWeekendMs(ts)) continue;
    var dispPos = mapper.toDisplay(ts);
    var pct = (dispPos / displaySpan) * 100;
    if (pct < 0 || pct > 100) continue;

    var tick = document.createElement("div");
    tick.className = "gantt-tick";
    tick.style.left = pct + "%";
    var line = document.createElement("div");
    line.className = "gantt-tick-line";
    var lbl = document.createElement("div");
    lbl.className = "gantt-tick-label";
    lbl.textContent = formatTickLabel(new Date(ts), tickInterval);
    tick.appendChild(line);
    tick.appendChild(lbl);
    tl.appendChild(tick);
  }

  header.appendChild(tl);
  return header;
}

function formatTickLabel(d, interval) {
  if (interval < 86400000) {
    // Show date label at midnight, time otherwise
    if (d.getHours() === 0 && d.getMinutes() === 0) {
      return d.toLocaleDateString(navigator.language, { weekday: "short", month: "short", day: "numeric" });
    }
    return d.toLocaleTimeString(navigator.language, { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString(navigator.language, { month: "short", day: "numeric" });
}

// ── Row ──
function buildRow(row, minT, mapper, colorMap) {
  var rowEl = document.createElement("div");
  rowEl.className = "gantt-row";
  var labelEl = document.createElement("div");
  labelEl.className = "gantt-row-label";
  labelEl.title = row.label;
  labelEl.innerHTML = esc(row.label) + (row.listName ? '<span class="row-list-name">' + esc(row.listName) + "</span>" : "");
  rowEl.appendChild(labelEl);

  var tlEl = document.createElement("div");
  tlEl.className = "gantt-row-timeline";
  var displaySpan = mapper.displaySpan;

  // Weekend shading on rows
  if (!hideWeekends) {
    getWeekendBlocks(minT, minT + displaySpan + 2 * 86400000).forEach(function (b) {
      var bs = Math.max(b.start, minT);
      var be = b.end;
      var ld = mapper.toDisplay(bs), rd = mapper.toDisplay(be);
      if (rd <= 0 || ld >= displaySpan) return;
      var shade = document.createElement("div");
      shade.className = "gantt-weekend-shade";
      shade.style.left = (ld / displaySpan) * 100 + "%";
      shade.style.width = ((rd - ld) / displaySpan) * 100 + "%";
      tlEl.appendChild(shade);
    });
  }

  // ── Grid lines ──
  // ≤8 days → 2h lines; thick on THICK_HOURS. ≤2 weeks → 6h. Wider → daily.
  // Grid lines every 2h (≤8d), 6h (≤2w), or daily.
  // A line is thick if it coincides with a tick label position (same interval as header).
  var realSpanG = maxT - minT;  // use real span to match header tick interval exactly
  var rangeMs = displaySpan;
  var GRID_INTERVAL = rangeMs <= 8 * 86400000  ? 2 * 3600000
                    : rangeMs <= 14 * 86400000 ? 6 * 3600000
                    : 86400000;
  var TICK_INTERVAL = realSpanG <= 8 * 86400000  ? 2 * 3600000
                    : realSpanG <= 14 * 86400000 ? 6 * 3600000
                    : 86400000;
  var firstGrid = Math.ceil(minT / GRID_INTERVAL) * GRID_INTERVAL;
  for (var ts = firstGrid; ts <= minT + displaySpan * 1.1; ts += GRID_INTERVAL) {
    if (hideWeekends && isWeekendMs(ts)) continue;
    var dispPos = mapper.toDisplay(ts);
    var pct = (dispPos / displaySpan) * 100;
    if (pct < 0 || pct > 100) continue;
    var gl = document.createElement("div");
    // Thick when this timestamp aligns with the tick label interval
    var isThick = (ts % TICK_INTERVAL === 0);
    gl.className = "gantt-gridline" + (isThick ? " gantt-gridline--thick" : "");
    gl.style.left = pct + "%";
    tlEl.appendChild(gl);
  }

  // ── Bars ──
  row.sessions.forEach(function (session) {
    var bars = hideWeekends ? splitSessionAtWeekends(session) : [{ start: session.clampedStart, end: session.clampedEnd }];
    bars.forEach(function (seg) {
      var leftD = mapper.toDisplay(seg.start), rightD = mapper.toDisplay(seg.end);
      var leftPct = (leftD / displaySpan) * 100;
      var widthPct = ((rightD - leftD) / displaySpan) * 100;
      if (widthPct < 0.05) widthPct = 0.05;
      var color = colorMap[sessionColorKey(session)] || PALETTE[0];
      var bar = document.createElement("div");
      bar.className = "gantt-bar" + (session.isRunning ? " gantt-bar--running" : "");
      bar.style.left = leftPct + "%";
      bar.style.width = widthPct + "%";
      bar.style.background = color;
      bar.style.opacity = session.type === "manual" ? "0.7" : "1";
      bar.dataset.filterKey = sessionColorKey(session);
      bar.dataset.cardName  = session.card.name;
      bar.dataset.listName  = session.card.listName;
      bar.dataset.members   = session.card.members.map(function (m) { return m.fullName || m.username; }).join(", ") || "Unassigned";
      bar.dataset.start     = new Date(session.start).toLocaleString(navigator.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      bar.dataset.end       = session.isRunning ? "now (running)" : new Date(session.end).toLocaleString(navigator.language, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      bar.dataset.duration  = fmtMs(session.end - session.start);
      bar.dataset.type      = session.type;
      bar.dataset.running   = session.isRunning ? "1" : "0";
      tlEl.appendChild(bar);
    });
  });

  rowEl.appendChild(tlEl);
  return rowEl;
}

function splitSessionAtWeekends(session) {
  var segments = [], cursor = session.clampedStart, end = session.clampedEnd;
  while (cursor < end) {
    var d = new Date(cursor), day = d.getDay();
    if (day === 6 || day === 0) {
      cursor = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (day === 6 ? 2 : 1)).getTime(), end);
      continue;
    }
    var nextSat = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (6 - day)).getTime();
    var segEnd = Math.min(nextSat, end);
    if (segEnd > cursor) segments.push({ start: cursor, end: segEnd });
    cursor = segEnd;
  }
  return segments.length ? segments : [{ start: session.clampedStart, end: session.clampedEnd }];
}

function wireTooltip() {
  var tooltip = document.getElementById("tooltip");
  document.querySelectorAll(".gantt-bar").forEach(function (bar) {
    bar.addEventListener("mouseenter", function (e) {
      var running = bar.dataset.running === "1";
      tooltip.innerHTML =
        "<b>" + esc(bar.dataset.cardName) + "</b>" +
        "<span class='tt-meta'>" + esc(bar.dataset.listName) + "</span>" +
        "<span class='tt-meta'>👤 " + esc(bar.dataset.members) + "</span>" +
        "<span class='tt-meta'>▶ " + bar.dataset.start + "</span>" +
        "<span class='tt-meta'>■ " + bar.dataset.end + "</span>" +
        "<span class='tt-meta'>⏱ " + bar.dataset.duration + (bar.dataset.type === "manual" ? " (manual)" : "") + (running ? " 🟢 live" : "") + "</span>";
      tooltip.classList.remove("hidden");
      positionTooltip(e);
    });
    bar.addEventListener("mousemove", positionTooltip);
    bar.addEventListener("mouseleave", function () { tooltip.classList.add("hidden"); });
  });
}

function positionTooltip(e) {
  var tooltip = document.getElementById("tooltip");
  var x = e.clientX + 14, y = e.clientY + 14;
  if (x + 270 > window.innerWidth) x = e.clientX - 275;
  if (y + 150 > window.innerHeight) y = e.clientY - 140;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

function wireControls() {
  document.getElementById("apply-filter").addEventListener("click", function () {
    dateFrom = getPickerDate("from");
    dateTo = getPickerDate("to");
    render();
  });
  document.getElementById("reset-filter").addEventListener("click", function () {
    document.getElementById("date-from").value = "";
    document.getElementById("date-to").value = "";
    dateFrom = null; dateTo = null;
    render();
  });
  document.getElementById("btn-group-member").addEventListener("click", function () {
    groupBy = "member"; hiddenMembers = {};
    this.classList.add("active");
    document.getElementById("btn-group-card").classList.remove("active");
    render();
  });
  document.getElementById("btn-group-card").addEventListener("click", function () {
    groupBy = "card"; hiddenMembers = {};
    this.classList.add("active");
    document.getElementById("btn-group-member").classList.remove("active");
    render();
  });
  document.getElementById("btn-weekends").addEventListener("click", function () {
    hideWeekends = !hideWeekends;
    this.classList.toggle("active", hideWeekends);
    this.textContent = hideWeekends ? "Weekends hidden" : "Hide weekends";
    render();
  });
}

function fmtMs(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  if (m > 0) return m + "m";
  return s + "s";
}
function initials(name) {
  return (name || "?").split(" ").slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
}
function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function showLoading(show, msg) {
  document.getElementById("loading").classList.toggle("hidden", !show);
  document.getElementById("app").classList.toggle("hidden", show);
  if (msg) document.getElementById("loading-msg").textContent = msg;
}