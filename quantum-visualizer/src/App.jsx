import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import BlochSphereView from './BlochSphere';
import GatePalette from './GatePalette';
import CircuitBuilder from './CircuitBuilder';
import GateSettings from './GateSettings';
import AnimationPlayer from './AnimationPlayer';
import ProbabilityBars from './ProbabilityBars';
import StateDisplay from './StateDisplay';
import {
  STATE_ZERO,
  GATES,
  applyGate,
  createGateInstance,
  updateMatrixFromDecomposition,
  extractRotationFromMatrix,
  getMultiQubitProbabilities,
  stateToBlochCoords,
  getProbabilities
} from './quantum';
import './App.css';

function App() {
  const [circuits, setCircuits] = useState([[]]); // Each gate: { gate, matrix, decomposition, controlIndex }
  const [barriers, setBarriers] = useState([]);
  const [qubitVisibility, setQubitVisibility] = useState([true]);
  const [focusQubit, setFocusQubit] = useState(null);
  const [selectedGate, setSelectedGate] = useState(null);

  const [animationFrame, setAnimationFrame] = useState(-1); // -1 = show all
  const [isPlaying, setIsPlaying] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState(400);
  const [configHeightPercent, setConfigHeightPercent] = useState(80);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);
  const containerRef = useRef(null);
  const leftPanelRef = useRef(null);

  const barrierCount = barriers.length;
  // Total frames: 0 = no gates, 1..barrierCount = after each barrier, barrierCount+1 = all gates
  const totalFrames = barrierCount + 2;

  // Highlighted barrier for animation (-1 = none)
  const highlightedBarrier = animationFrame > 0 && animationFrame <= barrierCount ? animationFrame - 1 : -1;

  // Compute animation duration per segment (for timeline)
  const segmentDurations = useMemo(() => {
    // Return equal duration for each segment to ensure uniform timeline
    return new Array(Math.max(0, totalFrames - 1)).fill(1);
  }, [totalFrames]);

  // Get gates up to a certain animation frame
  // Frame 0 = no gates
  // Frame 1 = gates before first barrier (slot index < barriers[0])
  // Frame 2 = gates before second barrier, etc.
  // Frame barrierCount+1 = all gates
  // Returns array of gate objects sorted by slot
  const getOrderedGates = useCallback((qubitIndex, frame) => {
    const row = circuits[qubitIndex] || [];
    const sortedBarriers = [...barriers].sort((a, b) => a - b);

    // Get all gates with their slots
    const entries = row.map((gate, slot) => ({ gate: gate ? { ...gate, slot } : null, slot })).filter(e => e.gate);
    entries.sort((a, b) => a.slot - b.slot);

    if (frame === 0) {
      // No gates - initial state
      return [];
    }

    if (frame > barrierCount) {
      // All gates - final state
      return entries.map(e => e.gate);
    }

    // Frame 1..barrierCount: show gates BEFORE barrier at index (frame-1)
    const barrierSlot = sortedBarriers[frame - 1];
    if (barrierSlot === undefined) {
      return entries.map(e => e.gate);
    }

    // Include gates whose slot is LESS than the barrier slot
    return entries.filter(e => e.slot < barrierSlot).map(e => e.gate);
  }, [circuits, barriers, barrierCount]);

  // Calculate branches with rotation history
  const qubitBranches = useMemo(() => {
    const frame = animationFrame < 0 ? totalFrames - 1 : animationFrame;

    // Helper to get control qubit state at a specific slot
    const getControlStateAtSlot = (ctrlQubit, maxSlot) => {
      const ctrlGates = getOrderedGates(ctrlQubit, totalFrames - 1); // Get all gates
      let state = STATE_ZERO();
      for (const g of ctrlGates) {
        if (g.slot <= maxSlot && g.gate !== 'BARRIER') {
          state = applyGate(state, g);
        }
      }
      return state;
    };

    return circuits.map((_, qi) => {
      const gates = getOrderedGates(qi, frame);
      const controlledGate = gates.find(g => g.controlIndex !== undefined && g.controlIndex !== null);
      const hasControl = !!controlledGate;

      // Build rotations from decomposition (for visualization)
      const buildRotations = (gateList) => {
        const rotations = [];
        for (const gate of gateList) {
          if (gate.gate === 'BARRIER') continue;
          // Use decomposition directly - already stored on gate
          const decomp = gate.decomposition;
          if (decomp) {
            const { theta, phi, lambda } = decomp;
            const hasTheta = Math.abs(theta) > 0.01;
            const hasPhi = Math.abs(phi) > 0.01;
            const hasLambda = Math.abs(lambda) > 0.01;
            if (hasTheta || hasPhi || hasLambda) {
              rotations.push({ theta, phi, lambda, isCompound: true });
            }
          }
        }
        return rotations;
      };

      // Apply gates using matrix multiplication
      const applyGates = (gateList, state) => {
        for (const gate of gateList) {
          if (gate.gate === 'BARRIER') continue;
          state = applyGate(state, gate);
        }
        return state;
      };

      if (!hasControl) {
        let state = STATE_ZERO();
        state = applyGates(gates, state);
        const rotations = buildRotations(gates);
        return [{ state, coords: stateToBlochCoords(state), probability: 1, rotations }];
      } else {
        // Find all controlled gates
        const controlledGates = gates.filter(g => g.controlIndex !== undefined && g.controlIndex !== null);
        const uniqueControls = [...new Set(controlledGates.map(g => g.controlIndex))];

        // Enumerate all combinations of control states (0 or 1 for each control qubit)
        const numControls = uniqueControls.length;
        const numCombinations = Math.pow(2, numControls);

        // Get probabilities for each control qubit being in |1⟩
        const controlProbs = uniqueControls.map(ctrlIdx => {
          // Find earliest controlled gate for this control
          const ctrlGate = controlledGates.find(g => g.controlIndex === ctrlIdx);
          const ctrlState = getControlStateAtSlot(ctrlIdx, ctrlGate.slot - 1);
          return getProbabilities(ctrlState).prob1;
        });

        const branches = [];

        for (let combo = 0; combo < numCombinations && branches.length < 10; combo++) {
          // Build control state map for this combination
          const controlActive = {};
          let probability = 1;

          for (let i = 0; i < numControls; i++) {
            const isActive = (combo >> i) & 1;
            controlActive[uniqueControls[i]] = isActive === 1;
            probability *= isActive ? controlProbs[i] : (1 - controlProbs[i]);
          }

          // Skip low-probability branches
          if (probability < 0.01) continue;

          // Build gate list for this control combination
          const activeGates = gates.filter(g => {
            if (g.controlIndex === undefined || g.controlIndex === null) return true;
            return controlActive[g.controlIndex];
          });

          let state = STATE_ZERO();
          state = applyGates(activeGates, state);
          const rotations = buildRotations(activeGates);

          branches.push({
            state,
            coords: stateToBlochCoords(state),
            probability,
            rotations
          });
        }

        // Sort by probability descending, limit to 10
        branches.sort((a, b) => b.probability - a.probability);
        if (branches.length > 10) branches.length = 10;

        return branches.length > 0 ? branches : [{
          state: STATE_ZERO(),
          coords: stateToBlochCoords(STATE_ZERO()),
          probability: 1,
          rotations: []
        }];
      }
    });
  }, [circuits, animationFrame, totalFrames, getOrderedGates]);

  const qubitStates = useMemo(() => qubitBranches.map(b => b.reduce((a, c) => c.probability > a.probability ? c : a).state), [qubitBranches]);
  const probabilities = useMemo(() => getMultiQubitProbabilities(qubitStates, false), [qubitStates]);
  const allProbabilities = useMemo(() => getMultiQubitProbabilities(qubitStates, true), [qubitStates]);

  const handleInsertGate = useCallback((qi, si, gate) => {
    const isOccupied = circuits[qi] && circuits[qi][si];

    setCircuits(prev => {
      const next = prev.map(r => [...r]);
      if (isOccupied) {
        // Shift gates
        for (let q = 0; q < next.length; q++) {
          const newRow = [];
          for (let s = 0; s <= Math.max(si, next[q].length); s++) {
            if (s < si) newRow[s] = next[q][s];
            else if (s === si) newRow[s] = q === qi ? gate : next[q][s];
            else newRow[s] = next[q][s - (q === qi ? 0 : 0)];
          }
          if (q === qi) {
            for (let s = si + 1; s <= next[q].length + 1; s++) {
              if (next[q][s - 1]) newRow[s] = next[q][s - 1];
            }
          }
          next[q] = newRow;
        }
      } else {
        next[qi][si] = gate;
      }
      return next;
    });

    if (isOccupied) {
      setBarriers(b => b.map(bi => bi >= si ? bi + 1 : bi));
    }

    setAnimationFrame(-1);
    setIsPlaying(false);
    setSelectedGate({ qubitIndex: qi, slotIndex: si, gate });
  }, [circuits]);

  const handleRemoveGate = useCallback((qi, si) => {
    setCircuits(prev => {
      const next = prev.map(r => [...r]);
      delete next[qi][si];
      return next;
    });
    setSelectedGate(null);
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, []);

  const handleRemoveBarrier = useCallback((slotIdx) => {
    setBarriers(prev => prev.filter(b => b !== slotIdx));
    setSelectedGate(null);
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, []);

  const handleUpdateGate = useCallback((qi, si, newGate) => {
    setCircuits(prev => {
      const next = prev.map(r => [...r]);
      next[qi][si] = newGate;
      return next;
    });
    setSelectedGate(prev => prev ? { ...prev, gate: newGate } : null);
  }, []);

  const handleGateClick = useCallback((qi, si, g) => {
    if (qi === -1) setSelectedGate({ isBarrier: true, slot: si });
    else setSelectedGate({ qubitIndex: qi, slotIndex: si, gate: g });
  }, []);

  const handleGateMiddleClick = useCallback((qi, si) => handleRemoveGate(qi, si), [handleRemoveGate]);

  const handleAddBarrier = useCallback((si) => {
    setBarriers(prev => prev.includes(si) ? prev : [...prev, si].sort((a, b) => a - b));
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, []);

  const handleMoveGate = useCallback((fromQi, fromSi, toQi, toSi) => {
    setCircuits(prev => {
      const next = prev.map(r => [...r]);
      let gate = next[fromQi][fromSi];
      if (!gate) return prev;

      // Remove control if moving to control qubit's row
      if (gate.controlIndex !== undefined && gate.controlIndex !== null && gate.controlIndex === toQi) {
        gate = { ...gate, controlIndex: null };
      }

      // Remove from old position
      delete next[fromQi][fromSi];

      // If target is occupied, shift
      if (next[toQi][toSi]) {
        // Shift gates at toQi from toSi onwards
        for (let s = next[toQi].length; s > toSi; s--) {
          if (next[toQi][s - 1]) {
            next[toQi][s] = next[toQi][s - 1];
          }
        }
        setBarriers(b => b.map(bi => bi >= toSi ? bi + 1 : bi));
      }

      next[toQi][toSi] = gate;
      return next;
    });
    setSelectedGate({ qubitIndex: toQi, slotIndex: toSi });
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, []);

  const handleAddQubit = useCallback(() => {
    setCircuits(prev => [...prev, []]);
    setQubitVisibility(prev => [...prev, true]);
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, []);

  const handleRemoveQubit = useCallback((qi) => {
    if (circuits.length <= 1) return;
    setCircuits(prev => {
      const next = prev.filter((_, i) => i !== qi);
      // Clean up control configs: remove if control points to removed qubit, remap indices
      return next.map((row, newQi) =>
        row.map(gate => {
          if (!gate || gate.controlIndex === undefined || gate.controlIndex === null) return gate;
          if (gate.controlIndex === qi) {
            // Control was pointing to removed qubit - remove control
            return { ...gate, controlIndex: null };
          }
          // Remap control qubit index
          return {
            ...gate,
            controlIndex: gate.controlIndex > qi ? gate.controlIndex - 1 : gate.controlIndex
          };
        })
      );
    });
    setQubitVisibility(prev => prev.filter((_, i) => i !== qi));
    setSelectedGate(null);
    setAnimationFrame(-1);
    setIsPlaying(false);
  }, [circuits.length]);

  const handleToggleVisibility = useCallback((qi) => {
    setQubitVisibility(prev => { const n = [...prev]; n[qi] = !n[qi]; return n; });
  }, []);

  const handleFocusQubit = useCallback((qi) => {
    setQubitVisibility(prev => { const n = [...prev]; n[qi] = true; return n; });
    setFocusQubit(qi);
    setTimeout(() => setFocusQubit(null), 50);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (isDraggingH && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setLeftPanelWidth(Math.min(Math.max(e.clientX - rect.left, 320), rect.width - 320));
      }
      if (isDraggingV && leftPanelRef.current) {
        const rect = leftPanelRef.current.getBoundingClientRect();
        const pct = ((e.clientY - rect.top) / rect.height) * 100;
        setConfigHeightPercent(Math.min(Math.max(pct, 30), 90));
      }
    };
    const onUp = () => { setIsDraggingH(false); setIsDraggingV(false); };
    if (isDraggingH || isDraggingV) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [isDraggingH, isDraggingV]);

  const selectedGateData = selectedGate?.isBarrier ?
    { isBarrier: true, slot: selectedGate.slot } :
    selectedGate ? circuits[selectedGate.qubitIndex]?.[selectedGate.slotIndex] : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Quantum Visualizer</h1>
        <span className="subtitle">Interactive Multi-Qubit Circuit Simulator</span>
      </header>

      <main className="app-main" ref={containerRef}>
        <div className="left-panel" ref={leftPanelRef} style={{ width: leftPanelWidth }}>
          <div className="config-section" style={{ height: `${configHeightPercent}%` }}>
            <GatePalette />
            <CircuitBuilder
              circuits={circuits}
              barriers={barriers}
              qubitVisibility={qubitVisibility}
              selectedGate={selectedGate}
              highlightedBarrier={highlightedBarrier}
              isPlaying={isPlaying}
              animationFrame={animationFrame < 0 ? -1 : animationFrame}
              onInsertGate={handleInsertGate}
              onRemoveGate={handleRemoveGate}
              onMoveGate={handleMoveGate}
              onGateClick={handleGateClick}
              onGateMiddleClick={handleGateMiddleClick}
              onAddQubit={handleAddQubit}
              onRemoveQubit={handleRemoveQubit}
              onToggleVisibility={handleToggleVisibility}
              onFocusQubit={handleFocusQubit}
              onAddBarrier={handleAddBarrier}
              onRemoveBarrier={handleRemoveBarrier}
            />
            <GateSettings
              gate={selectedGateData}
              gateIndex={selectedGate?.slotIndex}
              qubitIndex={selectedGate?.qubitIndex}
              numQubits={circuits.length}
              onRemove={selectedGate?.isBarrier ? () => handleRemoveBarrier(selectedGate.slot) : handleRemoveGate}
              onUpdate={handleUpdateGate}
            />
          </div>

          <div className={`resize-handle-h ${isDraggingV ? 'active' : ''}`} onMouseDown={() => setIsDraggingV(true)} />

          <div className="prob-section" style={{ height: `${100 - configHeightPercent}%` }}>
            <AnimationPlayer
              barrierCount={barrierCount}
              currentFrame={animationFrame < 0 ? totalFrames - 1 : animationFrame}
              isPlaying={isPlaying}
              segmentDurations={segmentDurations}
              onFrameChange={setAnimationFrame}
              onPlayPause={(playing) => { if (playing) setSelectedGate(null); setIsPlaying(playing); }}
              onReset={() => { setAnimationFrame(-1); setIsPlaying(false); }}
            />
            <ProbabilityBars probabilities={probabilities} allProbabilities={allProbabilities} />
            <StateDisplay qubitStates={qubitBranches} />
          </div>
        </div>

        <div className={`resize-handle ${isDraggingH ? 'active' : ''}`} onMouseDown={() => setIsDraggingH(true)} />

        <div className="right-panel">
          <BlochSphereView
            qubitBranches={qubitBranches}
            visibility={qubitVisibility}
            focusQubit={focusQubit}
            isPlaying={isPlaying}
          />
        </div>
      </main>
    </div>
  );
}

export default App;
