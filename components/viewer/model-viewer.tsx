"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stage, Center } from "@react-three/drei";
import { StlModel } from "./loaders/stl-model";
import { ObjModel } from "./loaders/obj-model";
import { ThreeMfModel } from "./loaders/threemf-model";

interface ModelViewerProps {
  modelUrl: string;
  format: "stl" | "obj" | "3mf" | "step" | "amf";
  mode?: "preview" | "detail" | "material";
  materialColor?: string;
  className?: string;
}

function ModelMesh({
  modelUrl,
  format,
  materialColor,
}: {
  modelUrl: string;
  format: string;
  materialColor?: string;
}) {
  const color = materialColor || "#a0a0a0";

  switch (format) {
    case "stl":
      return <StlModel url={modelUrl} color={color} />;
    case "obj":
      return <ObjModel url={modelUrl} color={color} />;
    case "3mf":
      return <ThreeMfModel url={modelUrl} color={color} />;
    default:
      // STEP and AMF are not natively supported by Three.js loaders
      // Show a placeholder for unsupported formats
      return (
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
  }
}

function LoadingFallback() {
  return (
    <mesh>
      <sphereGeometry args={[0.5, 16, 16]} />
      <meshStandardMaterial color="#666" wireframe />
    </mesh>
  );
}

export function ModelViewer({
  modelUrl,
  format,
  mode = "detail",
  materialColor,
  className,
}: ModelViewerProps) {
  const isPreview = mode === "preview";

  return (
    <div className={className || "h-full w-full"}>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 45 }}
        dpr={isPreview ? 1 : [1, 2]}
      >
        <Suspense fallback={<LoadingFallback />}>
          <Stage
            adjustCamera={1.2}
            intensity={0.5}
            environment="city"
          >
            <Center>
              <ModelMesh
                modelUrl={modelUrl}
                format={format}
                materialColor={materialColor}
              />
            </Center>
          </Stage>
        </Suspense>
        <OrbitControls
          enableZoom={!isPreview}
          enablePan={!isPreview}
          autoRotate={isPreview}
          autoRotateSpeed={2}
        />
      </Canvas>
    </div>
  );
}
