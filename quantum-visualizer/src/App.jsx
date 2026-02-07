import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import BlochSphereView from './BlochSphere';
import GatePalette from './GatePalette';
import CircuitBuilder from './CircuitBuilder';
import GateSettings from './GateSettings';
import AnimationPlayer from './AnimationPlayer';
import ProbabilityBars from './ProbabilityBars';
import {
  STATE_ZERO,
  GATES,
  applyGate,
  getMultiQubitProbabilities,
  stateToBlochCoords,
  getProbabilities
} from './quantum';
import './App.css';

function App() {
  const [circuits, setCircuits] = useState([[]]);
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
  // Returns array of {gate, slot} objects sorted by slot
  const getOrderedGates = useCallback((qubitIndex, frame) => {
    const row = circuits[qubitIndex] || [];
    const sortedBarriers = [...barriers].sort((a, b) => a - b);

    // Get all gates with their slots
    const entries = row.map((gate, slot) => ({ gate: { ...gate, slot }, slot })).filter(e => e.gate);
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
    const getControlStateAtSlot = (ctrlQubit, slot) => {
      const ctrlGates = getOrderedGates(ctrlQubit, frame);
      let state = STATE_ZERO();
      for (const g of ctrlGates) {
        // Only apply gates at slots BEFORE or EQUAL to the controlled gate's slot
        if (g.slot <= slot) {
          state = applyGate(state, GATES[g.gate] || g, g.params);
        }
      }
      return state;
    };

    return circuits.map((_, qi) => {
      const gates = getOrderedGates(qi, frame);
      const controlledGate = gates.find(g => g.controlQubit !== undefined);
      const hasControl = !!controlledGate;

      // Calculate cumulative rotations - use U-gate decomposition for all gates
      const rotations = [];
      for (const gate of gates) {
        const info = GATES[gate.gate] || gate;

        // Use decomposition params if available, otherwise use direct params
        let params = gate.params;
        if (info.decomposition && info.decomposition.params) {
          params = info.decomposition.params;
        }

        if (params) {
          const theta = params.theta || 0;
          const lambda = params.lambda || 0;
          const hasTheta = Math.abs(theta) > 0.01;
          const hasLambda = Math.abs(lambda) > 0.01;
          if (hasTheta || hasLambda) {
            rotations.push({
              theta: hasTheta ? theta : 0,
              lambda: hasLambda ? lambda : 0,
              isCompound: true
            });
          }
        }
      }

      if (!hasControl) {
        let state = STATE_ZERO();
        for (const gate of gates) {
          const info = GATES[gate.gate] || gate;
          state = applyGate(state, info, gate.params);
        }
        return [{ state, coords: stateToBlochCoords(state), probability: 1, rotations }];
      } else {
        // Evaluate with slot-aware control: control state at the slot of the controlled gate
        const ctrlSlot = controlledGate.slot;
        const ctrlIdx = controlledGate.controlQubit;

        // Get control probability at the slot where the controlled gate is
        const ctrlState = getControlStateAtSlot(ctrlIdx, ctrlSlot);
        const ctrlProb = getProbabilities(ctrlState).prob1;

        // State if control is |0⟩ (don't apply controlled gates)
        let stateNo = STATE_ZERO();
        for (const gate of gates) {
          if (gate.controlQubit === undefined) {
            const info = GATES[gate.gate] || gate;
            stateNo = applyGate(stateNo, info, gate.params);
          }
        }

        // State if control is |1⟩ (apply all gates including controlled)
        let stateWith = STATE_ZERO();
        for (const gate of gates) {
          const info = GATES[gate.gate] || gate;
          stateWith = applyGate(stateWith, info, gate.params);
        }

        const branches = [];
        const rotationsNo = [];
        for (const gate of gates) {
          if (gate.controlQubit === undefined) {
            const info = GATES[gate.gate] || gate;
            if (info.rotation) rotationsNo.push({ ...info.rotation });
          }
        }

        if (1 - ctrlProb > 0.01) branches.push({ state: stateNo, coords: stateToBlochCoords(stateNo), probability: 1 - ctrlProb, rotations: rotationsNo });
        if (ctrlProb > 0.01) branches.push({ state: stateWith, coords: stateToBlochCoords(stateWith), probability: ctrlProb, rotations });
        return branches.length > 0 ? branches : [{ state: stateNo, coords: stateToBlochCoords(stateNo), probability: 1, rotations: rotationsNo }];
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
      if (gate.controlQubit !== undefined && gate.controlQubit === toQi) {
        gate = { ...gate };
        delete gate.controlQubit;
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
          if (!gate || gate.controlQubit === undefined) return gate;
          if (gate.controlQubit === qi) {
            // Control was pointing to removed qubit - remove control
            const { controlQubit, ...rest } = gate;
            return rest;
          }
          // Remap control qubit index
          return {
            ...gate,
            controlQubit: gate.controlQubit > qi ? gate.controlQubit - 1 : gate.controlQubit
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
