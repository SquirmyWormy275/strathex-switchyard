/** VIA 9 matrix query as implemented by the pinned Vial source; no key logging. */
export function matrixDimensions(rows, cols) {
  if (![rows, cols].every((n) => Number.isInteger(n) && n >= 1 && n <= 32) || rows * cols > 512) throw new Error("The verified matrix dimensions are unsupported.");
  // This is the firmware's compile guard, deliberately not ceil(cols / 8).
  if ((Math.floor(cols / 8) + 1) * rows > 28) throw new Error("This matrix exceeds the pinned firmware's switch-state query limit. No key state was requested.");
  return { rows, cols, bytesPerRow: Math.ceil(cols / 8) };
}
export function decodeMatrixState(response, rows, cols) {
  const { bytesPerRow } = matrixDimensions(rows, cols), r = Buffer.from(response);
  if (r.length !== 32 || r[0] !== 2 || r[1] !== 3 || r.subarray(2 + rows * bytesPerRow).some((n) => n !== 0)) throw new Error("The switch-state response does not match the bounded query.");
  const pressed = [];
  for (let row = 0; row < rows; row++) {
    const bits = r.readUIntBE(2 + row * bytesPerRow, bytesPerRow);
    if (bits >= 2 ** cols) throw new Error("The switch-state response contains columns outside the verified matrix.");
    for (let col = 0; col < cols; col++) if (Math.floor(bits / 2 ** col) % 2) pressed.push([row, col]);
  }
  return pressed;
}
