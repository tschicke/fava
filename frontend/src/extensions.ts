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
  ) {
    const url = urlFor(
      `extension/${this.extension_name}/${endpoint}`,
      params,
      false,
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
    return fetch(url, { method, ...opts }).then((res) => res.json());
  }

  get(endpoint: string, params: Record<string, string | number>) {
    return this.request(endpoint, "GET", params, undefined);
  }

  put(endpoint: string, body: object | undefined) {
    return this.request(endpoint, "PUT", undefined, body);
  }

  post(endpoint: string, body: object | undefined) {
    return this.request(endpoint, "POST", undefined, body);
  }

  delete(endpoint: string, body: object | undefined) {
    return this.request(endpoint, "DELETE", undefined, body);
  }
}

export interface ExtensionContext {
  api: ExtensionApi;
}

/**
 * The Javascript code of a Fava extension should export an object of this type.
 */
export interface ExtensionModule {
  /** Initialise this Javascript module / run some code on the initial load. */
  init?: (c: ExtensionContext) => void;
  /** Run some code after any Fava page has loaded. */
  onPageLoad?: (c: ExtensionContext) => void;
  /** Run some code after the page for this extension has loaded. */
  onExtensionPageLoad?: (c: ExtensionContext) => void;
}

export class ExtensionData implements Required<ExtensionModule> {
  context: ExtensionContext;

  extension: ExtensionModule;

  constructor(context: ExtensionContext, extension: ExtensionModule) {
    this.context = context;
    this.extension = extension;
  }

  init(): void {
    this.extension.init?.(this.context);
  }

  onPageLoad(): void {
    this.extension.onPageLoad?.(this.context);
  }

  onExtensionPageLoad(): void {
    this.extension.onPageLoad?.(this.context);
  }
}

async function loadExtensionModule(name: string): Promise<ExtensionData> {
  const url = urlFor(`extension_js_module/${name}.js`, undefined, false);
  const mod = await (import(url) as Promise<{ default?: ExtensionModule }>);
  if (typeof mod.default === "object") {
    const context: ExtensionContext = {
      api: new ExtensionApi(name),
    };
    return new ExtensionData(context, mod.default);
  }
  throw new Error(
    `Error importing module for extension ${name}: module must export "default" object`,
  );
}

/** A map of all extensions modules that have been (requested to be) loaded already. */
const loaded_extensions = new Map<string, Promise<ExtensionData>>();

/** Get the extensions module - if it has not been imported yet, initialise it. */
async function getExt(name: string): Promise<ExtensionData> {
  const loaded_ext = loaded_extensions.get(name);
  if (loaded_ext) {
    return loaded_ext;
  }
  const ext = loadExtensionModule(name);
  loaded_extensions.set(name, ext);
  (await ext).init();
  return ext;
}

/**
 * On page load, run check if the new page is an extension report page and run hooks.
 */
export function handleExtensionPageLoad(): void {
  const exts = store_get(extensions).filter((e) => e.has_js_module);
  for (const { name } of exts) {
    // Run the onPageLoad handler for all pages.
    getExt(name)
      .then((m) => {
        m.onPageLoad();
      })
      .catch(log_error);
  }
  const path = getUrlPath(window.location);
  if (path?.startsWith("extension/")) {
    for (const { name } of exts) {
      if (path.startsWith(`extension/${name}`)) {
        getExt(name)
          .then((m) => {
            m.onExtensionPageLoad();
          })
          .catch(log_error);
      }
    }
  }
}
