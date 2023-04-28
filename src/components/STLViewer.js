import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';

const STLViewer = ({ url }) => {
  return (
    <div style={{ width: '100%', height: '500px' }}>
      <Canvas>
        <Suspense fallback={null}>
          <mesh>
            <primitive object={new STLLoader().load(url)} />
          </mesh>
        </Suspense>
      </Canvas>
    </div>
  );
};

export default STLViewer;