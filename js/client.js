// Helper to draw a dynamic progress bar for the card front
function createProgressBarIcon(percentage) {
  var w = 40;
  var h = 14;
  var fillW = Math.round((Math.min(percentage, 100) / 100) * w);
  var fillColor = percentage > 100 ? "#eb5a46" : "#61bd4f";

  var svg =
    '<svg width="' +
    w +
    '" height="' +
    h +
    '" xmlns="http://www.w3.org/2000/svg"><rect width="' +
    w +
    '" height="' +
    h +
    '" fill="#ebecf0" rx="3"/><rect width="' +
    fillW +
    '" height="' +
    h +
    '" fill="' +
    fillColor +
    '" rx="3"/></svg>';
  return "data:image/svg+xml;base64," + btoa(svg);
}

window.TrelloPowerUp.initialize({
  "card-badges": function (t, options) {
    return t.get("card", "shared").then(function (data) {
      if (!data || !data.estimated || data.estimated <= 0) return [];

      var timeLog = data.timeLog || [];
      var isRunning = data.isRunning || false;
      var startTime = data.startTime || 0;

      // Compute total elapsed from the log entries
      var totalElapsed = timeLog.reduce(function (acc, entry) {
        return (
          acc +
          (new Date(entry.end).getTime() - new Date(entry.start).getTime())
        );
      }, 0);

      // If the timer is currently running, add live time since startTime
      if (isRunning && startTime) {
        totalElapsed += Date.now() - startTime;
      }

      var estimatedMs = data.estimated * 60 * 1000;
      var percentage = Math.floor((totalElapsed / estimatedMs) * 100);

      return [
        {
          icon: createProgressBarIcon(percentage),
          text: percentage + "%",
          color: percentage > 100 ? "red" : "green",
        },
      ];
    });
  },

  "card-back-section": function (t, options) {
    return {
      title: "Time & Progress Tracker",
      icon: "https://img.icons8.com/ios-glyphs/30/737A8C/time.png",
      content: {
        type: "iframe",
        url: t.signUrl("./card-back.html", { bust: Date.now() }),
        height: 250,
      },
    };
  },
});
