var t = window.TrelloPowerUp.iframe();

// UI Elements
var startBtn = document.getElementById("start-btn");
var stopBtn = document.getElementById("stop-btn");
var resetBtn = document.getElementById("reset-btn");
var estimatedInput = document.getElementById("estimated-time");
var elapsedDisplay = document.getElementById("elapsed-time");
var progressText = document.getElementById("progress-text");
var progressSlider = document.getElementById("progress-slider");
var addManualBtn = document.getElementById("add-manual-btn");
var toggleLogBtn = document.getElementById("toggle-log-btn");
var logContainer = document.getElementById("time-log-container");
var toggleManualBtn = document.getElementById("toggle-manual-btn");
var manualEntryBody = document.getElementById("manual-entry-body");
var estimatedHint = document.getElementById("estimated-hint");
var durationPreview = document.getElementById("manual-duration-preview");

// ── Build hour/minute dropdowns ──
function buildSelects() {
  var hours = [
    document.getElementById("start-hour-manual"),
    document.getElementById("end-hour-manual"),
  ];
  var mins = [
    document.getElementById("start-min-manual"),
    document.getElementById("end-min-manual"),
  ];
  hours.forEach(function (sel) {
    for (var h = 0; h < 24; h++) {
      var o = document.createElement("option");
      o.value = h;
      o.textContent = String(h).padStart(2, "0");
      sel.appendChild(o);
    }
  });
  mins.forEach(function (sel) {
    for (var m = 0; m < 60; m += 5) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = String(m).padStart(2, "0");
      sel.appendChild(o);
    }
  });
}
buildSelects();

// Pre-fill date fields and sensible hour defaults to today
function prefillManualFields() {
  var now = new Date();
  var today = now.toISOString().slice(0, 10);
  var startDateEl = document.getElementById("start-date-manual");
  var endDateEl = document.getElementById("end-date-manual");
  var startHourEl = document.getElementById("start-hour-manual");
  var endHourEl = document.getElementById("end-hour-manual");
  var startMinEl = document.getElementById("start-min-manual");
  var endMinEl = document.getElementById("end-min-manual");
  if (!startDateEl.value) {
    startDateEl.value = today;
    endDateEl.value = today;
    // Round down to nearest 5-min for end, 1h before for start
    var endM = Math.floor(now.getMinutes() / 5) * 5;
    var startH = now.getHours() > 0 ? now.getHours() - 1 : 0;
    startHourEl.value = startH;
    startMinEl.value = endM;
    endHourEl.value = now.getHours();
    endMinEl.value = endM;
  }
}

function getManualDateTime(dateId, hourId, minId) {
  var d = document.getElementById(dateId).value;
  var h = document.getElementById(hourId).value;
  var m = document.getElementById(minId).value;
  if (!d) return null;
  var dt = new Date(d);
  dt.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
  return dt;
}

function updateDurationPreview() {
  var start = getManualDateTime(
    "start-date-manual",
    "start-hour-manual",
    "start-min-manual",
  );
  var end = getManualDateTime(
    "end-date-manual",
    "end-hour-manual",
    "end-min-manual",
  );
  if (start && end && end > start) {
    var ms = end - start;
    var totalMins = Math.floor(ms / 60000);
    var h = Math.floor(totalMins / 60);
    var m = totalMins % 60;
    var label = (h > 0 ? h + "h " : "") + (m > 0 ? m + "m" : "");
    durationPreview.textContent = "Duration: " + label;
    durationPreview.className = "duration-preview preview-ok";
  } else if (start && end && end <= start) {
    durationPreview.textContent = "End must be after start";
    durationPreview.className = "duration-preview preview-err";
  } else {
    durationPreview.textContent = "";
    durationPreview.className = "duration-preview";
  }
  t.sizeTo("body");
}

[
  "start-date-manual",
  "start-hour-manual",
  "start-min-manual",
  "end-date-manual",
  "end-hour-manual",
  "end-min-manual",
].forEach(function (id) {
  document.getElementById(id).addEventListener("change", updateDurationPreview);
});

var timerInterval;

// ── Duration string parser ──
// Accepts: "1d4h", "1h30m", "90m", "2h", "45", "1d", "1d 4h 30m", etc.
// Always stores as total minutes (integer) — same as before.
function parseDuration(str) {
  if (!str || !str.trim()) return 0;
  var s = str.trim().toLowerCase();

  // Pure number → treat as minutes
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  var days = 0,
    hours = 0,
    mins = 0;
  var d = s.match(/(\d+)\s*d/);
  var h = s.match(/(\d+)\s*h/);
  var m = s.match(/(\d+)\s*m/);
  if (d) days = parseInt(d[1], 10);
  if (h) hours = parseInt(h[1], 10);
  if (m) mins = parseInt(m[1], 10);

  if (!d && !h && !m) return 0; // unrecognised format
  return days * 1440 + hours * 60 + mins;
}

