import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Billboard, Text, Line } from '@react-three/drei';
import * as THREE from 'three';

const AXIS_COLOR = '#6cb6ff';
const AXIS_OPACITY = 0.2;

// Apply a rotation to a vector on the Bloch sphere
const applyRotation = (vec, axis, angle) => {
    const v = vec.clone();
    switch (axis) {
        case 'x':
            v.applyAxisAngle(new THREE.Vector3(1, 0, 0), angle);
            break;
        case 'y':
            v.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle); // Y axis on Bloch = Z in Three.js
            break;
        case 'z':
            v.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
            break;
        case 'yz':
            // Hadamard: rotate around (Y+Z)/sqrt(2) axis
            const yzAxis = new THREE.Vector3(0, 1, 1).normalize();
            v.applyAxisAngle(yzAxis, angle);
            break;
    }
    return v;
};

// Get target vector after applying all rotations
const getTargetVector = (rotations) => {
    let v = new THREE.Vector3(0, 1, 0); // |0⟩
    for (const rot of rotations) {
        v = applyRotation(v, rot.axis, rot.angle);
    }
    return v;
};

// Animated state arrow with delta animation
function StateArrow({ targetCoords, rotations = [], opacity = 1, isPlayMode = false, isNewBranch = false }) {
    const [displayVec, setDisplayVec] = useState(() => new THREE.Vector3(0, 1, 0));
    const [currentOpacity, setCurrentOpacity] = useState(isNewBranch ? 0 : opacity);

    // Track animation state
    const animatedRotationCount = useRef(0); // How many rotations we've fully animated
    const currentRotationProgress = useRef(0); // Progress through current rotation (0-1)
    const baseVec = useRef(new THREE.Vector3(0, 1, 0)); // Vector at start of current rotation
    const prevRotationsSignature = useRef(''); // To detect rotation changes
    const isSnapping = useRef(false); // True when we should snap (not animate)
    const wasPlayMode = useRef(false); // Track play mode changes
    const playStarted = useRef(false); // Track if we've started playing

    // Generate signature for rotations array
    const getRotationSignature = (rots) => {
        if (!rots || rots.length === 0) return '';
        return rots.map(r => `${r.axis}:${r.angle.toFixed(4)}`).join('|');
    };

    // Handle rotation changes
    useEffect(() => {
        const newSignature = getRotationSignature(rotations);
        const oldSignature = prevRotationsSignature.current;

        // Detect play mode start (transition from not playing to playing)
        if (isPlayMode && !wasPlayMode.current) {
            // Just started playing - reset to start
            baseVec.current = new THREE.Vector3(0, 1, 0);
            setDisplayVec(new THREE.Vector3(0, 1, 0));
            animatedRotationCount.current = 0;
            currentRotationProgress.current = 0;
            isSnapping.current = false;
            playStarted.current = true;
        } else if (isPlayMode && wasPlayMode.current && newSignature !== oldSignature) {
            // During play, rotations changed (new frame with more gates)
            // Treat as extension: animate only new rotations from current position
            const oldRots = oldSignature.split('|').filter(s => s);
            const newRots = newSignature.split('|').filter(s => s);

            // Only animate new rotations if this is an extension
            let isExtension = true;
            for (let i = 0; i < Math.min(oldRots.length, newRots.length); i++) {
                if (oldRots[i] !== newRots[i]) {
                    isExtension = false;
                    break;
                }
            }

            if (isExtension && newRots.length > oldRots.length) {
                // Extension: continue from where we are
                animatedRotationCount.current = oldRots.length;
                currentRotationProgress.current = 0;
            } else if (newRots.length < oldRots.length) {
                // Fewer rotations (shouldn't happen during normal play)
                isSnapping.current = true;
            }
        } else if (!isPlayMode && newSignature !== oldSignature) {
            // Not playing - circuit editing: determine delta
            const oldRots = oldSignature.split('|').filter(s => s);
            const newRots = newSignature.split('|').filter(s => s);

            // Check if new rotations are an extension of old (just added gates)
            let isExtension = true;
            for (let i = 0; i < Math.min(oldRots.length, newRots.length); i++) {
                if (oldRots[i] !== newRots[i]) {
                    isExtension = false;
                    break;
                }
            }

            if (isExtension && newRots.length > oldRots.length) {
                // Extension: animate only new rotations
                animatedRotationCount.current = oldRots.length;
                currentRotationProgress.current = 0;
            } else if (isExtension && newRots.length < oldRots.length) {
                // Removed gates: smooth lerp
                isSnapping.current = true;
            } else {
                // Parameters changed: smooth lerp to new position
                baseVec.current = displayVec.clone();
                isSnapping.current = true;
            }
        }

        wasPlayMode.current = isPlayMode;
        prevRotationsSignature.current = newSignature;
    }, [rotations, isPlayMode]);

    useFrame((_, delta) => {
        const speed = delta * 3; // Slower animation to match segment timing
        const targetVec = getTargetVector(rotations);

        if (isSnapping.current) {
            // Smooth lerp to target
            const newVec = displayVec.clone().lerp(targetVec, Math.min(speed * 2, 0.15));
            setDisplayVec(newVec);
            if (displayVec.distanceTo(targetVec) < 0.01) {
                setDisplayVec(targetVec);
                baseVec.current = targetVec.clone();
                animatedRotationCount.current = rotations.length;
                currentRotationProgress.current = 0;
                isSnapping.current = false;
            }
        } else if (rotations.length > 0 && animatedRotationCount.current < rotations.length) {
            // Animate through remaining rotations
            const rotIdx = animatedRotationCount.current;
            const rot = rotations[rotIdx];
            currentRotationProgress.current += speed;

            if (currentRotationProgress.current >= 1) {
                // Complete this rotation
                baseVec.current = applyRotation(baseVec.current, rot.axis, rot.angle);
                setDisplayVec(baseVec.current.clone());
                animatedRotationCount.current++;
                currentRotationProgress.current = 0;
            } else {
                // Interpolate rotation
                const partialAngle = rot.angle * currentRotationProgress.current;
                const partialVec = applyRotation(baseVec.current, rot.axis, partialAngle);
                setDisplayVec(partialVec);
            }
        } else if (rotations.length === 0) {
            // No rotations - should be at |0⟩
            const zeroVec = new THREE.Vector3(0, 1, 0);
            if (displayVec.distanceTo(zeroVec) > 0.01) {
                const newVec = displayVec.clone().lerp(zeroVec, Math.min(speed * 2, 0.15));
                setDisplayVec(newVec);
            }
        }

        // Animate opacity
        const opDiff = opacity - currentOpacity;
        if (Math.abs(opDiff) > 0.01) {
            setCurrentOpacity(prev => prev + opDiff * Math.min(speed * 3, 0.15));
        }
    });

    const direction = displayVec.clone().normalize();
    const arrowLen = 0.88;
    const position = [displayVec.x * arrowLen, displayVec.y * arrowLen, displayVec.z * arrowLen];

    const quaternion = useMemo(() => {
        const q = new THREE.Quaternion();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        return q;
    }, [direction.x, direction.y, direction.z]);

    const stickEnd = useMemo(() => {
        let perp = new THREE.Vector3(0, 1, 0).cross(direction);
        if (perp.length() < 0.1) perp = new THREE.Vector3(1, 0, 0);
        perp.normalize().multiplyScalar(0.1);
        const base = direction.clone().multiplyScalar(0.65);
        return [[base.x, base.y, base.z], [base.x + perp.x, base.y + perp.y, base.z + perp.z]];
    }, [direction.x, direction.y, direction.z]);

    return (
        <group>
            <Line points={[[0, 0, 0], [displayVec.x * 0.75, displayVec.y * 0.75, displayVec.z * 0.75]]} color="#00ff88" lineWidth={3} transparent opacity={currentOpacity} />
            <mesh position={position} quaternion={quaternion}>
                <coneGeometry args={[0.06, 0.15, 12]} />
                <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.4} transparent opacity={currentOpacity} />
            </mesh>
            <Line points={stickEnd} color="#00ff88" lineWidth={2} transparent opacity={currentOpacity * 0.7} />
        </group>
    );
}

