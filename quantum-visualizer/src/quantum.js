// Quantum simulation logic with multi-qubit support and entanglement

// Complex number operations
export const complex = (re, im = 0) => ({ re, im });

export const cAdd = (a, b) => complex(a.re + b.re, a.im + b.im);
export const cSub = (a, b) => complex(a.re - b.re, a.im - b.im);
export const cMul = (a, b) => complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export const cConj = (a) => complex(a.re, -a.im);
export const cAbs = (a) => Math.sqrt(a.re * a.re + a.im * a.im);
export const cPhase = (a) => Math.atan2(a.im, a.re);
export const cFromPolar = (r, theta) => complex(r * Math.cos(theta), r * Math.sin(theta));
export const cScale = (a, s) => complex(a.re * s, a.im * s);

// Normalize a qubit state
export const normalize = (state) => {
    const norm = Math.sqrt(cAbs(state[0]) ** 2 + cAbs(state[1]) ** 2);
    if (norm === 0) return [complex(1), complex(0)];
    return [
        complex(state[0].re / norm, state[0].im / norm),
        complex(state[1].re / norm, state[1].im / norm)
    ];
};

// Initial states
export const STATE_ZERO = () => [complex(1), complex(0)];
export const STATE_ONE = () => [complex(0), complex(1)];

// Gate matrices
const SQRT2_INV = 1 / Math.sqrt(2);

// Create U3 gate matrix from angles (theta, phi, lambda)
export const createU3Matrix = (theta, phi, lambda) => [
    [complex(Math.cos(theta / 2)), cScale(cFromPolar(1, -lambda), -Math.sin(theta / 2))],
    [cScale(cFromPolar(1, phi), Math.sin(theta / 2)), cScale(cFromPolar(1, phi + lambda), Math.cos(theta / 2))]
];

// Gate colors: I/X=Green (X-axis), Y=Purple (Y-axis), Z/S/T=Blue (Z-axis)
// animDuration: relative animation time (0-1 scale, π rotation ≈ 1)
export const GATES = {
    I: {
        name: 'I',
        label: 'I',
        description: 'Identity - does nothing',
        matrix: [[complex(1), complex(0)], [complex(0), complex(1)]],
        color: '#3fb950', // Green
        decomposition: null,
        rotation: null,
        animDuration: 0 // No animation
    },
    X: {
        name: 'X',
        label: 'X',
        description: 'Pauli-X (NOT) - π rotation around X axis',
        matrix: [[complex(0), complex(1)], [complex(1), complex(0)]],
        color: '#3fb950', // Green
        decomposition: { gate: 'U', params: { theta: Math.PI, phi: 0, lambda: Math.PI } },
        rotation: { axis: 'x', angle: Math.PI },
        animDuration: 1 // Full π rotation
    },
    Y: {
        name: 'Y',
        label: 'Y',
        description: 'Pauli-Y - π rotation around Y axis',
        matrix: [[complex(0), complex(0, -1)], [complex(0, 1), complex(0)]],
        color: '#a371f7', // Purple
        decomposition: { gate: 'U', params: { theta: Math.PI, phi: Math.PI / 2, lambda: Math.PI / 2 } },
        rotation: { axis: 'y', angle: Math.PI },
        animDuration: 1
    },
    Z: {
        name: 'Z',
        label: 'Z',
        description: 'Pauli-Z - π rotation around Z axis (phase flip)',
        matrix: [[complex(1), complex(0)], [complex(0), complex(-1)]],
        color: '#58a6ff', // Blue
        decomposition: { gate: 'U', params: { theta: 0, phi: 0, lambda: Math.PI } },
        rotation: { axis: 'z', angle: Math.PI },
        animDuration: 1
    },
    H: {
        name: 'H',
        label: 'H',
        description: 'Hadamard - creates superposition',
        matrix: [[complex(SQRT2_INV), complex(SQRT2_INV)], [complex(SQRT2_INV), complex(-SQRT2_INV)]],
        color: '#f85149', // Red
        decomposition: { gate: 'U', params: { theta: Math.PI / 2, phi: 0, lambda: Math.PI } },
        rotation: { axis: 'yz', angle: Math.PI },
        animDuration: 1
    },
    S: {
        name: 'S',
        label: 'S',
        description: 'S gate - π/2 rotation around Z axis',
        matrix: [[complex(1), complex(0)], [complex(0), complex(0, 1)]],
        color: '#58a6ff', // Blue
        decomposition: { gate: 'U', params: { theta: 0, phi: 0, lambda: Math.PI / 2 } },
        rotation: { axis: 'z', angle: Math.PI / 2 },
        animDuration: 0.5
    },
    T: {
        name: 'T',
        label: 'T',
        description: 'T gate - π/4 rotation around Z axis',
        matrix: [[complex(1), complex(0)], [complex(0), cFromPolar(1, Math.PI / 4)]],
        color: '#58a6ff', // Blue
        decomposition: { gate: 'U', params: { theta: 0, phi: 0, lambda: Math.PI / 4 } },
        rotation: { axis: 'z', angle: Math.PI / 4 },
        animDuration: 0.25
    },
    U: {
        name: 'U',
        label: 'U',
        description: 'Universal gate - U(θ, φ, λ)',
        matrix: null,
        color: '#d29922', // Yellow
        isParametric: true,
        defaultParams: { theta: 0, phi: 0, lambda: 0 },
        decomposition: null,
        rotation: null, // Computed from params
        animDuration: null // Computed from params
    },
    BARRIER: {
        name: 'BARRIER',
        label: '┃',
        description: 'Barrier - visual separator',
        matrix: [[complex(1), complex(0)], [complex(0), complex(1)]],
        color: '#8b949e', // White/gray
        isBarrier: true,
        decomposition: null,
        rotation: null,
        animDuration: 0
    }
};

