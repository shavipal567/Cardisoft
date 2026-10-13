import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Vessel } from "../api";
import { VIEWS } from "../anatomy/exploration";
import type { View } from "../anatomy/exploration";
import { loadCoronaries } from "../anatomy/coronary";

interface Props {
  view: View; revision: number; focused: Vessel | null; reducedMotion: boolean;
  zoom: { factor: number; sequence: number }; onRotate: () => void;
}
const routes = loadCoronaries().routes;
const centers = Object.fromEntries(Object.entries(routes).map(([name, route]) =>
  [name, new THREE.Box3().setFromPoints(route.points).getCenter(new THREE.Vector3())])) as Record<Vessel, THREE.Vector3>;

export default function CameraControls({ view, revision, focused, reducedMotion, zoom, onRotate }: Props) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const initialized = useRef(false);
  const transition = useRef<{
    started: number; from: THREE.Spherical; to: THREE.Spherical;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
  } | null>(null);
  const offset = useMemo(() => new THREE.Vector3(), []);
  const spherical = useMemo(() => new THREE.Spherical(), []);
  const framing = Math.max(1, .82 / (size.width / size.height));
  const maxDistance = Math.max(10, 5.5 * framing);

  const move = useCallback((position: THREE.Vector3, target: THREE.Vector3, immediate = false) => {
    const control = controls.current;
    if (!control) return;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(control.target));
    const to = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    // Interpolate around the heart, never straight through the myocardium.
    to.theta = from.theta + Math.atan2(Math.sin(to.theta - from.theta), Math.cos(to.theta - from.theta));
    if (immediate || reducedMotion) {
      transition.current = null; camera.position.copy(position); control.target.copy(target); control.update();
    } else transition.current = { started: performance.now(), from, to, fromTarget: control.target.clone(), toTarget: target.clone() };
    invalidate();
  }, [camera, invalidate, reducedMotion]);
  useEffect(() => {
    const target = focused ? centers[focused].clone().multiplyScalar(.6) : new THREE.Vector3(0, -.05, 0);
    const position = new THREE.Vector3(...VIEWS[view]).normalize().multiplyScalar((focused ? 3.75 : 4.5) * framing).add(target);
    move(position, target, !initialized.current);
    initialized.current = true;
    // Changes in selection elsewhere do not interrupt a user's orbit; only an
    // explicit focus/preset/resize request starts a camera transition.
  }, [view, revision, focused, framing, move]);
  useEffect(() => {
    if (!zoom.sequence || !controls.current) return;
    const target = controls.current.target;
    const destination = camera.position.clone().sub(target);
    destination.setLength(THREE.MathUtils.clamp(destination.length() * zoom.factor, 2.6, maxDistance));
    move(destination.add(target), target);
  }, [zoom, camera, maxDistance, move]);
  useFrame(() => {
    const tween = transition.current, control = controls.current;
    if (!tween || !control) return;
    const progress = Math.min(1, (performance.now() - tween.started) / 800), t = progress * progress * (3 - 2 * progress);
    spherical.set(
      THREE.MathUtils.lerp(tween.from.radius, tween.to.radius, t),
      THREE.MathUtils.lerp(tween.from.phi, tween.to.phi, t),
      THREE.MathUtils.lerp(tween.from.theta, tween.to.theta, t),
    );
    control.target.lerpVectors(tween.fromTarget, tween.toTarget, t);
    camera.position.copy(control.target).add(offset.setFromSpherical(spherical));
    control.update();
    if (progress === 1) transition.current = null;
    else invalidate();
  }, -1);
  return <OrbitControls ref={controls} makeDefault enablePan={false} enableDamping={!reducedMotion} dampingFactor={.12}
    minDistance={2.6} maxDistance={maxDistance} minPolarAngle={.2} maxPolarAngle={Math.PI - .2}
    onStart={() => { transition.current = null; onRotate(); }} />;
}
