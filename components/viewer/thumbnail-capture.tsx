"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";

interface ThumbnailCaptureProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileId: string;
  onCapture: (fileId: string, dataUrl: string) => void;
}

/**
 * Offscreen model renderer used to capture a thumbnail. Same rendering
 * setup as UploadPreview: manual three-point lighting, NormalizedModel
 * to scale any input STL into a fixed world size, StlModel/ObjModel/
 * ThreeMfModel loaders inside an explicit Suspense boundary. This
 * avoids drei's Stage auto-camera whiffing on STLs with unusual native
 * coordinates (which was producing nearly-blank captures).
 */

const TARGET_WORLD_SIZE = 2.4;

function NormalizedModel({
  onReady,
  children,
}: {
  onReady: () => void;
  children: React.ReactNode;
}) {
  const innerRef = useRef<THREE.Group>(null);
  const [transform, setTransform] = useState<{
    scale: number;
    offset: [number, number, number];
    ready: boolean;
  }>({ scale: 1, offset: [0, 0, 0], ready: false });

  useEffect(() => {
    if (!innerRef.current) return;

    let rafId = 0;
    let attempts = 0;

    const measure = () => {
      const group = innerRef.current;
      if (!group) return;

      const box = new THREE.Box3();
      let hasGeom = false;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          const bb = mesh.geometry.boundingBox;
          if (bb && bb.isEmpty() === false) {
            box.union(bb);
            hasGeom = true;
          }
        }
      });

      if (!hasGeom || box.isEmpty()) {
        if (attempts++ < 20) {
          rafId = requestAnimationFrame(measure);
        }
        return;
      }

      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = maxDim > 0 ? TARGET_WORLD_SIZE / maxDim : 1;

      setTransform({
        scale,
        offset: [-center.x, -center.y, -center.z],
        ready: true,
      });
      onReady();
    };

    measure();

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group scale={transform.scale} visible={transform.ready}>
      <group position={transform.offset} ref={innerRef}>
        {children}
      </group>
    </group>
  );
}

function ModelMesh({
  modelUrl,
  format,
}: {
  modelUrl: string;
  format: string;
}) {
  switch (format) {
    case "stl":
      return <StlModel url={modelUrl} color="#a0a0a0" useCustomShader={false} />;
    case "obj":
      return <ObjModel url={modelUrl} color="#a0a0a0" useCustomShader={false} />;
    case "3mf":
      return (
        <ThreeMfModel url={modelUrl} color="#a0a0a0" useCustomShader={false} />
      );
    default:
      return (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#a0a0a0" />
        </mesh>
      );
  }
}

function CaptureOnReady({
  ready,
  fileId,
  onCapture,
}: {
  ready: boolean;
  fileId: string;
  onCapture: (fileId: string, dataUrl: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const captured = useRef(false);
  const framesSinceReady = useRef(0);
  const framesChecked = useRef(0);

  useFrame(() => {
    if (captured.current) return;

    framesChecked.current++;
    if (framesChecked.current % 30 === 0) {
      console.log(
        `[thumbnail] waiting ${framesChecked.current} frames, ready=${ready}`
      );
    }

    if (!ready) return;

    framesSinceReady.current++;
    // Wait a few frames after normalization so the render is solid.
    if (framesSinceReady.current < 5) return;

    captured.current = true;
    gl.render(scene, camera);
    const dataUrl = gl.domElement.toDataURL("image/webp", 0.85);
    console.log(
      `[thumbnail] captured ${fileId} — dataUrl length ${dataUrl.length}`
    );
    onCapture(fileId, dataUrl);
  });

  return null;
}

export function ThumbnailCapture({
  modelUrl,
  format,
  fileId,
  onCapture,
}: ThumbnailCaptureProps) {
  const stableOnCapture = useCallback(onCapture, [onCapture]);
  const [ready, setReady] = useState(false);

  return (
    <div className="fixed -left-[9999px] top-0 h-[512px] w-[512px] pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 40 }}
        dpr={1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <ambientLight intensity={0.16} color="#fff3e3" />
        <directionalLight
          position={[5, 6, 5]}
          intensity={1.4}
          color="#ffeed6"
        />
        <directionalLight
          position={[-6, -1, -3]}
          intensity={0.35}
          color="#fff2e0"
        />
        <directionalLight
          position={[0, 2, -6]}
          intensity={0.75}
          color="#ffefd8"
        />

        <Suspense fallback={null}>
          <NormalizedModel onReady={() => setReady(true)}>
            <ModelMesh modelUrl={modelUrl} format={format} />
          </NormalizedModel>
        </Suspense>

        <CaptureOnReady
          ready={ready}
          fileId={fileId}
          onCapture={stableOnCapture}
        />
      </Canvas>
    </div>
  );
}
