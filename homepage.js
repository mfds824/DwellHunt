// Homepage presentation only. Marketplace state, routes and integrations remain in app.js.
export function createHomepage(
  React,
  useMarketplace,
  defaults,
  OriginalBrand,
  formatPrice,
) {
  const h = React.createElement;
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
            formatPrice(p.price, store.currency, p.purpose),
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
  function Featured() {
    const store = useMarketplace();
    const [tab, setTab] = React.useState("all");
    const featured = store.properties.filter(
      (p) => residential(p) && p.featured,
    );
    const tabs = [
      ["all", "All featured"],
      ...Object.entries(labels).filter(([key]) =>
        featured.some((p) => p.category === key),
      ),
    ];
    const properties = featured
      .filter((p) => tab === "all" || p.category === tab)
      .sort(
        (a, b) =>
          Number(b.category === "apartment") -
          Number(a.category === "apartment"),
      );
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
        h(
          "a",
          { href: "#dh-listings", className: "dh-button dh-featured-browse" },
          "Explore homes",
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
    const [showSearchShortcut, setShowSearchShortcut] = React.useState(false);
    React.useEffect(() => {
      const updateShortcut = () => setShowSearchShortcut(window.scrollY > 300);
      updateShortcut();
      window.addEventListener("scroll", updateShortcut, { passive: true });
      return () => window.removeEventListener("scroll", updateShortcut);
    }, []);
    const [purpose, setPurpose] = React.useState("buy");
    const [brief, setBrief] = React.useState("");
    const [location, setLocation] = React.useState("");
    const [minPrice, setMinPrice] = React.useState("");
    const [maxPrice, setMaxPrice] = React.useState("");
    const [bedrooms, setBedrooms] = React.useState("any");
    const [category, setCategory] = React.useState("apartment");
    const [sortBy, setSortBy] = React.useState("featured");
    const [layout, setLayout] = React.useState("grid");
    const [savedOnly, setSavedOnly] = React.useState(false);
    const inventory = store.properties.filter(residential);
    const types = ["all", ...Object.keys(labels)];
    const available = inventory.filter((p) => p.purpose === purpose);
    const cities = [...new Set(available.map((p) => p.city))].sort();
    const priceStep = purpose === "rent" ? 10000 : 1000000;
    const priceLimit =
      Math.ceil(
        Math.max(
          priceStep,
          ...available.map((p) => Number(p.price) || 0),
          Number(minPrice) || 0,
          Number(maxPrice) || 0,
        ) / priceStep,
      ) * priceStep;
    const changeMinimum = (value) => {
      setMinPrice(value);
      if (value !== "" && maxPrice !== "" && Number(value) > Number(maxPrice))
        setMaxPrice(value);
    };
    const changeMaximum = (value) => {
      setMaxPrice(value);
      if (value !== "" && minPrice !== "" && Number(value) < Number(minPrice))
        setMinPrice(value);
    };
    const priceText = (value) => `LKR ${Number(value).toLocaleString("en-LK")}`;
    const shown = available.filter(
      (p) =>
        (category === "all" || p.category === category) &&
        (!savedOnly || store.isPropertySaved(p.id)) &&
        (!location || p.city === location) &&
        (minPrice === "" || p.price >= Number(minPrice)) &&
        (maxPrice === "" || p.price <= Number(maxPrice)) &&
        (bedrooms === "any" || p.bedrooms >= Number(bedrooms)),
    );
    shown.sort((a, b) =>
      sortBy === "price_asc"
        ? a.price - b.price
        : sortBy === "price_desc"
          ? b.price - a.price
          : sortBy === "newest"
            ? new Date(b.updatedAt) - new Date(a.updatedAt)
            : Number(b.featured) - Number(a.featured),
    );
    const search = (event) => {
      event.preventDefault();
      store.setFilters({
        ...defaults,
        purpose,
        location,
        minPrice: minPrice === "" ? null : Number(minPrice),
        maxPrice: maxPrice === "" ? null : Number(maxPrice),
        bedrooms,
        category,
        sortBy,
      });
      go(store, "search");
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
      showSearchShortcut &&
        h(
          "a",
          {
            href: "#dh-ai-prompt",
            className: "dh-button dh-floating-search",
            "aria-label": "Return to home search",
            onClick: () =>
              document
                .getElementById("dh-ai-prompt")
                ?.focus({ preventScroll: true }),
          },
          "Find a home",
        ),
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
                "A short stay or a longer lease? Tell the agency your dates and preferred duration. Current listings show monthly prices; short-stay availability and nightly rates need agency confirmation.",
              ),
            h(
              "div",
              { className: "dh-filter-grid" },
              select("dh-location", "Location", location, setLocation, [
                ["", "Any location"],
                ...cities.map((city) => [city, city]),
              ]),
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
            h(
              "fieldset",
              { className: "dh-price-range" },
              h(
                "legend",
                null,
                purpose === "rent"
                  ? "Price range · LKR / month"
                  : "Price range · LKR",
              ),
              h(
                "div",
                { className: "dh-price-summary" },
                h(
                  "output",
                  { "aria-live": "polite", "aria-atomic": true },
                  `${priceText(minPrice || 0)} – ${maxPrice === "" ? "No maximum" : priceText(maxPrice)}${purpose === "rent" ? " / month" : ""}`,
                ),
                button(
                  "Reset",
                  () => {
                    setMinPrice("");
                    setMaxPrice("");
                  },
                  "dh-price-reset",
                  { "aria-label": "Reset price range" },
                ),
              ),
              h(
                "div",
                { className: "dh-price-controls" },
                h(
                  "div",
                  null,
                  h("label", { htmlFor: "dh-min-price" }, "Minimum price"),
                  h("input", {
                    id: "dh-min-price",
                    type: "number",
                    min: 0,
                    step: "any",
                    inputMode: "decimal",
                    value: minPrice,
                    placeholder: "0",
                    onChange: (e) => changeMinimum(e.target.value),
                  }),
                  h("input", {
                    type: "range",
                    min: 0,
                    max: priceLimit,
                    step: priceStep,
                    value: minPrice || 0,
                    "aria-label": "Adjust minimum price",
                    "aria-valuetext": priceText(minPrice || 0),
                    onChange: (e) => changeMinimum(e.target.value),
                  }),
                ),
                h(
                  "div",
                  null,
                  h("label", { htmlFor: "dh-max-price" }, "Maximum price"),
                  h("input", {
                    id: "dh-max-price",
                    type: "number",
                    min: 0,
                    step: "any",
                    inputMode: "decimal",
                    value: maxPrice,
                    placeholder: "No maximum",
                    onChange: (e) => changeMaximum(e.target.value),
                  }),
                  h("input", {
                    type: "range",
                    min: 0,
                    max: priceLimit,
                    step: priceStep,
                    value: maxPrice === "" ? priceLimit : maxPrice,
                    "aria-label": "Adjust maximum price",
                    "aria-valuetext":
                      maxPrice === "" ? "No maximum" : priceText(maxPrice),
                    onChange: (e) =>
                      changeMaximum(
                        e.target.value === String(priceLimit)
                          ? ""
                          : e.target.value,
                      ),
                  }),
                ),
              ),
            ),
            h(
              "button",
              { type: "submit", className: "dh-button dh-search-submit" },
              "Explore listings",
            ),
          ),
        ),
      ),
      h(Featured),
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
          h("p", null, "Picture your life here. Save the homes you love, compare the details, and find the place that feels like you."),
        ),
        h(
          "p",
          { role: "status", className: "dh-results-note" },
          `${shown.length} ${purpose === "rent" ? "rental" : "sale"} listing${shown.length === 1 ? "" : "s"} matching your filters.`,
          purpose === "rent" ? " Rental prices are per month." : "",
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
            button("More filters & map", search, "dh-property-tab"),
            button(
              "Reset filters",
              () => {
                setLocation("");
                setMinPrice("");
                setMaxPrice("");
                setBedrooms("any");
                setCategory("apartment");
                setSavedOnly(false);
                setSortBy("featured");
              },
              "dh-property-tab",
            ),
          ),
          h(
            "div",
            { className: "dh-toolbar-actions" },
            select("dh-sort", "Sort listings", sortBy, setSortBy, [
              ["featured", "Featured first"],
              ["price_asc", "Price: low to high"],
              ["price_desc", "Price: high to low"],
              ["newest", "Recently updated"],
            ]),
            h(
              "div",
              {
                role: "group",
                "aria-label": "Listing layout",
                className: "dh-layout-toggle",
              },
              ["grid", "list"].map((value) =>
                button(
                  value === "grid" ? "Grid" : "List",
                  () => setLayout(value),
                  "dh-property-tab",
                  { key: value, "aria-pressed": value === layout },
                ),
              ),
            ),
          ),
        ),
        h(
          "div",
          {
            className: `dh-property-grid ${layout === "list" ? "dh-property-list" : ""}`,
          },
          shown.map((p) => h(PropertyCard, { key: p.id, property: p })),
        ),
        !shown.length &&
          h(
            "p",
            { className: "dh-empty" },
            "No matching homes in the current inventory. Try another location, budget or property type.",
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
      h(
        "section",
        { className: "dh-photo-guide" },
        h(
          "div",
          null,
          h("p", { className: "dh-eyebrow" }, "Thoughtful presentation"),
          h("h2", null, "Show the home as it is."),
          h(
            "p",
            null,
            "Choose an actual property photo that clearly shows the space. Keep the camera level, frame rooms naturally and order photos like a walk through the home. Use gentle lighting and colour adjustments that stay true to the property.",
          ),
        ),
        h(
          "div",
          null,
          h("h3", null, "AI guidance · awaiting connection"),
          h(
            "p",
            null,
            "AI cover selection, framing and photo-order suggestions, natural lighting and colour adjustments, listing-copy drafting and missing-detail checks need a connected service before they can be offered here.",
          ),
          h(
            "p",
            null,
            "Keep original photos available and review every suggested change. Never remove defects, add features or alter the property’s appearance.",
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
    );
  }
  return { Header, Home, Footer };
}
