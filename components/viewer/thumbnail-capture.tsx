"use client";

import { useRef, useEffect, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Center, Stage } from "@react-three/drei";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";

interface ThumbnailCaptureProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  fileId: string;
  onCapture: (fileId: string, dataUrl: string) => void;
}

function ModelMesh({ modelUrl, format }: { modelUrl: string; format: string }) {
  switch (format) {
    case "stl":
      return <StlModel url={modelUrl} />;
    case "obj":
      return <ObjModel url={modelUrl} />;
    case "3mf":
      return <ThreeMfModel url={modelUrl} />;
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
  fileId,
  onCapture,
}: {
  fileId: string;
  onCapture: (fileId: string, dataUrl: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const captured = useRef(false);

  useEffect(() => {
    if (captured.current) return;

    // Wait a couple frames for the model to fully load and render
    let frameCount = 0;
    const id = requestAnimationFrame(function capture() {
      frameCount++;
      if (frameCount < 3) {
        requestAnimationFrame(capture);
        return;
      }

      gl.render(scene, camera);
      const dataUrl = gl.domElement.toDataURL("image/webp", 0.85);
      captured.current = true;
      onCapture(fileId, dataUrl);
    });

    return () => cancelAnimationFrame(id);
  }, [gl, scene, camera, fileId, onCapture]);

  return null;
}

/**
 * Renders a model offscreen with our shader, captures a thumbnail,
 * then calls onCapture with the data URL. The canvas is hidden.
 */
export function ThumbnailCapture({
  modelUrl,
  format,
  fileId,
  onCapture,
}: ThumbnailCaptureProps) {
  const stableOnCapture = useCallback(onCapture, [onCapture]);

  return (
    <div className="fixed -left-[9999px] top-0 w-[512px] h-[512px] pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={1}
        gl={{ preserveDrawingBuffer: true }}
      >
        <Stage adjustCamera={1.2} intensity={0.5} environment={null}>
          <Center>
            <ModelMesh modelUrl={modelUrl} format={format} />
          </Center>
        </Stage>
        <CaptureOnReady fileId={fileId} onCapture={stableOnCapture} />
      </Canvas>
    </div>
  );
}
