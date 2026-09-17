import { OpeningMicrostructureState } from './OpeningMicrostructureState.js';
import { buildConfluenceZones } from './LevelConfluenceEngine.js';

export class OpeningMicrostructureLiveState extends OpeningMicrostructureState {
    constructor({
        confluenceZonePct = 0.0015,
        ...opts
    } = {}) {
        super(opts);
        this.confluenceZonePct = confluenceZonePct;
    }

    snapshot() {
        const base = super.snapshot();
        const elapsedMs = this._elapsedMs();
        const isFinal = this._isFinal();
        const f2 = base.f2;

        return {
            ...base,
            complete: Boolean(f2),
            isFinal,
            phase: isFinal ? 'FINAL' : 'FORMING',
            elapsedMs,
            f2: f2 ? {
                ...f2,
                isFinal,
                elapsedMs,
                levels: this._levels(f2),
                zones: buildConfluenceZones(this._levels(f2), { zonePct: this.confluenceZonePct }),
            } : null,
        };
    }

    _levels(f2) {
        return [
            { name: 'F2-H', value: f2.high, role: 'upper', type: 'opening' },
            { name: 'F2-M', value: f2.midpoint, role: 'mid', type: 'opening' },
            { name: 'F2-L', value: f2.low, role: 'lower', type: 'opening' },
        ];
    }
}
