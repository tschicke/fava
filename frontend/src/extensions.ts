/**
 * Fava extensions might contain their own Javascript code, this module
 * contains the functionality to handle them.
 */

import { get as store_get } from "svelte/store";

import { getUrlPath, urlFor } from "./helpers";
import { log_error } from "./log";
import { extensions } from "./stores";

class ExtensionApi {
  extension_name: string;

  constructor(extension_name: string) {
    this.extension_name = extension_name;
  }

  request(
    endpoint: string,
    method: string,
    params: Record<string, string | number> | undefined,
    body: object | undefined,
    output: "json" | "string" | "raw" = "json"
  ) {
    const url = urlFor(
      `extension/${this.extension_name}/${endpoint}`,
      params,
      false
    );
    let opts = {};
    if (body) {
      opts =
        body instanceof FormData
          ? { body }
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            };
    }
    const request = fetch(url, { method, ...opts });
    if (output === "json") {
      return request.then((res) => res.json());
    }
    if (output === "string") {
      return request.then((res) => res.text());
    }
    return request;
  }

  get(
    endpoint: string,
    params: Record<string, string | number>,
    output: "json" | "string" | "raw" = "json"
  ) {
    return this.request(endpoint, "GET", params, undefined, output);
  }

  put(
    endpoint: string,
    body: object | undefined,
    output: "json" | "string" | "raw" = "json"
  ) {
    return this.request(endpoint, "PUT", undefined, body, output);
  }

  post(
    endpoint: string,
    body: object | undefined,
    output: "json" | "string" | "raw" = "json"
  ) {
    return this.request(endpoint, "POST", undefined, body, output);
  }

  delete(
    endpoint: string,
    body: object | undefined,
    output: "json" | "string" | "raw" = "json"
  ) {
    return this.request(endpoint, "DELETE", undefined, body, output);
  }
}

/**
 * The Javascript code of a Fava extension should export an object of this type.
 */
export interface ExtensionModule {
  /** Initialise this Javascript module / run some code on the initial load. */
  init?: () => void;
  /** Run some code after any Fava page has loaded. */
  onPageLoad?: () => void;
  /** Run some code after the page for this extension has loaded. */
  onExtensionPageLoad?: () => void;

  api: ExtensionApi;
}

async function loadExtensionModule(name: string): Promise<ExtensionModule> {
  const url = urlFor(`extension_js_module/${name}.js`, undefined, false);
  const mod = await (import(url) as Promise<{ default?: ExtensionModule }>);
  if (typeof mod.default === "object") {
    return mod.default;
  }
  throw new Error(
    `Error importing module for extension ${name}: module must export "default" object`
  );
}

/** A map of all extensions modules that have been (requested to be) loaded already. */
const loaded_extensions = new Map<string, Promise<ExtensionModule>>();

/** Get the extensions module - if it has not been imported yet, initialise it. */
async function getExt(name: string): Promise<ExtensionModule> {
  const loaded_ext = loaded_extensions.get(name);
  if (loaded_ext) {
    return loaded_ext;
  }
  const extPromise = loadExtensionModule(name);
  loaded_extensions.set(name, extPromise);
  const ext = await extPromise;
  ext.api = new ExtensionApi(name);
  ext.init?.();
  return ext;
}

function initExtensionHandlers(m: ExtensionModule) {
  const article = document.querySelector("article");
  if (!article) {
    throw new Error("<article> element is missing from markup");
  }
  for (const child of article.getElementsByClassName("extension-handler")) {
    for (const attr of child.attributes) {
      if (attr.name.startsWith("data-handler")) {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const handler: EventListener = new Function(
          "event",
          attr.value
        ) as EventListener;
        child.addEventListener(
          attr.name.replace("data-handler-", ""),
          (event) => handler.call(m, event)
        );
      }
    }
  }
}

/**
 * On page load, run check if the new page is an extension report page and run hooks.
 */
export function handleExtensionPageLoad() {
  const exts = store_get(extensions).filter((e) => e.has_js_module);
  for (const { name } of exts) {
    // Run the onPageLoad handler for all pages.
    getExt(name)
      .then((m) => m.onPageLoad?.())
      .catch(log_error);
  }
  const path = getUrlPath(window.location);
  if (path?.startsWith("extension/")) {
    for (const { name } of exts) {
      if (path.startsWith(`extension/${name}`)) {
        getExt(name)
          .then((m) => {
            initExtensionHandlers(m);
            m.onExtensionPageLoad?.();
          })
          .catch(log_error);
      }
    }
  }
}
