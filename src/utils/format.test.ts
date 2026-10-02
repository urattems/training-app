import { describe, expect, it } from 'vitest';
import { toLocalDateString, toLocalIsoString, secondsBetween } from './dates';
import { formatDayLong, formatDayShort, formatDuration, formatTime } from './format';
import { formatDecimal, formatKg, parseDecimalInput, parseIntegerInput } from './numbers';

describe('parseDecimalInput', () => {
  it('accepte la virgule et le point, normalise en nombre', () => {
    expect(parseDecimalInput('47,5')).toEqual({ ok: true, value: 47.5 });
    expect(parseDecimalInput('47.5')).toEqual({ ok: true, value: 47.5 });
    expect(parseDecimalInput('47')).toEqual({ ok: true, value: 47 });
    expect(parseDecimalInput(' 0,25 ')).toEqual({ ok: true, value: 0.25 });
    expect(parseDecimalInput('0')).toEqual({ ok: true, value: 0 });
    expect(parseDecimalInput('250')).toEqual({ ok: true, value: 250 });
  });

  it('champ vide = null (série non faite)', () => {
    expect(parseDecimalInput('')).toEqual({ ok: true, value: null });
    expect(parseDecimalInput('   ')).toEqual({ ok: true, value: null });
  });

  it('refuse les saisies incomplètes, négatives ou non numériques', () => {
    for (const input of ['47,', '47.', ',5', '-5', '4,7,5', 'abc', '47kg', '1e3']) {
      expect(parseDecimalInput(input), input).toEqual({ ok: false });
    }
  });
});

describe('parseIntegerInput', () => {
  it('entiers positifs uniquement, vide = null', () => {
    expect(parseIntegerInput('12')).toEqual({ ok: true, value: 12 });
    expect(parseIntegerInput('')).toEqual({ ok: true, value: null });
    for (const input of ['12,5', '-1', '1.0', 'x']) expect(parseIntegerInput(input), input).toEqual({ ok: false });
  });
});

describe('formatKg / formatDecimal', () => {
  it('affichage français', () => {
    expect(formatKg(47.5)).toBe('47,5 kg');
    expect(formatKg(47)).toBe('47 kg');
    expect(formatKg(0)).toBe('0 kg');
    expect(formatKg(52.25)).toBe('52,25 kg');
    expect(formatDecimal(4.5)).toBe('4,5');
  });
});

describe('Dates et durées', () => {
  it('horodatage local avec offset et date métier', () => {
    const date = new Date(2026, 9, 1, 18, 5, 9);
    expect(toLocalDateString(date)).toBe('2026-10-01');
    expect(toLocalIsoString(date)).toMatch(/^2026-10-01T18:05:09[+-]\d{2}:\d{2}$/);
    expect(Date.parse(toLocalIsoString(date))).toBe(date.getTime());
    expect(secondsBetween('2026-10-01T18:00:00+02:00', '2026-10-01T19:08:00+02:00')).toBe(4080);
    expect(secondsBetween('2026-10-01T19:00:00+02:00', '2026-10-01T18:00:00+02:00')).toBe(0);
  });

  it('formats d\'affichage', () => {
    expect(formatDayLong('2026-09-08', 2026)).toBe('mardi 8 septembre');
    expect(formatDayLong('2025-09-08', 2026)).toBe('lundi 8 septembre 2025');
    expect(formatDayShort('2026-09-08')).toBe('8 sept.');
    expect(formatTime(new Date(2026, 9, 1, 18, 2).toISOString())).toBe('18:02');
    expect(formatDuration(4080)).toBe('1 h 08');
    expect(formatDuration(2700)).toBe('45 min');
    expect(formatDuration(20)).toBe('< 1 min');
  });
});
