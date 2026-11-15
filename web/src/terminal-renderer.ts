/**
 * 端末の描画方式（WebGL / DOM）を決める。
 *
 * WebGL はハードウェア GPU があれば DOM より大幅に軽い（全画面の再描画が続く
 * TUI で 15〜20fps → 60fps）。一方ソフトウェア GL（SwiftShader / llvmpipe など）では
 * DOM の 10 倍以上遅くなるので、その環境では DOM のままにする。
 *
 * localStorage の `tw.renderer` に "webgl" / "dom" を入れると判定を上書きできる
 * （不具合の切り分けとテスト用）。
 */
import type { WebglAddon } from '@xterm/addon-webgl';

export type RendererChoice = 'auto' | 'webgl' | 'dom';

export const RENDERER_KEY = 'tw.renderer';

export function rendererChoice(): RendererChoice {
  try {
    const raw = localStorage.getItem(RENDERER_KEY);
    const value = raw == null ? null : JSON.parse(raw);
    return value === 'webgl' || value === 'dom' ? value : 'auto';
  } catch {
    return 'auto';
  }
}

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render|microsoft basic/i;

let hardware: boolean | null = null;

/** ハードウェアで動く WebGL2 があるか。結果は一度だけ調べて覚えておく */
export function hasHardwareWebgl(): boolean {
  if (hardware !== null) return hardware;
  hardware = false;
  try {
    const canvas = document.createElement('canvas');
    // ソフトウェア描画しか無いときはブラウザがここで null を返す
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return hardware;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
    hardware = !SOFTWARE_GL.test(name);
    // 調べるためだけのコンテキストはすぐ返す（同時に持てる数に上限がある）
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    hardware = false;
  }
  return hardware;
}

/** 実際に作ろうとして失敗したら、以降の自動判定では WebGL を使わない */
export function markWebglUnavailable(): void {
  hardware = false;
}

export function shouldUseWebgl(choice: RendererChoice = rendererChoice()): boolean {
  if (choice === 'dom') return false;
  if (choice === 'webgl') return typeof WebGL2RenderingContext !== 'undefined';
  return hasHardwareWebgl();
}

type WebglAddonClass = typeof WebglAddon;
let webglClass: WebglAddonClass | null = null;
let webglLoading: Promise<WebglAddonClass> | null = null;

/** WebGL 描画のアドオン（約 100KB）は、使う環境でだけ読み込む */
export function loadWebglAddon(): Promise<WebglAddonClass> {
  webglLoading ??= import('@xterm/addon-webgl').then(
    (module) => (webglClass = module.WebglAddon),
    (error) => {
      webglLoading = null;
      throw error;
    },
  );
  return webglLoading;
}

export function loadedWebglAddon(): WebglAddonClass | null {
  return webglClass;
}
