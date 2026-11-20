import { SORT_OPTIONS, budgetPresets, budgetValue, budgetError, selectedBudgetPreset, budgetSummary, rentalPeriod, filterHomeListings, sortHomeListings, locationSuggestions, locationQuery, budgetKind, priceForMonthly, monthlyForPrice, comparisonPriceLKR } from "./homepage-search.js?v=20261118-mp1";
import { createOwnerFeed } from "./owner-listings-feed.js?v=20261121-vv1";
import { createAgentProfiles } from "./agent-profiles.js?v=20261118-profile";
// Homepage presentation only. Marketplace state, routes and integrations remain in app.js.
export function createHomepage(
  React,
  useMarketplace,
  defaults,
  OriginalBrand,
  formatPrice,
) {
  const h = React.createElement;
  const OwnerFeed = createOwnerFeed(React);
  const { AgentStrip, AgentProfileOverlay } = createAgentProfiles(React);
  const labels = {
    apartment: "Apartments & Condominiums",
    villa: "Villas",
    mansion: "Mansions",
  };
  const residential = (p) =>
    p.country === "Sri Lanka" &&
    ["buy", "rent"].includes(p.purpose) &&
    Object.hasOwn(labels, p.category);
  const go = (store, view) => {
    store.setCurrentView(view);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  // Decorative Matrix-style "digital rain" filling the hero. Three layers of
  // different sizes give depth; it pauses off-screen and draws one still
  // frame for visitors who prefer reduced motion.
  function MatrixRain() {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const canvas = ref.current;
      const ctx = canvas && canvas.getContext("2d");
      if (!ctx) return undefined;
      const glyphs =
        "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z:.=*+-<>¦|";
      const pick = () => glyphs[(Math.random() * glyphs.length) | 0];
      const layers = [
        { size: 11, color: "0, 185, 60", glow: 0, density: 1, speed: 0.8 },
        { size: 17, color: "0, 235, 80", glow: 8, density: 0.9, speed: 0.9 },
        { size: 28, color: "70, 255, 120", glow: 16, density: 0.3, speed: 1 },
      ];
      const still = window.matchMedia("(prefers-reduced-motion: reduce)");
      let drops = [];
      let width = 0;
      let height = 0;
      let frame = 0;
      let last = 0;
      let visible = true;
      const font = (size) =>
        `${size}px "MS Gothic", "Yu Gothic", "Hiragino Kaku Gothic Pro", monospace`;
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        ({ width, height } = canvas.getBoundingClientRect());
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        drops = [];
        layers.forEach((layer) => {
          const rows = Math.ceil(height / layer.size);
          for (let x = 0; x < width; x += layer.size) {
            if (Math.random() > layer.density) continue;
            drops.push({
              layer,
              x,
              row: Math.floor(Math.random() * rows),
              prev: null,
              rate: layer.speed * (0.5 + Math.random() * 0.5),
            });
          }
        });
        // Pre-run the rain so the wallpaper starts full instead of empty.
        for (let i = 0; i < 140; i += 1) tick();
      };
      const tick = () => {
        // Fade the previous frame so every column leaves a trail.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
        ctx.fillRect(0, 0, width, height);
        ctx.textBaseline = "top";
        drops.forEach((drop) => {
          if (Math.random() > drop.rate) return;
          const { size, color, glow } = drop.layer;
          ctx.font = font(size);
          ctx.shadowColor = `rgb(${color})`;
          ctx.shadowBlur = glow;
          if (drop.prev) {
            // Repaint the old head green so only the newest glyph glows white.
            ctx.fillStyle = `rgb(${color})`;
            ctx.fillText(pick(), drop.x, drop.prev * size);
          }
          ctx.fillStyle = "rgb(210, 255, 220)";
          ctx.fillText(pick(), drop.x, drop.row * size);
          drop.prev = drop.row;
          drop.row += 1;
          if (drop.row * size > height && Math.random() > 0.96) {
            drop.row = 0;
            drop.prev = null;
          }
        });
      };
      const step = (time) => {
        frame = requestAnimationFrame(step);
        if (!visible || time - last < 45) return;
        last = time;
        tick();
      };
      const resizer = new ResizeObserver(resize);
      resizer.observe(canvas);
      const watcher = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      watcher.observe(canvas);
      if (!still.matches) frame = requestAnimationFrame(step);
      return () => {
        cancelAnimationFrame(frame);
        resizer.disconnect();
        watcher.disconnect();
      };
    }, []);
    return h("canvas", {
      ref,
      className: "dh-matrix-rain",
      "aria-hidden": "true",
    });
  }
  const button = (text, onClick, className = "dh-button", props = {}) =>
    h("button", { type: "button", onClick, className, ...props }, text);
  function Header() {
    const store = useMarketplace();
    const [menuOpen, setMenuOpen] = React.useState(false);
    const browse = (purpose) => {
      store.setFilters({ ...defaults, purpose, category: "apartment" });
      go(store, "search");
    };
    return h(
      "header",
      { className: "dh-home-header" },
      h(
        "a",
        {
          href: "#dh-home",
          className: "dh-brand",
          "aria-label": "DwellHunt home",
        },
        h(OriginalBrand),
      ),
      button(
        menuOpen ? "Close menu" : "Menu",
        () => setMenuOpen((open) => !open),
        "dh-menu-button",
        { "aria-expanded": menuOpen, "aria-controls": "dh-home-navigation" },
      ),
      h(
        "nav",
        {
          id: "dh-home-navigation",
          className: menuOpen ? "dh-navigation-open" : "",
          "aria-label": "Main navigation",
          onClick: (event) => {
            if (event.target.closest("a,button")) setMenuOpen(false);
          },
          onKeyDown: (event) => {
            if (event.key === "Escape") setMenuOpen(false);
          },
        },
        button("Buy", () => browse("buy"), "dh-nav-link"),
        button("Rent", () => browse("rent"), "dh-nav-link"),
        h(
          "a",
          { href: "#dh-listings", className: "dh-nav-link" },
          "Explore properties",
        ),
        button("Agencies & agents", () => go(store, "agencies"), "dh-nav-link"),
        button("Agency Portal", () => go(store, "dashboard"), "dh-nav-link"),
        h(
          "select",
          {
            "aria-label": "Display currency",
            value: store.currency,
            onChange: (e) => store.setCurrency(e.target.value),
            className: "dh-currency",
          },
          ["LKR", "USD", "AED", "GBP"].map((code) =>
            h("option", { key: code, value: code }, code),
          ),
        ),
        h(
          "a",
          { href: "#dh-journeys", className: "dh-nav-link dh-guide-link" },
          "How it works",
        ),
        button("List a property", () => go(store, "list-property")),
      ),
    );
  }
  function PropertyCard({ property: p }) {
    const store = useMarketplace();
    const [photo, setPhoto] = React.useState(0);
    const photos = p.images || [];
    const saved = store.isPropertySaved(p.id);
    const compared = store.comparePropertyIds.includes(p.id);
    const changePhoto = (direction) =>
      setPhoto((index) => (index + direction + photos.length) % photos.length);
    return h(
      "article",
      { className: "dh-property" },
      h(
        "div",
        { className: "dh-property-photo" },
        h("img", {
          src: photos[photo],
          alt: `${p.title} — photo ${photo + 1} of ${photos.length}`,
          loading: "lazy",
          width: 600,
          height: 450,
        }),
        h(
          "span",
          { className: "dh-purpose-badge" },
          p.purpose === "rent" ? "For rent" : "For sale",
        ),
        h(
          "div",
          { className: "dh-photo-actions" },
          button(
            "⇄",
            () => store.toggleCompareProperty(p.id),
            "dh-icon-button",
            { "aria-label": `Compare ${p.title}`, "aria-pressed": compared },
          ),
          button(
            saved ? "♥" : "♡",
            () => store.toggleSaveProperty(p.id),
            "dh-icon-button",
            { "aria-label": `Save ${p.title}`, "aria-pressed": saved },
          ),
        ),
        photos.length > 1 &&
          h(
            React.Fragment,
            null,
            button("‹", () => changePhoto(-1), "dh-photo-arrow dh-photo-prev", {
              "aria-label": `Previous photo of ${p.title}`,
            }),
            button("›", () => changePhoto(1), "dh-photo-arrow dh-photo-next", {
              "aria-label": `Next photo of ${p.title}`,
            }),
            h(
              "div",
              {
                className: "dh-photo-dots",
                role: "group",
                "aria-label": `Photos of ${p.title}`,
              },
              photos.map((_, index) =>
                button("", () => setPhoto(index), "dh-photo-dot", {
                  key: index,
                  "aria-label": `Photo ${index + 1} of ${p.title}`,
                  "aria-pressed": photo === index,
                }),
              ),
            ),
          ),
      ),
      h(
        "div",
        { className: "dh-property-body" },
        h(
          "div",
          { className: "dh-price-line" },
          h(
            "p",
            { className: "dh-price" },
            p.purpose === "rent" && !["month", "monthly"].includes(rentalPeriod(p))
              ? `${formatPrice(p.price, store.currency, "buy")} / ${{ weekly: "week", yearly: "year", nightly: "night", daily: "day" }[rentalPeriod(p)] || rentalPeriod(p)}`
              : formatPrice(p.price, store.currency, p.purpose),
          ),
          p.isNegotiable &&
            h("span", { className: "dh-negotiable" }, "Negotiable"),
        ),
        h(
          "h3",
          null,
          button(
            p.title,
            () => store.navigateToProperty(p.id),
            "dh-title-link",
          ),
        ),
        h(
          "p",
          { className: "dh-address" },
          [p.address, p.city].filter(Boolean).join(", "),
        ),
        // One quiet line of facts; agency, update date and loan estimate stay on the details page.
        h(
          "p",
          { className: "dh-property-facts", "aria-label": "Property details" },
          [p.bedrooms ? `${p.bedrooms} bed${p.bedrooms === 1 ? "" : "s"}` : "", p.bathrooms ? `${p.bathrooms} bath${p.bathrooms === 1 ? "" : "s"}` : "",
            p.floorAreaSqFt ? `${p.floorAreaSqFt.toLocaleString("en-US")} sq ft` : ""].filter(Boolean).join(" · "),
        ),
      ),
    );
  }
  const icon = (paths) => h("svg", { viewBox: "0 0 24 24", width: 26, height: 26, fill: "none", stroke: "currentColor", strokeWidth: 1.7,
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" }, paths.map((d, i) => h("path", { key: i, d })));
  const STEP_ICONS = {
    search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
    enquire: ["M4 5h16v11H8l-4 4z", "M8 9h8", "M8 12h5"],
    view: ["M3 7h12v10H3z", "M15 11l6-4v10l-6-4"],
  };
  /** A few areas with real homes, as photo tiles: one tap narrows the listings to that area. */
  function AreaTiles({ inventory, onPick }) {
    const areas = [];
    for (const p of inventory) {
      if (!p.city || !(p.images || [])[0]) continue;
      const known = areas.find(a => a.city === p.city);
      if (known) known.count++; else areas.push({ city: p.city, photo: p.images[0], count: 1 });
    }
    const shown = areas.sort((a, b) => b.count - a.count).slice(0, 4);
    if (shown.length < 2) return null;
    return h("section", { className: "dh-section dh-areas", "aria-labelledby": "dh-areas-title" },
      h("h2", { id: "dh-areas-title" }, "Explore by area"),
      h("div", { className: "dh-area-grid" }, shown.map(a => h("button", { key: a.city, type: "button", className: "dh-area-tile", onClick: () => onPick(a.city) },
        h("img", { src: a.photo, alt: "", loading: "lazy" }),
        h("span", null, h("strong", null, a.city), h("small", null, `${a.count} home${a.count === 1 ? "" : "s"}`))))));
  }
  function ResultsBar({ id, count, sortBy, onSort, featured = false, purpose, shown = count, invalid = false }) {
    return h("div", { className: "dh-results-bar" },
      h("p", { role: "status", className: "dh-results-note", "aria-live": "polite" }, invalid ? "Correct the budget to see matching listings." :
        `${count} ${featured ? "featured" : "matching"} ${purpose === "rent" ? "rental" : "sale"} listing${count === 1 ? "" : "s"}${shown < count ? ` · showing ${shown}` : ""}${purpose === "rent" ? " · LKR/month comparison" : ""}`),
      h("label", { htmlFor: id, className: "dh-sort-control" }, "Sort by",
        h("select", { id, value: sortBy, onChange: event => onSort(event.target.value), "aria-label": featured ? "Sort featured properties by" : "Sort matching listings by" },
          SORT_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label)))));
  }
  function Home() {
    const store = useMarketplace();
    const [purpose, setPurpose] = React.useState("buy");
    const [location, setLocation] = React.useState("");
    const [minPrice, setMinPrice] = React.useState("");
    const [maxPrice, setMaxPrice] = React.useState("");
    const [budgetMode, setBudgetMode] = React.useState("total");
    const kind = budgetKind(purpose, budgetMode);
    const [bedrooms, setBedrooms] = React.useState("any");
    const [category, setCategory] = React.useState("apartment");
    const [sortBy, setSortBy] = React.useState("newest");
    const [savedOnly, setSavedOnly] = React.useState(false);
    const inventory = store.properties.filter(residential);
    const types = ["all", ...Object.keys(labels)];
    const available = inventory.filter((p) => p.purpose === purpose);
    const cities = [...new Set(available.map((p) => p.city))].sort();
    const budgetProblem = budgetError(minPrice, maxPrice, kind);
    const activePreset = selectedBudgetPreset(minPrice, maxPrice, kind);
    const shown = sortHomeListings(filterHomeListings(inventory, {
      purpose, budgetMode, category, location, minPrice, maxPrice, bedrooms, savedOnly,
    }, store.isPropertySaved), sortBy);
    const savedCount = inventory.filter((p) => store.isPropertySaved(p.id)).length;
    // The advanced search filters by total price, so a monthly budget is converted to the matching price range.
    const totalBudget = value => { const v = budgetValue(value, kind); return v === null || kind !== "monthly" ? v : Math.round(priceForMonthly(v)); };
    const toListings = () => document.getElementById("dh-listings")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const search = (event, advanced = false) => {
      event.preventDefault();
      if (budgetProblem) return;
      store.setFilters({
        ...defaults, purpose, location: locationQuery(location),
        minPrice: totalBudget(minPrice), maxPrice: totalBudget(maxPrice),
        bedrooms, category, sortBy,
      });
      if (advanced) go(store, "search");
      else toListings();
    };
    const resetAll = () => {
      setLocation(""); setMinPrice(""); setMaxPrice(""); setBedrooms("any"); setBudgetMode("total");
      setCategory("apartment"); setSavedOnly(false); setSortBy("newest");
    };
    const select = (id, title, value, onChange, options) =>
      h("label", { htmlFor: id }, title,
        h("select", { id, value, "aria-label": title, onChange: (e) => onChange(e.target.value) },
          options.map(([value, text, disabled = false]) => h("option", { key: value, value, disabled }, text))));
    const budgetLabel = kind === "rent" ? "Budget · LKR thousands / month" : kind === "monthly" ? "Monthly payment · LKR thousands" : "Budget · LKR millions";
    return h(
      "div",
      { id: "dh-home", className: "dh-home" },
      h("section", { className: "dh-hero", "aria-labelledby": "dh-motto" },
        h(MatrixRain),
        h("div", { className: "dh-hero-content" },
          h("h1", { id: "dh-motto" }, "A Higher Way Home."),
          h("p", { className: "dh-intro" }, "Verified apartments and homes in Sri Lanka, starting with Colombo."),
          h("form", { className: "dh-home-search", onSubmit: search, "aria-label": "Find a home" },
            h("div", { className: "dh-mode", role: "group", "aria-label": "Buy or rent" },
              ["buy", "rent"].map((mode) => button(mode === "buy" ? "Buy" : "Rent", () => {
                setPurpose(mode); setMinPrice(""); setMaxPrice(""); setLocation("");
              }, "dh-mode-button", { key: mode, "aria-pressed": purpose === mode }))),
            h("div", { className: "dh-search-row" },
              h("label", { htmlFor: "dh-location" }, "Location",
                h("input", { id: "dh-location", type: "search", value: location, list: "dh-location-options", autoComplete: "off", maxLength: 80,
                  placeholder: "Colombo 07, Rajagiriya…", "aria-label": "Location", onChange: (event) => setLocation(event.target.value) }),
                h("datalist", { id: "dh-location-options" }, locationSuggestions(cities).map((place) => h("option", { key: place, value: place })))),
              select("dh-beds", "Bedrooms", bedrooms, setBedrooms, [["any", "Any"], ["1", "1+"], ["2", "2+"], ["3", "3+"], ["4", "4+"]]),
              h("button", { type: "submit", className: "dh-button dh-search-submit", disabled: !!budgetProblem },
                budgetProblem ? "Check budget" : "Search")),
            h("div", { className: "dh-budget-presets", role: "group", "aria-label": budgetLabel },
              budgetPresets(kind).map(preset => button(preset.label, () => {
                const on = activePreset === preset.id; setMinPrice(on ? "" : preset.min); setMaxPrice(on ? "" : preset.max);
              }, "dh-chip", { key: preset.id, "aria-pressed": activePreset === preset.id }))),
            budgetProblem && h("p", { id: "dh-budget-error", className: "dh-budget-error", role: "alert" }, budgetProblem),
            // Everything a careful searcher may want, out of the way until asked for.
            h("details", { className: "dh-more-filters" },
              h("summary", null, "More filters"),
              h("div", { className: "dh-more-filters-body" },
                select("dh-type", "Property type", category, setCategory, types.map((key) => {
                  const supported = key === "all" || key === "apartment" || inventory.some((p) => p.category === key);
                  return [key, (key === "all" ? "All residential homes" : labels[key]) + (supported ? "" : " · no listings yet"), !supported];
                })),
                purpose === "buy" && h("div", { className: "dh-budget-mode", role: "group", "aria-label": "Budget type" },
                  [["total", "Total price"], ["monthly", "Monthly payment"]].map(([mode, label]) => button(label, () => { setBudgetMode(mode); setMinPrice(""); setMaxPrice(""); },
                    "dh-chip", { key: mode, "aria-pressed": budgetMode === mode }))),
                h("fieldset", { className: "dh-price-range", "aria-describedby": budgetProblem ? "dh-budget-error" : "dh-budget-summary" },
                  h("legend", null, budgetLabel),
                  h("div", { className: "dh-price-controls" },
                    h("div", null, h("label", { htmlFor: "dh-min-price" }, "Minimum"),
                      h("input", { id: "dh-min-price", type: "number", min: 0, step: "any", inputMode: "decimal", value: minPrice, placeholder: "Any",
                        "aria-invalid": !!budgetProblem, onChange: e => setMinPrice(e.target.value) })),
                    h("div", null, h("label", { htmlFor: "dh-max-price" }, "Maximum"),
                      h("input", { id: "dh-max-price", type: "number", min: 0, step: "any", inputMode: "decimal", value: maxPrice, placeholder: "Any",
                        "aria-invalid": !!budgetProblem, onChange: e => setMaxPrice(e.target.value) }))),
                  h("output", { id: "dh-budget-summary", className: "dh-search-note", "aria-live": "polite", "aria-atomic": true }, budgetSummary(minPrice, maxPrice, kind))),
                kind === "monthly" && h("p", { className: "dh-search-note" }, "Estimated home-loan payment with 20% down, 12% interest over 20 years. A rough guide, not a loan offer."),
                purpose === "rent" && h("p", { className: "dh-search-note" }, "Prices compare per month. Short stays need the owner or agency to confirm dates."),
                h("div", { className: "dh-more-actions" },
                  button(`Saved only (${savedCount})`, () => setSavedOnly((value) => !value), "dh-chip", { "aria-pressed": savedOnly }),
                  button("Map & advanced search", event => search(event, true), "dh-chip", { disabled: !!budgetProblem }),
                  button("Reset", resetAll, "dh-chip"))))))),
      h(OwnerFeed),
      h(AreaTiles, { inventory: available, onPick: (city) => { setLocation(city); setCategory("all"); setTimeout(toListings, 0); } }),
      h("section", { className: "dh-section", id: "dh-listings", "aria-labelledby": "dh-listings-title" },
        h("div", { className: "dh-section-heading" },
          h("h2", { id: "dh-listings-title" }, purpose === "rent" ? "Homes to rent" : "Homes for sale")),
        h(ResultsBar, { id: "dh-sort", count: shown.length, sortBy, onSort: setSortBy, purpose, invalid: !!budgetProblem }),
        h("div", { className: "dh-property-grid" }, shown.map((p) => h(PropertyCard, { key: p.id, property: p }))),
        !shown.length && h("p", { className: "dh-empty" },
          budgetProblem ? "Correct the budget above to view matching homes." : "No homes match yet. Try another area or budget.",
          " ", button("Clear filters", resetAll, "dh-text-button")),
        store.comparePropertyIds.length > 0 && button("Open comparison", () => go(store, "compare"))),
      h("section", { className: "dh-section dh-how", id: "dh-journeys", "aria-labelledby": "dh-how-title" },
        h("h2", { id: "dh-how-title" }, "How it works"),
        h("ol", { className: "dh-how-steps" }, [
          ["search", "Search", "Pick an area and budget."],
          ["enquire", "Enquire", "Ask through DwellHunt. We check every lister."],
          ["view", "View online", "Book a virtual viewing with the agent."],
        ].map(([key, title, text]) => h("li", { key }, h("span", { className: "dh-how-icon" }, icon(STEP_ICONS[key])), h("strong", null, title), h("p", null, text)))),
        h("p", { className: "dh-how-owners" }, "Own a home or work as an agent? ",
          button("List a property →", () => go(store, "list-property"), "dh-text-button"))),
      h(AgentStrip),
      h(AgentProfileOverlay),
      h("section", { className: "dh-vision", "aria-labelledby": "dh-vision-title" },
        h("div", { className: "dh-vision-panel" },
          h("h2", { id: "dh-vision-title", className: "dh-vision-brand" }, "DwellHunt"),
          h("div", { className: "dh-vision-block" }, h("h3", null, "Our Vision"),
            h("p", null, "To become Sri Lanka’s most trusted marketplace for apartment and condominium living.")),
          h("div", { className: "dh-vision-block" }, h("h3", null, "Our Mission"),
            h("p", null, "To connect people with the right homes through accurate listings, thoughtful guidance and seamless property journeys."))))
    );
  }
  function Footer() {
    return h(
      "footer",
      { className: "dh-home-footer" },
      h("strong", null, "DwellHunt"),
      h("span", null, "A Higher Way Home."),
      h("span", null, "Thoughtful property search for Sri Lanka"),
      h("a", { href: "./guides/", className: "dh-footer-link" }, "Renting & buying guides"),
      h("a", { href: "./privacy.html", className: "dh-footer-link" }, "Privacy Policy"),
      h("small", { className: "dh-footer-note" }, "DwellHunt checks who is listing a property but does not guarantee title, boundaries or approvals. Before paying any money, have a lawyer check the deed and do a title search."),
    );
  }
  return { Header, Home, Footer };
}
