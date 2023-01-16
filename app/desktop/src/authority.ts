import { readFile, writeFile } from "fs/promises";
import { basename } from "path";

import {
  Observable,
  BehaviorSubject,
  ReplaySubject,
  of,
  map,
  scan,
  skip,
  debounceTime,
  take,
  concatWith,
  shareReplay,
} from "rxjs";

import { ChangeSet, Text } from "@codemirror/state";

import { Document, DocumentUpdate, Tab, TextManagementAPI } from "@core/api";

export class LocalDocument implements Document {
  readonly updates$: ReplaySubject<DocumentUpdate>;

  readonly text$: Observable<Text>;

  get version() {
    return this.initialVersion + this.updateList.length;
  }

  constructor(
    readonly initialText = Text.of([""]),
    readonly initialVersion = 0,
    private updateList: Omit<DocumentUpdate, "version">[] = []
  ) {
    this.updates$ = new ReplaySubject();
    this.updateList.forEach((update, index) =>
      this.updates$.next({ version: index + this.initialVersion, ...update })
    );

    this.text$ = of(this.initialText).pipe(
      concatWith(
        this.updates$.pipe(
          scan(
            (text, { changes }) => ChangeSet.fromJSON(changes).apply(text),
            this.initialText
          )
        )
      ),
      shareReplay(1)
    );
  }

  pushUpdate(update: DocumentUpdate) {
    if (this.destroyed) throw new Error("Can't update a destroyed document");

    const { version, ...updateData } = update;

    if (version !== this.version) return Promise.resolve(false);

    this.updateList.push(updateData);
    this.updates$.next(update);
    return Promise.resolve(true);
  }

  private destroyed = false;

  destroy() {
    this.updates$.complete();
  }
}

export class FileDocument extends LocalDocument {
  static async open(path?: string) {
    let initialText: Text | undefined;
    let saved = false;

    if (path) {
      try {
        let contents = await readFile(path, { encoding: "utf-8" });
        initialText = Text.of(contents.split(/\r?\n/));
        saved = true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err;
        }
      }
    }

    return new FileDocument(saved, initialText, path);
  }

  public saveState$: BehaviorSubject<boolean>;
  public path$: BehaviorSubject<string | null>;

  public saveAs(path: string) {
    this.saveState$.next(false);
    this.path$.next(path);

    this.watch();
  }

  private constructor(saved: boolean, initialText?: Text, path?: string) {
    super(initialText);

    this.saveState$ = new BehaviorSubject(saved);
    this.path$ = new BehaviorSubject(path || null);

    this.watch();
  }

  private unwatch = () => {};

  private watch() {
    this.unwatch();

    const path = this.path$.value;

    if (path) {
      let lastSaved = this.saveState$.value ? this.initialText : undefined;
      let pendingSave: Text | undefined;

      // First, set up write logic
      const write = async (nextSave: Text) => {
        // There's already a save in progress
        // Mark this one as pending and move on
        if (pendingSave) {
          pendingSave = nextSave;
          return;
        }

        while (!pendingSave || !pendingSave.eq(nextSave)) {
          pendingSave = nextSave;
          await writeFile(path, nextSave.sliceString(0));
          lastSaved = nextSave;
        }

        this.saveState$.next(!!lastSaved && nextSave.eq(lastSaved));
        pendingSave = undefined;
      };

      // Then hook up subscriptions
      const saveStateWatch = this.text$.subscribe({
        next: (nextSave) => {
          this.saveState$.next(!!lastSaved && nextSave.eq(lastSaved));
        },
      });

      const textWatch = this.text$
        .pipe(take(1), concatWith(this.text$.pipe(skip(1), debounceTime(1000))))
        .subscribe({
          next: (nextSave) => {
            if (!lastSaved || !nextSave.eq(lastSaved)) {
              write(nextSave);
            }
          },
        });

      this.unwatch = () => {
        saveStateWatch.unsubscribe();
        textWatch.unsubscribe();
      };
    }
  }
}

export class DesktopTab implements Tab {
  saveState$: BehaviorSubject<boolean>;
  path$: BehaviorSubject<string | null>;
  name$: BehaviorSubject<string>;

  private document: Promise<FileDocument>;

  get content() {
    return this.document;
  }

  constructor(path?: string) {
    this.saveState$ = new BehaviorSubject(!!path);
    this.path$ = new BehaviorSubject(path || null);
    this.name$ = new BehaviorSubject(path ? basename(path) : "untitled");

    this.path$
      .pipe(map((path) => (path ? basename(path) : "untitled")))
      .subscribe(this.name$);

    this.document = FileDocument.open(path);

    this.document.then(({ path$, saveState$ }) => {
      path$.subscribe(this.path$);
      saveState$.subscribe(this.saveState$);
    });
  }

  async destroy() {
    this.name$.complete();
    this.document.then((doc) => {
      doc.destroy();
    });
  }
}

export class Authority extends TextManagementAPI {
  private docID = 0;

  private id = this.getID();
  public tab = new DesktopTab();

  constructor() {
    super();

    this.onListener["open"] = (listener) => {
      let { id, tab } = this;
      listener({ id, tab });
    };
  }

  loadDoc(path?: string) {
    this.emit("close", { id: this.id });

    this.tab.destroy();

    this.tab = new DesktopTab(path);
    this.id = this.getID();

    this.emit("open", { id: this.id, tab: this.tab });
  }

  async saveDocAs(path: string) {
    (await this.tab.content).saveAs(path);
  }

  private getID() {
    let id = this.docID;
    this.docID = id + 1;
    return id.toString();
  }

  getTidalVersion(): Promise<string> {
    return new Promise(() => {});
  }
}
