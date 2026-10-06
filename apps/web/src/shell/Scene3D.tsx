// M19: React host of the 3D scene, drawn inside the map card. The scene itself (../scene/NocScene.ts) is plain three.js;
// it is loaded on demand so /admin and the panels do not pay for three.js.
import type { StatusSnapshot } from '@sbc-noc/shared';
import type { LayerKey } from '@sbc-noc/ui';
import { useEffect, useRef, useState } from 'react';
import type { SceneModel } from '../scene/model.js';
import type { NocScene, Selection } from '../scene/NocScene.js';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: remember for this page only */
    }
  },
};

export const ECO_KEY = 'noc-eco';
export const savedEco = () => store.get(ECO_KEY) === '1';
export const saveEco = (on: boolean) => store.set(ECO_KEY, on ? '1' : '0');

const touchUi = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Controls hint shown until the first drag or zoom (prototype #hint). */
export function useHint() {
  const [show, setShow] = useState(() => store.get('noc-hint') !== '1');
  const hide = () => {
    if (!show) return;
    setShow(false);
    store.set('noc-hint', '1');
  };
  const text = touchUi()
    ? 'นิ้วเดียวลากเพื่อหมุน · สองนิ้วถ่างเพื่อซูม · สองนิ้วลากเพื่อเลื่อน · แตะอุปกรณ์เพื่อดูรายละเอียด'
    : 'ลากเพื่อหมุน · ล้อเมาส์เพื่อซูม · คลิกขวาลากเพื่อเลื่อน · คลิกอุปกรณ์เพื่อดูรายละเอียด';
  return { show, hide, text };
}

export interface Scene3DProps {
  model: SceneModel | null;
  snapshot: StatusSnapshot | null;
  layers: Record<LayerKey, boolean>;
  mini: HTMLCanvasElement | null;
  onReady: (scene: NocScene | null) => void;
  onSelect: (sel: Selection | null) => void;
  onFps: (fps: number) => void;
  onAutoEco: (fps: number) => void;
  /** First drag/zoom on the scene (hides the controls hint). */
  onInteract: () => void;
  /** The data is not fresh: hold the scene's motion. */
  still?: boolean;
}

export function Scene3D(p: Scene3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<NocScene | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const cb = useRef(p);
  cb.current = p;

  useEffect(() => {
    let live = true;
    let made: NocScene | null = null;
    void import('../scene/NocScene.js')
      .then((mod) => {
        if (!live || !host.current || !labels.current) return;
        if (!mod.webglAvailable()) {
          setFailed(
            'เบราว์เซอร์หรือเครื่องนี้แสดงภาพ 3D (WebGL) ไม่ได้ ลองเปิดด้วย Chrome หรือ Edge รุ่นล่าสุด',
          );
          return;
        }
        const eco = store.get(ECO_KEY);
        made = new mod.NocScene(
          {
            container: host.current,
            labels: labels.current,
            eco: eco === '1',
            autoEco: eco === null,
            reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          },
          {
            onSelect: (s) => cb.current.onSelect(s),
            onFps: (f) => cb.current.onFps(f),
            onAutoEco: (f) => {
              saveEco(true);
              cb.current.onAutoEco(f);
            },
          },
        );
        setScene(made);
        cb.current.onReady(made);
      })
      .catch(() => {
        if (live) setFailed('โหลดส่วนแสดงภาพ 3D ไม่สำเร็จ ลองรีเฟรชหน้า');
      });
    return () => {
      live = false;
      made?.dispose();
      cb.current.onReady(null);
    };
  }, []);

  useEffect(() => {
    if (scene && p.model) scene.setModel(p.model);
  }, [scene, p.model]);
  useEffect(() => {
    scene?.setStatus(p.snapshot);
  }, [scene, p.snapshot, p.model]);
  useEffect(() => {
    scene?.setLayers(p.layers);
  }, [scene, p.layers, p.model]);
  useEffect(() => {
    scene?.setStill(!!p.still);
  }, [scene, p.still]);
  useEffect(() => {
    scene?.setMiniMap(p.mini);
  }, [scene, p.mini, p.model]);

  return (
    <div
      id="scene"
      ref={host}
      data-testid="scene"
      onPointerDown={p.onInteract}
      onWheel={p.onInteract}
      className={failed ? 'failed' : ''}
    >
      <div id="labels" ref={labels} />
      {failed && (
        <p role="status" className="scene-msg">
          {failed}
        </p>
      )}
      {!failed && !scene && <p className="scene-msg">กำลังโหลดภาพ 3D…</p>}
    </div>
  );
}
