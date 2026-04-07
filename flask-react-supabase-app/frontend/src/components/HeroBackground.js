import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial } from '@react-three/drei';

const ParticleField = ({ count = 140 }) => {
  const mesh = useRef();
  
  const particles = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * 15;
      positions[i3 + 1] = (Math.random() - 0.5) * 15;
      positions[i3 + 2] = (Math.random() - 0.5) * 15;
      scales[i] = Math.random() * 0.5 + 0.1;
    }
    
    return { positions, scales };
  }, [count]);

  useFrame((state) => {
    if (mesh.current) {
      mesh.current.rotation.y = state.clock.elapsedTime * 0.05;
      mesh.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.1) * 0.1;
    }
  });

  return (
    <points ref={mesh}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particles.positions.length / 3}
          array={particles.positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.028}
        color="#8de191"
        transparent
        opacity={0.42}
        sizeAttenuation
      />
    </points>
  );
};

const FloatingOrb = ({ position, color, speed = 1, scale = 1 }) => {
  const meshRef = useRef();
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * speed) * 0.3;
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.2;
      meshRef.current.rotation.z = state.clock.elapsedTime * 0.15;
    }
  });

  return (
    <Float speed={2} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh ref={meshRef} position={position}>
        <icosahedronGeometry args={[0.55 * scale, 8]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={0.16}
          metalness={0.8}
          roughness={0.14}
        />
      </mesh>
    </Float>
  );
};

const EnergyRings = () => {
  const groupRef = useRef();
  
  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.z = state.clock.elapsedTime * 0.08;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.18) * 0.08;
    }
  });

  return (
    <group ref={groupRef} position={[2.8, 0.2, -2.4]} rotation={[0.5, 0.2, 0]}>
      <mesh>
        <torusGeometry args={[2.2, 0.035, 16, 120]} />
        <MeshDistortMaterial
          color="#8de191"
          transparent
          opacity={0.26}
          metalness={0.75}
          roughness={0.1}
          distort={0.12}
          speed={1.4}
        />
      </mesh>
      <mesh rotation={[0.3, 0.8, 0.5]}>
        <torusGeometry args={[1.35, 0.028, 16, 96]} />
        <MeshDistortMaterial
          color="#3e8f49"
          transparent
          opacity={0.18}
          metalness={0.8}
          roughness={0.1}
          distort={0.18}
          speed={1.8}
        />
      </mesh>
    </group>
  );
};

const Scene3D = () => {
  return (
    <Canvas
      camera={{ position: [0, 0, 8], fov: 50 }}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
      gl={{ alpha: true }}
    >
      <ambientLight intensity={0.3} />
      <pointLight position={[8, 8, 8]} intensity={1.1} color="#8de191" />
      <pointLight position={[-8, -6, -8]} intensity={0.45} color="#0a5f31" />
      
      <ParticleField />
      
      <FloatingOrb position={[-3.6, 1.9, -2.2]} color="#7fda87" speed={0.8} scale={1.1} />
      <FloatingOrb position={[1.8, 2.8, -3.2]} color="#4caf50" speed={1.05} scale={0.72} />
      <FloatingOrb position={[4.1, -1.1, -2.8]} color="#154b24" speed={0.62} scale={1.4} />
      
      <EnergyRings />
      
      <fog attach="fog" args={['#000000', 5, 20]} />
    </Canvas>
  );
};

const HeroBackground = () => {
  return (
    <div className="cn-hero-3d" aria-hidden="true">
      <Scene3D />
      <div className="cn-hero-3d-overlay" />
    </div>
  );
};

export default HeroBackground;
