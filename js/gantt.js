var t = window.TrelloPowerUp.iframe();

// ── Colour palette (one per member / card depending on grouping) ──
var PALETTE = [
  "#0079bf",
  "#61bd4f",
  "#eb5a46",
  "#ff9f1a",
  "#c377e0",
  "#00c2e0",
  "#51e898",
  "#ff78cb",
  "#344563",
  "#f2d600",
];

// ── State ──
var allCards = [];
var allMembers = {}; // id → {id, fullName, username}
var allLists = {}; // id → {id, name}
var groupBy = "member"; // "member" | "card"
var dateFrom = null;
var dateTo = null;

// ── Boot ──
t.render(function () {
  var ctx = t.getContext();
  if (ctx && ctx.theme === "dark") document.body.classList.add("dark-mode");
  loadData();
});

// ─────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────
function loadData() {
  showLoading(true, "Loading cards…");

  Promise.all([
    t.cards("id", "name", "idList", "members", "dueComplete"),
    t.lists("id", "name"),
  ])
    .then(function (results) {
      var cards = results[0];
      var lists = results[1];

      lists.forEach(function (l) {
        allLists[l.id] = l;
      });
      cards.forEach(function (card) {
        (card.members || []).forEach(function (m) {
          if (!allMembers[m.id]) allMembers[m.id] = m;
        });
      });

      showLoading(true, "Loading time logs… (0 / " + cards.length + ")");

      fetchAllPowerUpData(
        cards.map(function (c) {
          return c.id;
        }),
        cards.length,
      ).then(function (puMap) {
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
    })
    .catch(function (err) {
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

  return batches
    .reduce(function (chain, batch) {
      return chain.then(function () {
        return Promise.all(
          batch.map(function (id) {
            return t
              .get(id, "shared")
              .then(function (data) {
                result[id] = data || {};
              })
              .catch(function () {
                result[id] = {};
              })
              .then(function () {
                done++;
                showLoading(
                  true,
                  "Loading time logs… (" + done + " / " + total + ")",
                );
              });
          }),
        );
      });
    }, Promise.resolve())
    .then(function () {
      return result;
    });
}

// ─────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────
function toInputDate(d) {
  return d.toISOString().slice(0, 10);
}

function setPickerDate(id, date) {
  document.getElementById("date-" + id).value = toInputDate(date);
}
function getPickerDate(id) {
  var val = document.getElementById("date-" + id).value;
  if (!val) return null;
  var p = val.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function initDateDefaults() {
  var now = new Date();
  var from = new Date(now);
  from.setDate(from.getDate() - 30);
  setPickerDate("from", from);
  setPickerDate("to", now);
  dateFrom = from;
  dateTo = now;
}

// ─────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────
function filteredSessions() {
  // Returns a flat array of session objects with card info attached
  var from = dateFrom ? dateFrom.getTime() : null;
  var to = dateTo
    ? new Date(
        dateTo.getFullYear(),
        dateTo.getMonth(),
        dateTo.getDate(),
        23,
        59,
        59,
        999,
      ).getTime()
    : null;
  var sessions = [];

  allCards.forEach(function (card) {
    card.timeLog.forEach(function (entry) {
      var s = new Date(entry.start).getTime();
      var e = new Date(entry.end).getTime();
      if (from && e < from) return;
      if (to && s > to) return;
      // Clamp to filter window
      var clampedStart = from ? Math.max(s, from) : s;
      var clampedEnd = to ? Math.min(e, to) : e;
      sessions.push({
        card: card,
        start: s,
        end: e,
        clampedStart: clampedStart,
        clampedEnd: clampedEnd,
        type: entry.type || "timer",
        isRunning: false,
      });
    });

    // Live running session
    if (card.isRunning && card.startTime) {
      var s = card.startTime;
      var e = Date.now();
      if (!(from && e < from) && !(to && s > to)) {
        sessions.push({
          card: card,
          start: s,
          end: e,
          clampedStart: from ? Math.max(s, from) : s,
          clampedEnd: to ? Math.min(e, to) : e,
          type: "timer",
          isRunning: true,
        });
      }
    }
  });

  return sessions;
}

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
function render() {
  var sessions = filteredSessions();

  if (sessions.length === 0) {
    document.getElementById("gantt-inner").innerHTML = "";
    document.getElementById("legend").innerHTML = "";
    document.getElementById("empty-state").classList.remove("hidden");
    return;
  }
  document.getElementById("empty-state").classList.add("hidden");

  // Time range for the whole chart
  var minT = Math.min.apply(
    null,
    sessions.map(function (s) {
      return s.clampedStart;
    }),
  );
  var maxT = Math.max.apply(
    null,
    sessions.map(function (s) {
      return s.clampedEnd;
    }),
  );
  // Add a small padding
  var pad = (maxT - minT) * 0.02 || 3600000;
  minT -= pad;
  maxT += pad;
  var totalSpan = maxT - minT;

  // Build colour map
  var colorMap = buildColorMap(sessions);

  // Build legend
  renderLegend(colorMap);

  // Group sessions
  var groups = buildGroups(sessions);

  // Render
  var inner = document.getElementById("gantt-inner");
  inner.innerHTML = "";

  // Header
  inner.appendChild(buildHeader(minT, maxT));

  // Rows
  groups.forEach(function (group) {
    // Group header
    var gh = document.createElement("div");
    gh.className = "gantt-group-header";
    var avatarColor = colorMap[group.colorKey] || PALETTE[0];
    gh.innerHTML =
      '<span class="group-avatar" style="background:' +
      avatarColor +
      '">' +
      initials(group.label) +
      "</span>" +
      esc(group.label);
    inner.appendChild(gh);

    // Card rows within this group
    group.rows.forEach(function (row) {
      inner.appendChild(buildRow(row, minT, totalSpan, colorMap));
    });
  });

  wireTooltip();
}

// ── Colour map ──
function buildColorMap(sessions) {
  var keys = [];
  sessions.forEach(function (s) {
    var key =
      groupBy === "member"
        ? s.card.members.length
          ? s.card.members
              .map(function (m) {
                return m.id;
              })
              .join("+")
          : "__unassigned__"
        : s.card.id;
    if (keys.indexOf(key) === -1) keys.push(key);
  });
  var map = {};
  keys.forEach(function (k, i) {
    map[k] = PALETTE[i % PALETTE.length];
  });
  return map;
}

function sessionColorKey(session) {
  if (groupBy === "member") {
    return session.card.members.length
      ? session.card.members
          .map(function (m) {
            return m.id;
          })
          .join("+")
      : "__unassigned__";
  }
  return session.card.id;
}

// ── Legend ──
function renderLegend(colorMap) {
  var legend = document.getElementById("legend");
  legend.innerHTML = "";
  Object.keys(colorMap).forEach(function (key) {
    var label;
    if (groupBy === "member") {
      if (key === "__unassigned__") {
        label = "Unassigned";
      } else {
        var ids = key.split("+");
        label = ids
          .map(function (id) {
            var m = allMembers[id];
            return m ? m.fullName || m.username : "?";
          })
          .join(" & ");
      }
    } else {
      var card = allCards.find(function (c) {
        return c.id === key;
      });
      label = card ? card.name : key;
    }
    var item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML =
      '<span class="legend-dot" style="background:' +
      colorMap[key] +
      '"></span>' +
      "<span>" +
      esc(label) +
      "</span>";
    legend.appendChild(item);
  });
}

// ── Groups ──
function buildGroups(sessions) {
  var groupMap = {};
  var groupOrder = [];

  sessions.forEach(function (session) {
    var groupKey, groupLabel, colorKey;

    if (groupBy === "member") {
      if (session.card.members.length === 0) {
        groupKey = "__unassigned__";
        groupLabel = "Unassigned";
      } else {
        groupKey = session.card.members
          .map(function (m) {
            return m.id;
          })
          .join("+");
        groupLabel = session.card.members
          .map(function (m) {
            return m.fullName || m.username;
          })
          .join(" & ");
      }
      colorKey = groupKey;
    } else {
      // Group by card
      groupKey = session.card.id;
      groupLabel = session.card.name;
      colorKey = session.card.id;
    }

    if (!groupMap[groupKey]) {
      groupMap[groupKey] = {
        key: groupKey,
        label: groupLabel,
        colorKey: colorKey,
        rowMap: {},
      };
      groupOrder.push(groupKey);
    }

    // Within each group, rows = cards (when grouping by member) or members (when grouping by card)
    var rowKey =
      groupBy === "member"
        ? session.card.id
        : session.card.members.length
          ? session.card.members
              .map(function (m) {
                return m.id;
              })
              .join("+")
          : "__unassigned__";
    var rowLabel =
      groupBy === "member"
        ? session.card.name
        : session.card.members.length
          ? session.card.members
              .map(function (m) {
                return m.fullName || m.username;
              })
              .join(" & ")
          : "Unassigned";
    var rowListName = groupBy === "member" ? session.card.listName : "";

    if (!groupMap[groupKey].rowMap[rowKey]) {
      groupMap[groupKey].rowMap[rowKey] = {
        key: rowKey,
        label: rowLabel,
        listName: rowListName,
        sessions: [],
      };
    }
    groupMap[groupKey].rowMap[rowKey].sessions.push(session);
  });

  return groupOrder.map(function (gk) {
    var g = groupMap[gk];
    return {
      key: g.key,
      label: g.label,
      colorKey: g.colorKey,
      rows: Object.keys(g.rowMap).map(function (rk) {
        return g.rowMap[rk];
      }),
    };
  });
}

// ── Header ──
function buildHeader(minT, maxT) {
  var span = maxT - minT;
  var header = document.createElement("div");
  header.className = "gantt-header";

  var labelCol = document.createElement("div");
  labelCol.className = "gantt-label-col";
  labelCol.textContent = groupBy === "member" ? "Card" : "Member";
  header.appendChild(labelCol);

  var tl = document.createElement("div");
  tl.className = "gantt-timeline-header";

  // Decide tick interval
  var intervals = [
    60 * 1000,
    5 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    3600 * 1000,
    3 * 3600 * 1000,
    6 * 3600 * 1000,
    12 * 3600 * 1000,
    86400 * 1000,
    2 * 86400 * 1000,
    7 * 86400 * 1000,
  ];
  var TARGET_TICKS = 8;
  var interval =
    intervals.find(function (iv) {
      return span / iv <= TARGET_TICKS * 2;
    }) || 7 * 86400 * 1000;

  // Snap first tick to interval boundary
  var firstTick = Math.ceil(minT / interval) * interval;
  for (var ts = firstTick; ts <= maxT; ts += interval) {
    var pct = ((ts - minT) / span) * 100;
    var tick = document.createElement("div");
    tick.className = "gantt-tick";
    tick.style.left = pct + "%";

    var line = document.createElement("div");
    line.className = "gantt-tick-line";

    var lbl = document.createElement("div");
    lbl.className = "gantt-tick-label";
    lbl.textContent = formatTickLabel(new Date(ts), interval);

    tick.appendChild(line);
    tick.appendChild(lbl);
    tl.appendChild(tick);
  }

  header.appendChild(tl);
  return header;
}

function formatTickLabel(d, interval) {
  if (interval < 3600000) {
    // sub-hour: show time only
    return d.toLocaleTimeString(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (interval < 86400000) {
    // hours: date + time
    return (
      d.toLocaleDateString(navigator.language, {
        month: "short",
        day: "numeric",
      }) +
      " " +
      d.toLocaleTimeString(navigator.language, {
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  }
  // days / weeks
  return d.toLocaleDateString(navigator.language, {
    month: "short",
    day: "numeric",
  });
}

// ── Row ──
function buildRow(row, minT, totalSpan, colorMap) {
  var rowEl = document.createElement("div");
  rowEl.className = "gantt-row";

  var labelEl = document.createElement("div");
  labelEl.className = "gantt-row-label";
  labelEl.title = row.label;
  labelEl.innerHTML =
    esc(row.label) +
    (row.listName
      ? '<span class="row-list-name">' + esc(row.listName) + "</span>"
      : "");
  rowEl.appendChild(labelEl);

  var tlEl = document.createElement("div");
  tlEl.className = "gantt-row-timeline";

  // Grid lines — reuse same tick positions
  var span = totalSpan;
  var intervals = [
    60 * 1000,
    5 * 60 * 1000,
    15 * 60 * 1000,
    30 * 60 * 1000,
    3600 * 1000,
    3 * 3600 * 1000,
    6 * 3600 * 1000,
    12 * 3600 * 1000,
    86400 * 1000,
    2 * 86400 * 1000,
    7 * 86400 * 1000,
  ];
  var interval =
    intervals.find(function (iv) {
      return span / iv <= 16;
    }) || 7 * 86400 * 1000;
  var firstTick = Math.ceil(minT / interval) * interval;
  for (var ts = firstTick; ts <= minT + totalSpan; ts += interval) {
    var gl = document.createElement("div");
    gl.className = "gantt-gridline";
    gl.style.left = ((ts - minT) / totalSpan) * 100 + "%";
    tlEl.appendChild(gl);
  }

  // Bars
  row.sessions.forEach(function (session) {
    var leftPct = ((session.clampedStart - minT) / totalSpan) * 100;
    var widthPct =
      ((session.clampedEnd - session.clampedStart) / totalSpan) * 100;
    if (widthPct < 0.05) widthPct = 0.05; // always visible

    var colorKey = sessionColorKey(session);
    var color = colorMap[colorKey] || PALETTE[0];

    var bar = document.createElement("div");
    bar.className =
      "gantt-bar" + (session.isRunning ? " gantt-bar--running" : "");
    bar.style.left = leftPct + "%";
    bar.style.width = widthPct + "%";
    bar.style.background = color;
    bar.style.opacity = session.type === "manual" ? "0.7" : "1";

    // Store tooltip data
    bar.dataset.cardName = session.card.name;
    bar.dataset.listName = session.card.listName;
    bar.dataset.members =
      session.card.members
        .map(function (m) {
          return m.fullName || m.username;
        })
        .join(", ") || "Unassigned";
    bar.dataset.start = new Date(session.start).toLocaleString(
      navigator.language,
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    );
    bar.dataset.end = session.isRunning
      ? "now (running)"
      : new Date(session.end).toLocaleString(navigator.language, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
    bar.dataset.duration = fmtMs(session.end - session.start);
    bar.dataset.type = session.type;
    bar.dataset.running = session.isRunning ? "1" : "0";

    tlEl.appendChild(bar);
  });

  rowEl.appendChild(tlEl);
  return rowEl;
}

// ─────────────────────────────────────────────
// TOOLTIP
// ─────────────────────────────────────────────
function wireTooltip() {
  var tooltip = document.getElementById("tooltip");

  document.querySelectorAll(".gantt-bar").forEach(function (bar) {
    bar.addEventListener("mouseenter", function (e) {
      var running = bar.dataset.running === "1";
      tooltip.innerHTML =
        "<b>" +
        esc(bar.dataset.cardName) +
        "</b>" +
        "<span class='tt-meta'>" +
        esc(bar.dataset.listName) +
        "</span>" +
        "<span class='tt-meta'>👤 " +
        esc(bar.dataset.members) +
        "</span>" +
        "<span class='tt-meta'>▶ " +
        bar.dataset.start +
        "</span>" +
        "<span class='tt-meta'>■ " +
        bar.dataset.end +
        "</span>" +
        "<span class='tt-meta'>⏱ " +
        bar.dataset.duration +
        (bar.dataset.type === "manual" ? " (manual)" : "") +
        (running ? " 🟢 live" : "") +
        "</span>";
      tooltip.classList.remove("hidden");
      positionTooltip(e);
    });

    bar.addEventListener("mousemove", positionTooltip);

    bar.addEventListener("mouseleave", function () {
      tooltip.classList.add("hidden");
    });
  });
}

function positionTooltip(e) {
  var tooltip = document.getElementById("tooltip");
  var x = e.clientX + 14;
  var y = e.clientY + 14;
  // Keep on screen
  if (x + 270 > window.innerWidth) x = e.clientX - 275;
  if (y + 150 > window.innerHeight) y = e.clientY - 140;
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

// ─────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────
function wireControls() {
  document
    .getElementById("apply-filter")
    .addEventListener("click", function () {
      dateFrom = getPickerDate("from");
      dateTo = getPickerDate("to");
      render();
    });

  document
    .getElementById("reset-filter")
    .addEventListener("click", function () {
      document.getElementById("date-from").value = "";
      document.getElementById("date-to").value = "";
      dateFrom = null;
      dateTo = null;
      render();
    });

  document
    .getElementById("btn-group-member")
    .addEventListener("click", function () {
      groupBy = "member";
      this.classList.add("active");
      document.getElementById("btn-group-card").classList.remove("active");
      render();
    });

  document
    .getElementById("btn-group-card")
    .addEventListener("click", function () {
      groupBy = "card";
      this.classList.add("active");
      document.getElementById("btn-group-member").classList.remove("active");
      render();
    });
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function fmtMs(ms) {
  var s = Math.max(0, Math.floor(ms / 1000));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  if (h > 0 && m > 0) return h + "h " + m + "m";
  if (h > 0) return h + "h";
  if (m > 0) return m + "m";
  return s + "s";
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .slice(0, 2)
    .map(function (w) {
      return w[0];
    })
    .join("")
    .toUpperCase();
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function showLoading(show, msg) {
  document.getElementById("loading").classList.toggle("hidden", !show);
  document.getElementById("app").classList.toggle("hidden", show);
  if (msg) document.getElementById("loading-msg").textContent = msg;
}
