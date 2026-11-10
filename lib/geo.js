'use strict';

const R = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoord(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

function allowedRadius(object) {
  return Math.max(25, Number(object.radius) || 80);
}

function maxAccuracy(object) {
  return Math.max(20, Math.min(60, allowedRadius(object) * 0.6));
}

module.exports = { distanceMeters, validCoord, allowedRadius, maxAccuracy, toRad };
