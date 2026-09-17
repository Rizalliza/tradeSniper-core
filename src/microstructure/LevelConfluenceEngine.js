export class LevelConfluenceEngine {
    constructor({
        zonePct = 0.0015,
        minZone = 0,
    } = {}) {
        this.zonePct = zonePct;
        this.minZone = minZone;
    }

    buildZones(levels = []) {
        const cleanLevels = levels
            .map(normalizeLevel)
            .filter(level => Number.isFinite(level.value))
            .sort((a, b) => a.value - b.value);

        const zones = [];
        for (const level of cleanLevels) {
            const previous = zones.at(-1);
            if (!previous || !this._overlaps(previous, level)) {
                zones.push(this._newZone(level));
                continue;
            }
            this._merge(previous, level);
        }

        return zones.map((zone, index) => ({
            id: zone.id || `Z${index + 1}`,
            center: round(zone.center),
            low: round(zone.low),
            high: round(zone.high),
            width: round(zone.high - zone.low),
            confluence: zone.levels.length,
            roles: [...new Set(zone.levels.map(level => level.role).filter(Boolean))],
            levels: zone.levels,
        }));
    }

    _newZone(level) {
        const radius = this._radius(level.value);
        return {
            id: null,
            center: level.value,
            low: level.value - radius,
            high: level.value + radius,
            levels: [level],
        };
    }

    _merge(zone, level) {
        const radius = this._radius(level.value);
        zone.levels.push(level);
        zone.low = Math.min(zone.low, level.value - radius);
        zone.high = Math.max(zone.high, level.value + radius);
        zone.center = weightedCenter(zone.levels);
        zone.id = zone.levels.map(l => l.name).join('+');
    }

    _overlaps(zone, level) {
        const radius = this._radius(level.value);
        return level.value - radius <= zone.high;
    }

    _radius(value) {
        return Math.max(Math.abs(value) * this.zonePct, this.minZone);
    }
}

export function buildConfluenceZones(levels, opts) {
    return new LevelConfluenceEngine(opts).buildZones(levels);
}

function normalizeLevel(level, index) {
    return {
        name: String(level?.name || level?.id || `L${index + 1}`),
        value: Number(level?.value),
        role: level?.role || level?.tier || null,
        type: level?.type || 'level',
        source: level?.source || null,
    };
}

function weightedCenter(levels) {
    if (!levels.length) return null;
    return levels.reduce((sum, level) => sum + level.value, 0) / levels.length;
}

function round(value, digits = 6) {
    return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}