// Format stored minutes back to a human string for display in the input
function minutesToDisplay(mins) {
  if (!mins || mins <= 0) return "";
  var d = Math.floor(mins / 1440);
  var h = Math.floor((mins % 1440) / 60);
  var m = mins % 60;
  var parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m) parts.push(m + "m");
  return parts.join(" ");
}

// Format elapsed time progressively — only show units that are non-zero
// e.g. 15s → 2min 15s → 1h 2min 15s → 3d 1h 2min 15s
function formatTime(ms) {
  var safeMs = Math.max(0, ms);
  var totalSeconds = Math.floor(safeMs / 1000);
  var days = Math.floor(totalSeconds / 86400);
  var hours = Math.floor((totalSeconds % 86400) / 3600);
  var minutes = Math.floor((totalSeconds % 3600) / 60);
  var seconds = totalSeconds % 60;

  var parts = [];
  if (days > 0) parts.push(days + "d");
  if (hours > 0) parts.push(hours + "h");
  if (minutes > 0) parts.push(minutes + "min");
  parts.push(seconds + "s");
  return parts.join(" ");
}

function styleSlider(percentage) {
  var isDark = document.body.classList.contains("dark-mode");
  var fillColor = percentage > 100 ? "#eb5a46" : "#61bd4f";
  var bgColor = isDark ? "#41474d" : "#dfe1e6";
  var fillPercentage = Math.min(percentage, 100);
  progressSlider.style.background = `linear-gradient(to right, ${fillColor} ${fillPercentage}%, ${bgColor} ${fillPercentage}%)`;
}

function formatLogDate(isoString) {
  if (!isoString) return "N/A";
  return new Date(isoString).toLocaleString(navigator.language, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function millisecondsToHms(ms) {
  var secs = Math.floor(Math.max(0, ms) / 1000);
  var hrs = Math.floor(secs / 3600);
  secs %= 3600;
  var mins = Math.floor(secs / 60);
  return `${hrs}h ${mins}m`;
}

// Returns a promise that resolves to true if the current member is a board admin
function checkIsAdmin() {
  return Promise.all([t.board("memberships"), t.member("id")]).then(
    function (results) {
      var memberships = results[0].memberships || [];
      var memberId = results[1].id;
      var mine = memberships.find(function (m) {
        return m.idMember === memberId;
      });
      return !!(mine && mine.memberType === "admin");
    },
  );
}

// Renders the entire UI
function render() {
  return Promise.all([t.getAll(), checkIsAdmin()]).then(function (results) {
    var cardData = results[0].card?.shared || {};
    var isAdmin = results[1];

    // Admin-only controls
    estimatedInput.disabled = !isAdmin;
    resetBtn.disabled = !isAdmin;

    // Hide the time log toggle entirely from non-admins
    toggleLogBtn.style.display = isAdmin ? "" : "none";
    if (!isAdmin) {
      logContainer.classList.add("hidden");
    }

    var estimated = cardData.estimated || 0;
    var timeLog = cardData.timeLog || [];
    var isRunning = cardData.isRunning || false;
    var startTime = cardData.startTime || 0;

    var totalElapsed = timeLog.reduce(
      (acc, entry) =>
        acc + (new Date(entry.end).getTime() - new Date(entry.start).getTime()),
      0,
    );

    if (isRunning) {
      totalElapsed += Date.now() - startTime;
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
    } else {
      startBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
    }

    // Show human-readable string; don't overwrite while user is typing
    if (document.activeElement !== estimatedInput) {
      estimatedInput.value = minutesToDisplay(estimated);
    }
    estimatedInput.classList.remove("input-error", "input-ok");
    estimatedHint.textContent = "";
    estimatedHint.className = "estimated-hint";
    elapsedDisplay.innerText = formatTime(totalElapsed);

    var estimatedMs = estimated * 60 * 1000;
    var percentage =
      estimatedMs > 0 ? Math.floor((totalElapsed / estimatedMs) * 100) : 0;

    progressText.innerText = percentage + "%";
    progressSlider.value = Math.min(percentage, 100);
    styleSlider(percentage);
    progressSlider.disabled = true;

    // Only populate log for admins
    if (isAdmin) {
      logContainer.innerHTML = "";
      if (timeLog.length === 0) {
        logContainer.innerHTML = "<p>No time entries yet.</p>";
      } else {
        // Render newest-first but track original index for deletion
        timeLog
          .slice()
          .reverse()
          .forEach((entry, reversedIdx) => {
            var originalIdx = timeLog.length - 1 - reversedIdx;
            var durationMs =
              new Date(entry.end).getTime() - new Date(entry.start).getTime();
            var entryEl = document.createElement("div");
            entryEl.className = "log-entry";
            entryEl.innerHTML = `
              <div class="log-entry-header">
                <span class="log-duration">${millisecondsToHms(durationMs)} (${entry.type})</span>
                <button class="log-delete-btn" data-idx="${originalIdx}" title="Delete this entry">✕</button>
              </div>
              <span>Start: ${formatLogDate(entry.start)}</span>
              <span>End: ${formatLogDate(entry.end)}</span>
            `;
            logContainer.appendChild(entryEl);
          });

        // Attach delete handlers after DOM is built
        logContainer.querySelectorAll(".log-delete-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var idx = parseInt(this.getAttribute("data-idx"), 10);
            t.get("card", "shared", "timeLog").then(function (log) {
              var updated = (log || []).filter(function (_, i) { return i !== idx; });
              t.set("card", "shared", "timeLog", updated).then(render);
            });
          });
        });
      }
    }
  });
}

