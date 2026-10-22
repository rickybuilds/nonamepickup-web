/* Experiment adapter: production Analytics owns fetching, calculations and rendering. */
(() => {
  "use strict";
  const variant = document.currentScript.dataset.careerVariant;
  const nativeFetch = window.fetch.bind(window);
  let analyticsData;

  // Production currently requests five rows. Only this preview requests ten;
  // pass the unmodified response back to the existing production renderer.
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const isAnalytics = url.origin === location.origin && url.pathname === "/api/analytics";
    if (!isAnalytics) return nativeFetch(input, init);
    url.searchParams.set("limit", "10");
    const request = input instanceof Request ? new Request(url, input) : url.href;
    const response = await nativeFetch(request, init);
    if (response.ok) {
      try {
        const payload = await response.clone().json();
        if (payload.ok && payload.data) analyticsData = payload.data;
      } catch (error) {
        console.warn("Career comparison context unavailable", error);
      }
    }
    return response;
  };

  document.addEventListener("DOMContentLoaded", () => {
    const comparisons = document.getElementById("analytics-comparisons");
    if (!comparisons) return;
    const section = comparisons.closest("section");
    section.classList.add("career-preview", `career-preview-${variant}`);
    const observer = new MutationObserver(refine);
    observer.observe(comparisons, { childList: true });
    refine();

    function refine() {
      const cards = [...comparisons.querySelectorAll(":scope > .analytics-comparison-card")];
      if (cards.length !== 4) return;
      observer.disconnect();
      const number = new Intl.NumberFormat("en-US");
      const min = analyticsData?.qualification?.minimum_games;
      const note = section.querySelector(".analytics-section-heading p");
      note.textContent = `Independent leaders · ${min == null ? "Performance qualification unavailable" : `Performance: ${number.format(min)}+ games`}`;

      const records = [
        [analyticsData?.combat?.kills?.[0], analyticsData?.per_game?.kills?.[0]],
        [analyticsData?.combat?.enemy_damage?.[0], analyticsData?.per_game?.damage?.[0]],
        [analyticsData?.mvps?.[0], analyticsData?.mvp_rate?.[0]],
        [analyticsData?.combat?.games?.[0], analyticsData?.per_game?.win_rate?.[0]]
      ];
      cards.forEach((card, index) => {
        card.querySelector(".analytics-versus")?.remove();
        [...card.querySelectorAll(".analytics-comparison-side")].forEach((side, sideIndex) => {
          const identity = side.querySelector(".analytics-comparison-player");
          identity.title = identity.textContent.trim();
          const value = side.querySelector("strong");
          const record = records[index][sideIndex];
          if (!record || record.value == null) value.textContent = "—";
          const sample = record?.matches;
          if (sample != null) {
            const context = document.createElement("small");
            context.className = "career-sample";
            context.textContent = `${number.format(sample)} games`;
            side.append(context);
          }
        });
      });
      if (variant !== "b") return;

      // Transpose the existing eight leader nodes into a two-band matrix.
      // Keep production identity markup, supporter badges and value formatting.
      const scroll = document.createElement("div");
      scroll.className = "career-matrix-scroll";
      const sides = cards.map(card => [card.querySelector(".career"), card.querySelector(".performance")]);
      const narrow = window.matchMedia("(max-width:700px)");
      comparisons.replaceChildren(scroll);
      compose(narrow.matches);
      narrow.addEventListener("change", event => compose(event.matches));

      function compose(paired) {
        const table = document.createElement("table");
        table.className = `career-matrix${paired ? " is-paired" : ""}`;
        const caption = table.createCaption();
        caption.textContent = "Career volume and qualified performance leaders by category";
        const head = table.createTHead().insertRow();
        (paired ? ["Career volume", "Performance"] : ["Leader type", "Kills", "Damage", "MVPs", "Match results"]).forEach(label => {
          const th = document.createElement("th");
          th.scope = "col";
          th.textContent = label;
          head.append(th);
        });
        const body = table.createTBody();
        if (paired) {
          sides.forEach(pair => {
            const row = body.insertRow();
            pair.forEach(side => row.insertCell().append(side));
          });
        } else {
          ["Career volume", "Performance"].forEach((label, sideIndex) => {
            const row = body.insertRow();
            row.className = sideIndex ? "performance" : "career";
            const th = document.createElement("th");
            th.scope = "row";
            th.textContent = label;
            row.append(th);
            sides.forEach(pair => row.insertCell().append(pair[sideIndex]));
          });
        }
        scroll.replaceChildren(table);
      }
    }
  });
})();
