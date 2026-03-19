import { moderateText } from "./filter.js";

const samples = [
  "привет",
  "секс",
  "сekс",
  "идиот",
  "нацизм",
  "white power",
  "t.me/test"
];

for (const sample of samples) {
  console.log(sample, "=>", JSON.stringify(moderateText(sample)));
}
