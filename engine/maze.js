export function parseMaze(text) {
  const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length > 0);
  const width = Math.max(...rows.map((r) => r.length));
  const walls = [];
  let start = null;
  let exit = null;
  rows.forEach((row, z) => {
    for (let x = 0; x < width; x++) {
      const c = row[x] ?? '#';
      if (c === '#') walls.push({ x, z });
      else if (c === 'S') start = { x, z };
      else if (c === 'E') exit = { x, z };
    }
  });
  if (!start) throw new Error('The maze needs an S (start).');
  if (!exit) throw new Error('The maze needs an E (exit).');
  const wallSet = new Set(walls.map((w) => `${w.x},${w.z}`));
  return {
    width,
    height: rows.length,
    walls,
    start,
    exit,
    isWall: (x, z) => x < 0 || z < 0 || x >= width || z >= rows.length || wallSet.has(`${x},${z}`),
  };
}
