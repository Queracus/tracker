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
var hiddenMembers = {}; // memberKey → true when filtered out
var hideWeekends = false; // when true, weekend time is collapsed from the timeline

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
  from.setDate(from.getDate() - 8);
  setPickerDate("from", from);
  setPickerDate("to", now);
  dateFrom = from;
  dateTo = now;
}

// ─────────────────────────────────────────────
// WEEKEND COMPRESSION
// ─────────────────────────────────────────────
// When hideWeekends=true we build a mapping from real timestamps to
// "display positions" that skip Saturday/Sunday entirely.
// A "weekend block" is midnight Sat → midnight Mon (local time).

function isWeekendMs(ts) {
  var d = new Date(ts);
  var day = d.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

// Returns start-of-day (local midnight) for a timestamp
function dayStart(ts) {
  var d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Build an array of weekend blocks {start, end} (ms) within [minT, maxT]
function getWeekendBlocks(minT, maxT) {
  var blocks = [];
  // Walk day by day
  var cursor = dayStart(minT);
  while (cursor <= maxT) {
    var d = new Date(cursor);
    var day = d.getDay();
    if (day === 6) {
      // Saturday — block runs Sat 00:00 → Mon 00:00
      var blockStart = cursor;
      var blockEnd = cursor + 2 * 86400000; // +2 days = Monday midnight
      blocks.push({ start: blockStart, end: blockEnd });
      cursor = blockEnd;
    } else {
      cursor += 86400000;
    }
  }
  return blocks;
}

// Convert a real timestamp to a display-axis position in [0, displaySpan]
// by subtracting the total weekend duration that falls before ts.
function buildTimeMapper(minT, maxT) {
  if (!hideWeekends) {
    var span = maxT - minT;
    return {
      toDisplay: function (ts) {
        return ts - minT;
      },
      displaySpan: span,
      weekendBlocks: [],
    };
  }

  var blocks = getWeekendBlocks(minT, maxT);
  // Clamp blocks to [minT, maxT]
  var clampedBlocks = blocks
    .map(function (b) {
      return { start: Math.max(b.start, minT), end: Math.min(b.end, maxT) };
    })
    .filter(function (b) {
      return b.end > b.start;
    });

  var totalWeekend = clampedBlocks.reduce(function (acc, b) {
    return acc + (b.end - b.start);
  }, 0);

  var displaySpan = maxT - minT - totalWeekend;
  if (displaySpan <= 0) displaySpan = maxT - minT; // fallback: all weekend

  function toDisplay(ts) {
    var skipped = 0;
    for (var i = 0; i < clampedBlocks.length; i++) {
      var b = clampedBlocks[i];
      if (ts <= b.start) break;
      if (ts >= b.end) {
        skipped += b.end - b.start;
      } else {
        skipped += ts - b.start;
      }
    }
    return ts - minT - skipped;
  }

  return {
    toDisplay: toDisplay,
    displaySpan: displaySpan,
    weekendBlocks: clampedBlocks,
  };
}

// ─────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────
function filteredSessions() {
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
  var pad = (maxT - minT) * 0.02 || 3600000;
  minT -= pad;
  maxT += pad;

  // Build the time mapper (handles weekend compression)
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
    gh.innerHTML =
      '<span class="group-avatar" style="background:' +
      avatarColor +
      '">' +
      initials(group.label) +
      "</span>" +
      esc(group.label);
    section.appendChild(gh);

    group.rows.forEach(function (row) {
      section.appendChild(buildRow(row, minT, mapper, colorMap));
    });

    inner.appendChild(section);
  });

  applyMemberFilter();
  wireTooltip();
}

// ── Colour map ──
function cardColorKey(card) {
  if (groupBy === "card") return card.id;
  if (!card.members.length) return "__unassigned__";
  return card.members
    .map(function (m) {
      return m.id;
    })
    .sort()
    .join("+");
}
function buildColorMap(sessions) {
  var keys = [];
  sessions.forEach(function (s) {
    var key = cardColorKey(s.card);
    if (keys.indexOf(key) === -1) keys.push(key);
  });
  var map = {};
  keys.forEach(function (k, i) {
    map[k] = PALETTE[i % PALETTE.length];
  });
  return map;
}
function sessionColorKey(session) {
  return cardColorKey(session.card);
}

// ── Legend — interactive filter ──
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
    item.className = "legend-item" + (hiddenMembers[key] ? " is-off" : "");
    item.title = hiddenMembers[key] ? "Click to show" : "Click to hide";
    item.dataset.key = key;
    item.innerHTML =
      '<span class="legend-dot" style="background:' +
      colorMap[key] +
      '"></span>' +
      "<span>" +
      esc(label) +
      "</span>";

    item.addEventListener("click", function () {
      var k = this.dataset.key;
      if (hiddenMembers[k]) {
        delete hiddenMembers[k];
      } else {
        hiddenMembers[k] = true;
      }
      applyMemberFilter();
      this.classList.toggle("is-off", !!hiddenMembers[k]);
      this.title = hiddenMembers[k] ? "Click to show" : "Click to hide";
    });

    legend.appendChild(item);
  });
}

