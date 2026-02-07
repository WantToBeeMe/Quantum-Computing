import { useState, useEffect } from 'react';
import { GATES } from './quantum';
import './GateSettings.css';

const parsePiNotation = (str) => {
    if (typeof str === 'number') return str;
    const s = str.toString().trim().toLowerCase().replace('π', 'pi');
    if (s === 'pi') return Math.PI;
    if (s === '-pi') return -Math.PI;
    const divMatch = s.match(/^(-?)pi\s*\/\s*(\d+)$/);
    if (divMatch) return (divMatch[1] === '-' ? -1 : 1) * Math.PI / parseInt(divMatch[2]);
    const mulMatch = s.match(/^(-?\d*\.?\d*)\s*\*?\s*pi$/);
    if (mulMatch) {
        const num = mulMatch[1] === '' || mulMatch[1] === '-' ? (mulMatch[1] === '-' ? -1 : 1) : parseFloat(mulMatch[1]);
        return num * Math.PI;
    }
    const num = parseFloat(s);
    return isNaN(num) ? 0 : num;
};

const toPiNotation = (rad) => {
    const pi = Math.PI;
    if (Math.abs(rad) < 0.001) return '0';
    if (Math.abs(rad - pi) < 0.001) return 'π';
    if (Math.abs(rad + pi) < 0.001) return '-π';
    if (Math.abs(rad - pi / 2) < 0.001) return 'π/2';
    if (Math.abs(rad + pi / 2) < 0.001) return '-π/2';
    if (Math.abs(rad - pi / 4) < 0.001) return 'π/4';
    if (Math.abs(rad + pi / 4) < 0.001) return '-π/4';
    return rad.toFixed(3);
};