// EVENT LISTENERS

// Live feedback while typing
estimatedInput.addEventListener("input", function () {
  var raw = this.value.trim();
  if (!raw) {
    this.classList.remove("input-error", "input-ok");
    estimatedHint.textContent = "";
    estimatedHint.className = "estimated-hint";
    return;
  }
  var mins = parseDuration(raw);
  if (mins > 0) {
    this.classList.remove("input-error");
    this.classList.add("input-ok");
    estimatedHint.textContent = minutesToDisplay(mins);
    estimatedHint.className = "estimated-hint hint-ok";
  } else {
    this.classList.remove("input-ok");
    this.classList.add("input-error");
    estimatedHint.textContent = "e.g. 1h30m, 2d, 90m";
    estimatedHint.className = "estimated-hint hint-error";
  }
  t.sizeTo("body");
});

// Save on blur or Enter
function saveEstimate() {
  var mins = parseDuration(estimatedInput.value);
  if (mins > 0 || estimatedInput.value.trim() === "") {
    t.set("card", "shared", "estimated", mins).then(render);
  }
}
estimatedInput.addEventListener("change", saveEstimate);
estimatedInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    this.blur();
  }
});

startBtn.addEventListener("click", function () {
  t.set("card", "shared", { isRunning: true, startTime: Date.now() }).then(
    () => {
      startTimerLoop();
      render();
    },
  );
});

stopBtn.addEventListener("click", function () {
  t.get("card", "shared").then(function (cardData) {
    var log = cardData.timeLog || [];
    log.push({
      start: new Date(cardData.startTime).toISOString(),
      end: new Date().toISOString(),
      type: "timer",
    });
    t.set("card", "shared", {
      isRunning: false,
      startTime: 0,
      timeLog: log,
    }).then(() => {
      stopTimerLoop();
      render();
    });
  });
});

resetBtn.addEventListener("click", function () {
  // Double-check admin status server-side before executing reset
  checkIsAdmin().then(function (isAdmin) {
    if (!isAdmin) {
      t.alert({
        message: "Only board admins can reset the tracker.",
        duration: 4,
        display: "error",
      });
      return;
    }
    t.set("card", "shared", {
      isRunning: false,
      startTime: 0,
      timeLog: [],
    }).then(() => {
      stopTimerLoop();
      render();
    });
  });
});

// Manual Log Entry
addManualBtn.addEventListener("click", function () {
  var startVal = getManualDateTime(
    "start-date-manual",
    "start-hour-manual",
    "start-min-manual",
  );
  var endVal = getManualDateTime(
    "end-date-manual",
    "end-hour-manual",
    "end-min-manual",
  );

  if (!startVal || !endVal || endVal <= startVal) {
    t.alert({
      message: "End time must be after start time.",
      duration: 4,
      display: "error",
    });
    return;
  }

  t.get("card", "shared", "timeLog").then(function (log) {
    var timeLog = log || [];
    timeLog.push({
      start: startVal.toISOString(),
      end: endVal.toISOString(),
      type: "manual",
    });
    t.set("card", "shared", "timeLog", timeLog).then(() => {
      // Reset fields
      document.getElementById("start-date-manual").value = "";
      document.getElementById("end-date-manual").value = "";
      durationPreview.textContent = "";
      durationPreview.className = "duration-preview";
      render();
      t.alert({
        message: "Manual time entry added!",
        duration: 3,
        display: "success",
      });
    });
  });
});

toggleLogBtn.addEventListener("click", function () {
  var isHidden = logContainer.classList.toggle("hidden");
  toggleLogBtn.innerText = isHidden ? "Show Time Log" : "Hide Time Log";
  t.sizeTo("body");
});

// Collapsible manual entry
toggleManualBtn.addEventListener("click", function () {
  var isHidden = manualEntryBody.classList.toggle("hidden");
  var arrow = toggleManualBtn.querySelector(".toggle-arrow");
  if (arrow) arrow.classList.toggle("open", !isHidden);
  if (!isHidden) prefillManualFields();
  t.sizeTo("body");
});

// Timer Loop
function startTimerLoop() {
  if (!timerInterval) {
    timerInterval = setInterval(render, 1000);
  }
}
function stopTimerLoop() {
  clearInterval(timerInterval);
  timerInterval = null;
}

t.render(function () {
  var context = t.getContext();
  if (context && context.theme === "dark")
    document.body.classList.add("dark-mode");

  t.get("card", "shared", "isRunning").then((isRunning) => {
    if (isRunning) startTimerLoop();
    render().then(() => t.sizeTo("body"));
  });
});