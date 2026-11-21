/**
 * Hand tracking utilities (used by dashboard)
 * Kept separate for architecture clarity.
 */

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

export function isFingerExtended(landmarks, tipIdx, pipIdx) {
  const wrist = landmarks[0];
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  return distance(wrist, tip) > distance(wrist, pip) * 1.15;
}

export function countExtendedFingers(landmarks) {
  let count = 0;
  const pairs = [
    [8, 6],   // index
    [12, 10], // middle
    [16, 14], // ring
    [20, 18]  // pinky
  ];
  for (const [tip, pip] of pairs) {
    if (isFingerExtended(landmarks, tip, pip)) count++;
  }
  // Thumb
  if (distance(landmarks[0], landmarks[4]) > distance(landmarks[0], landmarks[3]) * 1.1) {
    count++;
  }
  return count;
}
