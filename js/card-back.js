var t = window.TrelloPowerUp.iframe();

// UI Elements
var startBtn = document.getElementById("start-btn");
var stopBtn = document.getElementById("stop-btn");
var resetBtn = document.getElementById("reset-btn");
var estimatedInput = document.getElementById("estimated-time");
var elapsedDisplay = document.getElementById("elapsed-time");
var progressText = document.getElementById("progress-text");
var progressSlider = document.getElementById("progress-slider"); // The only progress element now

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

// Function to style the slider track based on progress
function styleSlider(percentage) {
  var isDark = document.body.classList.contains("dark-mode");
  var fillColor = "#61bd4f"; // Green for progress
  var bgColor = isDark ? "#41474d" : "#dfe1e6"; // Dark or light gray for the rest

  progressSlider.style.background = `linear-gradient(to right, ${fillColor} ${percentage}%, ${bgColor} ${percentage}%)`;
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
    } else {
      startBtn.classList.remove("hidden");
      stopBtn.classList.add("hidden");
    }

    estimatedInput.value = estimated > 0 ? estimated : "";
    elapsedDisplay.innerText = formatTime(elapsed);

    var estimatedMs = estimated * 60 * 1000;
    var percentage = 0;
    if (estimatedMs > 0) {
      percentage = Math.floor((elapsed / estimatedMs) * 100);
      if (percentage > 100) percentage = 100;
    }

    progressText.innerText = percentage + "%";
    progressSlider.value = percentage;
    styleSlider(percentage); // Apply the dynamic background style

    progressSlider.disabled = estimated <= 0;
  });
}

// Auto-save estimated time
estimatedInput.addEventListener("change", function () {
  t.set("card", "shared", "estimated", parseInt(this.value) || 0).then(render);
});

// START button
startBtn.addEventListener("click", function () {
  t.set("card", "shared", { isRunning: true, startTime: Date.now() }).then(
    function () {
      startTimerLoop();
      render();
    },
  );
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
  t.set("card", "shared", { isRunning: false, elapsed: 0, startTime: 0 }).then(
    function () {
      stopTimerLoop();
      render();
    },
  );
});

// Slider Event Listener (no changes needed here)
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
    if (isRunning) startTimerLoop();
    render();
  });
});
