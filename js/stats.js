var t = window.TrelloPowerUp.iframe();

// ── Chart instances (kept so we can destroy/re-render on filter) ──
var charts = {};

// ── Colour palette for charts ──
var PALETTE = [
  "#0079bf",
  "#61bd4f",
  "#eb5a46",
  "#f2d600",
  "#ff9f1a",
  "#c377e0",
  "#00c2e0",
  "#51e898",
  "#ff78cb",
  "#344563",
];

// ── Trello label colour map ──
var LABEL_COLORS = {
  green: "#61bd4f",
  yellow: "#f2d600",
  orange: "#ff9f1a",
  red: "#eb5a46",
  purple: "#c377e0",
  blue: "#0079bf",
  sky: "#00c2e0",
  lime: "#51e898",
  pink: "#ff78cb",
  black: "#344563",
  null: "#b3bac5",
};

// ── State ──
var allCards = []; // enriched card objects
var allMembers = {}; // id → {id, fullName, username}
var allLists = {}; // id → {id, name}
var dateFrom = null;
var dateTo = null;
var completedView = "day"; // "week" | "day"
var rangeView = "full"; // "active" | "full"

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
t.render(function () {
  var ctx = t.getContext();
  if (ctx && ctx.theme === "dark")
    document.documentElement.classList.add("dark");

  loadData();
});

// ─────────────────────────────────────────────
// DATA LOADING
// ─────────────────────────────────────────────
function loadData() {
  showLoading(true);

  Promise.all([
    t.cards(
      "id",
      "name",
      "idList",
      "members",
      "labels",
      "due",
      "dueComplete",
      "dateLastActivity",
      "start",
    ),
    t.lists("id", "name"),
    t.board("memberships"),
    t.member("id", "fullName", "username"),
  ])
    .then(function (results) {
      var cards = results[0];
      var lists = results[1];
      var boardData = results[2];
      var currentUser = results[3];

      // Build list lookup
      lists.forEach(function (l) {
        allLists[l.id] = l;
      });

      // Build member lookup from board memberships — we only get IDs here,
      // names come from card.members which includes {id, fullName, username}
      cards.forEach(function (card) {
        (card.members || []).forEach(function (m) {
          if (!allMembers[m.id]) allMembers[m.id] = m;
        });
      });

      // Fetch Power-Up data for every card in parallel (batched)
      var cardIds = cards.map(function (c) {
        return c.id;
      });
      fetchAllPowerUpData(cardIds).then(function (puDataMap) {
        allCards = cards.map(function (card) {
          var pu = puDataMap[card.id] || {};
          var timeLog = pu.timeLog || [];
          var estimated = pu.estimated || 0; // minutes
          var isRunning = pu.isRunning || false;
          var startTime = pu.startTime || 0;

          var loggedMs = timeLog.reduce(function (acc, e) {
            return (
              acc + (new Date(e.end).getTime() - new Date(e.start).getTime())
            );
          }, 0);
          if (isRunning && startTime) loggedMs += Date.now() - startTime;

          var estimatedMs = estimated * 60 * 1000;
          var pct =
            estimatedMs > 0 ? Math.round((loggedMs / estimatedMs) * 100) : null;

          // Card creation date is encoded in the Trello ID (first 4 bytes = unix seconds)
          var createdAt = new Date(
            parseInt(card.id.substring(0, 8), 16) * 1000,
          );

          return {
            id: card.id,
            name: card.name,
            idList: card.idList,
            listName: (allLists[card.idList] || {}).name || "Unknown",
            members: card.members || [],
            labels: card.labels || [],
            due: card.due ? new Date(card.due) : null,
            dueComplete: card.dueComplete || false,
            dateLastActivity: card.dateLastActivity
              ? new Date(card.dateLastActivity)
              : null,
            createdAt: createdAt,
            // Power-Up data
            timeLog: timeLog,
            estimated: estimated, // minutes
            estimatedMs: estimatedMs,
            loggedMs: loggedMs,
            loggedH: loggedMs / 3600000,
            pct: pct,
            isOver: pct !== null && pct > 100,
            hasLog: loggedMs > 0,
            isRunning: isRunning,
            startTime: startTime,
          };
        });

        showLoading(false);
        initDateDefaults();
        buildUI();
        wireControls();
        initResizeObserver();
      });
    })
    .catch(function (err) {
      console.error("Stats load error:", err);
      showLoading(false);
    });
}

