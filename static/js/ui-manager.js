import { createElement } from "./dom.js";

export class UIManager {
  constructor({
    banner,
    bannerText,
    connectionPill,
    activityLabel,
    sessionRole,
    toastRoot,
    confirmDialog,
    confirmTitle,
    confirmMessage,
    confirmAccept,
    promptDialog,
    promptForm,
    promptTitle,
    promptMessage,
    promptLabel,
    promptInput,
    promptCancel,
  }) {
    this.banner = banner;
    this.bannerText = bannerText;
    this.connectionPill = connectionPill;
    this.activityLabel = activityLabel;
    this.sessionRole = sessionRole;
    this.toastRoot = toastRoot;
    this.confirmDialog = confirmDialog;
    this.confirmTitle = confirmTitle;
    this.confirmMessage = confirmMessage;
    this.confirmAccept = confirmAccept;
    this.promptDialog = promptDialog;
    this.promptForm = promptForm;
    this.promptTitle = promptTitle;
    this.promptMessage = promptMessage;
    this.promptLabel = promptLabel;
    this.promptInput = promptInput;
    this.promptCancel = promptCancel;
    this.pendingConfirm = null;
    this.pendingPrompt = null;

    this.confirmDialog.addEventListener("close", () => {
      if (!this.pendingConfirm) return;
      const resolve = this.pendingConfirm;
      this.pendingConfirm = null;
      resolve(this.confirmDialog.returnValue === "confirm");
    });

    this.promptForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.promptInput.value.trim()) {
        this.promptInput.focus();
        return;
      }
      this.promptDialog.close("submit");
    });

    this.promptCancel.addEventListener("click", () => {
      this.promptDialog.close("cancel");
    });

    this.promptDialog.addEventListener("close", () => {
      if (!this.pendingPrompt) return;
      const resolve = this.pendingPrompt;
      const shouldSubmit = this.promptDialog.returnValue === "submit";
      const value = shouldSubmit ? this.promptInput.value.trim() : null;
      this.pendingPrompt = null;
      this.promptInput.value = "";
      resolve(value || null);
    });
  }

  setBanner(message, tone = "neutral") {
    this.banner.dataset.tone = tone;
    this.bannerText.textContent = message;
  }

  setActivity(message) {
    this.activityLabel.textContent = message;
  }

  setConnectionState(state) {
    const labels = {
      connected: "Live Sync",
      connecting: "Linking",
      reconnecting: "Reconnecting",
      disconnected: "Offline",
    };
    this.connectionPill.dataset.state = state;
    this.connectionPill.textContent = labels[state] || "Offline";
  }

  setSessionRole(user) {
    if (!user) {
      this.sessionRole.dataset.role = "anonymous";
      this.sessionRole.textContent = "Disconnected";
      return;
    }

    this.sessionRole.dataset.role = user.role;
    this.sessionRole.textContent = `${user.role.toUpperCase()} session`;
  }

  setBusy(control, busy, busyLabel = "Working...") {
    if (!control) return;

    if (busy) {
      if (!control.dataset.idleLabel) {
        control.dataset.idleLabel = control.textContent || "";
      }
      control.disabled = true;
      control.setAttribute("aria-busy", "true");
      control.textContent = busyLabel;
      return;
    }

    control.disabled = false;
    control.removeAttribute("aria-busy");
    if (control.dataset.idleLabel) {
      control.textContent = control.dataset.idleLabel;
    }
  }

  notify(message, tone = "info") {
    const toast = createElement("div", {
      className: "toast",
      attrs: { "data-tone": tone },
      children: [
        createElement("div", {
          className: "toast-copy",
          children: [
            createElement("strong", { text: this.toastTitle(tone) }),
            createElement("p", { text: message }),
          ],
        }),
        createElement("button", {
          className: "toast-dismiss",
          text: "Dismiss",
          attrs: { type: "button", "aria-label": "Dismiss notification" },
        }),
      ],
    });

    const dismissButton = toast.querySelector(".toast-dismiss");
    const remove = () => {
      window.clearTimeout(timer);
      toast.remove();
    };
    dismissButton.addEventListener("click", remove);

    const timer = window.setTimeout(remove, 4500);
    this.toastRoot.append(toast);
  }

  toastTitle(tone) {
    return {
      success: "Completed",
      warning: "Attention",
      error: "Request failed",
      info: "Update",
    }[tone] || "Notice";
  }

  async confirm({ title, message, confirmLabel = "Confirm", tone = "danger" }) {
    if (this.pendingConfirm) {
      this.pendingConfirm(false);
      this.pendingConfirm = null;
    }
    if (this.confirmDialog.open) {
      this.confirmDialog.close("cancel");
    }

    this.confirmTitle.textContent = title;
    this.confirmMessage.textContent = message;
    this.confirmAccept.textContent = confirmLabel;
    this.confirmAccept.dataset.tone = tone;

    return new Promise((resolve) => {
      this.pendingConfirm = resolve;
      this.confirmDialog.showModal();
    });
  }

  async prompt({
    title,
    message,
    label = "Value",
    value = "",
  }) {
    if (this.pendingPrompt) {
      this.pendingPrompt(null);
      this.pendingPrompt = null;
    }
    if (this.promptDialog.open) {
      this.promptDialog.close("cancel");
    }

    this.promptTitle.textContent = title;
    this.promptMessage.textContent = message;
    this.promptLabel.textContent = label;
    this.promptInput.value = value;

    return new Promise((resolve) => {
      this.pendingPrompt = resolve;
      this.promptDialog.showModal();
      window.setTimeout(() => {
        this.promptInput.focus();
        this.promptInput.select();
      }, 0);
    });
  }
}
