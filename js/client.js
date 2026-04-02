// Build a compact text-only progress bar so both badges render with identical
// Trello-native centering (no icon slot = no extra left padding).
// e.g. "▓▓▓▓▓░░░░░ 50%"
function createProgressBarText(percentage) {
  var filled = Math.round(Math.min(percentage, 100) / 10);
  var empty = 10 - filled;
  return "▓".repeat(filled) + "░".repeat(empty) + " " + percentage + "%";
}

window.TrelloPowerUp.initialize(
  {
    "card-badges": function (t, options) {
      return t.get("card", "shared").then(function (data) {
        if (!data) return [];

        var timeLog = data.timeLog || [];
        var isRunning = data.isRunning || false;
        var startTime = data.startTime || 0;

        var totalElapsed = timeLog.reduce(function (acc, entry) {
          return (
            acc +
            (new Date(entry.end).getTime() - new Date(entry.start).getTime())
          );
        }, 0);

        if (isRunning && startTime) {
          totalElapsed += Date.now() - startTime;
        }

        var badges = [];

        // ── Running indicator badge ──
        if (isRunning) {
          badges.push({
            text: "⏱️ ",
            color: "green",
            refresh: 10,
          });
        }

        // ── Progress badge (only when estimate is set) ──
        if (data.estimated && data.estimated > 0) {
          var estimatedMs = data.estimated * 60 * 1000;
          var percentage = Math.floor((totalElapsed / estimatedMs) * 100);
          badges.push({
            text: createProgressBarText(percentage),
            color: percentage > 100 ? "red" : "green",
            refresh: 60,
          });
        }

        return badges;
      });
    },

    "board-buttons": function (t, options) {
      // Only show the stats button to board admins
      return Promise.all([t.board("memberships"), t.member("id")]).then(
        function (results) {
          var memberships = results[0].memberships || [];
          var memberId = results[1].id;
          var mine = memberships.find(function (m) {
            return m.idMember === memberId;
          });
          var isAdmin = !!(mine && mine.memberType === "admin");
          if (!isAdmin) return [];

          return [
            {
              icon: "https://img.icons8.com/ios-glyphs/30/737A8C/combo-chart.png",
              text: "Project Stats",
              callback: function (t) {
                return t.modal({
                  title: "Project Statistics",
                  url: t.signUrl("./stats.html"),
                  fullscreen: true,
                });
              },
            },
          ];
        },
      );
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
  },
  {
    appName: "Time & Progress Tracker",
    scope: {
      board: "read",
      card: "read",
      member: "read",
    },
  },
);
