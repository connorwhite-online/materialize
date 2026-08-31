"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MATERIALS } from "@/lib/materials";
import {
  CAPTURE_DEFAULT_DISTANCE,
  CAPTURE_FOV,
  CAPTURE_TARGET_WORLD_SIZE,
} from "./preview-camera";
import { previewLightRigQuaternion } from "./preview-lights";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";

interface ThumbnailCaptureProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileId: string;
  onCapture: (fileId: string, dataUrl: string) => void;
  recommendedMaterialId?: string | null;
  /**
   * Where to put the camera, in the normalized capture space (the model
   * is centred on the origin at `TARGET_WORLD_SIZE`). Defaults to the
   * head-on shot the automatic first capture has always used.
   *
   * Supplied by "Update preview" when a creator picks their own angle —
   * `capturePositionFor()` in `./preview-camera` converts the detail
   * viewer's camera into this space. Applied on mount only, which is
   * fine because a capture always mounts a fresh rig.
   */
  cameraPosition?: [number, number, number];
}

/**
 * Offscreen model renderer used to capture a thumbnail. Same rendering
 * setup as UploadPreview: manual three-point lighting, NormalizedModel
 * to scale any input STL into a fixed world size, StlModel/ObjModel/
 * ThreeMfModel loaders inside an explicit Suspense boundary. This
 * avoids drei's Stage auto-camera whiffing on STLs with unusual native
 * coordinates (which was producing nearly-blank captures).
 */

const TARGET_WORLD_SIZE = CAPTURE_TARGET_WORLD_SIZE;

const DEFAULT_CAMERA_POSITION: [number, number, number] = [
  0,
  0,
  CAPTURE_DEFAULT_DISTANCE,
];

/**
 * Aim the camera at the origin, where `NormalizedModel` centres the
 * model. R3F only orients its default camera for us in the head-on
 * case; an arbitrary orbit position needs an explicit `lookAt`, or the
 * camera keeps staring down -Z and the model leaves the frame.
 */
function AimAtOrigin() {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

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
  materialColor,
  useCustomShader,
}: {
  modelUrl: string;
  format: string;
  materialColor?: string;
  useCustomShader?: boolean;
}) {
  const color = materialColor || "#a0a0a0";

  switch (format) {
    case "stl":
      return (
        <StlModel
          url={modelUrl}
          color={color}
          useCustomShader={useCustomShader || false}
        />
      );
    case "obj":
      return (
        <ObjModel
          url={modelUrl}
          color={color}
          useCustomShader={useCustomShader || false}
        />
      );
    case "3mf":
      return (
        <ThreeMfModel
          url={modelUrl}
          color={color}
          useCustomShader={useCustomShader || false}
        />
      );
    default:
      return (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} />
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
  recommendedMaterialId,
  cameraPosition,
}: ThumbnailCaptureProps) {
  const stableOnCapture = useCallback(onCapture, [onCapture]);
  const [ready, setReady] = useState(false);

  const material = recommendedMaterialId
    ? MATERIALS.find((m) => m.id === recommendedMaterialId)
    : null;
  const materialColor = material?.color;
  const useCustomShader = !!material;

  const resolvedCamera = cameraPosition ?? DEFAULT_CAMERA_POSITION;
  const lightRig = useMemo(
    () => previewLightRigQuaternion(resolvedCamera),
    // Position is a fresh tuple each render; compare by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedCamera[0], resolvedCamera[1], resolvedCamera[2]]
  );

  return (
    <div className="fixed -left-[9999px] top-0 h-[512px] w-[512px] pointer-events-none">
      <Canvas
        camera={{
          position: resolvedCamera,
          fov: CAPTURE_FOV,
        }}
        dpr={1}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <AimAtOrigin />
        <ambientLight intensity={0.16} color="#fff3e3" />
        <group quaternion={lightRig}>
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
        </group>

        <Suspense fallback={null}>
          <NormalizedModel onReady={() => setReady(true)}>
            <ModelMesh
              modelUrl={modelUrl}
              format={format}
              materialColor={materialColor}
              useCustomShader={useCustomShader}
            />
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
