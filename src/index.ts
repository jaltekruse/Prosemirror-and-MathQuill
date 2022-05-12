// ProseMirror imports
import {
  EditorState,
  Transaction,
  Plugin as ProsePlugin
} from "prosemirror-state";
import { EditorView, NodeView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { Schema, DOMParser, Node as ProsemirrorNode } from "prosemirror-model";
import { StepMap } from "prosemirror-transform";

// katex imports
import katex from "katex";
import { ParseError } from "katex";

var MQ = window.MathQuill.getInterface(2);
var config = {
  restrictMismatchedBrackets: true,
  autoSubscriptNumerals: true,
  autoCommands: 'pi theta sqrt sum int',
  autoOperatorNames: 'sin cos tan',
  // for intuitive navigation of fractions
  leftRightIntoCmdGoes: 'up',
  handlers: {
     enter: () => {
        var obj = canvas.getActiveObject();
        var htmlElement = document.getElementById('math_input');

        var mathField = MQ.MathField(htmlElement, config);
        //var math = mathField.latex();

        if (obj && obj.type === 'image' && typeof obj.math !== 'undefined') {
            mathField.blur();
            whenMqChanged();
            insertNewMath(obj);
        } else {
            if (evt.key === 'Enter') {
                insertNewMath();
            }
        }
     }
  }

};

//// EDITOR SCHEMA /////////////////////////////////////////

export const editorSchema = new Schema({
  nodes: {
    // :: NodeSpec top-level document node
    doc: {
      content: "block+"
    },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return ["p", 0];
      }
    },
    inlineMath: {
      group: "inline",
      content: "inline*",
      inline: true,
      atom: false,
      toDOM: () => ["inlinemath", 0],
      parseDOM: [
        {
          tag: "inlinemath"
        }
      ]
    },
    text: {
      group: "inline",
      inline: true
    }
  }
});

//// EDITOR SETUP //////////////////////////////////////////

function insertMath() {
  let mathType = editorSchema.nodes.inlineMath;
  return function(state: any, dispatch: any) {
    console.log("insertMath");
    let { $from } = state.selection,
      index = $from.index();
    if (!$from.parent.canReplaceWith(index, index, mathType)) return false;
    if (dispatch) {
      let tr = state.tr.replaceSelectionWith(mathType.create({}));
      dispatch(tr);
    }
    return true;
  };
}

function initEditor() {
  // get editor element
  let editorElt = document.getElementById("editor");
  if (!editorElt) {
    throw Error("missing #editor element");
  }

  // plugins
  let plugins: ProsePlugin[] = [keymap({ "Ctrl-Space": insertMath() })];

  // create ProseMirror state
  let state = EditorState.create({
    schema: editorSchema,
    doc: DOMParser.fromSchema(editorSchema).parse(document.getElementById(
      "editor-content"
    ) as HTMLElement),
    plugins: plugins
  });

  // create ProseMirror view
  let view = new EditorView(editorElt, {
    state,
    nodeViews: {
      inlineMath: (node, view, getPos) => {
        return new InlineMathView(node, view, getPos as (() => number));
      }
    }
  });

  return view;
}

//// INLINE MATH NODEVIEW //////////////////////////////////

export class InlineMathView implements NodeView {
  node: ProsemirrorNode;
  outerView: EditorView;
  innerView: EditorView | null;
  getPos: () => number;
  dom: HTMLElement;
  contents: HTMLElement;
  mathinput: HTMLElement | null;

  constructor(node: ProsemirrorNode, view: EditorView, getPos: () => number) {
    this.node = node;
    this.outerView = view;
    this.getPos = getPos;

    // node representation in the editor
    this.dom = document.createElement("inlinemath");
    this.contents = document.createElement("span");
    this.contents.textContent = "";
    this.contents.classList.add("math-render");
    this.dom.appendChild(this.contents);

    this.render();

    // node used when display math is selected
    this.innerView = null;
    this.mathinput = null;
  }

  // selection -------------------------------------------

  setSelection(anchor: number, head: number) {
    // nothing
  }

