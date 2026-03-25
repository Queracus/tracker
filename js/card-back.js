var t = window.TrelloPowerUp.iframe();

// UI Elements
var startBtn = document.getElementById("start-btn");
var stopBtn = document.getElementById("stop-btn");
var resetBtn = document.getElementById("reset-btn");
var estimatedInput = document.getElementById("estimated-time");
var elapsedDisplay = document.getElementById("elapsed-time");
var progressText = document.getElementById("progress-text");
var progressSlider = document.getElementById("progress-slider");

var timerInterval;
var lastSaveTime = 0; // --- NEW: Track the last time we saved to Trello

// Format milliseconds into MM:SS
function formatTime(ms) {
  var totalSeconds = Math.floor(ms / 1000);
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  return (
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0")
  );
}

// Function to style the slider track based on progress
function styleSlider(percentage) {
  var isDark = document.body.classList.contains("dark-mode");
  // --- Change color to red if over 100% ---
  var fillColor = percentage > 100 ? "#eb5a46" : "#61bd4f";
  var bgColor = isDark ? "#41474d" : "#dfe1e6";

  // The visual fill of the bar is capped at 100%
  var fillPercentage = Math.min(percentage, 100);

  progressSlider.style.background = `linear-gradient(to right, ${fillColor} ${fillPercentage}%, ${bgColor} ${fillPercentage}%)`;
}

// --- Saves current progress without stopping the timer ---
function saveProgress() {
  return t.get("card", "shared").then(function (data) {
    if (!data.isRunning) return; // Only save if timer is running

    var currentElapsed = data.elapsed || 0;
    var sessionTime = Date.now() - data.startTime;
    var totalElapsed = currentElapsed + sessionTime;

    lastSaveTime = Date.now(); // Update our save time tracker
    // We only save the new elapsed time. isRunning remains true.
    return t.set("card", "shared", "elapsed", totalElapsed);
  });
}

// Render the UI based on saved Trello data
function render() {
  return t.get("card", "shared").then(function (data) {
    var estimated = data.estimated || 0; // in minutes
    var elapsed = data.elapsed || 0; // in milliseconds
    var isRunning = data.isRunning || false;
    var startTime = data.startTime || 0;

    if (isRunning) {
      elapsed += Date.now() - startTime;
      startBtn.classList.add("hidden");
      stopBtn.classList.remove("hidden");

      // --- Check if it's time for a periodic save ---
      if (Date.now() - lastSaveTime > 10 * 60 * 1000) {
        // 10 minutes
        saveProgress();
      }
    } else {
      startBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
    }

    estimatedInput.value = estimated > 0 ? estimated : "";
    elapsedDisplay.innerText = formatTime(elapsed);

    var estimatedMs = estimated * 60 * 1000;
    var percentage = 0;
    if (estimatedMs > 0) {
      // --- Removed the cap at 100% ---
      percentage = Math.floor((elapsed / estimatedMs) * 100);
    }

    progressText.innerText = percentage + "%";
    progressSlider.value = Math.min(percentage, 100); // Slider value is capped visually
    styleSlider(percentage);

    progressSlider.disabled = estimated <= 0;
  });
}

// Auto-save estimated time
estimatedInput.addEventListener("change", function () {
  t.set("card", "shared", "estimated", parseInt(this.value) || 0).then(render);
});

// START button
startBtn.addEventListener("click", function () {
  lastSaveTime = Date.now(); // --- NEW: Reset save timer on start
  t.set("card", "shared", { isRunning: true, startTime: Date.now() }).then(
    function () {
      startTimerLoop();
      render();
    },
  );
});

// STOP button
stopBtn.addEventListener("click", function () {
  // The 'saveProgress' function does most of the work, but we still
  // need to set isRunning to false and stop the loop.
  saveProgress().then(function () {
    t.set("card", "shared", "isRunning", false).then(function () {
      stopTimerLoop();
      render();
    });
  });
});

// RESET button
resetBtn.addEventListener("click", function () {
  t.set("card", "shared", { isRunning: false, elapsed: 0, startTime: 0 }).then(
    function () {
      stopTimerLoop();
      render();
    },
  );
});

// Slider Event Listener
progressSlider.addEventListener("input", function () {
  var percentage = parseInt(this.value);
  t.get("card", "shared", "estimated").then(function (estimated) {
    if (!estimated || estimated <= 0) return;

    var estimatedMs = estimated * 60 * 1000;
    var newElapsed = (estimatedMs * percentage) / 100;

    t.set("card", "shared", { elapsed: newElapsed, isRunning: false }).then(
      function () {
        stopTimerLoop();
        render();
      },
    );
  });
});

// Loop to update the UI every second
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
  var context = t.getContext();
  if (context && context.theme === "dark") {
    document.body.classList.add("dark-mode");
  }

  t.get("card", "shared", "isRunning").then(function (isRunning) {
    if (isRunning) {
      lastSaveTime = Date.now(); // Ensure save timer is set on load
      startTimerLoop();
    }
    render();
  });
});
