"""Source-backed character arithmetic and explicitly formatted skill parameters."""
from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


BASE_PROPERTIES = {
    'FIGHT_PROP_BASE_HP': 'hpBase',
    'FIGHT_PROP_BASE_ATTACK': 'attackBase',
    'FIGHT_PROP_BASE_DEFENSE': 'defenseBase',
}
FIXED_PROPERTIES = {
    'FIGHT_PROP_CRITICAL': 'critical',
    'FIGHT_PROP_CRITICAL_HURT': 'criticalHurt',
    'FIGHT_PROP_CHARGE_EFFICIENCY': 'chargeEfficiency',
}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def promotion_ranges(promotions):
    """A phase's minimum is proven only by its immediate predecessor's source cap."""
    phases = {}
    duplicate = False
    for row in promotions:
        phase = row.get('promoteLevel', 0)
        maximum = row.get('unlockMaxLevel')
        if not isinstance(phase, int) or isinstance(phase, bool) or phase < 0:
            continue
        if phase in phases:
            duplicate = True
        phases[phase] = row
    ranges = []
    for phase, row in sorted(phases.items()):
        minimum = 1 if phase == 0 else phases.get(phase - 1, {}).get('unlockMaxLevel')
        maximum = row.get('unlockMaxLevel')
        if all(isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in (minimum, maximum)) and maximum >= minimum:
            ranges.append((phase, minimum, maximum, row))
    complete = bool(phases) and not duplicate and set(phases) == set(range(max(phases) + 1)) and len(ranges) == len(promotions)
    return ranges, complete


def character_levels(avatar, promotions, curves):
    """Keep proven ascension boundaries; missing predecessor phases never imply level 1."""
    growth = {r.get('type'): r.get('growCurve') for r in avatar.get('propGrowCurves', [])}
    result = []
    for phase, minimum, maximum, promotion in promotion_ranges(promotions)[0]:
        additions = {r['propType']: r.get('value', 0) for r in promotion.get('addProps', []) if r.get('propType')}
        for level in range(minimum, maximum + 1):
            stats = {}
            for prop, field in BASE_PROPERTIES.items():
                curve = curves.get(level, {}).get(growth.get(prop), {})
                base, multiplier, addition = avatar.get(field), curve.get('value'), additions.get(prop, 0)
                if curve.get('arith') == 'ARITH_MULTI' and all(finite(v) for v in (base, multiplier, addition)):
                    value = base * multiplier + addition
                    if finite(value):
                        stats[prop] = round(value, 8)
            for prop, field in FIXED_PROPERTIES.items():
                base, addition = avatar.get(field), additions.get(prop, 0)
                if finite(base) and finite(addition) and finite(base + addition):
                    stats[prop] = round(base + addition, 8)
            for prop, addition in additions.items():
                if prop not in BASE_PROPERTIES and prop not in FIXED_PROPERTIES and finite(addition):
                    stats[prop] = addition
            result.append({'level': level, 'ascension': phase, 'stats': stats})
    return result


def format_attribute(template, parameters):
    """Formats encode units; P multiplies by 100 while F does not."""
    unresolved = False

    def replace(match):
        nonlocal unresolved
        index, spec = int(match[1]) - 1, match[2]
        if index < 0 or index >= len(parameters) or not finite(parameters[index]):
            unresolved = True
            return ''
        percent = 'P' in spec
        if not re.fullmatch(r'(?:F[0-4]P?|P[0-4]?|I)', spec):
            unresolved = True
            return ''
        digits = int(spec[1]) if spec.startswith('F') else int(spec[1:]) if len(spec) > 1 and spec.startswith('P') else 0
        try:
            value = Decimal(str(parameters[index])) * (100 if percent else 1)
            value = value.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
        except InvalidOperation:
            unresolved = True
            return ''
        return f'{value:.{digits}f}' + ('%' if percent else '')

    text = re.sub(r'\{param(\d+):([^}]+)\}', replace, template)
    if re.search(r'\{[^}]*\}', text):
        unresolved = True
    return {'template': template, 'text': None if unresolved else text,
            'status': 'unresolved' if unresolved else 'complete'}