// Apply a gate to a qubit state
export const applyGate = (state, gate, params = null) => {
    if (gate.isBarrier) return state;

    let matrix = gate.matrix;

    if (gate.isParametric && params) {
        matrix = createU3Matrix(params.theta, params.phi, params.lambda);
    }

    if (!matrix) return state;

    return normalize([
        cAdd(cMul(matrix[0][0], state[0]), cMul(matrix[0][1], state[1])),
        cAdd(cMul(matrix[1][0], state[0]), cMul(matrix[1][1], state[1]))
    ]);
};

// Get rotation info for animation
export const getRotationInfo = (gate, params = null) => {
    if (gate.rotation) return gate.rotation;
    if (gate.isParametric && params) {
        // U gate rotation is complex, approximate with main theta rotation
        if (Math.abs(params.theta) > 0.01) {
            return { axis: 'y', angle: params.theta };
        }
        if (Math.abs(params.lambda) > 0.01) {
            return { axis: 'z', angle: params.lambda };
        }
    }
    return null;
};

// Calculate measurement probabilities for a single qubit
export const getProbabilities = (state) => {
    const prob0 = cAbs(state[0]) ** 2;
    const prob1 = cAbs(state[1]) ** 2;
    return { prob0, prob1 };
};

// Calculate combined probabilities for multiple independent qubits
export const getMultiQubitProbabilities = (qubitStates, includeZero = true) => {
    const numQubits = qubitStates.length;
    const numStates = Math.pow(2, numQubits);
    const results = [];

    for (let i = 0; i < numStates; i++) {
        let prob = 1;
        let stateLabel = '';

        for (let q = 0; q < numQubits; q++) {
            const bit = (i >> (numQubits - 1 - q)) & 1;
            stateLabel += bit;
            const qubitProbs = getProbabilities(qubitStates[q]);
            prob *= bit === 0 ? qubitProbs.prob0 : qubitProbs.prob1;
        }

        if (includeZero || prob > 0.001) {
            results.push({ state: stateLabel, probability: prob });
        }
    }

    results.sort((a, b) => b.probability - a.probability);
    return results;
};

// Convert qubit state to Bloch sphere coordinates
export const stateToBlochCoords = (state) => {
    const [alpha, beta] = state;

    const prob0 = cAbs(alpha) ** 2;
    const theta = 2 * Math.acos(Math.sqrt(Math.max(0, Math.min(1, prob0))));

    const alphaPhase = cPhase(alpha);
    const betaPhase = cPhase(beta);
    const phi = betaPhase - alphaPhase;

    const x = Math.sin(theta) * Math.cos(phi);
    const y = Math.sin(theta) * Math.sin(phi);
    const z = Math.cos(theta);

    return { x, y, z, theta, phi };
};

// Format angle for display
export const formatAngle = (rad) => {
    const pi = Math.PI;
    if (Math.abs(rad) < 0.001) return '0';
    if (Math.abs(rad - pi) < 0.001) return 'π';
    if (Math.abs(rad + pi) < 0.001) return '-π';
    if (Math.abs(rad - pi / 2) < 0.001) return 'π/2';
    if (Math.abs(rad + pi / 2) < 0.001) return '-π/2';
    if (Math.abs(rad - pi / 4) < 0.001) return 'π/4';
    if (Math.abs(rad + pi / 4) < 0.001) return '-π/4';
    return rad.toFixed(2);
};
