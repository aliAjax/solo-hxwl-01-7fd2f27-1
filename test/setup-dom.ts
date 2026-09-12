// 必须在任何 src 模块之前导入：先搭好 jsdom 全局环境，
// 这样 store.ts 模块加载时即可访问 window/localStorage。
import Module from "node:module";
import { JSDOM } from "jsdom";

// Node 环境下把 CSS 导入当作空模块（Vite 才会真正处理样式）
(Module as unknown as { _extensions: Record<string, (module: Module, filename: string) => void> })._extensions[".css"] =
  () => {};

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:5101",
  pretendToBeVisual: true,
});

const { window } = dom;

(globalThis as Record<string, unknown>).window = window;
(globalThis as Record<string, unknown>).document = window.document;
(globalThis as Record<string, unknown>).navigator = window.navigator;
(globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;
(globalThis as Record<string, unknown>).HTMLInputElement = window.HTMLInputElement;
(globalThis as Record<string, unknown>).HTMLSelectElement = window.HTMLSelectElement;
(globalThis as Record<string, unknown>).HTMLTextAreaElement = window.HTMLTextAreaElement;
(globalThis as Record<string, unknown>).HTMLAnchorElement = window.HTMLAnchorElement;
(globalThis as Record<string, unknown>).Event = window.Event;
(globalThis as Record<string, unknown>).Blob = window.Blob;
(globalThis as Record<string, unknown>).URL = window.URL;
(globalThis as Record<string, unknown>).localStorage = window.localStorage;
(globalThis as Record<string, unknown>).confirm = () => true;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
