var t = window.TrelloPowerUp.iframe();

// UI Elements
var startBtn = document.getElementById("start-btn");
var stopBtn = document.getElementById("stop-btn");
var resetBtn = document.getElementById("reset-btn");
var estimatedInput = document.getElementById("estimated-time");
var elapsedDisplay = document.getElementById("elapsed-time");
var progressBarFill = document.getElementById("progress-bar-fill");
var progressText = document.getElementById("progress-text");

var timerInterval;

// Format milliseconds into MM:SS
function formatTime(ms) {
  var totalSeconds = Math.floor(ms / 1000);
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  return (
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
  );
}

// Render the UI based on saved Trello data
function render() {
  var context = t.getContext();
  if (context && context.theme === "dark") {
    document.body.classList.add("dark-mode");
  }
  t.get("card", "shared").then(function (data) {
    var estimated = data.estimated || 0; // in minutes
    var elapsed = data.elapsed || 0; // in milliseconds
    var isRunning = data.isRunning || false;
    var startTime = data.startTime || 0;

    // If timer is running, calculate actual elapsed time right now
    if (isRunning) {
      elapsed += Date.now() - startTime;
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");
    } else {
      startBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
    }

    // Update Text fields
    estimatedInput.value = estimated > 0 ? estimated : "";
    elapsedDisplay.innerText = formatTime(elapsed);

    // Update Progress Bar
    var estimatedMs = estimated * 60 * 1000;
    var percentage = 0;
    if (estimatedMs > 0) {
      percentage = Math.floor((elapsed / estimatedMs) * 100);
      if (percentage > 100) percentage = 100;
    }

    progressBarFill.style.width = percentage + "%";
    progressText.innerText = percentage + "%";
  });
}

// Auto-save estimated time when user types
estimatedInput.addEventListener("change", function () {
  t.set("card", "shared", "estimated", parseInt(this.value) || 0).then(
    function () {
      render();
    },
  );
});

// START button
startBtn.addEventListener("click", function () {
  t.set("card", "shared", {
    isRunning: true,
    startTime: Date.now(),
  }).then(function () {
    startTimerLoop();
    render();
  });
});

// STOP button
stopBtn.addEventListener("click", function () {
  t.get("card", "shared").then(function (data) {
    var currentElapsed = data.elapsed || 0;
    var sessionTime = Date.now() - data.startTime;
    var totalElapsed = currentElapsed + sessionTime;

    t.set("card", "shared", {
      isRunning: false,
      elapsed: totalElapsed,
      startTime: 0,
    }).then(function () {
      stopTimerLoop();
      render();
    });
  });
});

// RESET button
resetBtn.addEventListener("click", function () {
  t.set("card", "shared", {
    isRunning: false,
    elapsed: 0,
    startTime: 0,
  }).then(function () {
    stopTimerLoop();
    render();
  });
});

// Loop to update the UI every second if running
function startTimerLoop() {
  if (!timerInterval) {
    timerInterval = setInterval(render, 1000);
  }
}
function stopTimerLoop() {
  clearInterval(timerInterval);
  timerInterval = null;
}

// Initial Setup
t.render(function () {
  t.get("card", "shared", "isRunning").then(function (isRunning) {
    if (isRunning) startTimerLoop();
    render();
  });
});
