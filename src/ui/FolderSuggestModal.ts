import { App, FuzzySuggestModal, TFolder } from "obsidian";

/** Pick a vault folder (fuzzy search over every folder). */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private onPick: (folder: TFolder) => void
  ) {
    super(app);
    this.setPlaceholder("Pick a folder…");
  }

  getItems(): TFolder[] {
    return this.app.vault.getAllFolders(true);
  }

  getItemText(folder: TFolder): string {
    return folder.path || "/";
  }

  onChooseItem(folder: TFolder): void {
    this.onPick(folder);
  }
}
