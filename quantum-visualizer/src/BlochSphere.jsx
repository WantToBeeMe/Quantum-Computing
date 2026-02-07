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
        if (rot.isCompound) {
            // Compound rotation: apply theta (Y) then lambda (Z)
            if (Math.abs(rot.theta || 0) > 0.01) {
                v = applyRotation(v, 'y', rot.theta);
            }
            if (Math.abs(rot.lambda || 0) > 0.01) {
                v = applyRotation(v, 'z', rot.lambda);
            }
        } else {
            v = applyRotation(v, rot.axis, rot.angle);
        }
    }
    return v;
};

// Animated state arrow with delta animation + phase visualization
function StateArrow({ targetCoords, rotations = [], opacity = 1, isPlayMode = false, isNewBranch = false }) {
    const [displayVec, setDisplayVec] = useState(() => new THREE.Vector3(0, 1, 0));
    const [displayLambda, setDisplayLambda] = useState(0); // Track accumulated lambda
    const [currentOpacity, setCurrentOpacity] = useState(isNewBranch ? 0 : opacity);

    // Track animation state
    const animatedRotationCount = useRef(0);
    const currentRotationProgress = useRef(0);
    const baseVec = useRef(new THREE.Vector3(0, 1, 0));
    const baseLambda = useRef(0);
    const prevRotationsSignature = useRef('');
    const isSnapping = useRef(false);
    const wasPlayMode = useRef(false);
    const playStarted = useRef(false);

    // Compute target lambda from rotations (sum of all z-axis angles + compound lambda)
    const getTargetLambda = (rots) => {
        return rots.reduce((acc, r) => {
            if (r.isCompound) return acc + (r.lambda || 0);
            if (r.axis === 'z') return acc + r.angle;
            return acc;
        }, 0);
    };

    // Generate signature for rotations array
    const getRotationSignature = (rots) => {
        if (!rots || rots.length === 0) return '';
        return rots.map(r => {
            if (r.isCompound) return `c:${(r.theta || 0).toFixed(4)}:${(r.lambda || 0).toFixed(4)}`;
            return `${r.axis}:${r.angle.toFixed(4)}`;
        }).join('|');
    };

    // Handle rotation changes
    useEffect(() => {
        const newSignature = getRotationSignature(rotations);
        const oldSignature = prevRotationsSignature.current;

        if (isPlayMode && !wasPlayMode.current) {
            baseVec.current = new THREE.Vector3(0, 1, 0);
            baseLambda.current = 0;
            setDisplayVec(new THREE.Vector3(0, 1, 0));
            setDisplayLambda(0);
            animatedRotationCount.current = 0;
            currentRotationProgress.current = 0;
            isSnapping.current = false;
            playStarted.current = true;
        } else if (isPlayMode && wasPlayMode.current && newSignature !== oldSignature) {
            const oldRots = oldSignature.split('|').filter(s => s);
            const newRots = newSignature.split('|').filter(s => s);

            let isExtension = true;
            for (let i = 0; i < Math.min(oldRots.length, newRots.length); i++) {
                if (oldRots[i] !== newRots[i]) {
                    isExtension = false;
                    break;
                }
            }

            if (isExtension && newRots.length > oldRots.length) {
                animatedRotationCount.current = oldRots.length;
                currentRotationProgress.current = 0;
            } else if (newRots.length < oldRots.length) {
                isSnapping.current = true;
            }
        } else if (!isPlayMode && newSignature !== oldSignature) {
            const oldRots = oldSignature.split('|').filter(s => s);
            const newRots = newSignature.split('|').filter(s => s);

            let isExtension = true;
            for (let i = 0; i < Math.min(oldRots.length, newRots.length); i++) {
                if (oldRots[i] !== newRots[i]) {
                    isExtension = false;
                    break;
                }
            }

            if (isExtension && newRots.length > oldRots.length) {
                animatedRotationCount.current = oldRots.length;
                currentRotationProgress.current = 0;
            } else if (isExtension && newRots.length < oldRots.length) {
                isSnapping.current = true;
            } else {
                baseVec.current = displayVec.clone();
                baseLambda.current = displayLambda;
                isSnapping.current = true;
            }
        }

        wasPlayMode.current = isPlayMode;
        prevRotationsSignature.current = newSignature;
    }, [rotations, isPlayMode]);

    useFrame((_, delta) => {
        const speed = delta * 3;
        const targetVec = getTargetVector(rotations);
        const targetLambda = getTargetLambda(rotations);

        if (isSnapping.current) {
            const newVec = displayVec.clone().lerp(targetVec, Math.min(speed * 2, 0.15));
            const lambdaDiff = targetLambda - displayLambda;
            setDisplayVec(newVec);
            setDisplayLambda(prev => prev + lambdaDiff * Math.min(speed * 2, 0.15));
            if (displayVec.distanceTo(targetVec) < 0.01 && Math.abs(lambdaDiff) < 0.01) {
                setDisplayVec(targetVec);
                setDisplayLambda(targetLambda);
                baseVec.current = targetVec.clone();
                baseLambda.current = targetLambda;
                animatedRotationCount.current = rotations.length;
                currentRotationProgress.current = 0;
                isSnapping.current = false;
            }
        } else if (rotations.length > 0 && animatedRotationCount.current < rotations.length) {
            const rotIdx = animatedRotationCount.current;
            const rot = rotations[rotIdx];
            currentRotationProgress.current += speed;

            if (rot.isCompound) {
                // Compound rotation: animate theta (Y-axis), apply lambda (Z-axis) instantly
                const partialT = Math.min(currentRotationProgress.current, 1);
                const partialTheta = (rot.theta || 0) * partialT;
                const fullLambda = rot.lambda || 0; // Lambda is applied instantly

                // Apply rotations from base
                let newVec = baseVec.current.clone();
                if (Math.abs(rot.theta || 0) > 0.01) {
                    newVec = applyRotation(newVec, 'y', partialTheta);
                }
                // Lambda always applied fully (not animated)
                if (Math.abs(fullLambda) > 0.01) {
                    newVec = applyRotation(newVec, 'z', fullLambda);
                }
                setDisplayVec(newVec);
                // Lambda display is also instant
                setDisplayLambda(baseLambda.current + fullLambda);

                if (currentRotationProgress.current >= 1) {
                    // Complete this compound rotation
                    baseVec.current = newVec.clone();
                    baseLambda.current += fullLambda;
                    animatedRotationCount.current++;
                    currentRotationProgress.current = 0;
                }
            } else {
                // Simple single-axis rotation
                if (currentRotationProgress.current >= 1) {
                    baseVec.current = applyRotation(baseVec.current, rot.axis, rot.angle);
                    if (rot.axis === 'z') baseLambda.current += rot.angle;
                    setDisplayVec(baseVec.current.clone());
                    setDisplayLambda(baseLambda.current);
                    animatedRotationCount.current++;
                    currentRotationProgress.current = 0;
                } else {
                    const partialAngle = rot.angle * currentRotationProgress.current;
                    const partialVec = applyRotation(baseVec.current, rot.axis, partialAngle);
                    setDisplayVec(partialVec);
                    if (rot.axis === 'z') {
                        setDisplayLambda(baseLambda.current + partialAngle);
                    }
                }
            }
        } else if (rotations.length === 0) {
            const zeroVec = new THREE.Vector3(0, 1, 0);
            if (displayVec.distanceTo(zeroVec) > 0.01) {
                setDisplayVec(displayVec.clone().lerp(zeroVec, Math.min(speed * 2, 0.15)));
            }
            if (Math.abs(displayLambda) > 0.01) {
                setDisplayLambda(prev => prev * 0.9);
            }
        }

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

    // Stick points to |-⟩ (local -X) when lambda=0, rotates around vector with lambda
    const stickEnd = useMemo(() => {
        // Get local -X axis in world coordinates, then rotate by lambda around the direction
        let localMinusX = new THREE.Vector3(-1, 0, 0).applyQuaternion(quaternion);
        // Rotate around the state vector by displayLambda
        localMinusX.applyAxisAngle(direction, displayLambda);
        localMinusX.normalize().multiplyScalar(0.12);
        const base = direction.clone().multiplyScalar(0.65);
        return [[base.x, base.y, base.z], [base.x + localMinusX.x, base.y + localMinusX.y, base.z + localMinusX.z]];
    }, [direction.x, direction.y, direction.z, displayLambda, quaternion]);

    // Phase arc: shows accumulated lambda (mod 2π), purple curved line
    const arcPoints = useMemo(() => {
        // Wrap to 0-2π range for display
        let arcAngle = displayLambda % (2 * Math.PI);
        if (arcAngle < 0) arcAngle += 2 * Math.PI;
        if (arcAngle < 0.05) return null; // Don't show tiny arcs

        const points = [];
        const segments = 32;
        const radius = 0.12;

        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * arcAngle;
            // Start from |-⟩ direction (local -X), sweep in same direction as stick rotation
            const angle = Math.PI - t; // Flip direction: π - t instead of π + t
            points.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
        }
        return points;
    }, [displayLambda]);

    // Arc position and orientation - orbits the state vector
    const arcQuaternion = useMemo(() => {
        return quaternion.clone();
    }, [quaternion]);

    const arcPosition = useMemo(() => {
        const base = direction.clone().multiplyScalar(0.65);
        return [base.x, base.y, base.z];
    }, [direction.x, direction.y, direction.z]);

    return (
        <group>
            {/* Main State Arrow */}
            <Line points={[[0, 0, 0], [displayVec.x * 0.75, displayVec.y * 0.75, displayVec.z * 0.75]]} color="#00ff88" lineWidth={3} transparent opacity={currentOpacity} />
            <mesh position={position} quaternion={quaternion}>
                <coneGeometry args={[0.06, 0.15, 12]} />
                <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.4} transparent opacity={currentOpacity} />
            </mesh>

            {/* Purple Stick Indicator - points to |-⟩ and rotates with lambda */}
            <Line points={stickEnd} color="#a371f7" lineWidth={3} transparent opacity={currentOpacity} />

            {/* Purple Phase Arc - shows accumulated lambda rotation */}
            {arcPoints && (
                <group position={arcPosition} quaternion={arcQuaternion}>
                    <Line points={arcPoints} color="#a371f7" lineWidth={2} transparent opacity={currentOpacity * 0.8} />
                </group>
            )}
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