// Fetch Power-Up data for all cards — batched to avoid overwhelming Trello
function fetchAllPowerUpData(cardIds) {
  var result = {};
  var BATCH = 20;
  var batches = [];
  for (var i = 0; i < cardIds.length; i += BATCH) {
    batches.push(cardIds.slice(i, i + BATCH));
  }
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
// FILTER
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// DATE PICKER HELPERS — native <input type="date">
// ─────────────────────────────────────────────
function setPickerDate(id, date) {
  document.getElementById("date-" + id).value = toInputDate(date);
}

function getPickerDate(id) {
  var val = document.getElementById("date-" + id).value;
  if (!val) return null;
  var parts = val.split("-");
  return new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10),
  );
}

function clearPicker(id) {
  document.getElementById("date-" + id).value = "";
}

function initDateDefaults() {
  var now = new Date();
  var from = new Date(now);
  from.setDate(from.getDate() - 21);
  setPickerDate("from", from);
  setPickerDate("to", now);
  dateFrom = from;
  dateTo = now;
}

function readDates() {
  dateFrom = getPickerDate("from");
  dateTo = getPickerDate("to");
  if (dateTo) dateTo.setHours(23, 59, 59, 999);
}

function filteredCards() {
  return allCards.filter(function (card) {
    // Filter by when the card was last active (catches completion date via your automation)
    var ref = card.due || card.dateLastActivity || card.createdAt;
    if (dateFrom && ref && ref < dateFrom) return false;
    if (dateTo && ref && ref > dateTo) return false;
    return true;
  });
}

// Returns logged milliseconds for a card, counting only time log entries
// whose start falls within the active date filter range.
function filteredLoggedMs(card) {
  var from = dateFrom ? dateFrom.getTime() : null;
  var to = dateTo ? dateTo.getTime() : null;
  var ms = card.timeLog.reduce(function (acc, e) {
    var entryStart = new Date(e.start).getTime();
    if (from && entryStart < from) return acc;
    if (to && entryStart > to) return acc;
    return acc + (new Date(e.end).getTime() - entryStart);
  }, 0);
  // Add currently-running timer if its start is in range
  if (card.isRunning && card.startTime) {
    var st = card.startTime;
    if ((!from || st >= from) && (!to || st <= to)) {
      ms += Date.now() - st;
    }
  }
  return ms;
}

// ─────────────────────────────────────────────
// UI BUILD
// ─────────────────────────────────────────────
function buildUI() {
  var cards = filteredCards();
  renderSummary(cards);
  renderChartByList(cards);
  renderLabelSection(cards);
  renderCardsOverTime(cards);
  renderMemberSection(cards);
  renderCardsPerList(cards);
  renderCardTable(cards);
}

// ── Summary ──
function renderSummary(cards) {
  var done = cards.filter(function (c) {
    return c.dueComplete;
  }).length;
  var totalH = cards.reduce(function (a, c) {
    return a + filteredLoggedMs(c) / 3600000;
  }, 0);
  var withLog = cards.filter(function (c) {
    return filteredLoggedMs(c) > 0;
  });
  var avgH = withLog.length > 0 ? totalH / withLog.length : 0;
  var over = cards.filter(function (c) {
    var fms = filteredLoggedMs(c);
    return c.estimatedMs > 0 && fms > c.estimatedMs;
  }).length;
  var noLog = cards.filter(function (c) {
    return filteredLoggedMs(c) === 0;
  }).length;

  set("stat-total-cards", cards.length);
  set("stat-done-cards", done);
  set("stat-total-hours", fmtH(totalH));
  set("stat-avg-hours", fmtH(avgH));
  set("stat-over-estimate", over);
  set("stat-no-log", noLog);
}

// ── Chart: Hours by List ──
function renderChartByList(cards) {
  var map = {};
  cards.forEach(function (c) {
    if (!map[c.listName]) map[c.listName] = 0;
    map[c.listName] += filteredLoggedMs(c) / 3600000;
  });
  var labels = Object.keys(map);
  var data = labels.map(function (l) {
    return +map[l].toFixed(2);
  });
  renderBarChart("chart-by-list", labels, data, "Hours");
}

