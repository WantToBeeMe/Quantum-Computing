import React from 'react';
import './StateDisplay.css';

/**
 * Format a complex number for display
 */
const formatComplex = (c) => {
    const re = c.re;
    const im = c.im;
    const absRe = Math.abs(re);
    const absIm = Math.abs(im);

    if (absRe < 0.001 && absIm < 0.001) return '0';
    if (absIm < 0.001) return re.toFixed(3);
    if (absRe < 0.001) return `${im >= 0 ? '' : '-'}${absIm.toFixed(3)}i`;

    const sign = im >= 0 ? '+' : '-';
    return `${re.toFixed(3)}${sign}${absIm.toFixed(3)}i`;
};

/**
 * Format a quantum state as mathematical notation
 */
const formatStateString = (state) => {
    if (!state || state.length < 2) return '|0⟩';
    const [alpha, beta] = state;

    const alphaStr = formatComplex(alpha);
    const betaStr = formatComplex(beta);

    const parts = [];
    if (alphaStr !== '0') {
        parts.push({ coef: alphaStr, ket: '|0⟩' });
    }
    if (betaStr !== '0') {
        parts.push({ coef: betaStr, ket: '|1⟩' });
    }

    if (parts.length === 0) return '0';
    return parts;
};

function StateDisplay({ qubitStates }) {
    if (!qubitStates || qubitStates.length === 0) {
        return null;
    }

    return (
        <div className="state-display">
            <h4>Mathematical State</h4>
            <div className="state-equations">
                {qubitStates.map((branches, qIdx) => {
                    // Get the primary state (first branch or highest probability)
                    const primaryBranch = branches && branches.length > 0 ? branches[0] : null;
                    const state = primaryBranch?.state;
                    const parts = formatStateString(state);

                    return (
                        <div key={qIdx} className="qubit-state-row">
                            <span className="qubit-label">q{qIdx}:</span>
                            <span className="state-equation">
                                {Array.isArray(parts) ? parts.map((p, i) => (
                                    <React.Fragment key={i}>
                                        {i > 0 && <span className="operator"> + </span>}
                                        <span className="coefficient">{p.coef}</span>
                                        <span className="ket">{p.ket}</span>
                                    </React.Fragment>
                                )) : <span className="ket">{parts}</span>}
                            </span>
                            {branches && branches.length > 1 && (
                                <span className="branch-indicator">({branches.length} branches)</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default StateDisplay;