export default function GateSettings({ gate, gateIndex, qubitIndex, onRemove, onUpdate, numQubits }) {
    const [isControlled, setIsControlled] = useState(gate?.controlQubit !== undefined);
    const [controlQubit, setControlQubit] = useState(gate?.controlQubit ?? -1);
    const [useSliders, setUseSliders] = useState(false);
    const [params, setParams] = useState({
        theta: gate?.params?.theta || 0,
        phi: gate?.params?.phi || 0,
        lambda: gate?.params?.lambda || 0
    });
    const [paramStrings, setParamStrings] = useState({
        theta: toPiNotation(params.theta),
        phi: toPiNotation(params.phi),
        lambda: toPiNotation(params.lambda)
    });

    useEffect(() => {
        if (gate && !gate.isBarrier) {
            setIsControlled(gate.controlQubit !== undefined);
            setControlQubit(gate.controlQubit ?? -1);
            const newParams = {
                theta: gate.params?.theta || 0,
                phi: gate.params?.phi || 0,
                lambda: gate.params?.lambda || 0
            };
            setParams(newParams);
            setParamStrings({
                theta: toPiNotation(newParams.theta),
                phi: toPiNotation(newParams.phi),
                lambda: toPiNotation(newParams.lambda)
            });
        }
    }, [gate, gateIndex, qubitIndex]);

    if (!gate) {
        return (
            <div className="gate-settings empty">
                <span className="placeholder">Click a gate to configure</span>
            </div>
        );
    }

    if (gate.isBarrier) {
        return (
            <div className="gate-settings">
                <div className="settings-header">
                    <div className="gate-badge barrier">┃</div>
                    <span className="gate-name">Barrier</span>
                </div>
                <div className="settings-actions">
                    <button className="action-btn remove" onClick={() => onRemove(qubitIndex, gateIndex)}>Remove</button>
                </div>
            </div>
        );
    }

    const gateInfo = GATES[gate.gate] || gate;
    const isParametric = gate.gate === 'U' || gateInfo.isParametric;
    const hasDecomposition = gateInfo.decomposition !== null;

    const handleParamStringChange = (key, value) => setParamStrings(prev => ({ ...prev, [key]: value }));

    const handleParamBlur = (key) => {
        const parsed = parsePiNotation(paramStrings[key]);
        const newParams = { ...params, [key]: parsed };
        setParams(newParams);
        onUpdate(qubitIndex, gateIndex, { ...gate, params: newParams });
    };

    const handleSliderChange = (key, value) => {
        const numValue = parseFloat(value);
        const newParams = { ...params, [key]: numValue };
        setParams(newParams);
        setParamStrings(prev => ({ ...prev, [key]: toPiNotation(numValue) }));
        onUpdate(qubitIndex, gateIndex, { ...gate, params: newParams });
    };

    const handleControlChange = (checked) => {
        setIsControlled(checked);
        if (!checked) {
            setControlQubit(-1);
            onUpdate(qubitIndex, gateIndex, { ...gate, controlQubit: undefined });
        }
    };

    const handleControlQubitChange = (value) => {
        const ctrl = parseInt(value);
        setControlQubit(ctrl);
        if (ctrl >= 0) {
            onUpdate(qubitIndex, gateIndex, { ...gate, controlQubit: ctrl });
        }
    };

    const handleDecompose = () => {
        if (gateInfo.decomposition) {
            onUpdate(qubitIndex, gateIndex, {
                gate: 'U',
                label: 'U',
                params: gateInfo.decomposition.params,
                color: GATES.U.color,
                description: GATES.U.description,
                controlQubit: gate.controlQubit // Keep controlled config
            });
        }
    };

    const availableControlQubits = Array.from({ length: numQubits }, (_, i) => i).filter(i => i !== qubitIndex);

    return (
        <div className="gate-settings">
            <div className="settings-header">
                <div className="gate-badge" style={{ '--gate-color': gate.color }}>{gate.label}</div>
                <span className="gate-name">{gateInfo.description}</span>
            </div>

            {isParametric && (
                <div className="param-section">
                    <div className="param-header">
                        <span>Parameters</span>
                        <label className="slider-toggle">
                            <input type="checkbox" checked={useSliders} onChange={e => setUseSliders(e.target.checked)} />
                            <span>Sliders</span>
                        </label>
                    </div>

                    {useSliders ? (
                        <div className="param-sliders">
                            {['theta', 'phi', 'lambda'].map(key => (
                                <div key={key} className="slider-row">
                                    <label>{key === 'theta' ? 'θ' : key === 'phi' ? 'φ' : 'λ'}</label>
                                    <input type="range" min={-Math.PI} max={Math.PI} step={0.01} value={params[key]} onChange={e => handleSliderChange(key, e.target.value)} />
                                    <span className="slider-value">{toPiNotation(params[key])}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="param-grid">
                            {['theta', 'phi', 'lambda'].map(key => (
                                <div key={key} className="param-row">
                                    <label>{key === 'theta' ? 'θ' : key === 'phi' ? 'φ' : 'λ'}</label>
                                    <input type="text" value={paramStrings[key]} onChange={e => handleParamStringChange(key, e.target.value)} onBlur={() => handleParamBlur(key)} placeholder="π/4..." />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {numQubits > 1 && !gate.isBarrier && (
                <div className="control-section">
                    <label className="control-toggle">
                        <input type="checkbox" checked={isControlled} onChange={e => handleControlChange(e.target.checked)} />
                        <span>Controlled</span>
                    </label>
                    {isControlled && (
                        <div className="control-select">
                            {availableControlQubits.map(q => (
                                <button
                                    key={q}
                                    className={`control-qubit-btn ${controlQubit === q ? 'active' : ''}`}
                                    onClick={() => handleControlQubitChange(q)}
                                >
                                    q[{q}]
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="settings-actions">
                {hasDecomposition && <button className="action-btn decompose" onClick={handleDecompose}>→ U</button>}
                <button className="action-btn remove" onClick={() => onRemove(qubitIndex, gateIndex)}>Remove</button>
            </div>
        </div>
    );
}