// ── Chart: Cards Created / Assigned / Completed over time (3 traces) ──
function renderCardsOverTime(cards) {
  var created = {},
    completed = {},
    assigned = {};

  // Helper: check a date is within the active filter range
  function inRange(d) {
    if (!d) return false;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  cards.forEach(function (c) {
    // Created — only plot if createdAt is within the filter range
    if (inRange(c.createdAt)) {
      var keyC =
        completedView === "day"
          ? toInputDate(c.createdAt)
          : weekLabel(c.createdAt);
      created[keyC] = (created[keyC] || 0) + 1;
    }

    // Completed — only plot if due date is within the filter range
    if (c.dueComplete && c.due && inRange(c.due)) {
      var keyD =
        completedView === "day" ? toInputDate(c.due) : weekLabel(c.due);
      completed[keyD] = (completed[keyD] || 0) + 1;
    }

    // Assigned — same date anchor as Created, same range check
    if (c.members.length > 0 && inRange(c.createdAt)) {
      var keyA =
        completedView === "day"
          ? toInputDate(c.createdAt)
          : weekLabel(c.createdAt);
      assigned[keyA] = (assigned[keyA] || 0) + 1;
    }
  });

  var allKeys = Object.keys(created)
    .concat(Object.keys(completed))
    .concat(Object.keys(assigned));

  var allDates;
  if (allKeys.length === 0) {
    allDates = [];
  } else if (rangeView === "active") {
    // Only days/weeks where something happened
    allDates = Array.from(new Set(allKeys)).sort();
  } else {
    // Full: every day (or week) from dateFrom (or first event) to dateTo (or last event)
    allKeys.sort();
    var rangeStart = dateFrom ? new Date(dateFrom) : new Date(allKeys[0]);
    var rangeEnd = dateTo
      ? new Date(dateTo)
      : new Date(allKeys[allKeys.length - 1]);
    allDates = [];
    var cur = new Date(rangeStart);
    var step = completedView === "day" ? 1 : 7;
    while (cur <= rangeEnd) {
      allDates.push(toInputDate(cur));
      cur.setDate(cur.getDate() + step);
    }
    if (completedView === "week") {
      allDates = Array.from(
        new Set(
          allDates.map(function (d) {
            return weekLabel(new Date(d));
          }),
        ),
      ).sort();
    }
  }

  var createdData = allDates.map(function (d) {
    return created[d] || 0;
  });
  var completedData = allDates.map(function (d) {
    return completed[d] || 0;
  });
  var assignedData = allDates.map(function (d) {
    return assigned[d] || 0;
  });

  destroyChart("chart-cards-over-time");
  var ctx = document.getElementById("chart-cards-over-time").getContext("2d");
  charts["chart-cards-over-time"] = new Chart(ctx, {
    type: "line",
    data: {
      labels: allDates,
      datasets: [
        {
          label: "Created",
          data: createdData,
          borderColor: PALETTE[0],
          backgroundColor: PALETTE[0] + "22",
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: PALETTE[0],
        },
        {
          label: "Assigned",
          data: assignedData,
          borderColor: PALETTE[4],
          backgroundColor: PALETTE[4] + "22",
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: PALETTE[4],
        },
        {
          label: "Completed",
          data: completedData,
          borderColor: PALETTE[1],
          backgroundColor: PALETTE[1] + "22",
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: PALETTE[1],
        },
      ],
    },
    options: (function () {
      var opts = baseChartOptions("Cards");
      opts.plugins.legend = {
        display: true,
        labels: { color: legendColor, font: { size: 11 } },
      };
      return opts;
    })(),
  });
}

// ── Member section ──
function renderMemberSection(cards) {
  var members = {};

  cards.forEach(function (card) {
    if (card.members.length === 0) {
      var key = "__unassigned__";
      if (!members[key])
        members[key] = {
          name: "Unassigned",
          cards: 0,
          done: 0,
          loggedMs: 0,
          estimatedMs: 0,
          over: 0,
        };
      members[key].cards++;
      if (card.dueComplete) members[key].done++;
      members[key].loggedMs += filteredLoggedMs(card);
      members[key].estimatedMs += card.estimatedMs;
      if (card.isOver) members[key].over++;
      return;
    }
    card.members.forEach(function (m) {
      if (!members[m.id])
        members[m.id] = {
          name: m.fullName || m.username || m.id,
          cards: 0,
          done: 0,
          loggedMs: 0,
          estimatedMs: 0,
          over: 0,
        };
      members[m.id].cards++;
      if (card.dueComplete) members[m.id].done++;
      members[m.id].loggedMs += filteredLoggedMs(card) / card.members.length;
      members[m.id].estimatedMs += card.estimatedMs / card.members.length;
      if (card.isOver) members[m.id].over++;
    });
  });

  var keys = Object.keys(members);
  var labels = keys.map(function (k) {
    return members[k].name;
  });
  var hours = keys.map(function (k) {
    return +(members[k].loggedMs / 3600000).toFixed(2);
  });
  var assigned = keys.map(function (k) {
    return members[k].cards;
  });
  var completed = keys.map(function (k) {
    return members[k].done;
  });

  renderBarChart("chart-member-hours", labels, hours, "Hours");
  renderGroupedBarChart(
    "chart-member-cards",
    labels,
    [
      { label: "Assigned", data: assigned, color: PALETTE[0] },
      { label: "Completed", data: completed, color: PALETTE[1] },
    ],
    "Cards",
  );

  // Table
  var tbody = document.getElementById("member-table-body");
  tbody.innerHTML = "";
  keys.forEach(function (k) {
    var m = members[k];
    var avg = m.cards > 0 ? m.loggedMs / 3600000 / m.cards : 0;
    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td><span class='member-avatar'>" +
      "<span class='avatar-circle'>" +
      initials(m.name) +
      "</span>" +
      m.name +
      "</span></td>" +
      "<td>" +
      m.cards +
      "</td>" +
      "<td class='badge-done'>" +
      m.done +
      "</td>" +
      "<td>" +
      fmtH(m.loggedMs / 3600000) +
      "</td>" +
      "<td>" +
      fmtH(avg) +
      "</td>" +
      "<td class='" +
      (m.over > 0 ? "badge-over" : "badge-ok") +
      "'>" +
      m.over +
      "</td>";
    tbody.appendChild(tr);
  });
}

// ── Chart: Cards per List (open vs completed) ──
function renderCardsPerList(cards) {
  var map = {};
  cards.forEach(function (card) {
    var name = card.listName;
    if (!map[name]) map[name] = { open: 0, done: 0 };
    if (card.dueComplete) map[name].done++;
    else map[name].open++;
  });
  var labels = Object.keys(map);
  var open = labels.map(function (l) {
    return map[l].open;
  });
  var done = labels.map(function (l) {
    return map[l].done;
  });
  renderGroupedBarChart(
    "chart-cards-per-list",
    labels,
    [
      { label: "Open", data: open, color: PALETTE[0] },
      { label: "Completed", data: done, color: PALETTE[1] },
    ],
    "Cards",
  );
}

// ── Label section ──
function renderLabelSection(cards) {
  var map = {};
  cards.forEach(function (card) {
    if (card.labels.length === 0) {
      var k = "__none__";
      if (!map[k]) map[k] = { name: "No label", color: null, loggedMs: 0 };
      map[k].loggedMs += filteredLoggedMs(card);
      return;
    }
    card.labels.forEach(function (lbl) {
      var k = lbl.id;
      if (!map[k])
        map[k] = {
          name: lbl.name || lbl.color || "Label",
          color: lbl.color,
          loggedMs: 0,
        };
      map[k].loggedMs += filteredLoggedMs(card) / card.labels.length;
    });
  });

  var keys = Object.keys(map);
  var labels = keys.map(function (k) {
    return map[k].name;
  });
  var hours = keys.map(function (k) {
    return +(map[k].loggedMs / 3600000).toFixed(2);
  });
  var colors = keys.map(function (k) {
    return LABEL_COLORS[map[k].color] || PALETTE[0];
  });

  renderBarChart("chart-label-hours", labels, hours, "Hours", colors);
}

// ── Card table ──
function renderCardTable(cards) {
  var tbody = document.getElementById("card-table-body");
  tbody.innerHTML = "";

  var sorted = cards.slice().sort(function (a, b) {
    return b.loggedMs - a.loggedMs;
  });

  sorted.forEach(function (card) {
    var memberNames =
      card.members
        .map(function (m) {
          return m.fullName || m.username;
        })
        .join(", ") || "—";
    var estH = card.estimatedMs > 0 ? fmtH(card.estimatedMs / 3600000) : "—";
    var fms = filteredLoggedMs(card);
    var logH =
      fms > 0 ? fmtH(fms / 3600000) : '<span class="text-muted">—</span>';
    var fpct =
      card.estimatedMs > 0 ? Math.round((fms / card.estimatedMs) * 100) : null;
    var fOver = fpct !== null && fpct > 100;
    var pct =
      fpct !== null
        ? '<span class="' +
          (fOver ? "badge-over" : "badge-ok") +
          '">' +
          fpct +
          "%</span>"
        : "—";
    var done = card.dueComplete
      ? '<span class="badge-done">✓</span>'
      : '<span class="text-muted">–</span>';
    var comp = card.due
      ? fmtDate(card.due)
      : '<span class="text-muted">—</span>';

    var tr = document.createElement("tr");
    tr.innerHTML =
      "<td>" +
      esc(card.name) +
      "</td>" +
      "<td>" +
      esc(card.listName) +
      "</td>" +
      "<td>" +
      esc(memberNames) +
      "</td>" +
      "<td>" +
      estH +
      "</td>" +
      "<td>" +
      logH +
      "</td>" +
      "<td>" +
      pct +
      "</td>" +
      "<td style='text-align:center'>" +
      done +
      "</td>" +
      "<td>" +
      comp +
      "</td>";
    tbody.appendChild(tr);
  });
}

// ─────────────────────────────────────────────
// CHART HELPERS
// ─────────────────────────────────────────────
var isDark = document.documentElement.classList.contains("dark");
var gridColor = isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)";
var tickColor = isDark ? "#9fadbc" : "#5e6c84";
var legendColor = isDark ? "#9fadbc" : "#5e6c84";

function baseChartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: "index", intersect: false },
    },
    scales: {
      x: {
        ticks: { color: tickColor, font: { size: 11 }, maxRotation: 35 },
        grid: { color: gridColor },
      },
      y: {
        beginAtZero: true,
        ticks: { color: tickColor, font: { size: 11 } },
        grid: { color: gridColor },
        title: {
          display: !!yLabel,
          text: yLabel,
          color: tickColor,
          font: { size: 11 },
        },
      },
    },
  };
}

function renderBarChart(canvasId, labels, data, yLabel, colorOverrides) {
  destroyChart(canvasId);
  var colors =
    colorOverrides ||
    labels.map(function (_, i) {
      return PALETTE[i % PALETTE.length];
    });
  var ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors.map(function (c) {
            return c + "cc";
          }),
          borderColor: colors,
          borderWidth: 1.5,
          borderRadius: 4,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
      ],
    },
    options: baseChartOptions(yLabel),
  });
}

function renderLineChart(canvasId, labels, data, yLabel) {
  destroyChart(canvasId);
  var ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          borderColor: PALETTE[0],
          backgroundColor: PALETTE[0] + "22",
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: PALETTE[0],
        },
      ],
    },
    options: baseChartOptions(yLabel),
  });
}

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

// datasets: [{ label, data, color }, ...]
function renderGroupedBarChart(canvasId, labels, datasets, yLabel) {
  destroyChart(canvasId);
  var ctx = document.getElementById(canvasId).getContext("2d");
  charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: datasets.map(function (ds) {
        return {
          label: ds.label,
          data: ds.data,
          backgroundColor: ds.color + "cc",
          borderColor: ds.color,
          borderWidth: 1.5,
          borderRadius: 4,
          barPercentage: 0.75,
          categoryPercentage: 0.8,
        };
      }),
    },
    options: (function () {
      var opts = baseChartOptions(yLabel);
      opts.plugins.legend = {
        display: true,
        labels: { color: legendColor, font: { size: 11 } },
      };
      return opts;
    })(),
  });
}

