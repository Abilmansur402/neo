/**
 * StellarHeroCanvas — interactive 3D constellation of Kazakhstan perinatal centres.
 * Nodes are placed by (lon, lat) on a gently curved plane; Level III hubs glow larger; dashed filaments
 * trace in-utero / neonatal transfer routes; three orbit rings carry telemetry particles; the camera tilts
 * with the cursor. Pure three.js + React Three Fiber, no post-processing, so it runs on a laptop GPU.
 */
import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const TEAL = new THREE.Color('#00B4D8');
const CYAN = new THREE.Color('#00B4D8');
const AMBER = new THREE.Color('#F5C26B');
const CORAL = new THREE.Color('#E8788A');

export function projectRegion(r, bounds) {
  const x = ((r.lon - bounds.lon0) / (bounds.lon1 - bounds.lon0) - 0.5) * 9.5;
  const y = ((r.lat - bounds.lat0) / (bounds.lat1 - bounds.lat0) - 0.5) * 4.6;
  const z = -0.25 * (x * x) / 9 + Math.sin(r.lon * 0.9) * 0.15; // slight bowl so depth reads
  return [x, y, z];
}

function Particles({ count = 1800 }) {
  const ref = useRef();
  const { positions, sizes } = useMemo(() => {
    const p = new Float32Array(count * 3), s = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 9, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      p[i * 3] = r * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.55; p[i * 3 + 2] = r * Math.cos(ph) - 4;
      s[i] = Math.random();
    }
    return { positions: p, sizes: s };
  }, [count]);
  useFrame((st) => { if (ref.current) { ref.current.rotation.y = st.clock.elapsedTime * 0.012; ref.current.rotation.x = Math.sin(st.clock.elapsedTime * 0.05) * 0.04; } });
  return (
    <points ref={ref}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-size" args={[sizes, 1]} /></bufferGeometry>
      <pointsMaterial size={0.03} color="#C7DBFF" transparent opacity={0.45} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

function OrbitRing({ radius, tilt, speed, color, particles = 48 }) {
  const g = useRef();
  const pts = useMemo(() => { const a = new Float32Array(particles * 3); for (let i = 0; i < particles; i++) { const t = (i / particles) * Math.PI * 2; a[i * 3] = Math.cos(t) * radius; a[i * 3 + 1] = Math.sin(t) * radius; a[i * 3 + 2] = 0; } return a; }, [radius, particles]);
  useFrame((st) => { if (g.current) g.current.rotation.z = st.clock.elapsedTime * speed; });
  return (
    <group rotation={[tilt, 0.3, 0]}>
      <mesh><torusGeometry args={[radius, 0.006, 8, 160]} /><meshBasicMaterial color={color} transparent opacity={0.28} /></mesh>
      <group ref={g}>
        <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[pts, 3]} /></bufferGeometry><pointsMaterial size={0.05} color={color} transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
        <mesh position={[radius, 0, 0]}><sphereGeometry args={[0.07, 12, 12]} /><meshBasicMaterial color={color} /></mesh>
      </group>
    </group>
  );
}

function Node({ r, pos, hovered, onHover, risk }) {
  const m = useRef();
  const size = r.level === 3 ? 0.17 : r.level === 2 ? 0.11 : 0.08;
  const col = risk == null ? new THREE.Color('#94A3B8') : risk >= 6 ? CORAL : risk >= 4 ? AMBER : TEAL;
  useFrame((st) => { if (m.current) { const k = 1 + Math.sin(st.clock.elapsedTime * 2 + r.lon) * 0.06; m.current.scale.setScalar(hovered ? 1.4 : k); } });
  return (
    <group position={pos}>
      <mesh ref={m} onPointerOver={(e) => { e.stopPropagation(); onHover(r.id); }} onPointerOut={() => onHover(null)}>
        <sphereGeometry args={[size, 20, 20]} /><meshStandardMaterial color={col} emissive={col} emissiveIntensity={hovered ? 1.6 : 0.8} roughness={0.3} />
      </mesh>
      <mesh><sphereGeometry args={[size * 2.4, 16, 16]} /><meshBasicMaterial color={col} transparent opacity={hovered ? 0.18 : 0.07} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      {r.level === 3 && <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[size * 1.8, size * 1.95, 48]} /><meshBasicMaterial color={CYAN} transparent opacity={0.5} side={THREE.DoubleSide} /></mesh>}
      {r.growth && <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[size * 2.6, size * 2.7, 48]} /><meshBasicMaterial color={AMBER} transparent opacity={0.45} side={THREE.DoubleSide} /></mesh>}
    </group>
  );
}

