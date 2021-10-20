import { basicSetup, EditorState, EditorView } from "@codemirror/basic-setup";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { RangeSetBuilder } from "@codemirror/rangeset";
import { StreamLanguage } from "@codemirror/stream-parser";
import {
  Decoration,
  DecorationSet,
  KeyBinding,
  keymap,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { useCallback } from "react";
import { sendOSC } from "../osc";
import { oneDark } from "./theme";

let commands: KeyBinding[] = [
  {
    key: "Shift-Enter",
    run: ({ state }) => {
      let { from } = state.selection.main;
      let { text } = state.doc.lineAt(from);
      return sendOSC("/code", text);
    },
  },
];

const emptyLine = Decoration.line({
  attributes: { class: "cm-emptyLine" },
});

function emptyLineDeco(view: EditorView) {
  let builder = new RangeSetBuilder<Decoration>();
  for (let { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      let line = view.state.doc.lineAt(pos);
      if (line.text === "") builder.add(line.from, line.from, emptyLine);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

export function Editor() {
  const refCallback = useCallback((ref: HTMLElement | null) => {
    if (ref) {
      new EditorView({
        state: EditorState.create({
          extensions: [
            basicSetup,
            oneDark,
            StreamLanguage.define(haskell),
            keymap.of(commands),
            ViewPlugin.fromClass(
              class {
                decorations: DecorationSet;
                constructor(view: EditorView) {
                  this.decorations = emptyLineDeco(view);
                }
                update(update: ViewUpdate) {
                  if (update.docChanged || update.viewportChanged)
                    this.decorations = emptyLineDeco(update.view);
                }
              },
              {
                decorations: (v) => v.decorations,
              }
            ),
          ],
        }),
        parent: ref,
      });
    }
  }, []);

  return <section id="editor" ref={refCallback}></section>;
}
