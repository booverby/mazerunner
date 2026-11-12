// Symbols: # wall, . floor, S start, E exit, a b c key, A B C matching locked door,
// M moving wall that starts raised, m moving wall that starts lowered, X monster spawn, H hiding place.
export function parseMaze(text) {
  const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length > 0);
  const width = Math.max(...rows.map((r) => r.length));
  const walls = [];
  const keys = [];
  const doors = [];
  const movers = [];
  const monsters = [];
  const hides = [];
  let start = null;
  let exit = null;
  rows.forEach((row, z) => {
    for (let x = 0; x < width; x++) {
      const c = row[x] ?? '#';
      if (c === '#') walls.push({ x, z });
      else if (c === 'S') start = { x, z };
      else if (c === 'E') exit = { x, z };
      else if ('abc'.includes(c)) keys.push({ x, z, id: c });
      else if ('ABC'.includes(c)) doors.push({ x, z, id: c.toLowerCase() });
      else if (c === 'M' || c === 'm') movers.push({ x, z, startsUp: c === 'M' });
      else if (c === 'X') monsters.push({ x, z });
      else if (c === 'H') hides.push({ x, z });
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
    keys,
    doors,
    movers,
    monsters,
    hides,
    // Only the fixed walls; doors and moving walls are floor here and block through the level's entities.
    isWall: (x, z) => x < 0 || z < 0 || x >= width || z >= rows.length || wallSet.has(`${x},${z}`),
  };
}
