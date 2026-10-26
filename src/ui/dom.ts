// 小さな DOM ヘルパー。フレームワークを使わずに画面を組み立てる。

type Child = Node | string | null | undefined | false;

export interface ElementProps {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly on?: Readonly<Partial<Record<keyof HTMLElementEventMap, (event: Event) => void>>>;
}

export function h<TTag extends keyof HTMLElementTagNameMap>(
  tag: TTag,
  props: ElementProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[TTag] {
  const element = document.createElement(tag);
  if (props.class) element.className = props.class;
  if (props.text !== undefined) element.textContent = props.text;
  Object.entries(props.attrs ?? {}).forEach(([name, value]) => element.setAttribute(name, value));
  Object.entries(props.on ?? {}).forEach(([type, listener]) => {
    if (listener) element.addEventListener(type, listener);
  });
  children.forEach((child) => {
    if (child) element.append(child);
  });
  return element;
}

export function button(label: string, onClick: () => void, variant: "primary" | "ghost" | "danger" = "primary"): HTMLButtonElement {
  return h("button", { class: `btn btn-${variant}`, text: label, attrs: { type: "button" }, on: { click: onClick } });
}

/** 二度押しを防ぐ。最初の 1 回だけ handler を呼ぶ。 */
export function once(handler: () => void | Promise<void>): () => void {
  const state = { fired: false };
  return (): void => {
    if (state.fired) return;
    state.fired = true;
    void handler();
  };
}