function AxisLabel({ position, text }) {
    return (
        <Billboard position={position}>
            <Text fontSize={0.12} color={AXIS_COLOR} anchorX="center" anchorY="middle">{text}</Text>
        </Billboard>
    );
}

function SingleBlochSphere({ branches, position = [0, 0, 0], qubitIndex, isPlayMode }) {
    const [prevBranchCount, setPrevBranchCount] = useState(branches.length);
    const [newBranchIndices, setNewBranchIndices] = useState([]);

    useEffect(() => {
        if (branches.length > prevBranchCount) {
            const newIndices = [];
            for (let i = prevBranchCount; i < branches.length; i++) {
                newIndices.push(i);
            }
            setNewBranchIndices(newIndices);
            setTimeout(() => setNewBranchIndices([]), 800);
        }
        setPrevBranchCount(branches.length);
    }, [branches.length, prevBranchCount]);

    return (
        <group position={position}>
            <Billboard position={[0, 1.6, 0]}>
                <Text fontSize={0.1} color="#8b949e" anchorX="center" anchorY="middle">q[{qubitIndex}]</Text>
            </Billboard>
            {[0, 1, 2].map(i => (
                <Line key={i} points={Array.from({ length: 65 }, (_, j) => {
                    const angle = (j / 64) * Math.PI * 2;
                    if (i === 0) return [Math.cos(angle), Math.sin(angle), 0];
                    if (i === 1) return [Math.cos(angle), 0, Math.sin(angle)];
                    return [0, Math.sin(angle), Math.cos(angle)];
                })} color={AXIS_COLOR} lineWidth={1} transparent opacity={AXIS_OPACITY} />
            ))}
            <Line points={[[-1.2, 0, 0], [1.2, 0, 0]]} color={AXIS_COLOR} lineWidth={1} transparent opacity={0.4} />
            <AxisLabel position={[1.4, 0, 0]} text="|+⟩" />
            <AxisLabel position={[-1.4, 0, 0]} text="|−⟩" />
            <Line points={[[0, 0, -1.2], [0, 0, 1.2]]} color={AXIS_COLOR} lineWidth={1} transparent opacity={0.4} />
            <AxisLabel position={[0, 0, 1.4]} text="|+i⟩" />
            <AxisLabel position={[0, 0, -1.4]} text="|−i⟩" />
            <Line points={[[0, -1.2, 0], [0, 1.2, 0]]} color={AXIS_COLOR} lineWidth={1} transparent opacity={0.4} />
            <AxisLabel position={[0, 1.4, 0]} text="|0⟩" />
            <AxisLabel position={[0, -1.4, 0]} text="|1⟩" />
            {branches.map((branch, i) => (
                <StateArrow
                    key={i}
                    targetCoords={branch.coords}
                    rotations={branch.rotations || []}
                    opacity={branch.probability}
                    isPlayMode={isPlayMode}
                    isNewBranch={newBranchIndices.includes(i)}
                />
            ))}
        </group>
    );
}