function applyMemberFilter() {
  document.querySelectorAll(".gantt-bar").forEach(function (bar) {
    var key = bar.dataset.filterKey;
    bar.style.display = key && hiddenMembers[key] ? "none" : "";
  });
  document.querySelectorAll(".gantt-group-section").forEach(function (section) {
    var anyVisible = false;
    section.querySelectorAll(".gantt-bar").forEach(function (bar) {
      if (bar.style.display !== "none") anyVisible = true;
    });
    section.style.display = anyVisible ? "" : "none";
  });
}

// ── Groups ──
function buildGroups(sessions) {
  var groupMap = {};
  var groupOrder = [];

  function memberKey(card) {
    if (!card.members.length) return "__unassigned__";
    return card.members
      .map(function (m) {
        return m.id;
      })
      .sort()
      .join("+");
  }
  function memberLabel(card) {
    if (!card.members.length) return "Unassigned";
    return card.members
      .map(function (m) {
        return m.fullName || m.username;
      })
      .join(" & ");
  }

  if (groupBy === "member") {
    sessions.forEach(function (session) {
      var memberList = session.card.members.length
        ? session.card.members
        : [{ id: "__unassigned__", fullName: "Unassigned" }];

      memberList.forEach(function (member) {
        var gKey = member.id;
        var gLabel = member.fullName || member.username || "Unassigned";

        if (!groupMap[gKey]) {
          groupMap[gKey] = {
            key: gKey,
            label: gLabel,
            colorKey: gKey,
            rowMap: {},
          };
          groupOrder.push(gKey);
        }

        var rowKey = session.card.id;
        if (!groupMap[gKey].rowMap[rowKey]) {
          groupMap[gKey].rowMap[rowKey] = {
            key: rowKey,
            label: session.card.name,
            listName: session.card.listName,
            colorKey: memberKey(session.card),
            sessions: [],
          };
        }
        var already = groupMap[gKey].rowMap[rowKey].sessions.some(function (s) {
          return s.start === session.start && s.end === session.end;
        });
        if (!already) groupMap[gKey].rowMap[rowKey].sessions.push(session);
      });
    });
  } else {
    sessions.forEach(function (session) {
      var gKey = session.card.id;
      if (!groupMap[gKey]) {
        groupMap[gKey] = {
          key: gKey,
          label: session.card.name,
          colorKey: memberKey(session.card),
          rowMap: {},
        };
        groupOrder.push(gKey);
      }
      if (!groupMap[gKey].rowMap[gKey]) {
        groupMap[gKey].rowMap[gKey] = {
          key: gKey,
          label: memberLabel(session.card),
          listName: session.card.listName,
          colorKey: memberKey(session.card),
          sessions: [],
        };
      }
      groupMap[gKey].rowMap[gKey].sessions.push(session);
    });
  }

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

  // Weekend shading bands in header
  if (hideWeekends === false) {
    // Show subtle weekend shading when weekends ARE visible
    var wBlocks = getWeekendBlocks(minT, maxT);
    wBlocks.forEach(function (b) {
      var bs = Math.max(b.start, minT);
      var be = Math.min(b.end, maxT);
      if (be <= bs) return;
      var leftPct = (mapper.toDisplay(bs) / displaySpan) * 100;
      var widthPct =
        ((mapper.toDisplay(be) - mapper.toDisplay(bs)) / displaySpan) * 100;
      var shade = document.createElement("div");
      shade.className = "gantt-weekend-shade";
      shade.style.left = leftPct + "%";
      shade.style.width = widthPct + "%";
      tl.appendChild(shade);
    });
  }

  // Tick marks
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
  var realSpan = maxT - minT;
  var interval =
    intervals.find(function (iv) {
      return realSpan / iv <= 16;
    }) || 7 * 86400 * 1000;
  var firstTick = Math.ceil(minT / interval) * interval;

  for (var ts = firstTick; ts <= maxT; ts += interval) {
    // Skip ticks that fall inside a hidden weekend block
    if (hideWeekends && isWeekendMs(ts)) continue;

    var dispPos = mapper.toDisplay(ts);
    var pct = (dispPos / displaySpan) * 100;

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
    return d.toLocaleTimeString(navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (interval < 86400000) {
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
  return d.toLocaleDateString(navigator.language, {
    month: "short",
    day: "numeric",
  });
}

// ── Row ──
function buildRow(row, minT, mapper, colorMap) {
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
  var displaySpan = mapper.displaySpan;

  // Weekend shading bands on each row
  if (!hideWeekends) {
    var maxT = minT + displaySpan; // approximate; good enough for shading
    var wBlocks = getWeekendBlocks(
      minT,
      minT + displaySpan / (1 - 0.04) + 86400000 * 2,
    );
    wBlocks.forEach(function (b) {
      var bs = Math.max(b.start, minT);
      var be = Math.min(b.end, minT + displaySpan / 0.96 + 86400000); // rough maxT
      if (be <= bs) return;
      var ld = mapper.toDisplay(bs);
      var rd = mapper.toDisplay(be);
      if (rd <= 0 || ld >= displaySpan) return;
      var leftPct = (ld / displaySpan) * 100;
      var widthPct = ((rd - ld) / displaySpan) * 100;
      var shade = document.createElement("div");
      shade.className = "gantt-weekend-shade";
      shade.style.left = leftPct + "%";
      shade.style.width = widthPct + "%";
      tlEl.appendChild(shade);
    });
  }

  // Grid lines — 2h when range ≤ 8 days, 6h up to 2 weeks, daily beyond that.
  // In 2h mode: every 4h line (midnight, 4am, 8am…) is thick, alternate ones thin.
  var rangeMs = displaySpan;
  var GRID_INTERVAL =
    rangeMs <= 8 * 86400000
      ? 2 * 3600000
      : rangeMs <= 14 * 86400000
        ? 6 * 3600000
        : 86400000;
  var firstGrid = Math.ceil(minT / GRID_INTERVAL) * GRID_INTERVAL;
  for (
    var ts = firstGrid;
    ts <= minT + displaySpan * 1.1;
    ts += GRID_INTERVAL
  ) {
    if (hideWeekends && isWeekendMs(ts)) continue;
    var dispPos = mapper.toDisplay(ts);
    var pct = (dispPos / displaySpan) * 100;
    if (pct < 0 || pct > 100) continue;
    var gl = document.createElement("div");
    // In 2h mode, mark every other line (every 4h) as thick
    var isThick =
      GRID_INTERVAL === 2 * 3600000 ? new Date(ts).getHours() % 4 !== 0 : true;
    gl.className = "gantt-gridline" + (isThick ? " gantt-gridline--thick" : "");
    gl.style.left = pct + "%";
    tlEl.appendChild(gl);
  }

  // Bars — when hiding weekends, a session that spans a weekend gets split
  row.sessions.forEach(function (session) {
    var bars = hideWeekends
      ? splitSessionAtWeekends(session)
      : [{ start: session.clampedStart, end: session.clampedEnd }];

    bars.forEach(function (seg) {
      var leftD = mapper.toDisplay(seg.start);
      var rightD = mapper.toDisplay(seg.end);
      var leftPct = (leftD / displaySpan) * 100;
      var widthPct = ((rightD - leftD) / displaySpan) * 100;
      if (widthPct < 0.05) widthPct = 0.05;

      var colorKey = sessionColorKey(session);
      var color = colorMap[colorKey] || PALETTE[0];

      var bar = document.createElement("div");
      bar.className =
        "gantt-bar" + (session.isRunning ? " gantt-bar--running" : "");
      bar.style.left = leftPct + "%";
      bar.style.width = widthPct + "%";
      bar.style.background = color;
      bar.style.opacity = session.type === "manual" ? "0.7" : "1";

      bar.dataset.filterKey = sessionColorKey(session);
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
  });

  rowEl.appendChild(tlEl);
  return rowEl;
}

// Split a session into non-weekend segments (for hideWeekends mode)
function splitSessionAtWeekends(session) {
  var segments = [];
  var cursor = session.clampedStart;
  var end = session.clampedEnd;

  while (cursor < end) {
    var d = new Date(cursor);
    var day = d.getDay();

    if (day === 6 || day === 0) {
      // Skip to next Monday midnight (or Sunday → Monday)
      var daysToMon = day === 6 ? 2 : 1;
      var nextMon = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate() + daysToMon,
      ).getTime();
      cursor = Math.min(nextMon, end);
      continue;
    }

    // Find end of this weekday stretch (next Saturday midnight)
    var daysToSat = 6 - day;
    var nextSat = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + daysToSat,
    ).getTime();
    var segEnd = Math.min(nextSat, end);

    if (segEnd > cursor) {
      segments.push({ start: cursor, end: segEnd });
    }
    cursor = segEnd;
  }

  return segments.length
    ? segments
    : [{ start: session.clampedStart, end: session.clampedEnd }];
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
      hiddenMembers = {};
      this.classList.add("active");
      document.getElementById("btn-group-card").classList.remove("active");
      render();
    });

  document
    .getElementById("btn-group-card")
    .addEventListener("click", function () {
      groupBy = "card";
      hiddenMembers = {};
      this.classList.add("active");
      document.getElementById("btn-group-member").classList.remove("active");
      render();
    });

  document
    .getElementById("btn-weekends")
    .addEventListener("click", function () {
      hideWeekends = !hideWeekends;
      this.classList.toggle("active", hideWeekends);
      this.textContent = hideWeekends ? "Weekends hidden" : "Hide weekends";
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
