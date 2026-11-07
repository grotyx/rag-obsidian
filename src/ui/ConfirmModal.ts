import { App, Modal } from "obsidian";

/** Minimal yes/no dialog. Resolves true on the confirm button, false on cancel or Esc/close. */
export function confirmModal(app: App, title: string, message: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const modal = new (class extends Modal {
      onOpen(): void {
        this.titleEl.setText(title);
        this.contentEl.createEl("p", { text: message });
        const row = this.contentEl.createDiv({ cls: "modal-button-container" });
        row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
        const ok = row.createEl("button", { text: confirmText, cls: "mod-cta" });
        ok.onclick = () => {
          answer = true;
          this.close();
        };
      }
      onClose(): void {
        this.contentEl.empty();
        resolve(answer);
      }
    })(app);
    modal.open();
  });
}
