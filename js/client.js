// Helper to draw a dynamic progress bar for the card front
function createProgressBarIcon(percentage) {
  var w = 40;
  var h = 14;
  var fillW = Math.round((percentage / 100) * w);
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
    '" fill="#61bd4f" rx="3"/></svg>';
  return "data:image/svg+xml;base64," + btoa(svg);
}

window.TrelloPowerUp.initialize({
  // 1. Show badges on the front of the cards (List view)
  "card-badges": function (t, options) {
    return t.get("card", "shared").then(function (data) {
      if (!data || !data.estimated || !data.elapsed) return [];

      // Calculate progress percentage
      var estimatedMs = data.estimated * 60 * 1000; // stored in minutes
      var percentage = Math.floor((data.elapsed / estimatedMs) * 100);
      if (percentage > 100) percentage = 100;

      return [
        {
          icon: createProgressBarIcon(percentage),
          text: percentage + "%",
          color: "green",
        },
      ];
    });
  },

  // 2. Add our custom section to the back of the card
  "card-back-section": function (t, options) {
    return {
      title: "Time & Progress Tracker",
      icon: "https://img.icons8.com/ios-glyphs/30/737A8C/time.png",
      content: {
        type: "iframe",
        url: t.signUrl("./card-back.html"),
        height: 250, // Initial height of our iframe
      },
    };
  },
});