// ─────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────
function wireControls() {
  document
    .getElementById("apply-filter")
    .addEventListener("click", function () {
      readDates();
      buildUI();
    });

  document
    .getElementById("reset-filter")
    .addEventListener("click", function () {
      clearPicker("from");
      clearPicker("to");
      dateFrom = null;
      dateTo = null;
      buildUI();
    });

  document.getElementById("export-csv").addEventListener("click", exportCSV);

  document
    .getElementById("btn-range-active")
    .addEventListener("click", function () {
      rangeView = "active";
      this.classList.add("active");
      document.getElementById("btn-range-full").classList.remove("active");
      renderCardsOverTime(filteredCards());
      requestAnimationFrame(function () {
        if (charts["chart-cards-over-time"])
          charts["chart-cards-over-time"].resize();
      });
    });

  document
    .getElementById("btn-range-full")
    .addEventListener("click", function () {
      rangeView = "full";
      this.classList.add("active");
      document.getElementById("btn-range-active").classList.remove("active");
      renderCardsOverTime(filteredCards());
      requestAnimationFrame(function () {
        if (charts["chart-cards-over-time"])
          charts["chart-cards-over-time"].resize();
      });
    });

  document
    .getElementById("btn-per-week")
    .addEventListener("click", function () {
      completedView = "week";
      this.classList.add("active");
      document.getElementById("btn-per-day").classList.remove("active");
      renderCardsOverTime(filteredCards());
      requestAnimationFrame(function () {
        if (charts["chart-cards-over-time"])
          charts["chart-cards-over-time"].resize();
      });
    });

  document.getElementById("btn-per-day").addEventListener("click", function () {
    completedView = "day";
    this.classList.add("active");
    document.getElementById("btn-per-week").classList.remove("active");
    renderCardsOverTime(filteredCards());
    requestAnimationFrame(function () {
      if (charts["chart-cards-over-time"])
        charts["chart-cards-over-time"].resize();
    });
  });
}

