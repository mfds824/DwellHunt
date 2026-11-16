import { SORT_OPTIONS, budgetPresets, budgetValue, budgetError, selectedBudgetPreset, budgetSummary, rentalPeriod, filterHomeListings, sortHomeListings, locationSuggestions, locationQuery } from "./homepage-search.js?v=20261115-loc1";
import { createOwnerFeed } from "./owner-listings-feed.js?v=20261116-pr1";
import { createAgentProfiles } from "./agent-profiles.js?v=20261116-pr1";
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
  const { AgentStories, AgentProfileOverlay } = createAgentProfiles(React);
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
          "a",
          { href: "#dh-ai-prompt", className: "dh-nav-link" },
          "AI search",
        ),
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
        h(
          "ul",
          { className: "dh-property-specs", "aria-label": "Property details" },
          h("li", null, `${p.bedrooms ?? "—"} Beds`),
          h("li", null, `${p.bathrooms ?? "—"} Baths`),
          h("li", null, `${p.floorAreaSqFt?.toLocaleString() || "—"} sq ft`),
        ),
        p.agencyName &&
          button(
            p.agencyName,
            () => store.navigateToAgency(p.agencyId),
            "dh-agency-link",
          ),
        p.updatedAt &&
          h(
            "p",
            { className: "dh-agency" },
            `Updated ${new Date(p.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" })}`,
          ),
        button(
          "View details",
          () => store.navigateToProperty(p.id),
          "dh-text-button",
        ),
      ),
    );
  }
  function ResultsBar({ id, count, sortBy, onSort, featured = false, purpose, shown = count, invalid = false }) {
    return h("div", { className: "dh-results-bar" },
      h("p", { role: "status", className: "dh-results-note", "aria-live": "polite" }, invalid ? "Correct the budget to see matching listings." :
        `${count} ${featured ? "featured" : "matching"} ${purpose === "rent" ? "rental" : "sale"} listing${count === 1 ? "" : "s"}${shown < count ? ` · showing ${shown}` : ""}${purpose === "rent" ? " · LKR/month comparison" : ""}`),
      h("label", { htmlFor: id, className: "dh-sort-control" }, "Sort by",
        h("select", { id, value: sortBy, onChange: event => onSort(event.target.value), "aria-label": featured ? "Sort featured properties by" : "Sort matching listings by" },
          SORT_OPTIONS.map(([value, label]) => h("option", { key: value, value }, label)))));
  }
  function Featured({ purpose, sortBy, onSort }) {
    const store = useMarketplace();
    const [tab, setTab] = React.useState("all");
    const featured = store.properties.filter(
      (p) => residential(p) && p.featured && p.purpose === purpose,
    );
    const tabs = [
      ["all", "All featured"],
      ...Object.entries(labels).filter(([key]) =>
        featured.some((p) => p.category === key),
      ),
    ];
    const properties = sortHomeListings(featured.filter((p) => tab === "all" || p.category === tab), sortBy);
    if (!featured.length) return null;
    return h(
      "section",
      {
        className: "dh-section dh-featured",
        "aria-labelledby": "dh-featured-title",
      },
      h(
        "div",
        { className: "dh-section-heading" },
        h(
          "div",
          null,
          h("p", { className: "dh-eyebrow" }, "From the existing portfolio"),
          h("h2", { id: "dh-featured-title" }, "Featured properties"),
        ),
      ),
      h(
        "div",
        {
          className: "dh-property-tabs",
          role: "group",
          "aria-label": "Featured property types",
        },
        tabs.map(([key, label]) =>
          button(label, () => setTab(key), "dh-property-tab", {
            key,
            "aria-pressed": tab === key,
          }),
        ),
      ),
      h(ResultsBar, { id: "dh-featured-sort", count: properties.length, sortBy, onSort, featured: true, purpose, shown: Math.min(6, properties.length) }),
      h(
        "div",
        { className: "dh-property-grid" },
        properties
          .slice(0, 6)
          .map((p) => h(PropertyCard, { key: p.id, property: p })),
      ),
    );
  }
  function Home() {
    const store = useMarketplace();
    const [purpose, setPurpose] = React.useState("buy");
    const [brief, setBrief] = React.useState("");
    const [location, setLocation] = React.useState("");
    const [minPrice, setMinPrice] = React.useState("");
    const [maxPrice, setMaxPrice] = React.useState("");
    const [bedrooms, setBedrooms] = React.useState("any");
    const [category, setCategory] = React.useState("apartment");
    const [sortBy, setSortBy] = React.useState("newest");
    const [savedOnly, setSavedOnly] = React.useState(false);
    const inventory = store.properties.filter(residential);
    const types = ["all", ...Object.keys(labels)];
    const available = inventory.filter((p) => p.purpose === purpose);
    const cities = [...new Set(available.map((p) => p.city))].sort();
    const budgetProblem = budgetError(minPrice, maxPrice, purpose);
    const activePreset = selectedBudgetPreset(minPrice, maxPrice, purpose);
    const shown = sortHomeListings(filterHomeListings(inventory, {
      purpose, category, location, minPrice, maxPrice, bedrooms, savedOnly,
    }, store.isPropertySaved), sortBy);
    const search = (event, advanced = false) => {
      event.preventDefault();
      if (budgetProblem) return;
      store.setFilters({
        ...defaults, purpose, location: locationQuery(location),
        minPrice: budgetValue(minPrice, purpose), maxPrice: budgetValue(maxPrice, purpose),
        bedrooms, category, sortBy,
      });
      if (advanced) go(store, "search");
      else document.getElementById("dh-listings")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const select = (id, title, value, onChange, options) =>
      h(
        "label",
        { htmlFor: id },
        title,
        h(
          "select",
          {
            id,
            value,
            "aria-label": title,
            onChange: (e) => onChange(e.target.value),
          },
          options.map(([value, text, disabled = false]) =>
            h("option", { key: value, value, disabled }, text),
          ),
        ),
      );
    const steps = (items) =>
      h(
        "ol",
        { className: "dh-steps" },
        items.map(([title, text]) =>
          h("li", { key: title }, h("strong", null, title), h("p", null, text)),
        ),
      );
    return h(
      "div",
      { id: "dh-home", className: "dh-home" },
      h(
        "section",
        { className: "dh-hero", "aria-labelledby": "dh-motto" },
        h("img", {
          className: "dh-hero-photo",
          src: "./assets/colombo-condo-hero.png",
          alt: "A golden-hour Colombo condominium interior overlooking the skyline, with a couple and their realtor on the right",
          fetchPriority: "high",
          width: 1671,
          height: 941,
        }),
        h(
          "div",
          { className: "dh-hero-content" },
          h(
            "p",
            { className: "dh-eyebrow" },
            "Sri Lanka’s Premier Apartment & Condo Marketplace",
          ),
          h("h1", { id: "dh-motto" }, "A Higher Way Home."),
          h(
            "p",
            { className: "dh-intro" },
            "Room to breathe. A city to call home. Discover Sri Lankan apartments and condominiums, starting with Colombo.",
          ),
          h(
            "form",
            {
              className: "dh-home-search",
              onSubmit: search,
              "aria-label": "Find a home",
            },
            h(
              "div",
              { className: "dh-search-top" },
              h(
                "div",
                {
                  className: "dh-mode",
                  role: "group",
                  "aria-label": "Buy or rent",
                },
                ["buy", "rent"].map((mode) =>
                  button(
                    mode === "buy" ? "Buy" : "Rent",
                    () => {
                      setPurpose(mode);
                      setMinPrice("");
                      setMaxPrice("");
                      setLocation("");
                    },
                    "dh-mode-button",
                    { key: mode, "aria-pressed": purpose === mode },
                  ),
                ),
              ),
              h("span", { className: "dh-ai-label" }, "✧ AI-assisted search"),
            ),
            h(
              "label",
              { htmlFor: "dh-ai-prompt", className: "dh-prompt-label" },
              "Describe the apartment you’re looking for.",
            ),
            h("textarea", {
              id: "dh-ai-prompt",
              rows: 2,
              value: brief,
              onChange: (event) => setBrief(event.target.value),
              maxLength: 1200,
              placeholder:
                "A quiet two-bedroom apartment in Colombo, close to work…",
              "aria-describedby": "dh-ai-status",
            }),
            h(
              "p",
              { id: "dh-ai-status", className: "dh-search-note" },
              "Plan your search here. AI matching is not connected yet; this note stays on this page and is not used to filter listings. Use the filters below to explore homes.",
            ),
            purpose === "rent" &&
              h(
                "p",
                { className: "dh-rental-note", role: "status" },
                "Budgets and price sorting use LKR per month. Other billing periods use approximate monthly equivalents; each card keeps its actual period. Short-stay dates still need owner or agency confirmation.",
              ),
            h(
              "div",
              { className: "dh-filter-grid" },
              h(
                "label",
                { htmlFor: "dh-location" },
                "Location",
                h("input", {
                  id: "dh-location",
                  type: "search",
                  value: location,
                  list: "dh-location-options",
                  autoComplete: "off",
                  maxLength: 80,
                  placeholder: "Search area, e.g. Colombo 07 or Galle",
                  "aria-label": "Location",
                  onChange: (event) => setLocation(event.target.value),
                }),
                h(
                  "datalist",
                  { id: "dh-location-options" },
                  locationSuggestions(cities).map((place) =>
                    h("option", { key: place, value: place }),
                  ),
                ),
              ),
              select("dh-beds", "Bedrooms", bedrooms, setBedrooms, [
                ["any", "Any bedrooms"],
                ["1", "1+ bedrooms"],
                ["2", "2+ bedrooms"],
                ["3", "3+ bedrooms"],
                ["4", "4+ bedrooms"],
              ]),
              select(
                "dh-type",
                "Property type",
                category,
                setCategory,
                types.map((key) => {
                  const supported =
                    key === "all" ||
                    key === "apartment" ||
                    inventory.some((p) => p.category === key);
                  return [
                    key,
                    (key === "all" ? "All residential homes" : labels[key]) +
                      (supported ? "" : " · no listings yet"),
                    !supported,
                  ];
                }),
              ),
            ),
            h("fieldset", { className: "dh-price-range", "aria-describedby": budgetProblem ? "dh-budget-error" : "dh-budget-summary" },
              h("legend", null, purpose === "rent" ? "Your budget · LKR thousands / month" : "Your budget · LKR millions"),
              h("div", { className: "dh-budget-presets", role: "group", "aria-label": "Budget presets" },
                budgetPresets(purpose).map(preset => button(preset.label, () => { setMinPrice(preset.min); setMaxPrice(preset.max); }, "dh-property-tab", {
                  key: preset.id, "aria-pressed": activePreset === preset.id,
                }))),
              h("div", { className: "dh-price-summary" },
                h("output", { id: "dh-budget-summary", "aria-live": "polite", "aria-atomic": true }, budgetSummary(minPrice, maxPrice, purpose)),
                button("Reset", () => { setMinPrice(""); setMaxPrice(""); }, "dh-price-reset", { "aria-label": "Reset budget" })),
              h("div", { className: "dh-price-controls" },
                h("div", null, h("label", { htmlFor: "dh-min-price" }, purpose === "rent" ? "Minimum (thousands / month)" : "Minimum (millions)"),
                  h("input", { id: "dh-min-price", type: "number", min: 0, step: "any", inputMode: "decimal", value: minPrice, placeholder: "Any minimum",
                    "aria-invalid": !!budgetProblem, "aria-describedby": budgetProblem ? "dh-budget-error" : "dh-budget-summary", onChange: e => setMinPrice(e.target.value) })),
                h("div", null, h("label", { htmlFor: "dh-max-price" }, purpose === "rent" ? "Maximum (thousands / month)" : "Maximum (millions)"),
                  h("input", { id: "dh-max-price", type: "number", min: 0, step: "any", inputMode: "decimal", value: maxPrice, placeholder: "No maximum",
                    "aria-invalid": !!budgetProblem, "aria-describedby": budgetProblem ? "dh-budget-error" : "dh-budget-summary", onChange: e => setMaxPrice(e.target.value) }))),
              budgetProblem ? h("p", { id: "dh-budget-error", className: "dh-budget-error", role: "alert" }, budgetProblem) :
                h("p", { className: "dh-budget-count", role: "status", "aria-live": "polite" }, `${shown.length} matching listing${shown.length === 1 ? "" : "s"}${purpose === "rent" ? " · monthly price comparison" : ""}`),
              h("p", { className: "dh-search-note" }, "Leave either field empty for no limit. “Under” excludes its upper limit; other ranges include both limits.")),
            h(
              "button",
              { type: "submit", className: "dh-button dh-search-submit", disabled: !!budgetProblem },
              "Explore listings",
            ),
          ),
        ),
      ),
      h(Featured, { purpose, sortBy, onSort: setSortBy }),
      h(
        "section",
        {
          className: "dh-section",
          id: "dh-listings",
          "aria-labelledby": "dh-listings-title",
        },
        h(
          "div",
          { className: "dh-section-heading" },
          h(
            "div",
            null,
            h("p", { className: "dh-eyebrow" }, "A place to begin"),
            h("h2", { id: "dh-listings-title" }, "Find your kind of home."),
          ),
        ),
        h(
          "div",
          { className: "dh-listings-toolbar" },
          h(
            "div",
            { className: "dh-toolbar-actions" },
            button(
              `Saved only (${inventory.filter((p) => store.isPropertySaved(p.id)).length})`,
              () => setSavedOnly((value) => !value),
              "dh-property-tab",
              { "aria-pressed": savedOnly },
            ),
            button("More filters & map", event => search(event, true), "dh-property-tab", { disabled: !!budgetProblem }),
            button(
              "Reset filters",
              () => {
                setLocation("");
                setMinPrice("");
                setMaxPrice("");
                setBedrooms("any");
                setCategory("apartment");
                setSavedOnly(false);
                setSortBy("newest");
              },
              "dh-property-tab",
            ),
          ),
        ),
        h(ResultsBar, { id: "dh-sort", count: shown.length, sortBy, onSort: setSortBy, purpose, invalid: !!budgetProblem }),
        h(
          "div",
          {
            className: "dh-property-grid",
          },
          shown.map((p) => h(PropertyCard, { key: p.id, property: p })),
        ),
        !shown.length &&
          h(
            "p",
            { className: "dh-empty" },
            budgetProblem ? "Correct the budget above to view matching homes." : "No matching homes in the current inventory. Try another location, budget or property type.",
          ),
        store.comparePropertyIds.length > 0 &&
          button("Open comparison", () => go(store, "compare")),
      ),
      h(
        "section",
        { className: "dh-section dh-journeys", id: "dh-journeys" },
        h("p", { className: "dh-eyebrow" }, "A little guidance, at every step"),
        h("h2", null, "Move forward with clarity."),
        h(
          "div",
          { className: "dh-journey-grid" },
          h(
            "article",
            null,
            h("h3", null, "For buyers & renters"),
            steps([
              [
                "Set your goals & expectations",
                "Start with how you want to live: your move date, commute, budget and must-haves. For rentals, decide whether you need a short stay or a longer lease.",
              ],
              [
                "Find suitable matches",
                "Use location, budget, bedrooms and property type to narrow the existing listings. Save suitable homes and compare the details side by side.",
              ],
              [
                "Talk to the agency",
                "Ask about availability, fees and anything the listing does not explain.",
              ],
              [
                "Request a viewing",
                "Open the property details to enquire or request a virtual viewing. The agency confirms the arrangements.",
              ],
            ]),
            h(
              "a",
              { href: "#dh-listings", className: "dh-text-button" },
              "Explore homes →",
            ),
          ),
          h(
            "article",
            null,
            h("h3", null, "For owners & listing agents"),
            steps([
              [
                "Add property details",
                "Enter the location, price, specifications and features accurately.",
              ],
              [
                "Prepare your photos",
                "Choose a clear cover from your actual property photos. Keep walls straight, show useful room angles and upload your photo through the existing form.",
              ],
              [
                "Review & submit",
                "Check your description, details and image before using the final publish step.",
              ],
              [
                "Follow the listing",
                "Use the Agency Portal to review locally stored listings and enquiries. Submission status tracking is not connected yet.",
              ],
            ]),
            button(
              "Start your listing →",
              () => go(store, "list-property"),
              "dh-text-button",
            ),
          ),
        ),
      ),
      h(AgentStories),
      h(OwnerFeed),
      h(AgentProfileOverlay),
      h(
        "section",
        {
          className: "dh-vision",
          "aria-labelledby": "dh-vision-title",
        },
        h(
          "div",
          { className: "dh-vision-panel" },
          h("p", { className: "dh-vision-brand" }, "DwellHunt"),
          h(
            "h2",
            { id: "dh-vision-title", className: "dh-vision-tagline" },
            "A Higher Way Home.",
          ),
          h(
            "div",
            { className: "dh-vision-block" },
            h("h3", null, "Our Vision"),
            h(
              "p",
              null,
              "To become Sri Lanka’s most trusted marketplace for apartment and condominium living.",
            ),
          ),
          h(
            "div",
            { className: "dh-vision-block" },
            h("h3", null, "Our Mission"),
            h(
              "p",
              null,
              "To connect people with the right homes through accurate listings, thoughtful guidance and seamless property journeys.",
            ),
          ),
        ),
      ),
      h(
        "section",
        { className: "dh-section dh-closing" },
        h("p", { className: "dh-eyebrow" }, "Your next chapter"),
        h("h2", null, "Take the next step at your pace."),
        button(
          "Explore homes",
          () => document.getElementById("dh-listings").scrollIntoView(),
          "dh-button",
        ),
        button("Agency Portal", () => go(store, "dashboard"), "dh-text-button"),
      ),
    );
  }
  function Footer() {
    return h(
      "footer",
      { className: "dh-home-footer" },
      h("strong", null, "DwellHunt"),
      h("span", null, "A Higher Way Home."),
      h("span", null, "Thoughtful property search for Sri Lanka"),
      h("a", { href: "./privacy.html", className: "dh-footer-link" }, "Privacy Policy"),
      h("small", { className: "dh-footer-note" }, "DwellHunt checks who is listing a property but does not guarantee title, boundaries or approvals. Before paying any money, have a lawyer check the deed and do a title search."),
    );
  }
  return { Header, Home, Footer };
}
