import { createElement, replaceChildren } from "./dom.js";
import { formatDateLabel, formatFileSize } from "./formatters.js";

export class ExplorerManager {
  constructor({ root, pathLabel, summaryLabel, onOpenDirectory, onPlayMedia, onRename, onDelete, onSettings }) {
    this.root = root;
    this.pathLabel = pathLabel;
    this.summaryLabel = summaryLabel;
    this.onOpenDirectory = onOpenDirectory;
    this.onPlayMedia = onPlayMedia;
    this.onRename = onRename;
    this.onDelete = onDelete;
    this.onSettings = onSettings;
    this.listing = null;
    this.query = "";
    this.permissions = {
      canRename: false,
      canDelete: false,
    };

    this.root.addEventListener("click", (event) => {
      const actionTarget = event.target.closest("[data-action]");
      if (!actionTarget) return;

      const path = actionTarget.dataset.path || "";
      switch (actionTarget.dataset.action) {
        case "open":
          this.onOpenDirectory(path);
          break;
        case "play":
          this.onPlayMedia(path);
          break;
        case "rename":
          this.onRename(path);
          break;
        case "delete":
          this.onDelete(path);
          break;
        case "settings":
          this.onSettings(path);
          break;
        default:
          break;
      }
    });
  }

  setPermissions(permissions) {
    this.permissions = { ...this.permissions, ...permissions };
    this.render();
  }

  setListing(listing) {
    this.listing = listing;
    this.pathLabel.textContent = `shared_media/${listing.path || ""}`;
    this.render();
  }

  setQuery(query) {
    this.query = query.trim().toLowerCase();
    this.render();
  }

  clear() {
    this.listing = null;
    this.query = "";
    this.pathLabel.textContent = "shared_media/";
    this.summaryLabel.textContent = "No folder loaded.";
    replaceChildren(this.root, [
      createElement("p", {
        className: "section-note empty-state",
        text: "Authenticate to browse the shared media folder.",
      }),
    ]);
  }

  getVisibleItems() {
    const items = (this.listing && this.listing.items) || [];
    if (!this.query) {
      return items;
    }
    return items.filter((item) =>
      [item.name, item.path].some((value) => value.toLowerCase().includes(this.query)),
    );
  }

  render() {
    if (!this.listing) {
      this.clear();
      return;
    }

    const visibleItems = this.getVisibleItems();
    const totalCount = this.listing.items.length;
    this.summaryLabel.textContent = this.query
      ? `${visibleItems.length} of ${totalCount} items match "${this.query}".`
      : `${totalCount} item${totalCount === 1 ? "" : "s"} in this folder.`;

    if (!visibleItems.length) {
      const message = this.query
        ? `No files or folders match "${this.query}".`
        : "This directory is empty.";
      replaceChildren(this.root, [
        createElement("p", {
          className: "section-note empty-state",
          text: message,
        }),
      ]);
      return;
    }

    replaceChildren(
      this.root,
      visibleItems.map((item) => this.buildItem(item)),
    );
  }

  buildItem(item) {
    const descriptor = item.is_dir ? "Folder" : item.media ? "Indexed media" : "File";
    const titleBlock = createElement(item.is_dir ? "button" : "div", {
      className: item.is_dir ? "explorer-item-main is-button" : "explorer-item-main",
      attrs: item.is_dir
        ? {
            type: "button",
            "data-action": "open",
            "data-path": item.path,
            "aria-label": `Open folder ${item.name}`,
          }
        : {},
      children: [
        createElement("span", { className: "explorer-item-kind", text: descriptor }),
        createElement("strong", { text: item.name }),
      ],
    });

    const meta = createElement("div", {
      className: "explorer-item-meta",
      children: [
        item.locked ? createElement("span", { className: "meta-tag warning-tag", text: "PIN" }) : null,
        item.adult_only ? createElement("span", { className: "meta-tag error-tag", text: "R18" }) : null,
        createElement("span", {
          className: "meta-tag",
          text: item.is_dir ? "DIR" : formatFileSize(item.size),
        }),
        createElement("span", {
          className: "meta-tag",
          text: formatDateLabel(item.modified_at),
        }),
      ],
    });

    const actionChildren = [];
    if (item.is_dir) {
      actionChildren.push(
        createElement("button", {
          className: "ghost-button small-button",
          text: "Open",
          attrs: { type: "button", "data-action": "open", "data-path": item.path },
        }),
      );
    }
    if (item.media) {
      actionChildren.push(
        createElement("button", {
          className: "ghost-button small-button",
          text: "Play",
          attrs: { type: "button", "data-action": "play", "data-path": item.path },
        }),
      );
    }
    if (this.permissions.canRename) {
      actionChildren.push(
        createElement("button", {
          className: "ghost-button small-button",
          text: "Rename",
          attrs: { type: "button", "data-action": "rename", "data-path": item.path },
        }),
      );
    }
    if (this.permissions.canDelete) {
      actionChildren.push(
        createElement("button", {
          className: "ghost-button small-button",
          text: "Delete",
          attrs: { type: "button", "data-action": "delete", "data-path": item.path },
        }),
      );
    }
    if (this.permissions.isAdmin && item.is_dir) {
      actionChildren.push(
        createElement("button", {
          className: "ghost-button small-button",
          text: "Settings",
          attrs: { type: "button", "data-action": "settings", "data-path": item.path },
        }),
      );
    }

    const actions = createElement("div", {
      className: "explorer-item-actions",
      children: actionChildren,
    });

    return createElement("article", {
      className: "explorer-item",
      children: [
        createElement("div", {
          className: "explorer-item-copy",
          children: [titleBlock, meta],
        }),
        actions,
      ],
    });
  }
}
