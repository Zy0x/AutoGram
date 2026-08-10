export type SidebarLayoutModel = 'model_a' | 'model_b' | 'model_c';

const LS_KEY = 'autogram_sidebar_layout_model';
const EVENT_NAME = 'autogram:sidebar_layout_change';

export function getSidebarLayoutModel(): SidebarLayoutModel {
  try {
    const val = localStorage.getItem(LS_KEY);
    if (val === 'model_a' || val === 'model_b' || val === 'model_c') {
      return val;
    }
  } catch {
    /* ignore */
  }
  return 'model_a';
}

export function setSidebarLayoutModel(model: SidebarLayoutModel): void {
  try {
    localStorage.setItem(LS_KEY, model);
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: model }));
  } catch {
    /* ignore */
  }
}

export function subscribeSidebarLayoutModel(callback: (model: SidebarLayoutModel) => void): () => void {
  const handler = (e: Event) => {
    const custom = e as CustomEvent<SidebarLayoutModel>;
    if (custom.detail) {
      callback(custom.detail);
    } else {
      callback(getSidebarLayoutModel());
    }
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
  };
}
