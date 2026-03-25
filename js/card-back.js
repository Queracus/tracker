var t = window.TrelloPowerUp.iframe();

// --- UI Elements (more added) ---
var startBtn = document.getElementById("start-btn");
var stopBtn = document.getElementById("stop-btn");
var resetBtn = document.getElementById("reset-btn");
var estimatedInput = document.getElementById("estimated-time");
var elapsedDisplay = document.getElementById("elapsed-time");
var progressText = document.getElementById("progress-text");
var progressSlider = document.getElementById("progress-slider");
var addManualBtn = document.getElementById("add-manual-btn");
var startTimeManual = document.getElementById("start-time-manual");
var endTimeManual = document.getElementById("end-time-manual");
var toggleLogBtn = document.getElementById("toggle-log-btn");
var logContainer = document.getElementById("time-log-container");

var timerInterval;

// --- Helper Functions ---

/**
 * Formats milliseconds into a MM:SS string.
 * @param {number} ms - The total milliseconds.
 * @returns {string} The formatted time string.
 */
function formatTime(ms) {
  var totalSeconds = Math.floor(ms / 1000);
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  return (
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
  );
}

/**
 * Styles the slider's background to act as a progress bar.
 * @param {number} percentage - The current progress percentage.
 */
function styleSlider(percentage) {
  var isDark = document.body.classList.contains("dark-mode");
  var fillColor = percentage > 100 ? "#eb5a46" : "#61bd4f";
  var bgColor = isDark ? "#41474d" : "#dfe1e6";

  var fillPercentage = Math.min(percentage, 100);
  progressSlider.style.background = `linear-gradient(to right, ${fillColor} ${fillPercentage}%, ${bgColor} ${fillPercentage}%)`;
}

/**
 * Formats an ISO date string into a more readable local format.
 * @param {string} isoString - The date string to format.
 * @returns {string} The formatted date string.
 */
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

/**
 * Converts milliseconds into a "Xh Ym" formatted string.
 * @param {number} ms - The total milliseconds.
 * @returns {string} The formatted duration string.
 */
function millisecondsToHms(ms) {
  var secs = Math.floor(ms / 1000);
  var hrs = Math.floor(secs / 3600);
  secs %= 3600;
  var mins = Math.floor(secs / 60);
  return `${hrs}h ${mins}m`;
}

// --- Main Render Function ---

/**
 * Renders the entire UI based on data from Trello.
 */
function render() {
  return t.getAll().then(function (data) {
    var cardData = data.card?.shared || {};
    var memberRole = t.getContext().member.role; // 'admin', 'normal', or 'observer'
    var isAdmin = memberRole === "admin";

    // Enable/disable admin controls based on role
    estimatedInput.disabled = !isAdmin;
    resetBtn.disabled = !isAdmin;

    var estimated = cardData.estimated || 0;
    var timeLog = cardData.timeLog || [];
    var isRunning = cardData.isRunning || false;
    var startTime = cardData.startTime || 0;

    // Calculate total elapsed time by summing up all entries in the log
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

    estimatedInput.value = estimated > 0 ? estimated : "";
    elapsedDisplay.innerText = formatTime(totalElapsed);

    var estimatedMs = estimated * 60 * 1000;
    var percentage =
      estimatedMs > 0 ? Math.floor((totalElapsed / estimatedMs) * 100) : 0;

    progressText.innerText = percentage + "%";
    progressSlider.value = Math.min(percentage, 100);
    styleSlider(percentage);
    progressSlider.disabled = estimated <= 0;

    // Render the Time Log display
    logContainer.innerHTML = ""; // Clear previous entries
    if (timeLog.length === 0) {
      logContainer.innerHTML = "<p>No time entries yet.</p>";
    } else {
      timeLog
        .slice()
        .reverse()
        .forEach((entry) => {
          // Show newest entries first
          var durationMs =
            new Date(entry.end).getTime() - new Date(entry.start).getTime();
          var entryEl = document.createElement("div");
          entryEl.className = "log-entry";
          entryEl.innerHTML = `
                    <span class="log-duration">${millisecondsToHms(durationMs)} (${entry.type})</span>
                    <span>Start: ${formatLogDate(entry.start)}</span>
                    <span>End: ${formatLogDate(entry.end)}</span>
                `;
          logContainer.appendChild(entryEl);
        });
    }
  });
}

// --- Event Listeners ---
estimatedInput.addEventListener("change", function () {
  t.set("card", "shared", "estimated", parseInt(this.value) || 0).then(render);
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
    var newEntry = {
      start: new Date(cardData.startTime).toISOString(),
      end: new Date().toISOString(),
      type: "timer",
    };
    log.push(newEntry);
    // Persist the new log entry and stop the timer
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
  // Clear all tracking data for the card
  t.set("card", "shared", { isRunning: false, startTime: 0, timeLog: [] }).then(
    () => {
      stopTimerLoop();
      render();
    },
  );
});

addManualBtn.addEventListener("click", function () {
  var startVal = startTimeManual.value;
  var endVal = endTimeManual.value;

  if (!startVal || !endVal || new Date(endVal) <= new Date(startVal)) {
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
      start: new Date(startVal).toISOString(),
      end: new Date(endVal).toISOString(),
      type: "manual",
    });
    // Save the updated log
    t.set("card", "shared", "timeLog", timeLog).then(() => {
      startTimeManual.value = "";
      endTimeManual.value = "";
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
  t.sizeTo("body"); // Resize iframe to fit content
});

// --- Timer Loop & Initial Setup ---
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
  if (context && context.theme === "dark") {
    document.body.classList.add("dark-mode");
  }
  t.get("card", "shared", "isRunning").then((isRunning) => {
    if (isRunning) startTimerLoop();
    render().then(() => {
      // Resize iframe to fit all the new content
      t.sizeTo("body");
    });
  });
});