  selectNode() {
    this.dom.classList.add("ProseMirror-selectednode");
    var mathField = MQ.MathField(this.contents, config);
    let content: Node[] = (this.node.content as any).content;

    // get tex string to render
    let texString = "";
    if (content.length > 0 && content[0].textContent !== null) {
      texString = content[0].textContent;
    }

    mathField.latex(texString);

    mathField.focus();
    /*
    if (!this.innerView) {
      this.open();
    }
    */
  }

  deselectNode() {
    this.dom.classList.remove("ProseMirror-selectednode");
    if (this.innerView) {
      this.close();
    }
  }

  // NodeView::update(node)
  update(node: ProsemirrorNode) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;

    if (this.innerView) {
      let state = this.innerView.state;

      let start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let diff = node.content.findDiffEnd(state.doc.content as any);
        if (diff) {
          let { a: endA, b: endB } = diff;
          let overlap = start - Math.min(endA, endB);
          if (overlap > 0) {
            endA + overlap;
            endB += overlap;
          }
          this.innerView.dispatch(
            state.tr
              .replace(start, endB, node.slice(start, endA))
              .setMeta("fromOutside", true)
          );
        }
      }
    }

    this.render();

    return true;
  }

  // lifecycle -------------------------------------------

  render() {
    let content: Node[] = (this.node.content as any).content;

    // get tex string to render
    let texString = "";
    if (content.length > 0 && content[0].textContent !== null) {
      texString = content[0].textContent;
    }

    // render katex, but fail gracefully
    try {
      //katex.render(texString, this.contents);
      var mathField = MQ.MathField(this.contents, config);
    } catch (err) {
      if (err instanceof ParseError) {
        console.error(err);
      } else {
        throw err;
      }
    }
  }

  dispatchInner(tr: Transaction) {
    if (!this.innerView) {
      return;
    }
    let { state, transactions } = this.innerView.state.applyTransaction(tr);
    this.innerView.updateState(state);

    if (!tr.getMeta("fromOutside")) {
      let outerTr = this.outerView.state.tr,
        offsetMap = StepMap.offset(this.getPos() + 1);
      for (let i = 0; i < transactions.length; i++) {
        let steps = transactions[i].steps;
        for (let j = 0; j < steps.length; j++) {
          let mapped = steps[j].map(offsetMap);
          if (!mapped) {
            throw Error("step discarded!");
          }
          outerTr.step(mapped);
        }
      }
      if (outerTr.docChanged) this.outerView.dispatch(outerTr);
    }
  }

  open() {
    if (this.innerView) {
      throw Error("inner view should not exist!");
    }
    if (this.mathinput) {
      throw Error("mathinput should not exist!");
    }

    // create math input field
    let mathinput = this.dom.appendChild(document.createElement("div"));
    mathinput.className = "math-src";
    this.mathinput = mathinput;

    // create a nested ProseMirror view
    this.innerView = new EditorView(mathinput, {
      // You can use any node as an editor document
      state: EditorState.create({
        doc: this.node
      }),
      // This is the magic part
      dispatchTransaction: this.dispatchInner.bind(this),
      // seems not to be necessary?
      handleDOMEvents: {
        mousedown: (view, evt) => {
          // Kludge to prevent issues due to the fact that the whole
          // footnote is node-selected (and thus DOM-selected) when
          // the parent editor is focused.
          if (!this.innerView) {
            return false;
          }
          if (this.outerView.hasFocus()) this.innerView.focus();
          return false;
        }
      }
    });

    this.innerView.focus();
  }

  close() {
    if (this.innerView) {
      this.innerView.destroy();
      this.innerView = null;
    }
    if (this.mathinput) {
      this.dom.removeChild(this.mathinput);
      this.mathinput = null;
    }
  }

  destroy() {
    if (this.innerView) this.close();
  }

  stopEvent(event: Event): boolean {
    return (
      this.innerView !== null &&
      event.target !== undefined &&
      this.innerView.dom.contains(event.target as Node)
    );
  }

  ignoreMutation() {
    return true;
  }
}

setTimeout(() => initEditor(), 0);
