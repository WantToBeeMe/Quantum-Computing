import { useState, useMemo, useEffect, useRef } from 'react';
import './CircuitBuilder.css';

export default function CircuitBuilder({
    circuits,
    barriers,
    qubitVisibility,
    selectedGate,
    highlightedBarrier,
    isPlaying = false,
    animationFrame = -1,
    onInsertGate,
    onRemoveGate,
    onMoveGate,
    onGateClick,
    onGateMiddleClick,
    onAddQubit,
    onRemoveQubit,
    onToggleVisibility,
    onFocusQubit,
    onAddBarrier,
    onRemoveBarrier
}) {
    const [isDraggingGate, setIsDraggingGate] = useState(false);
    const [isDraggingBarrier, setIsDraggingBarrier] = useState(false);
    const [isDraggingExisting, setIsDraggingExisting] = useState(null); // {qubit, slot}
    const [dropTarget, setDropTarget] = useState(null); // {qubit, slot} or {insert: true, qubit, slot, side}
    const [barrierTarget, setBarrierTarget] = useState(null);
    const circuitRef = useRef(null);

    const numQubits = circuits.length;
    const rowHeight = 42;
    const slotWidth = 38;
    const totalHeight = numQubits * rowHeight;

    const maxSlot = useMemo(() => {
        let max = 0;
        circuits.forEach(row => {
            row.forEach((gate, idx) => { if (gate) max = Math.max(max, idx); });
        });
        return max;
    }, [circuits]);

    const slots = Array.from({ length: maxSlot + 2 }, (_, i) => i);

    // Sorted barriers for frame logic
    const sortedBarriers = useMemo(() => [...barriers].sort((a, b) => a - b), [barriers]);

    // Determine if a gate at slot is "animated" (within current animation frame)
    const isGateAnimated = useMemo(() => {
        if (!isPlaying || animationFrame < 0) return () => true; // Not playing: all gates visible
        if (animationFrame === 0) return () => false; // Frame 0: no gates

        const barrierCount = sortedBarriers.length;
        if (animationFrame > barrierCount) return () => true; // Final frame: all gates

        // Gates before barrier at (animationFrame - 1) are animated
        const barrierSlot = sortedBarriers[animationFrame - 1];
        return (slot) => slot < barrierSlot;
    }, [isPlaying, animationFrame, sortedBarriers]);

    // Handle drag over circuit area
    const handleCircuitDragOver = (e) => {
        e.preventDefault();

        const rect = circuitRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (isDraggingBarrier) {
            // Barrier: always show closest pillar (minimum 1, not 0)
            const slotIndex = Math.round(x / slotWidth);
            setBarrierTarget(Math.max(1, Math.min(slotIndex, slots.length)));
            setDropTarget(null);
        } else if (isDraggingGate || isDraggingExisting) {
            // Gate: check if over empty slot or need insert indicator
            const slotIndex = Math.floor(x / slotWidth);
            const qubitIndex = Math.floor(y / rowHeight);

            if (qubitIndex >= 0 && qubitIndex < numQubits && slotIndex >= 0 && slotIndex < slots.length) {
                const hasGate = circuits[qubitIndex]?.[slotIndex];
                const isOwnGate = isDraggingExisting?.qubit === qubitIndex && isDraggingExisting?.slot === slotIndex;

                if (hasGate && !isOwnGate) {
                    // Show insert indicator
                    const slotCenterX = slotIndex * slotWidth + slotWidth / 2;
                    const side = x < slotCenterX ? 'left' : 'right';
                    setDropTarget({ insert: true, qubit: qubitIndex, slot: slotIndex, side });
                } else {
                    // Empty slot or own position
                    setDropTarget({ qubit: qubitIndex, slot: slotIndex });
                }
            } else {
                setDropTarget(null);
            }
            setBarrierTarget(null);
        }
    };

    const resetDragState = () => {
        setIsDraggingGate(false);
        setIsDraggingBarrier(false);
        setIsDraggingExisting(null);
        setDropTarget(null);
        setBarrierTarget(null);
    };

    const handleCircuitDrop = (e) => {
        e.preventDefault();

        try {
            const gateData = e.dataTransfer.getData('gate');
            const moveData = e.dataTransfer.getData('moveGate');

            if (moveData) {
                // Moving existing gate
                const { fromQubit, fromSlot, gate } = JSON.parse(moveData);

                if (dropTarget && !dropTarget.insert) {
                    // Drop to empty slot
                    if (fromQubit !== dropTarget.qubit || fromSlot !== dropTarget.slot) {
                        onMoveGate(fromQubit, fromSlot, dropTarget.qubit, dropTarget.slot);
                    }
                } else if (dropTarget?.insert) {
                    // Insert at position
                    const insertSlot = dropTarget.side === 'left' ? dropTarget.slot : dropTarget.slot + 1;
                    onMoveGate(fromQubit, fromSlot, dropTarget.qubit, insertSlot);
                }
            } else if (gateData) {
                const gate = JSON.parse(gateData);

                if (gate.isBarrier && barrierTarget !== null) {
                    onAddBarrier(barrierTarget);
                } else if (!gate.isBarrier) {
                    if (dropTarget && !dropTarget.insert) {
                        onInsertGate(dropTarget.qubit, dropTarget.slot, gate);
                    } else if (dropTarget?.insert) {
                        const insertSlot = dropTarget.side === 'left' ? dropTarget.slot : dropTarget.slot + 1;
                        onInsertGate(dropTarget.qubit, insertSlot, gate);
                    }
                }
            }
        } catch (err) {
            console.error('Drop error:', err);
        }

        resetDragState();
    };

    // Handle starting drag from palette
    const handleDragEnter = (e) => {
        const types = e.dataTransfer.types;
        if (types.includes('barrier')) {
            setIsDraggingBarrier(true);
            setIsDraggingGate(false);
        } else if (types.includes('gate')) {
            setIsDraggingGate(true);
            setIsDraggingBarrier(false);
        }
    };

    // Handle dragging existing gate
    const handleGateDragStart = (e, qi, si, gate) => {
        e.stopPropagation();
        const moveData = { fromQubit: qi, fromSlot: si, gate };
        e.dataTransfer.setData('moveGate', JSON.stringify(moveData));
        e.dataTransfer.setData('gate', JSON.stringify(gate));
        e.dataTransfer.effectAllowed = 'move';
        setIsDraggingExisting({ qubit: qi, slot: si });
        setIsDraggingGate(true);
    };

    return (
        <div className="circuit-builder">
            <div className="circuit-header">
                <h3 className="circuit-title">Circuit</h3>
            </div>

            <div className="circuit-board">
                <div className="circuit-grid">
                    {/* Qubit labels */}
                    <div className="qubit-labels">
                        {circuits.map((_, qi) => (
                            <div key={qi} className="qubit-row-label">
                                <button
                                    className={`qubit-btn eye ${qubitVisibility[qi] ? '' : 'hidden'}`}
                                    onClick={() => onToggleVisibility(qi)}
                                    title={qubitVisibility[qi] ? 'Hide' : 'Show'}
                                >
                                    {qubitVisibility[qi] ? '◉' : '○'}
                                </button>
                                <button
                                    className="qubit-btn trash"
                                    onClick={() => onRemoveQubit(qi)}
                                    disabled={numQubits <= 1}
                                >
                                    ×
                                </button>
                                <button className="qubit-label" onClick={() => onFocusQubit(qi)} title="Focus">
                                    q[{qi}]
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Circuit area */}
                    <div className="circuit-slots-wrapper">
                        <div
                            ref={circuitRef}
                            className="circuit-slots"
                            style={{ '--num-qubits': numQubits, '--total-height': `${totalHeight}px`, '--slot-count': slots.length }}
                            onDragOver={handleCircuitDragOver}
                            onDragEnter={handleDragEnter}
                            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) resetDragState(); }}
                            onDrop={handleCircuitDrop}
                        >
                            {/* Qubit track lines */}
                            {circuits.map((_, qi) => (
                                <div key={qi} className="qubit-track" style={{ '--row': qi }} />
                            ))}

                            {/* Control lines (SVG underneath) */}
                            <svg className="control-lines-svg" style={{ width: slots.length * slotWidth, height: totalHeight }}>
                                {circuits.map((row, qi) =>
                                    row.map((gate, si) => {
                                        if (!gate || gate.controlQubit === undefined) return null;
                                        const ctrlQ = gate.controlQubit;
                                        const gateY = qi * rowHeight + rowHeight / 2;
                                        const ctrlY = ctrlQ * rowHeight + rowHeight / 2;
                                        const gateX = si * slotWidth + slotWidth / 2;

                                        return (
                                            <g key={`ctrl-${qi}-${si}`}>
                                                <line x1={gateX} y1={gateY} x2={gateX} y2={ctrlY} stroke="#a371f7" strokeWidth="2" />
                                                <circle cx={gateX} cy={ctrlY} r="5" fill="#a371f7" />
                                            </g>
                                        );
                                    })
                                )}
                            </svg>

                            {/* Barriers */}
                            {barriers.map((slotIdx, bIdx) => (
                                <div
                                    key={`barrier-${bIdx}`}
                                    className={`barrier-line ${highlightedBarrier === bIdx ? 'highlighted' : ''} ${selectedGate?.isBarrier && selectedGate?.slot === slotIdx ? 'selected' : ''}`}
                                    style={{ '--slot': slotIdx, '--total-height': `${totalHeight}px` }}
                                    onClick={() => onGateClick(-1, slotIdx, { isBarrier: true })}
                                    onMouseDown={(e) => e.button === 1 && onRemoveBarrier(slotIdx)}
                                    title="Barrier"
                                />
                            ))}

                            {/* Barrier indicator while dragging */}
                            {barrierTarget !== null && isDraggingBarrier && (
                                <div
                                    className="barrier-indicator"
                                    style={{ '--slot': barrierTarget, '--total-height': `${totalHeight}px` }}
                                />
                            )}

                            {/* Drop target highlight */}
                            {dropTarget && !dropTarget.insert && (isDraggingGate || isDraggingExisting) && (
                                <div
                                    className="drop-highlight"
                                    style={{ '--slot': dropTarget.slot, '--row': dropTarget.qubit }}
                                />
                            )}

                            {/* Insert indicator */}
                            {dropTarget?.insert && (
                                <div
                                    className={`insert-indicator ${dropTarget.side}`}
                                    style={{ '--slot': dropTarget.slot, '--row': dropTarget.qubit }}
                                />
                            )}

                            {/* Gates */}
                            {circuits.map((row, qi) =>
                                row.map((gate, si) => {
                                    if (!gate) return null;
                                    const isSelected = selectedGate?.qubitIndex === qi && selectedGate?.slotIndex === si;
                                    const isBeingDragged = isDraggingExisting?.qubit === qi && isDraggingExisting?.slot === si;
                                    const isAnimated = isGateAnimated(si);
                                    const isDisabled = isPlaying && !isAnimated;

                                    return (
                                        <div
                                            key={`gate-${qi}-${si}`}
                                            className={`circuit-gate ${isSelected ? 'selected' : ''} ${isBeingDragged ? 'dragging' : ''} ${isDisabled ? 'disabled' : ''}`}
                                            style={{ '--slot': si, '--row': qi, '--gate-color': gate.color }}
                                            onClick={() => {
                                                if (isPlaying) return; // Disable interaction during play
                                                // Toggle selection: click again to deselect
                                                if (selectedGate?.qubitIndex === qi && selectedGate?.slotIndex === si) {
                                                    onGateClick(null, null, null);
                                                } else {
                                                    onGateClick(qi, si, gate);
                                                }
                                            }}
                                            onMouseDown={(e) => !isPlaying && e.button === 1 && onGateMiddleClick(qi, si)}
                                            draggable={!isPlaying}
                                            onDragStart={(e) => !isPlaying && handleGateDragStart(e, qi, si, gate)}
                                            onDragEnd={resetDragState}
                                            title={`${gate.label}\nDrag to move | Middle-click to remove`}
                                        >
                                            {gate.controlQubit !== undefined && <span className="control-indicator">C</span>}
                                            {gate.label}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <button className="add-qubit-button" onClick={onAddQubit}>+ Add Qubit</button>
        </div>
    );
}
