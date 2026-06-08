import { createElement, replaceChildren } from "./dom.js";
import { flattenLibrary, formatDuration, formatResolution } from "./formatters.js";
import { thumbUrl } from "./utils.js";

export class GalleryManager {
  constructor({ root, hero, onPlay }) {
    this.root = root;
    this.hero = hero;
    this.onPlay = onPlay;
    this.library = [];
    this.featured = null;
    this.query = "";

    this.root.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      const card = event.target.closest("[data-media-id]");
      if (!card) return;

      const media = this.findMedia(Number(card.dataset.mediaId));
      if (!media) return;

      this.featured = media;
      this.render();

      if (actionTarget && actionTarget.dataset && actionTarget.dataset.action === "play") {
        this.onPlay(media);
      }
    });
  }

  setLibrary(groups) {
    this.library = Array.isArray(groups) ? groups : [];
    this._mediaMap = new Map();
    flattenLibrary(this.library).forEach(item => this._mediaMap.set(item.id, item));
    this.render();
  }

  setQuery(query) {
    this.query = query.trim().toLowerCase();
    this.render();
  }

  clear() {
    this.library = [];
    this.featured = null;
    this.query = "";
    if (this._mediaMap) this._mediaMap.clear();
    this.render();
  }

  getVisibleGroups() {
    if (!this.query) {
      return this.library;
    }

    return this.library
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          [item.title, item.category, item.relative_path].some((value) =>
            value.toLowerCase().includes(this.query),
          ),
        ),
      }))
      .filter((group) => group.items.length);
  }

  get visibleGroups() {
    return this.getVisibleGroups();
  }

  get visibleItems() {
    return flattenLibrary(this.visibleGroups);
  }

  findMedia(mediaId) {
    if (this._mediaMap) return this._mediaMap.get(mediaId) || null;
    return flattenLibrary(this.library).find((item) => item.id === mediaId) || null;
  }

  ensureFeatured(groups) {
    // Keep the current featured item if it still exists in the library to avoid jarring search switches
    if (this.featured && this.findMedia(this.featured.id)) {
      return;
    }

    const items = flattenLibrary(groups);
    if (!items.length) {
      this.featured = null;
      return;
    }

    this.featured = items[0];
  }

  render() {
    const groups = this.getVisibleGroups();
    this.ensureFeatured(groups);
    this.renderHero();
    this.renderRows(groups);
  }

  renderHero() {
    const item = this.featured;
    this.hero.title.textContent = item ? item.title : "Scan your library to begin.";
    this.hero.description.textContent = item
      ? this.describeItem(item)
      : "MediaHub keeps every asset on your network while surfacing it like a polished home screen.";
    this.hero.thumb.src = thumbUrl(item);
    this.hero.thumb.alt = item ? `${item.title} artwork` : "Featured artwork";
    this.hero.badge.textContent = this.badgeLabel(item);
    this.hero.play.disabled = !item;

    if (!item) {
      replaceChildren(this.hero.meta, [
        createElement("span", {
          className: "meta-chip",
          text: "Awaiting first library scan",
        }),
      ]);
      return;
    }

    replaceChildren(this.hero.meta, [
      createElement("span", { className: "meta-chip", text: item.category }),
      createElement("span", {
        className: "meta-chip",
        text: item.stream_mode === "direct" ? "Direct play" : "Adaptive HLS",
      }),
      createElement("span", {
        className: "meta-chip",
        text: formatDuration(item.duration_seconds),
      }),
      createElement("span", {
        className: "meta-chip",
        text: formatResolution(item.width, item.height),
      }),
      createElement("span", {
        className: "meta-chip",
        text: item.requires_pin ? "PIN protected" : "Session ready",
      }),
    ]);
  }

  describeItem(item) {
    const details = [
      `From ${item.category}`,
      item.stream_mode === "direct" ? "starts instantly" : "streams through HLS",
      item.requires_pin ? "requires the admin PIN" : "is open to the current session",
    ];

    if (item.duration_seconds) {
      details.push(`runs for ${formatDuration(item.duration_seconds).toLowerCase()}`);
    }

    return `${details.join(", ")}.`;
  }

  badgeLabel(item) {
    if (!item) {
      return "Offline Ready";
    }
    if (item.adult_only) {
      return "18+ Restricted";
    }
    if (item.requires_pin) {
      return "PIN Required";
    }
    return item.stream_mode === "direct" ? "Direct Play" : "Adaptive Stream";
  }

  renderRows(groups) {
    if (!groups.length) {
      const message = this.query
        ? `No titles match "${this.query}".`
        : "No indexed media found in shared_media/.";
      replaceChildren(this.root, [
        createElement("p", {
          className: "section-note empty-state",
          text: message,
        }),
      ]);
      return;
    }

    const emptyState = this.root.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    // Map existing cards to reuse DOM nodes (diffing approach)
    const existingCards = new Map();
    this.root.querySelectorAll('.media-card').forEach(card => {
      existingCards.set(card.dataset.mediaId, card);
    });

    const existingSections = Array.from(this.root.children).filter(el => el.classList.contains('gallery-row'));
    let sectionIdx = 0;

    for (const group of groups) {
      let section = existingSections[sectionIdx];
      if (!section) {
        section = createElement("section", { className: "gallery-row" });
        this.root.append(section);
      }

      let header = section.querySelector('.section-header');
      if (!header) {
        header = createElement("div", { className: "section-header compact-header" });
        section.insertBefore(header, section.firstChild);
      }

      const headerCopy = createElement("div", {
        children: [
          createElement("p", { className: "eyebrow", text: "Collection" }),
          createElement("h3", { text: group.label }),
        ],
      });

      const headerCount = createElement("span", {
        className: "collection-count",
        text: `${group.items.length} titles`,
      });
      replaceChildren(header, [headerCopy, headerCount]);

      let track = section.querySelector('.gallery-track');
      if (!track) {
        track = createElement("div", { className: "gallery-track", attrs: { role: "list" } });
        section.append(track);
      }

      const trackCards = [];
      for (const item of group.items) {
        const isFeatured = this.featured && item.id === this.featured.id;
        const expectedClass = `media-card${isFeatured ? " is-featured" : ""}`;

        let card = existingCards.get(String(item.id));
        if (card) {
          if (card.className !== expectedClass) {
            card.className = expectedClass;
          }
          existingCards.delete(String(item.id));
        } else {
          card = this.buildCard(item);
        }
        trackCards.push(card);
      }

      replaceChildren(track, trackCards);
      sectionIdx++;
    }

    // Remove excess unneeded sections
    while (this.root.children.length > sectionIdx) {
      this.root.lastChild.remove();
    }
  }

  buildCard(item) {
    const isFeatured = this.featured && item.id === this.featured.id;
    const article = createElement("article", {
      className: `media-card${isFeatured ? " is-featured" : ""}`,
      dataset: { mediaId: item.id },
    });

    const coverButton = createElement("button", {
      className: "media-card-select",
      attrs: {
        type: "button",
        "data-action": "select",
        "aria-label": `Feature ${item.title}`,
      },
      children: [
        createElement("div", {
          className: "media-card-flags",
          children: [
            item.requires_pin
              ? createElement("span", { className: "locked-badge", text: "PIN" })
              : null,
            item.adult_only
              ? createElement("span", { className: "adult-badge", text: "18+" })
              : null,
          ],
        }),
        createElement("img", {
          attrs: {
            src: thumbUrl(item),
            alt: `${item.title} cover art`,
            loading: "lazy",
          },
        }),
      ],
    });

    const title = createElement("strong", { text: item.title });
    const meta = createElement("p", {
      text: [
        item.stream_mode === "direct" ? "Direct" : "HLS",
        formatDuration(item.duration_seconds),
      ].join(" / "),
    });

    const footer = createElement("div", {
      className: "media-card-footer",
      children: [
        createElement("div", {
          className: "media-card-copy",
          children: [title, meta],
        }),
        createElement("button", {
          className: "ghost-button small-button media-card-play",
          text: "Play",
          attrs: {
            type: "button",
            "data-action": "play",
            "aria-label": `Play ${item.title}`,
          },
        }),
      ],
    });

    article.append(coverButton, footer);
    return article;
  }
}
