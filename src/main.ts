import "@fontsource/dela-gothic-one/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "./style.css";
import { App } from "./app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("#app not found");
new App(root).start();