// ─────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────
function exportCSV() {
  var cards = filteredCards();
  var rows = [
    [
      "Card",
      "List",
      "Members",
      "Labels",
      "Estimated (h)",
      "Logged (h)",
      "%",
      "Done",
      "Completed Date",
      "Created Date",
    ],
  ];
  cards.forEach(function (card) {
    rows.push([
      card.name,
      card.listName,
      card.members
        .map(function (m) {
          return m.fullName || m.username;
        })
        .join("; "),
      card.labels
        .map(function (l) {
          return l.name || l.color;
        })
        .join("; "),
      card.estimatedMs > 0 ? (card.estimatedMs / 3600000).toFixed(2) : "",
      card.hasLog ? card.loggedH.toFixed(2) : "",
      card.pct !== null ? card.pct : "",
      card.dueComplete ? "Yes" : "No",
      card.due ? fmtDate(card.due) : "",
      fmtDate(card.createdAt),
    ]);
  });

  var csv = rows
    .map(function (r) {
      return r.map(csvCell).join(",");
    })
    .join("\n");
  var blob = new Blob([csv], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "trello-stats-" + toInputDate(new Date()) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
function fmtH(h) {
  if (h < 0.017) return "0m";
  var hrs = Math.floor(h);
  var mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return mins + "m";
  if (mins === 0) return hrs + "h";
  return hrs + "h " + mins + "m";
}

function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString(navigator.language, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function toInputDate(d) {
  return d.toISOString().slice(0, 10);
}

function weekLabel(d) {
  var dd = new Date(d);
  var day = dd.getDay();
  var diff = dd.getDate() - day + (day === 0 ? -6 : 1);
  dd.setDate(diff);
  return toInputDate(dd);
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

function csvCell(v) {
  var s = String(v == null ? "" : v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function set(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

function showLoading(show) {
  document.getElementById("loading").classList.toggle("hidden", !show);
  document.getElementById("app").classList.toggle("hidden", show);
}

// ─────────────────────────────────────────────
// RESPONSIVE GRID — ResizeObserver
// ─────────────────────────────────────────────
function getColCount(width) {
  if (width >= 1400) return 4;
  if (width >= 1000) return 3;
  if (width >= 620) return 2;
  return 1;
}

function applyColCount(app) {
  if (app.offsetWidth === 0) return; // Not laid out yet, skip
  var cols = getColCount(app.offsetWidth);
  var prev = app.dataset.cols;
  if (prev === String(cols)) return;
  app.dataset.cols = cols;

  // chart grids and tables-grid column layout is handled entirely by CSS
  // auto-fit minmax — no JS needed there.

  // Summary grid: scale the 6 stat cards based on available width
  var summaryEl = document.getElementById("summary-grid");
  if (summaryEl) {
    if (cols >= 3) summaryEl.style.gridTemplateColumns = "repeat(6, 1fr)";
    else if (cols === 2) summaryEl.style.gridTemplateColumns = "repeat(3, 1fr)";
    else summaryEl.style.gridTemplateColumns = "repeat(2, 1fr)";
  }

  // Tell Chart.js to redraw at new width
  setTimeout(function () {
    Object.keys(charts).forEach(function (id) {
      if (charts[id]) charts[id].resize();
    });
  }, 50);
}

function initResizeObserver() {
  var app = document.getElementById("app");

  // Trello modal iframes often report 0 width on first paint.
  // Poll until we get a real width, then set up the observer.
  function tryApply() {
    if (app.offsetWidth > 0) {
      applyColCount(app);
    } else {
      // Not laid out yet — try again next frame
      requestAnimationFrame(tryApply);
    }
  }
  tryApply();

  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      applyColCount(app);
    });
    ro.observe(app);
  }
}
