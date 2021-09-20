import { keymap, KeyBinding } from "@codemirror/view";
import { EditorState, EditorView, basicSetup } from "@codemirror/basic-setup";
import { StreamLanguage } from "@codemirror/stream-parser";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";

import { oneDark } from "./theme";

let socket = new WebSocket("ws://localhost:4567/");

socket.addEventListener("open", () => {
  socket.addEventListener("message", ({ data }) => {
    const element = document.createElement("div");
    element.innerText = JSON.parse(data).data;
    element.classList.add("item");
    document.getElementById("terminal-contents").appendChild(element);
    element.scrollIntoView(false);
  });
});

let commands: KeyBinding[] = [
  {
    key: "Shift-Enter",
    run: ({ state, dispatch }) => {
      if (socket.readyState === WebSocket.OPEN) {
        let { from } = state.selection.main;
        socket.send(state.doc.lineAt(from).text);
        return true;
      } else {
        return false;
      }
    },
  },
];

window.addEventListener("load", () => {
  let editor = new EditorView({
    state: EditorState.create({
      extensions: [
        basicSetup,
        oneDark,
        StreamLanguage.define(haskell),
        keymap.of(commands),
      ],
    }),
    parent: document.getElementById("editor"),
  });
});