(function (C, A, L) {
  let p = function (a, ar) { a.q.push(ar); };
  let d = C.document;
  C.Cal = C.Cal || function () {
    let cal = C.Cal;
    let ar = arguments;
    if (!cal.loaded) {
      cal.ns = {};
      cal.q = cal.q || [];
      d.head.appendChild(d.createElement("script")).src = A;
      cal.loaded = true;
    }
    if (ar[0] === L) {
      const api = function () { p(api, arguments); };
      const namespace = ar[1];
      api.q = api.q || [];
      if (typeof namespace === "string") {
        cal.ns[namespace] = cal.ns[namespace] || api;
        p(cal.ns[namespace], ar);
        p(cal, ["initNamespace", namespace]);
      } else p(cal, ar);
      return;
    }
    p(cal, ar);
  };
})(window, "https://app.cal.com/embed/embed.js", "init");

Cal("init", "package", { origin: "https://cal.com" });

Cal.ns.package("inline", {
  elementOrSelector: "#my-cal-inline",
  config: {
    layout: "month_view",
    hideEventTypeDetails: true,
    showLandingPageDetails: false,
    showEventTypeTitle: false,
    ui: false
  },
  calLink: "rebeccamiller/package",
});

Cal.ns.package("ui", {
  hideEventTypeDetails: true,
  showLandingPageDetails: false,
  showEventTypeTitle: false,
  layout: "month_view",
  cssVarsPerTheme: {
    light: { "cal-brand": "#2c77cc" },
    dark: { "cal-brand": "#fafafa" }
  }
});
