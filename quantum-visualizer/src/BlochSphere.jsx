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
// U-gate rotation is: Rz(phi) * Ry(theta) * Rz(lambda)
// Applied to |0⟩ starting vector: first lambda (Z), then theta (Y), then phi (Z)
const getTargetVector = (rotations) => {
    let v = new THREE.Vector3(0, 1, 0); // |0⟩
    for (const rot of rotations) {
        if (rot.isCompound) {
            // U-gate compound rotation: apply in order lambda -> theta -> phi
            // Since U = Rz(phi) * Ry(theta) * Rz(lambda), we apply right-to-left to vector:
            // First Rz(lambda), then Ry(theta), then Rz(phi)
            if (Math.abs(rot.lambda || 0) > 0.01) {
                v = applyRotation(v, 'z', rot.lambda);
            }
            if (Math.abs(rot.theta || 0) > 0.01) {
                v = applyRotation(v, 'y', rot.theta);
            }
            if (Math.abs(rot.phi || 0) > 0.01) {
                v = applyRotation(v, 'z', rot.phi);
            }
        } else {
            v = applyRotation(v, rot.axis, rot.angle);
        }
    }
    return v;
};

// Animated state arrow with delta animation + phase visualization
function StateArrow({ targetCoords, rotations = [], opacity = 1, isPlayMode = false, isNewBranch = false, depthOffset = 0 }) {
    const [displayVec, setDisplayVec] = useState(() => new THREE.Vector3(0, 1, 0));
    const [displayLambda, setDisplayLambda] = useState(0); // Track accumulated lambda (blue stick)
    const [displayPhi, setDisplayPhi] = useState(0); // Track accumulated phi (magenta stick)
    const [currentOpacity, setCurrentOpacity] = useState(isNewBranch ? 0 : opacity);

    // Track animation state
    const animatedRotationCount = useRef(0);
    const currentRotationProgress = useRef(0);
    const baseVec = useRef(new THREE.Vector3(0, 1, 0));
    const baseLambda = useRef(0);
    const basePhi = useRef(0);
    const prevRotationsSignature = useRef('');
    const isSnapping = useRef(false);
    const wasPlayMode = useRef(false);
    const playStarted = useRef(false);

    // Compute lambda phase from rotations (only lambda values)
    const getTargetLambda = (rots) => {
        return rots.reduce((acc, r) => {
            if (r.isCompound) return acc + (r.lambda || 0);
            return acc;
        }, 0);
    };

    // Compute phi phase from rotations (only phi values and z-axis rotations)
    const getTargetPhi = (rots) => {
        return rots.reduce((acc, r) => {
            if (r.isCompound) return acc + (r.phi || 0);
            if (r.axis === 'z') return acc + r.angle;
            return acc;
        }, 0);
    };

    // Generate signature for rotations array (include phi now)
    const getRotationSignature = (rots) => {
        if (!rots || rots.length === 0) return '';
        return rots.map(r => {
            if (r.isCompound) return `c:${(r.theta || 0).toFixed(4)}:${(r.phi || 0).toFixed(4)}:${(r.lambda || 0).toFixed(4)}`;
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
            basePhi.current = 0;
            setDisplayVec(new THREE.Vector3(0, 1, 0));
            setDisplayLambda(0);
            setDisplayPhi(0);
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
                basePhi.current = displayPhi;
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
        const targetPhi = getTargetPhi(rotations);

        if (isSnapping.current) {
            const newVec = displayVec.clone().lerp(targetVec, Math.min(speed * 2, 0.15));
            const lambdaDiff = targetLambda - displayLambda;
            const phiDiff = targetPhi - displayPhi;
            setDisplayVec(newVec);
            setDisplayLambda(prev => prev + lambdaDiff * Math.min(speed * 2, 0.15));
            setDisplayPhi(prev => prev + phiDiff * Math.min(speed * 2, 0.15));
            if (displayVec.distanceTo(targetVec) < 0.01 && Math.abs(lambdaDiff) < 0.01 && Math.abs(phiDiff) < 0.01) {
                setDisplayVec(targetVec);
                setDisplayLambda(targetLambda);
                setDisplayPhi(targetPhi);
                baseVec.current = targetVec.clone();
                baseLambda.current = targetLambda;
                basePhi.current = targetPhi;
                animatedRotationCount.current = rotations.length;
                currentRotationProgress.current = 0;
                isSnapping.current = false;
            }
        } else if (rotations.length > 0 && animatedRotationCount.current < rotations.length) {
            const rotIdx = animatedRotationCount.current;
            const rot = rotations[rotIdx];
            currentRotationProgress.current += speed;

            if (rot.isCompound) {
                // Compound rotation: animate theta, phi, and lambda all simultaneously
                // U = Rz(phi) * Ry(theta) * Rz(lambda)
                const progress = Math.min(currentRotationProgress.current, 1);
                const partialTheta = (rot.theta || 0) * progress;
                const partialLambda = (rot.lambda || 0) * progress;
                const partialPhi = (rot.phi || 0) * progress;

                // Apply partial rotations from base: lambda -> theta -> phi
                let newVec = baseVec.current.clone();
                if (Math.abs(partialLambda) > 0.01) {
                    newVec = applyRotation(newVec, 'z', partialLambda);
                }
                if (Math.abs(partialTheta) > 0.01) {
                    newVec = applyRotation(newVec, 'y', partialTheta);
                }
                if (Math.abs(partialPhi) > 0.01) {
                    newVec = applyRotation(newVec, 'z', partialPhi);
                }
                setDisplayVec(newVec);
                setDisplayLambda(baseLambda.current + partialLambda);
                setDisplayPhi(basePhi.current + partialPhi);

                if (currentRotationProgress.current >= 1) {
                    // Complete this compound rotation
                    baseVec.current = newVec.clone();
                    baseLambda.current += (rot.lambda || 0);
                    basePhi.current += (rot.phi || 0);
                    animatedRotationCount.current++;
                    currentRotationProgress.current = 0;
                }
            } else {
                // Simple single-axis rotation
                if (currentRotationProgress.current >= 1) {
                    baseVec.current = applyRotation(baseVec.current, rot.axis, rot.angle);
                    if (rot.axis === 'z') basePhi.current += rot.angle;
                    setDisplayVec(baseVec.current.clone());
                    setDisplayPhi(basePhi.current);
                    animatedRotationCount.current++;
                    currentRotationProgress.current = 0;
                } else {
                    const partialAngle = rot.angle * currentRotationProgress.current;
                    const partialVec = applyRotation(baseVec.current, rot.axis, partialAngle);
                    setDisplayVec(partialVec);
                    if (rot.axis === 'z') {
                        setDisplayPhi(basePhi.current + partialAngle);
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
            if (Math.abs(displayPhi) > 0.01) {
                setDisplayPhi(prev => prev * 0.9);
            }
        }

        const opDiff = opacity - currentOpacity;
        if (Math.abs(opDiff) > 0.01) {
            setCurrentOpacity(prev => prev + opDiff * Math.min(speed * 3, 0.15));
        }
    });

    const direction = displayVec.clone().normalize();
    // Shorten arrow for overlapping vectors: each offset level shortens by 0.12
    const shortenFactor = Math.max(0.3, 1 - depthOffset * 0.15);
    const baseArrowLen = 0.94;
    const arrowLen = baseArrowLen * shortenFactor;
    const lineLen = 0.9 * shortenFactor; // Extended to touch cone base
    const coneHeight = 0.07; // Taller cone
    const coneRadius = 0.035; // Smaller cone radius
    const phiStickPos = (lineLen + arrowLen) / 2; // At bottom of cone head
    const lambdaStickPos = 0.50 * shortenFactor; // Lower on the vector
    const arcPos = phiStickPos; // Arc at same position as phi stick
    const position = [displayVec.x * arrowLen, displayVec.y * arrowLen, displayVec.z * arrowLen];

    const quaternion = useMemo(() => {
        const q = new THREE.Quaternion();
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        return q;
    }, [direction.x, direction.y, direction.z]);

    // Lambda stick: blue, points to |-⟩ (local -X), rotates with lambda only
    const lambdaStickEnd = useMemo(() => {
        let localMinusX = new THREE.Vector3(-1, 0, 0).applyQuaternion(quaternion);
        localMinusX.applyAxisAngle(direction, displayLambda);
        localMinusX.normalize().multiplyScalar(0.10);
        const base = direction.clone().multiplyScalar(lambdaStickPos);
        return [[base.x, base.y, base.z], [base.x + localMinusX.x, base.y + localMinusX.y, base.z + localMinusX.z]];
    }, [direction.x, direction.y, direction.z, displayLambda, quaternion, lambdaStickPos]);

    // Lambda reference line: dashed, shows original direction (no rotation)
    const lambdaRefEnd = useMemo(() => {
        let localMinusX = new THREE.Vector3(-1, 0, 0).applyQuaternion(quaternion);
        localMinusX.normalize().multiplyScalar(0.10);
        const base = direction.clone().multiplyScalar(lambdaStickPos);
        return [[base.x, base.y, base.z], [base.x + localMinusX.x, base.y + localMinusX.y, base.z + localMinusX.z]];
    }, [direction.x, direction.y, direction.z, quaternion, lambdaStickPos]);

    // Phi stick: purple, points to |-⟩, rotates with phi only
    const phiStickEnd = useMemo(() => {
        let localMinusX = new THREE.Vector3(-1, 0, 0).applyQuaternion(quaternion);
        localMinusX.applyAxisAngle(direction, displayPhi);
        localMinusX.normalize().multiplyScalar(0.10);
        const base = direction.clone().multiplyScalar(phiStickPos);
        return [[base.x, base.y, base.z], [base.x + localMinusX.x, base.y + localMinusX.y, base.z + localMinusX.z]];
    }, [direction.x, direction.y, direction.z, displayPhi, quaternion, phiStickPos]);

    // Phi reference line: dashed, shows original direction (no rotation)
    const phiRefEnd = useMemo(() => {
        let localMinusX = new THREE.Vector3(-1, 0, 0).applyQuaternion(quaternion);
        localMinusX.normalize().multiplyScalar(0.10);
        const base = direction.clone().multiplyScalar(phiStickPos);
        return [[base.x, base.y, base.z], [base.x + localMinusX.x, base.y + localMinusX.y, base.z + localMinusX.z]];
    }, [direction.x, direction.y, direction.z, quaternion, phiStickPos]);

    // Phi arc: shows accumulated phi rotation (purple curved line)
    const phiArcPoints = useMemo(() => {
        let arcAngle = displayPhi % (2 * Math.PI);
        if (arcAngle < 0) arcAngle += 2 * Math.PI;
        if (arcAngle < 0.05) return null;

        const points = [];
        const segments = 32;
        const radius = 0.10;

        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * arcAngle;
            const angle = Math.PI - t;
            points.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
        }
        return points;
    }, [displayPhi]);

    // Lambda arc: shows accumulated lambda rotation (blue curved line)
    const lambdaArcPoints = useMemo(() => {
        let arcAngle = displayLambda % (2 * Math.PI);
        if (arcAngle < 0) arcAngle += 2 * Math.PI;
        if (arcAngle < 0.05) return null;

        const points = [];
        const segments = 32;
        const radius = 0.10;

        for (let i = 0; i <= segments; i++) {
            const t = (i / segments) * arcAngle;
            const angle = Math.PI - t;
            points.push([radius * Math.cos(angle), 0, radius * Math.sin(angle)]);
        }
        return points;
    }, [displayLambda]);

    // Arc position and orientation - orbits the state vector at phi stick position
    const arcQuaternion = useMemo(() => {
        return quaternion.clone();
    }, [quaternion]);

    const phiArcPosition = useMemo(() => {
        const base = direction.clone().multiplyScalar(arcPos);
        return [base.x, base.y, base.z];
    }, [direction.x, direction.y, direction.z, arcPos]);

    const lambdaArcPosition = useMemo(() => {
        const base = direction.clone().multiplyScalar(lambdaStickPos);
        return [base.x, base.y, base.z];
    }, [direction.x, direction.y, direction.z, lambdaStickPos]);

    return (
        <group>
            {/* Main State Arrow - extended green stick to touch cone */}
            <Line points={[[0, 0, 0], [displayVec.x * lineLen, displayVec.y * lineLen, displayVec.z * lineLen]]} color="#00ff88" lineWidth={3} transparent opacity={currentOpacity} />
            {/* Arrow head - taller and smaller */}
            <mesh position={position} quaternion={quaternion}>
                <coneGeometry args={[coneRadius, coneHeight, 12]} />
                <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={0.4} transparent opacity={currentOpacity} />
            </mesh>

            {/* Blue Lambda Stick - lower on vector, shows lambda phase */}
            <Line points={lambdaRefEnd} color="#3b82f6" lineWidth={1} dashed dashScale={40} transparent opacity={currentOpacity * 0.4} />
            <Line points={lambdaStickEnd} color="#3b82f6" lineWidth={3} transparent opacity={currentOpacity * 0.8} />

            {/* Purple Phi Stick - at base of cone, shows phi phase */}
            <Line points={phiRefEnd} color="#a855f7" lineWidth={1} dashed dashScale={40} transparent opacity={currentOpacity * 0.4} />
            <Line points={phiStickEnd} color="#a855f7" lineWidth={3} transparent opacity={currentOpacity} />

            {/* Blue Lambda Arc - shows accumulated lambda rotation */}
            {lambdaArcPoints && (
                <group position={lambdaArcPosition} quaternion={arcQuaternion}>
                    <Line points={lambdaArcPoints} color="#3b82f6" lineWidth={2} transparent opacity={currentOpacity * 0.8} />
                </group>
            )}

            {/* Purple Phi Arc - shows accumulated phi rotation */}
            {phiArcPoints && (
                <group position={phiArcPosition} quaternion={arcQuaternion}>
                    <Line points={phiArcPoints} color="#a855f7" lineWidth={2} transparent opacity={currentOpacity * 0.8} />
                </group>
            )}
        </group>
    );
}

// Animated photon signal between control and target qubit spheres
// variant: 'control' (orange, curve up) or 'kickback' (light blue, curve down)
function ControlSignal({ fromPosition, toPosition, onComplete, variant = 'control' }) {
    const photonRef = useRef();
    const trailRef = useRef();
    const progressRef = useRef(0);
    const completedRef = useRef(false);
    const DURATION = 0.2; // 0.2 second animation

    // Colors based on variant
    const color = variant === 'kickback' ? '#5bc0de' : '#ff9900';
    const curveDirection = variant === 'kickback' ? -1 : 1; // -1 = down, 1 = up

    // Calculate curve arc height based on distance
    const arcHeight = useMemo(() => {
        const dx = toPosition[0] - fromPosition[0];
        const dz = toPosition[2] - fromPosition[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        return Math.max(0.25, dist * 0.18) * curveDirection;
    }, [fromPosition, toPosition, curveDirection]);

    // Get position along curved path
    const getPointOnCurve = useCallback((t) => {
        const x = fromPosition[0] + (toPosition[0] - fromPosition[0]) * t;
        const y = fromPosition[1] + (toPosition[1] - fromPosition[1]) * t + Math.sin(t * Math.PI) * arcHeight;
        const z = fromPosition[2] + (toPosition[2] - fromPosition[2]) * t;
        return [x, y, z];
    }, [fromPosition, toPosition, arcHeight]);

    // Animate photon
    useFrame((state, delta) => {
        if (completedRef.current) return;

        progressRef.current += delta / DURATION;

        if (progressRef.current >= 1) {
            progressRef.current = 1;
            completedRef.current = true;
            if (onComplete) onComplete();
        }

        const t = progressRef.current;
        const [x, y, z] = getPointOnCurve(t);

        if (photonRef.current) {
            photonRef.current.position.set(x, y, z);
            // Glow brighter in the middle of travel
            const intensity = 0.8 + Math.sin(t * Math.PI) * 0.4;
            photonRef.current.material.emissiveIntensity = intensity;
            // Bigger photon: base 0.12, max 0.18
            photonRef.current.scale.setScalar(0.12 + Math.sin(t * Math.PI) * 0.06);
        }

        // Update trail (fade behind photon)
        if (trailRef.current) {
            const trailPoints = [];
            const trailLength = 0.15; // Trail covers 15% of path behind photon
            const steps = 10;
            for (let i = 0; i <= steps; i++) {
                const trailT = Math.max(0, t - (trailLength * (1 - i / steps)));
                trailPoints.push(getPointOnCurve(trailT));
            }

            // Update line geometry
            const positions = new Float32Array(trailPoints.length * 3);
            trailPoints.forEach((pt, i) => {
                positions[i * 3] = pt[0];
                positions[i * 3 + 1] = pt[1];
                positions[i * 3 + 2] = pt[2];
            });
            trailRef.current.geometry.setAttribute(
                'position',
                new THREE.BufferAttribute(positions, 3)
            );
        }
    });

    // Don't render after complete
    if (completedRef.current) return null;

    const startPoint = getPointOnCurve(0);

    return (
        <group>
            {/* Glowing photon */}
            <mesh ref={photonRef} position={startPoint}>
                <sphereGeometry args={[0.12, 12, 12]} />
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={1.2}
                    transparent
                    opacity={1}
                />
            </mesh>
            {/* Trail behind photon */}
            <line ref={trailRef}>
                <bufferGeometry />
                <lineBasicMaterial color={color} transparent opacity={0.6} linewidth={3} />
            </line>
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

    // Compute depth offsets for overlapping branches
    const branchesWithOffset = useMemo(() => {
        if (branches.length <= 1) {
            return branches.map(b => ({ ...b, depthOffset: 0 }));
        }

        const result = [];
        const assignedPositions = [];
        const threshold = 0.15; // Distance threshold for overlap detection

        for (const branch of branches) {
            if (!branch.coords) {
                result.push({ ...branch, depthOffset: 0 });
                continue;
            }

            let offset = 0;
            // Check against already assigned branches
            for (const assigned of assignedPositions) {
                const dx = branch.coords.x - assigned.coords.x;
                const dy = branch.coords.y - assigned.coords.y;
                const dz = branch.coords.z - assigned.coords.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (dist < threshold) {
                    offset = Math.max(offset, assigned.offset + 1);
                }
            }
            assignedPositions.push({ coords: branch.coords, offset });
            result.push({ ...branch, depthOffset: offset });
        }

        return result;
    }, [branches]);

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
            {branchesWithOffset.map((branch, i) => (
                <StateArrow
                    key={i}
                    targetCoords={branch.coords}
                    rotations={branch.rotations || []}
                    opacity={branch.probability}
                    isPlayMode={isPlayMode}
                    isNewBranch={newBranchIndices.includes(i)}
                    depthOffset={branch.depthOffset || 0}
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

function Scene({ sphereData, focusPosition, isPlayMode, onUserInteract, controlSignals = [] }) {
    const controlsRef = useRef();
    const [activeSignals, setActiveSignals] = useState([]);
    const signalIdRef = useRef(0);

    // When new control signals come in, create signal instances with unique keys
    useEffect(() => {
        if (controlSignals.length > 0) {
            const newSignals = controlSignals.map(signal => ({
                ...signal,
                id: signalIdRef.current++
            }));
            setActiveSignals(prev => [...prev, ...newSignals]);
        }
    }, [controlSignals.map(s => `${s.from}-${s.to}`).join(',')]);

    const handleSignalComplete = useCallback((id) => {
        setActiveSignals(prev => prev.filter(s => s.id !== id));
    }, []);

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
            {/* Control signals */}
            {activeSignals.map((signal) => {
                const fromSphere = sphereData.find(s => s.originalIndex === signal.from);
                const toSphere = sphereData.find(s => s.originalIndex === signal.to);
                if (!fromSphere || !toSphere) return null;
                return (
                    <group key={`signal-group-${signal.id}`}>
                        {/* Control signal: from control to target */}
                        <ControlSignal
                            key={`signal-${signal.id}`}
                            fromPosition={fromSphere.position}
                            toPosition={toSphere.position}
                            onComplete={() => handleSignalComplete(signal.id)}
                            variant="control"
                        />
                        {/* Kickback signal: from target back to control (if applicable) */}
                        {signal.hasKickback && (
                            <ControlSignal
                                key={`kickback-${signal.id}`}
                                fromPosition={toSphere.position}
                                toPosition={fromSphere.position}
                                variant="kickback"
                            />
                        )}
                    </group>
                );
            })}
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
export default function BlochSphereView({ qubitBranches, visibility, focusQubit, isPlaying, controlSignals = [] }) {
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
                    controlSignals={controlSignals}
                />
            </Canvas>
        </div>
    );
}