function CameraController({ focusPosition, controlsRef }) {
    const { camera } = useThree();
    const targetRef = useRef(new THREE.Vector3());
    const positionRef = useRef(new THREE.Vector3());
    const isAnimating = useRef(false);

    useEffect(() => {
        if (focusPosition) {
            targetRef.current.set(...focusPosition);
            positionRef.current.copy(targetRef.current).add(new THREE.Vector3(4, 3, 4));
            isAnimating.current = true;
        }
    }, [focusPosition]);

    useFrame((_, delta) => {
        if (isAnimating.current && controlsRef.current) {
            const speed = Math.min(delta * 4, 0.12);
            controlsRef.current.target.lerp(targetRef.current, speed);
            camera.position.lerp(positionRef.current, speed);
            controlsRef.current.update();
            if (camera.position.distanceTo(positionRef.current) < 0.1) isAnimating.current = false;
        }
    });

    // Stop animation on user interaction
    const stopAnimation = useCallback(() => {
        isAnimating.current = false;
    }, []);

    return null;
}

function Scene({ sphereData, focusPosition, isPlayMode, onUserInteract }) {
    const controlsRef = useRef();

    return (
        <>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1} />
            <pointLight position={[-10, -10, -10]} intensity={0.3} />
            <CameraController focusPosition={focusPosition} controlsRef={controlsRef} />
            {sphereData.map(data => (
                <SingleBlochSphere
                    key={data.originalIndex}
                    branches={data.branches}
                    position={data.position}
                    qubitIndex={data.originalIndex}
                    isPlayMode={isPlayMode}
                />
            ))}
            <OrbitControls
                ref={controlsRef}
                enablePan
                enableZoom
                minZoom={0.5}
                maxZoom={100}
                mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
                minDistance={2}
                maxDistance={30}
                onStart={onUserInteract}
            />
        </>
    );
}
export default function BlochSphereView({ qubitBranches, visibility, focusQubit, isPlaying }) {
    const numVisible = visibility.filter(v => v).length;
    const spacing = 3.5;
    const [userInteracted, setUserInteracted] = useState(false);

    // Reset user interaction flag when focus changes
    useEffect(() => {
        setUserInteracted(false);
    }, [focusQubit]);

    const handleUserInteract = useCallback(() => {
        setUserInteracted(true);
    }, []);

    const sphereData = useMemo(() => {
        const visible = [];
        qubitBranches.forEach((branches, i) => {
            if (visibility[i]) visible.push({ branches, originalIndex: i });
        });
        const cols = Math.ceil(Math.sqrt(visible.length)) || 1;
        return visible.map((data, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            return {
                ...data,
                position: [(col - (cols - 1) / 2) * spacing, 0, (row - (Math.ceil(visible.length / cols) - 1) / 2) * spacing]
            };
        });
    }, [qubitBranches, visibility, spacing]);

    const focusPosition = useMemo(() => {
        if (focusQubit === null || userInteracted) return null;
        const data = sphereData.find(d => d.originalIndex === focusQubit);
        return data ? data.position : null;
    }, [focusQubit, sphereData, userInteracted]);

    const camDist = Math.max(5, 3 + numVisible * 1.1);

    return (
        <div style={{ width: '100%', height: '100%', background: '#0d1117', position: 'relative' }}>
            <Canvas camera={{ position: [camDist, camDist * 0.6, camDist], fov: 45, near: 0.1, far: 1000 }}>
                <Scene
                    sphereData={sphereData}
                    focusPosition={focusPosition}
                    isPlayMode={isPlaying}
                    onUserInteract={handleUserInteract}
                />
            </Canvas>
        </div>
    );
}
