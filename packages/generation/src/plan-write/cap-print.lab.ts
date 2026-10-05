/* Prints T3's measured option capacities and their menu lines (lab/t3 round 2). */
import { optionCapacity, t3Menu } from "./simple";

const t = Date.now();
console.log(
  "hinge",
  optionCapacity("hinge"),
  "matching",
  optionCapacity("matching"),
  `${Date.now() - t} ms`,
);
console.log(
  t3Menu()
    .split("\n")
    .filter((l) => /hinge|matching/.test(l))
    .join("\n"),
);
