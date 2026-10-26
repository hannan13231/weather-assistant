import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlaceLabel, clampLatitude, describeWeather, formatCoords, formatDayLabel, formatHour,
  formatNumber, formatTemperature, hourlyWindow, isFiniteNumber, normalizeLongitude,
  rangeBarGeometry, sanitizeQuery, uvCategory, windDirection, WEATHER_CODES
} from '../js/utils.js';

test('describeWeather returns the mapped label and day/night icon', () => {
  assert.deepEqual(describeWeather(0, true), { label: 'Clear sky', icon: '☀️' });
  assert.equal(describeWeather(0, false).icon, '🌙');
  assert.equal(describeWeather(95).label, 'Thunderstorm');
});

test('describeWeather falls back for unknown codes', () => {
  assert.deepEqual(describeWeather(1234), { label: 'Unknown', icon: '❔' });
  assert.deepEqual(describeWeather(null), { label: 'Unknown', icon: '❔' });
});

test('WEATHER_CODES is immutable', () => {
  assert.throws(() => { 'use strict'; WEATHER_CODES[0] = null; }, TypeError);
});

test('isFiniteNumber rejects non-numeric and non-finite values', () => {
  assert.equal(isFiniteNumber(3.2), true);
  assert.equal(isFiniteNumber(0), true);
  assert.equal(isFiniteNumber(NaN), false);
  assert.equal(isFiniteNumber(Infinity), false);
  assert.equal(isFiniteNumber('5'), false);
  assert.equal(isFiniteNumber(undefined), false);
});

test('formatNumber rounds and appends a suffix', () => {
  assert.equal(formatNumber(12.6, '%'), '13%');
  assert.equal(formatNumber(1.234, ' mm', 1), '1.2 mm');
  assert.equal(formatNumber(null, '%'), '--');
});

test('formatTemperature respects the selected unit', () => {
  assert.equal(formatTemperature(21.4), '21°C');
  assert.equal(formatTemperature(70.6, 'fahrenheit'), '71°F');
  assert.equal(formatTemperature('warm'), '--');
});

test('windDirection maps bearings to compass points', () => {
  assert.equal(windDirection(0), 'N');
  assert.equal(windDirection(90), 'E');
  assert.equal(windDirection(181), 'S');
  assert.equal(windDirection(-90), 'W');
  assert.equal(windDirection(360), 'N');
  assert.equal(windDirection(undefined), '');
});

test('uvCategory bands match WHO thresholds', () => {
  assert.equal(uvCategory(1), 'Low');
  assert.equal(uvCategory(5.9), 'Moderate');
  assert.equal(uvCategory(7), 'High');
  assert.equal(uvCategory(10), 'Very high');
  assert.equal(uvCategory(12), 'Extreme');
  assert.equal(uvCategory('x'), '--');
});

test('formatHour renders 12h and 24h clock values', () => {
  assert.equal(formatHour('2026-09-26T14:00'), '2 PM');
  assert.equal(formatHour('2026-09-26T00:30'), '12 AM');
  assert.equal(formatHour('2026-09-26T09:15', false), '09:15');
  assert.equal(formatHour('not-a-date'), '--');
  assert.equal(formatHour(null), '--');
});

test('formatDayLabel marks the reference day as Today', () => {
  assert.equal(formatDayLabel('2026-09-26', '2026-09-26T10:00'), 'Today');
  assert.equal(formatDayLabel('2026-09-27', '2026-09-26'), 'Sun');
  assert.equal(formatDayLabel('oops'), '--');
});

test('buildPlaceLabel joins unique, non-empty parts', () => {
  assert.equal(buildPlaceLabel({ name: 'Paris', admin1: 'Île-de-France', country: 'France' }),
    'Paris, Île-de-France, France');
  assert.equal(buildPlaceLabel({ name: 'Singapore', admin1: '', country: 'Singapore' }), 'Singapore');
  assert.equal(buildPlaceLabel(null), 'Unknown location');
});

test('clampLatitude and normalizeLongitude keep coordinates valid', () => {
  assert.equal(clampLatitude(120), 90);
  assert.equal(clampLatitude(-120), -90);
  assert.equal(clampLatitude('x'), 0);
  assert.equal(normalizeLongitude(190), -170);
  assert.equal(normalizeLongitude(-190), 170);
  assert.equal(normalizeLongitude(45), 45);
});

test('sanitizeQuery strips control characters and limits length', () => {
  assert.equal(sanitizeQuery('  Berlin \n'), 'Berlin');
  assert.equal(sanitizeQuery('a'.repeat(200)).length, 80);
  assert.equal(sanitizeQuery(42), '');
});

test('formatCoords renders hemispheres', () => {
  assert.equal(formatCoords(12.9716, 77.5946), '12.97°N, 77.59°E');
  assert.equal(formatCoords(-33.87, -70.66), '33.87°S, 70.66°W');
  assert.equal(formatCoords(NaN, 1), '--');
});

test('hourlyWindow starts at the current hour', () => {
  const times = ['2026-09-26T10:00', '2026-09-26T11:00', '2026-09-26T12:00'];
  assert.deepEqual(hourlyWindow(times, '2026-09-26T11:00', 2), { start: 1, end: 3 });
  assert.deepEqual(hourlyWindow(times, '2030-01-01T00:00', 2), { start: 0, end: 2 });
  assert.deepEqual(hourlyWindow([], 'x'), { start: 0, end: 0 });
});

test('rangeBarGeometry returns bounded offsets and widths', () => {
  assert.deepEqual(rangeBarGeometry(10, 20, 0, 40), { offset: 25, width: 25 });
  assert.deepEqual(rangeBarGeometry(1, 1, 5, 5), { offset: 0, width: 100 });
  const geometry = rangeBarGeometry(0, 1, 0, 100);
  assert.ok(geometry.width >= 4);
});