function Filaments({ routes, byId, bounds }) {
  const geo = useMemo(() => {
    const pts = [];
    routes.forEach(([a, b]) => { const A = projectRegion(byId[a], bounds), B = projectRegion(byId[b], bounds); for (let i = 0; i < 24; i++) { const t0 = i / 24, t1 = (i + 0.55) / 24; const lerp = (t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t + Math.sin(t * Math.PI) * 0.35]; pts.push(...lerp(t0), ...lerp(t1)); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g;
  }, [routes, byId, bounds]);
  const pulses = useRef();
  const pulsePos = useMemo(() => new Float32Array(routes.length * 3), [routes.length]);
  useFrame((st) => {
    if (!pulses.current) return; const t = (st.clock.elapsedTime * 0.18) % 1;
    routes.forEach(([a, b], i) => { const A = projectRegion(byId[a], bounds), B = projectRegion(byId[b], bounds); const tt = (t + i * 0.13) % 1; pulsePos[i * 3] = A[0] + (B[0] - A[0]) * tt; pulsePos[i * 3 + 1] = A[1] + (B[1] - A[1]) * tt; pulsePos[i * 3 + 2] = A[2] + (B[2] - A[2]) * tt + Math.sin(tt * Math.PI) * 0.35; });
    pulses.current.geometry.attributes.position.needsUpdate = true;
  });
  return (
    <group>
      <lineSegments geometry={geo}><lineBasicMaterial color="#00B4D8" transparent opacity={0.3} /></lineSegments>
      <points ref={pulses}><bufferGeometry><bufferAttribute attach="attributes-position" args={[pulsePos, 3]} /></bufferGeometry><pointsMaterial size={0.11} color="#FFFFFF" transparent opacity={0.95} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
    </group>
  );
}

function Rig({ mouse }) {
  useFrame((st) => {
    const [mx, my] = mouse.current;
    st.camera.position.x += (mx * 1.3 - st.camera.position.x) * 0.035;
    st.camera.position.y += (-my * 0.7 - st.camera.position.y) * 0.035;
    st.camera.lookAt(0, 0, 0);
  });
  return null;
}

export default function StellarHeroCanvas({ regions, routes, onHover, hoveredId, className }) {
  const mouse = useRef([0, 0]);
  const bounds = useMemo(() => ({ lon0: Math.min(...regions.map((r) => r.lon)) - 1, lon1: Math.max(...regions.map((r) => r.lon)) + 1, lat0: Math.min(...regions.map((r) => r.lat)) - 1, lat1: Math.max(...regions.map((r) => r.lat)) + 1 }), [regions]);
  const byId = useMemo(() => Object.fromEntries(regions.map((r) => [r.id, r])), [regions]);
  return (
    <div className={className} onPointerMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); mouse.current = [((e.clientX - b.left) / b.width - 0.5) * 2, ((e.clientY - b.top) / b.height - 0.5) * 2]; }} onPointerLeave={() => { mouse.current = [0, 0]; }}>
      <Canvas camera={{ position: [0, 0, 7.5], fov: 42 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} style={{ background: 'transparent' }}>
        <ambientLight intensity={0.5} /><pointLight position={[4, 5, 6]} intensity={40} color="#9ADCF0" /><pointLight position={[-5, -3, 4]} intensity={14} color="#8B5CF6" />
        <Rig mouse={mouse} />
        <Particles />
        <OrbitRing radius={5.2} tilt={1.25} speed={0.05} color="#00B4D8" />
        <OrbitRing radius={6.1} tilt={1.05} speed={-0.035} color="#8B5CF6" particles={36} />
        <OrbitRing radius={4.3} tilt={1.4} speed={0.08} color="#3B82F6" particles={24} />
        <group rotation={[0.35, 0, 0]} position={[0, -0.2, 0]}>
          <Filaments routes={routes} byId={byId} bounds={bounds} />
          {regions.map((r) => <Node key={r.id} r={r} pos={projectRegion(r, bounds)} hovered={hoveredId === r.id} onHover={onHover} risk={r.nmr} />)}
        </group>
      </Canvas>
    </div>
  );
}
